import type { Command, GokaiClient } from '@/types';
import { HelpCommand } from '@/commands/help/HelpCommand';
import { PlayCommand } from '@/commands/music/PlayCommand';

/**
 * Command registry.
 *
 * As the command layer is built out phase-by-phase, each new command is added to
 * {@link ALL_COMMANDS}. `registerCommands` indexes every command by its canonical
 * name *and* each alias into the client's `commands` collection, so the
 * messageCreate middleware can resolve a trigger token in O(1).
 */

/** Every command the bot exposes. New commands are appended here. */
export const ALL_COMMANDS: readonly Command[] = [
  HelpCommand,
  PlayCommand,
  // Further Phase 3+ commands (queue, sessions, settings, …) are added here.
];

/** Populate `client.commands` with names + aliases, guarding against clashes. */
export function registerCommands(client: GokaiClient): void {
  for (const command of ALL_COMMANDS) {
    register(client, command.meta.name, command);
    for (const alias of command.meta.aliases) {
      register(client, alias, command);
    }
  }
  console.info(`[commands] registered ${ALL_COMMANDS.length} commands.`);
}

/** Register a single trigger token, warning on accidental duplicates. */
function register(client: GokaiClient, token: string, command: Command): void {
  const key = token.toLowerCase();
  if (client.commands.has(key)) {
    console.warn(`[commands] duplicate trigger "${key}" — "${command.meta.name}" overwrites an existing entry.`);
  }
  client.commands.set(key, command);
}
