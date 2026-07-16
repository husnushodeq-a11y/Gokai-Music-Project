import { EmbedBuilder, type GuildMember, type Message } from 'discord.js';
import type { Command, CommandContext, CommandMeta, CommandRequirements } from '@/types';
import type { MusicSession } from '@/core/SessionManager';
import { requesterId } from '@/core/QueueManager';
import { getGuildSettings } from '@/core/SettingsService';
import { isDj } from '@/util/permissions';
import { clamp, formatDuration, parseTimeToMs, progressBar } from '@/util/format';

/**
 * Playback control commands: pause, resume, stop, skip (vote-aware), loop,
 * volume, seek and nowplaying.
 *
 * All of these run against the guild's existing session (the middleware enforces
 * `sessionRequired` + `sameVoiceRequired`), and the mutating ones additionally
 * gate on {@link MusicSession.canControl} so lock / deny-list rules are honoured.
 * Every message sent is a static embed/text — no interactive components.
 */

const ACCENT = 0x5865f2;

/** Requirements shared by the mutating control commands. */
const CONTROL_REQ: CommandRequirements = {
  guildOnly: true,
  sessionRequired: true,
  voiceRequired: true,
  sameVoiceRequired: true,
};

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Reply helper that never throws and never pings the replied-to user. */
async function reply(message: Message, content: string | { embeds: EmbedBuilder[] }): Promise<void> {
  const payload = typeof content === 'string' ? { content } : content;
  try {
    await message.reply({ ...payload, allowedMentions: { repliedUser: false } });
  } catch {
    /* swallow */
  }
}

/**
 * Resolve the guild's session and verify the caller may control it. Returns null
 * (after replying with the reason) when control is denied. The middleware has
 * already guaranteed the session exists and the caller shares its voice channel.
 */
async function requireController(
  ctx: CommandContext,
): Promise<{ session: MusicSession; member: GuildMember } | null> {
  const session = ctx.client.sessions.get(ctx.message.guildId!)!;
  const member = ctx.message.member as GuildMember;
  const decision = await session.canControl(member);
  if (!decision.allowed) {
    await reply(ctx.message, `🚫 ${decision.reason ?? 'You cannot control this session.'}`);
    return null;
  }
  return { session, member };
}

// ── pause ─────────────────────────────────────────────────────────────────────

class PauseCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'pause', aliases: [], description: 'Pause the current track',
    category: 'music', subCategory: 'Playback', usage: 'pause', examples: ['m!pause'],
  };
  public readonly requirements = CONTROL_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    if (!ctrl.session.queue.current) return void reply(ctx.message, 'ℹ️ Nothing is playing.');
    if (ctrl.session.player.paused) return void reply(ctx.message, '⏸️ Already paused.');
    ctrl.session.player.pause(true);
    await reply(ctx.message, '⏸️ Paused.');
  }
}

// ── resume ──────────────────────────────────────────────────────────────────

class ResumeCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'resume', aliases: ['unpause'], description: 'Resume a paused track',
    category: 'music', subCategory: 'Playback', usage: 'resume', examples: ['m!resume'],
  };
  public readonly requirements = CONTROL_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    if (!ctrl.session.player.paused) return void reply(ctx.message, '▶️ Already playing.');
    ctrl.session.player.pause(false);
    await reply(ctx.message, '▶️ Resumed.');
  }
}

// ── stop ──────────────────────────────────────────────────────────────────────

class StopCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'stop', aliases: [], description: 'Stop playback and clear the queue',
    category: 'music', subCategory: 'Playback', usage: 'stop', examples: ['m!stop'],
  };
  public readonly requirements = CONTROL_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const { session } = ctrl;
    session.queue.clear();
    // Ending the current track with an empty queue stops playback; the empty
    // queue then drives the 24/7-aware auto-leave logic in SessionManager.
    if (session.queue.current) session.player.skip();
    session.clearSkipVotes();
    await session.persist().catch(() => undefined);
    await reply(ctx.message, '⏹️ Stopped playback and cleared the queue.');
  }
}

// ── skip (vote-aware) ─────────────────────────────────────────────────────────

class SkipCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'skip', aliases: ['s', 'next'], description: 'Skip the current track (vote-aware)',
    category: 'music', subCategory: 'Playback', usage: 'skip [amount]', examples: ['m!skip', 'm!skip 3'],
  };
  public readonly requirements = CONTROL_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const { session, member } = ctrl;

    const current = session.queue.current;
    if (!current) return void reply(ctx.message, 'ℹ️ Nothing is playing.');

    const listeners = session.getPresentUserIds(ctx.client).size;
    const isRequester = requesterId(current.requester) === member.id;
    const canForce = isRequester || listeners <= 1 || (await isDj(member, ctx.client));

    if (canForce) {
      // Optional multi-skip (e.g. `m!skip 3`) — DJ/force path only.
      const amount = Number(ctx.args[0]);
      if (Number.isInteger(amount) && amount > 1) {
        session.queue.removeRange(0, amount - 2); // drop the intermediate tracks
      }
      session.player.skip();
      session.clearSkipVotes();
      await session.persist().catch(() => undefined);
      return void reply(ctx.message, `⏭️ Skipped **${current.title}**.`);
    }

    // Vote-skip path.
    const settings = await getGuildSettings(session.guildId);
    const required = Math.max(1, Math.ceil((settings.voteSkipPercentage / 100) * listeners));
    const count = session.addSkipVote(member.id);

    if (count >= required) {
      session.player.skip();
      session.clearSkipVotes();
      return void reply(ctx.message, `⏭️ Vote passed — skipped **${current.title}**.`);
    }
    await reply(ctx.message, `🗳️ Vote to skip **${current.title}**: **${count}/${required}**.`);
  }
}

