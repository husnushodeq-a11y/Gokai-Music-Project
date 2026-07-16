import {
  PermissionFlagsBits,
  type GuildMember,
  type Message,
} from 'discord.js';
import { prisma } from '@/lib/prisma';
import { config } from '@/config';
import { resolvePrefix, getGuildSettings } from '@/core/SettingsService';
import { isBlacklisted } from '@/core/BlacklistService';
import type { Command, CommandContext, GokaiClient } from '@/types';

/**
 * messageCreate middleware — the single entry point that turns a raw Discord
 * message into a resolved, permission-checked command invocation.
 *
 * Pipeline (fail-fast, cheapest checks first):
 *   1. Ignore bots / webhooks / system messages.
 *   2. Resolve the effective prefix (User → Server → Default) and match it
 *      (a leading bot-mention is also accepted as a prefix).
 *   3. Tokenise into `command` + `args`.
 *   4. Expand per-guild command aliases.
 *   5. Look up the command in the registry.
 *   6. Blacklist gate (user / guild / global).
 *   7. Enforce the command's declared requirements (guild/voice/session/DJ/owner).
 *   8. Build the CommandContext and execute, funnelling errors to one handler.
 *
 * Every step that rejects does so quietly or with a single short reply — never a
 * stack trace to the user.
 */

/** Small per-guild alias cache so we don't hit Postgres on every message. */
interface AliasCacheEntry {
  map: Map<string, { command: string; arguments: string | null }>;
  expiresAt: number;
}
const aliasCache = new Map<string, AliasCacheEntry>();
const ALIAS_TTL_MS = 60_000;

/** Load (and cache) a guild's alias table. */
async function getAliases(guildId: string): Promise<AliasCacheEntry['map']> {
  const cached = aliasCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.map;

  const rows = await prisma.commandAlias.findMany({ where: { guildId } });
  const map = new Map(rows.map((r) => [r.alias.toLowerCase(), { command: r.command, arguments: r.arguments }]));
  aliasCache.set(guildId, { map, expiresAt: Date.now() + ALIAS_TTL_MS });
  return map;
}

/** Entry point registered on the client's `messageCreate` event. */
export async function onMessageCreate(client: GokaiClient, message: Message): Promise<void> {
  // 1. Ignore non-human authors and system messages outright.
  if (message.author.bot || message.webhookId || message.system) return;
  if (!message.content) return;

  // 2. Resolve prefix and match it (supports a leading bot mention too).
  const prefix = await resolvePrefix(message.guildId, message.author.id);
  const matched = matchPrefix(message, client, prefix);
  if (!matched) return;

  // 3. Tokenise. `commandToken` is the first word; `rest` is everything after.
  const withoutPrefix = message.content.slice(matched.length).trim();
  if (withoutPrefix.length === 0) return;

  const firstSpace = withoutPrefix.search(/\s/);
  let commandToken = (firstSpace === -1 ? withoutPrefix : withoutPrefix.slice(0, firstSpace)).toLowerCase();
  let rest = firstSpace === -1 ? '' : withoutPrefix.slice(firstSpace + 1).trim();

  // 4. Expand a guild alias (aliases can inject canned arguments).
  if (message.guildId) {
    const aliases = await getAliases(message.guildId);
    const alias = aliases.get(commandToken);
    if (alias) {
      commandToken = alias.command.toLowerCase();
      rest = [alias.arguments ?? '', rest].filter(Boolean).join(' ').trim();
    }
  }

  // 5. Resolve command (by name or built-in alias).
  const command = client.commands.get(commandToken);
  if (!command) return;

  // 6. Blacklist gate — silently ignore blacklisted callers.
  const blacklist = await isBlacklisted(message.author.id, message.guildId);
  if (blacklist.blocked) return;

  // 7. Enforce declared requirements.
  const requirementError = await checkRequirements(command, message, client);
  if (requirementError) {
    await safeReply(message, requirementError);
    return;
  }

  // 8. Build context and execute under a single error boundary.
  const ctx: CommandContext = {
    message,
    args: rest.length ? rest.split(/\s+/) : [],
    rawArgs: rest,
    prefix: matched,
    client,
  };

  try {
    await command.execute(ctx);
  } catch (err) {
    console.error(`[command:${command.meta.name}] execution failed:`, err);
    await safeReply(message, '⚠️ Something went wrong while running that command.');
  }
}

/**
 * Return the matched prefix string if the message begins with the resolved
 * prefix or a leading mention of the bot; otherwise null.
 */
function matchPrefix(message: Message, client: GokaiClient, prefix: string): string | null {
  if (message.content.startsWith(prefix)) return prefix;

  // Accept "<@id> " / "<@!id> " as an alternative prefix.
  const mention = new RegExp(`^<@!?${client.user.id}>\\s*`);
  const m = mention.exec(message.content);
  return m ? m[0] : null;
}

/**
 * Validate a command's declared requirements against the invocation.
 * Returns a user-facing error string on failure, or null when all pass.
 */
async function checkRequirements(
  command: Command,
  message: Message,
  client: GokaiClient,
): Promise<string | null> {
  const req = command.requirements ?? {};
  const guildOnly = req.guildOnly ?? true;

  if (guildOnly && !message.inGuild()) {
    return '🚫 This command can only be used in a server.';
  }

  if (req.ownerOnly && !config.ownerIds.includes(message.author.id)) {
    return '🚫 This command is restricted to the bot owners.';
  }

  // Remaining checks only make sense inside a guild.
  if (!message.inGuild()) return null;
  const member = message.member as GuildMember | null;
  if (!member) return null;

  if (req.voiceRequired && !member.voice.channel) {
    return '🔇 You need to be in a voice channel to use that.';
  }

  const session = client.sessions.get(message.guildId);

  if (req.sessionRequired && !session) {
    return '⏹️ There is no active music session in this server.';
  }

  if (req.sameVoiceRequired && session) {
    if (member.voice.channelId !== session.voiceChannelId) {
      return '🔇 You need to be in the same voice channel as the bot.';
    }
  }

  if (req.djOnly && !(await passesDjCheck(member, client, message.guildId))) {
    return '🎧 Only DJs can use that command.';
  }

  return null;
}

/** DJ gate: bot owner, session owner, DJ-role holder, or Manage Server. */
async function passesDjCheck(
  member: GuildMember,
  client: GokaiClient,
  guildId: string,
): Promise<boolean> {
  if (config.ownerIds.includes(member.id)) return true;

  const session = client.sessions.get(guildId);
  if (session?.ownerId === member.id) return true;

  const settings = await getGuildSettings(guildId);
  if (settings.djRoleId && member.roles.cache.has(settings.djRoleId)) return true;

  // Fall back to a moderator-level permission when no DJ role is configured.
  if (!settings.djRoleId && member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }

  return false;
}

/** Reply without ever throwing (missing perms, deleted message, …). */
async function safeReply(message: Message, content: string): Promise<void> {
  try {
    await message.reply({ content, allowedMentions: { repliedUser: false } });
  } catch {
    /* swallow — the user simply won't see the notice */
  }
}

/** Invalidate the alias cache for a guild after an alias is added/removed. */
export function invalidateAliasCache(guildId: string): void {
  aliasCache.delete(guildId);
}
