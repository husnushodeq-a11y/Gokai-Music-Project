import { Kazagumo, KazagumoPlayer, KazagumoTrack } from 'kazagumo';
import { Connectors } from 'shoukaku';
import { EmbedBuilder, type Client, type SendableChannels } from 'discord.js';
import { config } from '@/config';
import { getGuildSettings } from '@/core/SettingsService';
import { formatDuration } from '@/util/format';
import { requesterId } from '@/core/QueueManager';

/**
 * AudioManager — the thin, well-typed wrapper around Lavalink v4.
 *
 * We use **Kazagumo** (a queue-aware abstraction) on top of **Shoukaku**
 * (the raw Lavalink v4 driver). Kazagumo owns the low-level player and the
 * backing queue array; our `QueueManager` layers advanced manipulation on top,
 * and our `SessionManager` layers ownership/permissions on top of that.
 *
 * Responsibilities:
 *   1. Construct the Kazagumo instance and connect it to the Discord gateway.
 *   2. Emit the **static** "Now Playing" announcement on `playerStart`
 *      (a plain embed — never any buttons, per the strict UI rules).
 *   3. Re-emit the "queue drained" signal as a namespaced event so the
 *      SessionManager can apply 24/7 / auto-leave behaviour without reaching
 *      into Lavalink internals.
 */

/** Custom event fired when a player's queue empties (SessionManager listens). */
export const GOKAI_QUEUE_EMPTY = 'gokaiQueueEmpty';

/** Build & wire the Kazagumo instance for the given (not-yet-ready) client. */
export function createAudioManager(client: Client): Kazagumo {
  const kazagumo = new Kazagumo(
    {
      defaultSearchEngine: 'youtube',
      // Route Lavalink's outbound voice payloads back through discord.js' ws.
      send: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) guild.shard.send(payload);
      },
    },
    // Shoukaku connector for discord.js v14.
    new Connectors.DiscordJS(client),
    // Lavalink v4 nodes from validated config.
    config.lavalink.nodes.map((n) => ({
      name: n.name,
      url: n.url,
      auth: n.auth,
      secure: n.secure,
    })),
  );

  wireNodeDiagnostics(kazagumo);
  wirePlayerLifecycle(kazagumo, client);

  return kazagumo;
}

/** Log node connectivity so operational issues are visible in the console. */
function wireNodeDiagnostics(kazagumo: Kazagumo): void {
  kazagumo.shoukaku.on('ready', (name) => console.info(`[lavalink] node "${name}" ready`));
  kazagumo.shoukaku.on('error', (name, err) =>
    console.error(`[lavalink] node "${name}" error:`, err),
  );
  kazagumo.shoukaku.on('close', (name, code, reason) =>
    console.warn(`[lavalink] node "${name}" closed (${code}) ${reason ?? ''}`),
  );
  kazagumo.shoukaku.on('disconnect', (name, count) =>
    console.warn(`[lavalink] node "${name}" disconnected, ${count} players moved`),
  );
}

/** Wire the per-player lifecycle events that drive announcements + auto-leave. */
function wirePlayerLifecycle(kazagumo: Kazagumo, client: Client): void {
  // ── Track start → STATIC now-playing announcement (NO buttons). ────────────
  kazagumo.on('playerStart', (player, track) => {
    void announceNowPlaying(client, player, track).catch((err) =>
      console.error('[audio] failed to announce now playing:', err),
    );
  });

  // ── Queue drained → SessionManager decides 24/7 stay vs. timed leave. ──────
  kazagumo.on('playerEmpty', (player) => {
    kazagumo.emit(GOKAI_QUEUE_EMPTY as never, player as never);
  });
}

/**
 * Render and send the static "Now Playing" embed to the session's text channel.
 *
 * Per the strict UI rules this is a plain {@link EmbedBuilder} with **no**
 * action rows or buttons attached. The announcement copy honours the guild's
 * configurable `announceTemplate`.
 */
async function announceNowPlaying(
  client: Client,
  player: KazagumoPlayer,
  track: KazagumoTrack,
): Promise<void> {
  const channel = await resolveSendable(client, player.textId);
  if (!channel) return;

  const settings = await getGuildSettings(player.guildId);
  const duration = track.isStream ? 'LIVE' : formatDuration(track.length ?? 0);

  const description = settings.announceTemplate
    .replaceAll('{title}', track.title)
    .replaceAll('{author}', track.author ?? 'Unknown')
    .replaceAll('{duration}', duration)
    .replaceAll('{requester}', formatRequester(track))
    .replaceAll('{url}', track.uri ?? '');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: 'Now Playing' })
    .setTitle(track.title)
    .setURL(track.uri ?? null)
    .setDescription(description)
    .addFields(
      { name: 'Author', value: track.author ?? 'Unknown', inline: true },
      { name: 'Duration', value: track.isStream ? '🔴 LIVE' : duration, inline: true },
      { name: 'Requested by', value: formatRequester(track), inline: true },
    );

  if (track.thumbnail) embed.setThumbnail(track.thumbnail);

  // STATIC embed — deliberately no `components` field is ever attached here.
  await channel.send({ embeds: [embed] });
}

/** Resolve a channel id to a sendable text channel, fetching if uncached. */
async function resolveSendable(
  client: Client,
  channelId: string | null | undefined,
): Promise<SendableChannels | null> {
  if (!channelId) return null;
  const cached = client.channels.cache.get(channelId);
  if (cached?.isSendable()) return cached;
  try {
    const fetched = await client.channels.fetch(channelId);
    return fetched?.isSendable() ? fetched : null;
  } catch {
    return null;
  }
}

/** Render a track's requester as a mention (or a fallback label). */
function formatRequester(track: KazagumoTrack): string {
  const id = requesterId(track.requester);
  return id ? `<@${id}>` : 'Unknown';
}
