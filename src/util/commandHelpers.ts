import { EmbedBuilder, type GuildMember, type Message } from 'discord.js';
import type { CommandContext } from '@/types';
import type { MusicSession } from '@/core/SessionManager';

/**
 * Small shared helpers used across the command layer to cut boilerplate:
 * safe replies, session resolution, control gating and argument parsing.
 */

/** A reply payload: plain text or an embed message. */
export type ReplyContent = string | { embeds: EmbedBuilder[]; content?: string };

/** Reply without ever throwing and without pinging the replied-to user. */
export async function reply(message: Message, content: ReplyContent): Promise<void> {
  const payload = typeof content === 'string' ? { content } : content;
  try {
    await message.reply({ ...payload, allowedMentions: { repliedUser: false } });
  } catch {
    /* swallow — missing perms / deleted message */
  }
}

/** The guild's live session (existence guaranteed by `sessionRequired`). */
export function sessionOf(ctx: CommandContext): MusicSession {
  return ctx.client.sessions.get(ctx.message.guildId!)!;
}

/**
 * Resolve the session and verify the caller may control it (lock / deny-list).
 * Replies with the denial reason and returns null when control is refused.
 */
export async function requireController(
  ctx: CommandContext,
): Promise<{ session: MusicSession; member: GuildMember } | null> {
  const session = sessionOf(ctx);
  const member = ctx.message.member as GuildMember;
  const decision = await session.canControl(member);
  if (!decision.allowed) {
    await reply(ctx.message, `🚫 ${decision.reason ?? 'You cannot control this session.'}`);
    return null;
  }
  return { session, member };
}

/** Resolve a target user id from the first mention or a raw snowflake argument. */
export function resolveTargetId(message: Message, arg: string | undefined): string | null {
  const mentioned = message.mentions.users.first();
  if (mentioned) return mentioned.id;
  if (arg && /^\d{17,20}$/.test(arg)) return arg;
  return null;
}

/**
 * Parse a 1-based position argument into a 0-based index, or null if invalid.
 * Users type "1" for the first upcoming track; we store 0-based internally.
 */
export function parsePosition(arg: string | undefined): number | null {
  if (arg === undefined) return null;
  const n = Number(arg);
  if (!Number.isInteger(n) || n < 1) return null;
  return n - 1;
}

/** Standard embed accent colour used across the bot. */
export const ACCENT = 0x5865f2;
