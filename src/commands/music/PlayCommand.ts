import {
  EmbedBuilder,
  PermissionFlagsBits,
  type GuildMember,
  type Message,
  type VoiceBasedChannel,
} from 'discord.js';
import type { KazagumoTrack } from 'kazagumo';
import type { GuildSettings } from '@prisma/client';
import type { Command, CommandContext, CommandMeta, CommandRequirements } from '@/types';
import { getGuildSettings } from '@/core/SettingsService';
import type { MusicSession } from '@/core/SessionManager';
import { requesterId } from '@/core/QueueManager';
import { formatDuration, truncate } from '@/util/format';

/**
 * PlayCommand — `m!play <query|url>`.
 *
 * Responsibilities:
 *   1. Resolve the caller's voice channel and verify the bot can join/speak.
 *   2. Search Lavalink (URL, playlist or free-text search) via Kazagumo.
 *   3. Get-or-create the guild's session (the first person to play owns it).
 *   4. Enforce the guild's configurable limits (max track length, queue size).
 *   5. Enqueue and start playback if idle.
 *
 * UI contract — **everything this command sends is a static embed with no
 * components** (no buttons). The "Now Playing" announcement itself is emitted by
 * the AudioManager on `playerStart`, so this command deliberately does *not*
 * announce a track that begins playing immediately — it would duplicate that
 * static embed. It only confirms *additions to an existing queue* and playlists.
 */

const ACCENT = 0x5865f2;

class PlayCommandImpl implements Command {
  public readonly meta: CommandMeta = {
    name: 'play',
    aliases: ['p'],
    description: 'Play a track or playlist by search or URL',
    category: 'music',
    subCategory: 'Playback',
    usage: 'play <query>',
    examples: ['m!play never gonna give you up', 'm!play https://youtu.be/dQw4w9WgXcQ'],
  };

  // The middleware guarantees these before `execute` runs. `sameVoiceRequired`
  // only bites when a session already exists in a *different* channel.
  public readonly requirements: CommandRequirements = {
    guildOnly: true,
    voiceRequired: true,
    sameVoiceRequired: true,
  };

  public async execute(ctx: CommandContext): Promise<void> {
    const { message, client } = ctx;

    // `guildOnly` + `voiceRequired` are enforced upstream; narrow the types here.
    const member = message.member as GuildMember;
    const voiceChannel = member.voice.channel;
    if (!voiceChannel || !message.inGuild()) return;

    const query = ctx.rawArgs.trim();
    if (!query) {
      await reply(message, `🔎 Give me something to play — e.g. \`${ctx.prefix}play <song or url>\`.`);
      return;
    }

    // 1. Verify the bot can actually join and speak in the target channel.
    const permsError = checkVoicePermissions(voiceChannel, client.user.id);
    if (permsError) {
      await reply(message, permsError);
      return;
    }

    // 2. Search. Kazagumo transparently handles URLs, playlists and free text.
    const result = await client.audio
      .search(query, { requester: message.author })
      .catch(() => null);

    if (!result || result.tracks.length === 0) {
      await reply(message, `❌ No results found for **${truncate(query, 100)}**.`);
      return;
    }

    // 3. Get-or-create the session (first player to summon becomes the owner).
    const session = await client.sessions.getOrCreate({
      guildId: message.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: message.channelId,
      ownerId: message.author.id,
    });

    // Respect lock / deny-list before mutating the queue.
    const decision = await session.canControl(member);
    if (!decision.allowed) {
      await reply(message, `🚫 ${decision.reason ?? 'You cannot control this session.'}`);
      // If we *just* created an empty session for a denied user, tear it down.
      await this.destroyIfEmpty(session, client);
      return;
    }

    const settings = await getGuildSettings(message.guildId);
    const isPlaylist = result.type === 'PLAYLIST';

    // 4. Apply the guild limits (length, queue size, per-user cap, blacklists).
    const candidates = isPlaylist ? result.tracks : [result.tracks[0]!];
    const { accepted, notes } = applyLimits(session, settings, candidates, message.author.id);

    if (accepted.length === 0) {
      await reply(message, `⚠️ Nothing was added${notes ? ` — ${notes.replace('-# skipped: ', '')}` : '.'}`);
      await this.destroyIfEmpty(session, client);
      return;
    }

    // Was audio already flowing? Determines whether we announce an "add".
    const wasActive =
      Boolean(session.queue.current) || session.player.playing || session.player.paused;

    // 5. Enqueue + start playback if the player is idle.
    session.queue.add(accepted);
    if (!session.player.playing && !session.player.paused) {
      await session.player.play();
    }

    // Persist (snapshots the queue for 24/7 sessions).
    await session.persist().catch(() => undefined);

    // 6. Static, component-less feedback.
    await this.sendConfirmation(message, {
      isPlaylist,
      playlistName: result.playlistName,
      accepted,
      wasActive,
      session,
      notes,
    });
  }