// ── loop ──────────────────────────────────────────────────────────────────────

class LoopCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'loop', aliases: ['repeat'], description: 'Set loop mode: off, track or queue',
    category: 'music', subCategory: 'Sound', usage: 'loop <off|track|queue>', examples: ['m!loop track', 'm!loop queue', 'm!loop off'],
  };
  public readonly requirements = CONTROL_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;

    const mode = normaliseLoop(ctx.args[0]);
    if (!mode) {
      const current = ctrl.session.player.loop;
      return void reply(ctx.message, `🔁 Loop is **${current}**. Use \`${ctx.prefix}loop <off|track|queue>\`.`);
    }
    ctrl.session.queue.setLoop(mode);
    await ctrl.session.persist().catch(() => undefined);
    const label = mode === 'none' ? 'off' : mode;
    await reply(ctx.message, `🔁 Loop set to **${label}**.`);
  }
}

/** Map user input to a Kazagumo loop mode, or null if unrecognised. */
function normaliseLoop(input?: string): 'none' | 'track' | 'queue' | null {
  switch (input?.toLowerCase()) {
    case 'off': case 'none': case 'disable': return 'none';
    case 'track': case 'song': case 'one': case 'current': return 'track';
    case 'queue': case 'all': case 'q': return 'queue';
    default: return null;
  }
}

// ── volume ────────────────────────────────────────────────────────────────────

class VolumeCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'volume', aliases: ['vol'], description: 'View or set the playback volume',
    category: 'music', subCategory: 'Sound', usage: 'volume [0-200]', examples: ['m!volume', 'm!volume 80'],
  };
  public readonly requirements = CONTROL_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const session = ctx.client.sessions.get(ctx.message.guildId!)!;

    // Reading the volume needs no control permission.
    if (ctx.args.length === 0) {
      return void reply(ctx.message, `🔊 Volume is **${session.player.volume}%**.`);
    }

    const ctrl = await requireController(ctx);
    if (!ctrl) return;

    const requested = Number(ctx.args[0]);
    if (!Number.isFinite(requested)) {
      return void reply(ctx.message, `⚠️ Give me a number between 0 and 200 — e.g. \`${ctx.prefix}volume 80\`.`);
    }
    const volume = clamp(Math.round(requested), 0, 200);
    await session.player.setVolume(volume);
    await session.persist().catch(() => undefined);
    await reply(ctx.message, `🔊 Volume set to **${volume}%**.`);
  }
}

// ── seek ──────────────────────────────────────────────────────────────────────

class SeekCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'seek', aliases: [], description: 'Seek to a position in the track',
    category: 'music', subCategory: 'Playback', usage: 'seek <time>', examples: ['m!seek 1:30', 'm!seek 90', 'm!seek 2m10s'],
  };
  public readonly requirements = CONTROL_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const { session } = ctrl;

    const current = session.queue.current;
    if (!current) return void reply(ctx.message, 'ℹ️ Nothing is playing.');
    if (current.isStream || !current.isSeekable) {
      return void reply(ctx.message, '🚫 This track cannot be seeked.');
    }

    const ms = parseTimeToMs(ctx.rawArgs);
    if (ms === null) {
      return void reply(ctx.message, `⚠️ I couldn't parse that time. Try \`${ctx.prefix}seek 1:30\`.`);
    }
    const target = clamp(ms, 0, current.length ?? 0);
    try {
      await session.player.seek(target); // Kazagumo seeks in milliseconds
    } catch {
      return void reply(ctx.message, '🚫 Failed to seek that track.');
    }
    await reply(ctx.message, `⏩ Seeked to **${formatDuration(target)}**.`);
  }
}

// ── nowplaying ────────────────────────────────────────────────────────────────

class NowPlayingCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'nowplaying', aliases: ['np'], description: 'Show the track currently playing',
    category: 'music', subCategory: 'Sound', usage: 'nowplaying', examples: ['m!nowplaying', 'm!np'],
  };
  // Viewing does not require being in the voice channel.
  public readonly requirements: CommandRequirements = { guildOnly: true, sessionRequired: true };

  public async execute(ctx: CommandContext): Promise<void> {
    const session = ctx.client.sessions.get(ctx.message.guildId!)!;
    const current = session.queue.current;
    if (!current) return void reply(ctx.message, 'ℹ️ Nothing is playing right now.');

    const position = session.player.position;
    const length = current.length ?? 0;
    const bar = current.isStream ? '🔴 LIVE' : `${progressBar(position, length)}`;
    const time = current.isStream ? 'LIVE' : `${formatDuration(position)} / ${formatDuration(length)}`;
    const requester = requesterId(current.requester);

    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setAuthor({ name: 'Now Playing' })
      .setTitle(current.title)
      .setURL(current.uri ?? null)
      .setDescription(`${bar}\n\`${time}\``)
      .addFields(
        { name: 'Author', value: current.author ?? 'Unknown', inline: true },
        { name: 'Requested by', value: requester ? `<@${requester}>` : 'Unknown', inline: true },
        { name: 'Loop', value: session.player.loop, inline: true },
      )
      .setFooter({ text: `Volume ${session.player.volume}% • ${session.queue.size} track(s) up next` });

    if (current.thumbnail) embed.setThumbnail(current.thumbnail);
    // Static — no components.
    await reply(ctx.message, { embeds: [embed] });
  }
}

/** All playback control commands, exported for registration. */
export const CONTROL_COMMANDS: readonly Command[] = [
  new PauseCommand(),
  new ResumeCommand(),
  new StopCommand(),
  new SkipCommand(),
  new LoopCommand(),
  new VolumeCommand(),
  new SeekCommand(),
  new NowPlayingCommand(),
];
