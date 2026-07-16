import { config } from '@/config';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/client';
import { createAudioManager } from '@/audio/AudioManager';
import { SessionManager } from '@/core/SessionManager';
import { registerCommands } from '@/commands';
import { onMessageCreate } from '@/events/messageCreate';

/**
 * Bootstrap — composition root.
 *
 * Wiring order matters:
 *   1. Client (needs nothing).
 *   2. AudioManager / Kazagumo (needs the client for gateway voice plumbing).
 *   3. SessionManager (needs both the client and the audio facade).
 *   4. Command registry + event handlers.
 *   5. Login, then restore any 24/7 sessions once we're ready.
 */
async function main(): Promise<void> {
  const client = createClient();

  // 2 & 3 — attach the long-lived managers onto the client.
  const audio = createAudioManager(client);
  client.audio = audio;
  client.sessions = new SessionManager(client, audio);

  // 4 — commands + the prefix middleware.
  registerCommands(client);
  client.on('messageCreate', (message) => {
    void onMessageCreate(client, message);
  });

  // Auto-clean sessions whose voice channel empties (and un-cancel on rejoin).
  client.on('voiceStateUpdate', (oldState, newState) => {
    const guildId = oldState.guild.id;
    const session = client.sessions.get(guildId);
    if (!session) return;

    // A user relevant to our channel changed voice state.
    const present = session.getPresentUserIds(client);
    if (present.size === 0) session.onChannelEmpty(client);
    else session.onChannelPopulated();
    void oldState;
    void newState;
  });

  client.once('clientReady', async () => {
    console.info(`[gokai] logged in as ${client.user.tag} (prefix default: "${config.defaultPrefix}")`);
    // 5 — bring persisted 24/7 sessions back online.
    await client.sessions.restoreAll().catch((err) => {
      console.error('[gokai] failed restoring 24/7 sessions:', err);
    });
  });

  await client.login(config.discord.token);
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.info(`[gokai] received ${signal}, shutting down…`);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((err) => {
  console.error('[gokai] fatal bootstrap error:', err);
  process.exit(1);
});
