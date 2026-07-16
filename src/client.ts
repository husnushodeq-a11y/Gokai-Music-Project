import { Client, Collection, GatewayIntentBits, Options, Partials } from 'discord.js';
import type { Command, GokaiClient } from '@/types';

/**
 * Build the discord.js client with exactly the intents a prefix-only music bot
 * needs. Crucially we request `MessageContent` (a privileged intent) because all
 * command triggers are prefix-based — there are no slash commands.
 *
 * The returned object is typed as {@link GokaiClient}: it already has an empty
 * `commands` collection; the long-lived managers (`audio`, `sessions`) are
 * attached by the bootstrap in `index.ts` once the client exists.
 */
export function createClient(): GokaiClient {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds, // guild + channel cache, voice state targets
      GatewayIntentBits.GuildMessages, // receive messages in guilds
      GatewayIntentBits.MessageContent, // read message text (prefix commands)
      GatewayIntentBits.GuildVoiceStates, // join/track voice channels
    ],
    partials: [Partials.Channel],
    // Keep the message cache small — we process messages on arrival and don't
    // need a large backlog, which keeps memory flat on big deployments.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 50,
    }),
  }) as GokaiClient;

  // Initialise the command registry up front; managers are attached later.
  client.commands = new Collection<string, Command>();

  return client;
}
