import { EmbedBuilder, type GuildMember, type Message } from 'discord.js';
import type { Command, CommandContext, CommandMeta, CommandRequirements } from '@/types';
import type { MusicSession } from '@/core/SessionManager';
import { isBotOwner, isDj } from '@/util/permissions';

/**
 * Session commands: claim / transfer / release, lock / unlock, allow / deny,
 * 247 and autoplay.
 *
 * The heavy lifting (state changes + persistence) already lives on
 * {@link MusicSession}; these are thin, well-guarded wrappers that resolve the
 * session, enforce the right authority level, and render a static confirmation.
 *
 * Authority model:
 *   - `claim` is open (that's how a session *gets* an owner).
 *   - Everything else requires "manage" authority: bot owner, the session owner,
 *     or — when the session is currently unowned — a DJ.
 */

/** Requirements shared by session-management commands. */
const MANAGE_REQ: CommandRequirements = {
  guildOnly: true,
  sessionRequired: true,
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

/** The guild's live session (existence guaranteed by `sessionRequired`). */
function sessionOf(ctx: CommandContext): MusicSession {
  return ctx.client.sessions.get(ctx.message.guildId!)!;
}

/**
 * Whether `member` may manage the session (transfer/lock/allow/deny/247/…).
 * Returns a reason string on denial for a friendly reply.
 */
async function canManage(
  session: MusicSession,
  member: GuildMember,
  ctx: CommandContext,
): Promise<{ allowed: boolean; reason?: string }> {
  if (isBotOwner(member.id)) return { allowed: true };
  if (session.ownerId === member.id) return { allowed: true };

  // Owned by someone else → only that owner (or a bot owner) may manage.
  if (session.ownerId) {
    return { allowed: false, reason: `Only the session owner (<@${session.ownerId}>) can do that.` };
  }

  // Unowned → allow DJs to manage.
  if (await isDj(member, ctx.client)) return { allowed: true };
  return { allowed: false, reason: `This session is unowned — \`${ctx.prefix}claim\` it first.` };
}

/** Resolve a target user id from the first mention or a raw snowflake argument. */
function resolveTargetId(message: Message, arg: string | undefined): string | null {
  const mentioned = message.mentions.users.first();
  if (mentioned) return mentioned.id;
  if (arg && /^\d{17,20}$/.test(arg)) return arg;
  return null;
}

// ── claim ─────────────────────────────────────────────────────────────────────

class ClaimCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'claim', aliases: [], description: 'Claim ownership of the session',
    category: 'sessions', subCategory: 'Ownership', usage: 'claim', examples: ['m!claim'],
  };
  public readonly requirements = MANAGE_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const session = sessionOf(ctx);
    const member = ctx.message.member as GuildMember;

    if (session.ownerId === member.id) {
      return void reply(ctx.message, '👑 You already own this session.');
    }
    const result = await session.claim(member.id);
    if (!result.allowed) {
      return void reply(ctx.message, `🚫 ${result.reason ?? 'This session is already owned.'}`);
    }
    await reply(ctx.message, '👑 You are now the owner of this session.');
  }
}

// ── transfer ──────────────────────────────────────────────────────────────────

class TransferCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'transfer', aliases: [], description: 'Transfer ownership to another user',
    category: 'sessions', subCategory: 'Ownership', usage: 'transfer <@user>', examples: ['m!transfer @Alice'],
  };
  public readonly requirements = MANAGE_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const session = sessionOf(ctx);
    const member = ctx.message.member as GuildMember;

    if (!session.ownerId) {
      return void reply(ctx.message, `ℹ️ This session has no owner yet — use \`${ctx.prefix}claim\`.`);
    }
    const auth = await canManage(session, member, ctx);
    if (!auth.allowed) return void reply(ctx.message, `🚫 ${auth.reason}`);

    const targetId = resolveTargetId(ctx.message, ctx.args[0]);
    if (!targetId) return void reply(ctx.message, '⚠️ Mention the user you want to transfer ownership to.');
    if (targetId === session.ownerId) return void reply(ctx.message, 'ℹ️ That user already owns the session.');

    await session.transfer(targetId);
    await reply(ctx.message, `👑 Ownership transferred to <@${targetId}>.`);
  }
}

// ── release ───────────────────────────────────────────────────────────────────

class ReleaseCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'release', aliases: [], description: 'Release ownership of the session',
    category: 'sessions', subCategory: 'Ownership', usage: 'release', examples: ['m!release'],
  };
  // Release does not require sharing the voice channel — the owner can free it
  // from anywhere in the guild.
  public readonly requirements: CommandRequirements = { guildOnly: true, sessionRequired: true };

  public async execute(ctx: CommandContext): Promise<void> {
    const session = sessionOf(ctx);
    const member = ctx.message.member as GuildMember;

    if (!session.ownerId) return void reply(ctx.message, 'ℹ️ This session is already unowned.');
    const auth = await canManage(session, member, ctx);
    if (!auth.allowed) return void reply(ctx.message, `🚫 ${auth.reason}`);

    await session.release();
    await reply(ctx.message, '🔓 Ownership released — anyone can now claim this session.');
  }
}

// ── lock / unlock ─────────────────────────────────────────────────────────────

class LockCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'lock', aliases: [], description: 'Lock the session to owner & allowed users',
    category: 'sessions', subCategory: 'Permissions', usage: 'lock', examples: ['m!lock'],
  };
  public readonly requirements = MANAGE_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const session = sessionOf(ctx);
    const member = ctx.message.member as GuildMember;
    const auth = await canManage(session, member, ctx);
    if (!auth.allowed) return void reply(ctx.message, `🚫 ${auth.reason}`);

    if (session.locked) return void reply(ctx.message, '🔒 The session is already locked.');
    await session.setLocked(true);
    await reply(ctx.message, '🔒 Session locked — only the owner, allowed users and DJs can control it.');
  }
}

class UnlockCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'unlock', aliases: [], description: 'Unlock the session for everyone',
    category: 'sessions', subCategory: 'Permissions', usage: 'unlock', examples: ['m!unlock'],
  };
  public readonly requirements = MANAGE_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const session = sessionOf(ctx);
    const member = ctx.message.member as GuildMember;
    const auth = await canManage(session, member, ctx);
    if (!auth.allowed) return void reply(ctx.message, `🚫 ${auth.reason}`);

    if (!session.locked) return void reply(ctx.message, '🔓 The session is already unlocked.');
    await session.setLocked(false);
    await reply(ctx.message, '🔓 Session unlocked — everyone can control playback again.');
  }
}

// ── allow / deny ──────────────────────────────────────────────────────────────

class AllowCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'allow', aliases: [], description: 'Allow a user to control the session',
    category: 'sessions', subCategory: 'Permissions', usage: 'allow <@user>', examples: ['m!allow @Bob'],
  };
  public readonly requirements = MANAGE_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const session = sessionOf(ctx);
    const member = ctx.message.member as GuildMember;
    const auth = await canManage(session, member, ctx);
    if (!auth.allowed) return void reply(ctx.message, `🚫 ${auth.reason}`);

    const targetId = resolveTargetId(ctx.message, ctx.args[0]);
    if (!targetId) return void reply(ctx.message, '⚠️ Mention the user you want to allow.');

    await session.allow(targetId);
    await reply(ctx.message, `✅ <@${targetId}> can now control this session.`);
  }
}

class DenyCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'deny', aliases: [], description: 'Deny a user control of the session',
    category: 'sessions', subCategory: 'Permissions', usage: 'deny <@user>', examples: ['m!deny @Bob'],
  };
  public readonly requirements = MANAGE_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const session = sessionOf(ctx);
    const member = ctx.message.member as GuildMember;
    const auth = await canManage(session, member, ctx);
    if (!auth.allowed) return void reply(ctx.message, `🚫 ${auth.reason}`);

    const targetId = resolveTargetId(ctx.message, ctx.args[0]);
    if (!targetId) return void reply(ctx.message, '⚠️ Mention the user you want to deny.');

    const result = await session.deny(targetId);
    if (!result.allowed) return void reply(ctx.message, `🚫 ${result.reason}`);
    await reply(ctx.message, `⛔ <@${targetId}> can no longer control this session.`);
  }
}

// ── 247 ───────────────────────────────────────────────────────────────────────

class TwentyFourSevenCommand implements Command {
  public readonly meta: CommandMeta = {
    name: '247', aliases: ['stay'], description: 'Toggle 24/7 always-on mode',
    category: 'sessions', subCategory: 'Modes', usage: '247', examples: ['m!247'],
  };
  public readonly requirements = MANAGE_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const session = sessionOf(ctx);
    const member = ctx.message.member as GuildMember;
    const auth = await canManage(session, member, ctx);
    if (!auth.allowed) return void reply(ctx.message, `🚫 ${auth.reason}`);

    const next = !session.mode247;
    await session.set247(next);

    if (next) {
      await reply(ctx.message, '♾️ 24/7 mode **enabled** — I will stay connected and restore this session after restarts.');
    } else {
      await reply(ctx.message, '⏱️ 24/7 mode **disabled** — I will leave when the channel is empty.');
      // If the channel is already empty, begin the auto-leave countdown now.
      if (session.getPresentUserIds(ctx.client).size === 0) session.onChannelEmpty(ctx.client);
    }
  }
}

// ── autoplay ──────────────────────────────────────────────────────────────────

class AutoplayCommand implements Command {
  public readonly meta: CommandMeta = {
    name: 'autoplay', aliases: ['ap'], description: 'Toggle autoplay recommendations',
    category: 'sessions', subCategory: 'Modes', usage: 'autoplay', examples: ['m!autoplay'],
  };
  public readonly requirements = MANAGE_REQ;

  public async execute(ctx: CommandContext): Promise<void> {
    const session = sessionOf(ctx);
    const member = ctx.message.member as GuildMember;
    const auth = await canManage(session, member, ctx);
    if (!auth.allowed) return void reply(ctx.message, `🚫 ${auth.reason}`);

    const next = !session.autoplay;
    await session.setAutoplay(next);
    await reply(ctx.message, next
      ? '🎶 Autoplay **enabled** — I will queue recommendations when the queue runs dry.'
      : '⏹️ Autoplay **disabled**.');
  }
}

/** All session commands, exported for registration. */
export const SESSION_COMMANDS: readonly Command[] = [
  new ClaimCommand(),
  new TransferCommand(),
  new ReleaseCommand(),
  new LockCommand(),
  new UnlockCommand(),
  new AllowCommand(),
  new DenyCommand(),
  new TwentyFourSevenCommand(),
  new AutoplayCommand(),
];