  /** Build & send the appropriate static confirmation embed (never any buttons). */
  private async sendConfirmation(
    message: Message,
    opts: {
      isPlaylist: boolean;
      playlistName?: string;
      accepted: KazagumoTrack[];
      wasActive: boolean;
      session: MusicSession;
      notes: string;
    },
  ): Promise<void> {
    const { isPlaylist, accepted, wasActive, session, notes } = opts;

    // A single track that starts playing immediately is announced by the
    // AudioManager's static "Now Playing" embed — don't duplicate it here.
    if (!isPlaylist && !wasActive) return;

    const embed = new EmbedBuilder().setColor(ACCENT);

    if (isPlaylist) {
      const totalMs = accepted.reduce((s, t) => s + (t.isStream ? 0 : t.length ?? 0), 0);
      embed
        .setAuthor({ name: 'Added Playlist' })
        .setTitle(truncate(opts.playlistName ?? 'Playlist', 240))
        .setDescription(
          [
            `Queued **${accepted.length}** track${accepted.length === 1 ? '' : 's'}.`,
            `Total duration: **${formatDuration(totalMs)}**`,
            notes,
          ]
            .filter(Boolean)
            .join('\n'),
        );
    } else {
      const track = accepted[0]!;
      embed
        .setAuthor({ name: 'Added to Queue' })
        .setTitle(truncate(track.title, 240))
        .setURL(track.uri ?? null)
        .setDescription(
          [
            `**${track.author ?? 'Unknown'}** • ${track.isStream ? '🔴 LIVE' : formatDuration(track.length ?? 0)}`,
            `Position in queue: **${session.queue.size}**`,
            notes,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      if (track.thumbnail) embed.setThumbnail(track.thumbnail);
    }

    // STATIC — no `components` are ever attached.
    await reply(message, { embeds: [embed] });
  }

  /**
   * If a freshly-created session ended up with nothing queued and nothing
   * playing (e.g. a denied user or an all-rejected playlist), don't leave an
   * idle player connected — tear it back down.
   */
  private async destroyIfEmpty(session: MusicSession, client: CommandContext['client']): Promise<void> {
    const idle = !session.player.playing && !session.player.paused && session.queue.totalSize === 0;
    if (idle && !session.mode247) {
      await client.sessions.destroy(session.guildId).catch(() => undefined);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Outcome of applying guild limits to a set of candidate tracks. */
interface LimitOutcome {
  accepted: KazagumoTrack[];
  /** Pre-rendered "N skipped (reason)" note, or '' when nothing was skipped. */
  notes: string;
}

/**
 * Filter candidate tracks by every configured guild limit: max/min track length,
 * max queue size, per-user track cap, and title/author blacklists. A limit of 0
 * (or an empty blacklist) means "no restriction"; streams bypass length limits.
 */
function applyLimits(
  session: MusicSession,
  settings: GuildSettings,
  candidates: KazagumoTrack[],
  requesterUserId: string,
): LimitOutcome {
  const maxDuration = Number(settings.maxTrackDuration);
  const minDuration = Number(settings.minTrackDuration);
  const maxQueue = settings.maxQueueSize;
  const maxUser = settings.maxUserTracks;
  const titles = settings.blacklistedTitles;
  const authors = settings.blacklistedAuthors;

  let remaining = maxQueue > 0 ? Math.max(0, maxQueue - session.queue.totalSize) : Number.POSITIVE_INFINITY;

  // How many tracks this user already has queued (for the per-user cap).
  let userCount =
    maxUser > 0
      ? session.queue.upcoming.filter((t) => requesterId(t.requester) === requesterUserId).length
      : 0;

  const accepted: KazagumoTrack[] = [];
  const skipped = { long: 0, short: 0, full: 0, blacklisted: 0, userCap: 0 };

  for (const track of candidates) {
    const len = track.length ?? 0;
    const title = track.title.toLowerCase();
    const author = (track.author ?? '').toLowerCase();

    if (titles.some((t) => title.includes(t)) || authors.some((a) => author.includes(a))) {
      skipped.blacklisted++;
      continue;
    }
    if (!track.isStream && maxDuration > 0 && len > maxDuration) { skipped.long++; continue; }
    if (!track.isStream && minDuration > 0 && len < minDuration) { skipped.short++; continue; }
    if (remaining <= 0) { skipped.full++; continue; }
    if (maxUser > 0 && userCount >= maxUser) { skipped.userCap++; continue; }

    accepted.push(track);
    remaining--;
    userCount++;
  }

  const parts: string[] = [];
  if (skipped.long) parts.push(`${skipped.long} too long`);
  if (skipped.short) parts.push(`${skipped.short} too short`);
  if (skipped.full) parts.push(`${skipped.full} queue full`);
  if (skipped.userCap) parts.push(`${skipped.userCap} over your limit`);
  if (skipped.blacklisted) parts.push(`${skipped.blacklisted} blacklisted`);

  return { accepted, notes: parts.length ? `-# skipped: ${parts.join(' • ')}` : '' };
}

/** Ensure the bot has Connect (+ Speak, unless it's a stage) in the channel. */
function checkVoicePermissions(channel: VoiceBasedChannel, botId: string): string | null {
  const perms = channel.permissionsFor(botId);
  if (!perms) return '⚠️ I could not resolve my permissions for that channel.';
  if (!perms.has(PermissionFlagsBits.Connect)) return '🚫 I don\'t have permission to join that voice channel.';
  if (!perms.has(PermissionFlagsBits.Speak)) return '🚫 I don\'t have permission to speak in that voice channel.';
  return null;
}

/** Reply helper that never throws and never pings the replied-to user. */
async function reply(
  message: Message,
  content: string | { embeds: EmbedBuilder[] },
): Promise<void> {
  const payload = typeof content === 'string' ? { content } : content;
  try {
    await message.reply({ ...payload, allowedMentions: { repliedUser: false } });
  } catch {
    /* swallow — missing perms / deleted message */
  }
}

/** The command instance the loader registers. */
export const PlayCommand: Command = new PlayCommandImpl();
