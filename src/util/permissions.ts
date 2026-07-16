import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import { config } from '@/config';
import { getGuildSettings } from '@/core/SettingsService';
import type { GokaiClient } from '@/types';

/**
 * Shared permission predicates used by both the messageCreate middleware and the
 * playback control commands. Centralised here so the DJ rules live in exactly one
 * place and never drift between the gate and the commands.
 */

/** Bot owners bypass every check. */
export function isBotOwner(userId: string): boolean {
  return config.ownerIds.includes(userId);
}

/**
 * Whether a member counts as a "DJ" for the guild:
 *   - bot owner, or
 *   - the current session's owner, or
 *   - a holder of the configured DJ role, or
 *   - (when no DJ role is set) anyone with Manage Server.
 */
export async function isDj(member: GuildMember, client: GokaiClient): Promise<boolean> {
  if (isBotOwner(member.id)) return true;

  const session = client.sessions.get(member.guild.id);
  if (session?.ownerId === member.id) return true;

  const settings = await getGuildSettings(member.guild.id);
  if (settings.djRoleId) {
    return member.roles.cache.has(settings.djRoleId);
  }

  // No DJ role configured → fall back to a moderator-level permission.
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}
