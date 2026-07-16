import type { Command, GokaiClient } from '@/types';
import { HelpCommand } from '@/commands/help/HelpCommand';
import { PlayCommand } from '@/commands/music/PlayCommand';
import { CONTROL_COMMANDS } from '@/commands/music/ControlCommands';
import { QueueCommand } from '@/commands/queue/QueueCommand';
import { QUEUE_STATE_COMMANDS } from '@/commands/queue/QueueStateCommands';
import { INFO_COMMANDS } from '@/commands/info/InfoCommands';
import { FILTER_COMMANDS } from '@/commands/filters/FilterCommands';
import { SESSION_COMMANDS } from '@/commands/session/SessionCommands';
import { PERMISSION_COMMANDS } from '@/commands/session/PermissionCommands';
import { CONFIG_COMMANDS } from '@/commands/config/ConfigCommands';
import { SETTINGS_COMMANDS } from '@/commands/settings/SettingsCommands';
import { PROFILE_COMMANDS } from '@/commands/profile/ProfileCommands';

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
  QueueCommand,
  ...CONTROL_COMMANDS,
  ...QUEUE_STATE_COMMANDS,
  ...INFO_COMMANDS,
  ...FILTER_COMMANDS,
  ...SESSION_COMMANDS,
  ...PERMISSION_COMMANDS,
  ...CONFIG_COMMANDS,
  ...SETTINGS_COMMANDS,
  ...PROFILE_COMMANDS,
  // Collections layer (save/load/share/…) is the remaining major group.
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
