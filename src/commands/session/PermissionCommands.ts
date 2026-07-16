import { EmbedBuilder, type GuildMember } from 'discord.js';
import type { Command, CommandContext } from '@/types';
import type { MusicSession } from '@/core/SessionManager';
import { isBotOwner, isDj } from '@/util/permissions';
import { reply, sessionOf, resolveTargetId, ACCENT } from '@/util/commandHelpers';

/**
 * Session permission commands — inspect and bulk-manage the allow/deny lists
 * and lock state that {@link MusicSession.canControl} enforces.
 */

/** Manage authority: bot owner, session owner, or (unowned) a DJ. */
async function canManage(session: MusicSession, member: GuildMember, ctx: CommandContext): Promise<boolean> {
  if (isBotOwner(member.id)) return true;
  if (session.ownerId === member.id) return true;
  if (!session.ownerId && (await isDj(member, ctx.client))) return true;
  return false;
}

const permissionsCommand: Command = {
  meta: { name: 'permissions', aliases: ['perms'], description: 'Get the permissions of the current session or a user', category: 'sessions', subCategory: 'Permissions', usage: 'permissions [@user]', examples: ['m!permissions', 'm!permissions @Bob'] },
  requirements: { guildOnly: true, sessionRequired: true },
  execute: async (ctx) => {
    const session = sessionOf(ctx);

    // If a user is given, report their concrete control decision.
    const targetId = resolveTargetId(ctx.message, ctx.args[0]);
    if (targetId) {
      const member = await ctx.message.guild!.members.fetch(targetId).catch(() => null);
      if (!member) return void reply(ctx.message, '⚠️ Could not find that member.');
      const decision = await session.canControl(member);
      return void reply(ctx.message, decision.allowed
        ? `✅ <@${targetId}> can control this session.`
        : `⛔ <@${targetId}> cannot control this session — ${decision.reason}`);
    }

    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setAuthor({ name: 'Session Permissions' })
      .addFields(
        { name: 'Owner', value: session.ownerId ? `<@${session.ownerId}>` : 'Unclaimed', inline: true },
        { name: 'Locked', value: session.locked ? '🔒 Yes' : '🔓 No', inline: true },
        { name: 'Allowed', value: session.allowedUsers.size ? [...session.allowedUsers].map((id) => `<@${id}>`).join(', ') : '*none*', inline: false },
        { name: 'Denied', value: session.deniedUsers.size ? [...session.deniedUsers].map((id) => `<@${id}>`).join(', ') : '*none*', inline: false },
      );
    await reply(ctx.message, { embeds: [embed] });
  },
};

const permissionsResetCommand: Command = {
  meta: { name: 'permissionsreset', aliases: [], description: 'Reset the permissions of the session', category: 'sessions', subCategory: 'Permissions', usage: 'permissionsreset', examples: ['m!permissionsreset'] },
  requirements: { guildOnly: true, sessionRequired: true, sameVoiceRequired: true },
  execute: async (ctx) => {
    const session = sessionOf(ctx);
    const member = ctx.message.member as GuildMember;
    if (!(await canManage(session, member, ctx))) return void reply(ctx.message, '🚫 Only the session owner can reset permissions.');
    session.allowedUsers.clear();
    session.deniedUsers.clear();
    await session.setLocked(false);
    await reply(ctx.message, '♻️ Cleared all allow/deny entries and unlocked the session.');
  },
};

/** All permission commands, exported for registration. */
export const PERMISSION_COMMANDS: readonly Command[] = [permissionsCommand, permissionsResetCommand];
