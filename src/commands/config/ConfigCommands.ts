import { type GuildMember } from 'discord.js';
import type { Command, CommandMeta } from '@/types';
import { prisma } from '@/lib/prisma';
import { config } from '@/config';
import {
  getGuildSettings,
  getUserSettings,
  updateGuildSettings,
  updateUserSettings,
} from '@/core/SettingsService';
import { invalidateAliasCache } from '@/events/messageCreate';
import { isServerAdmin } from '@/util/permissions';
import { reply } from '@/util/commandHelpers';

/**
 * Prefix & command-alias commands.
 *
 * Prefix resolution is User → Server → Default; these commands let users set
 * their personal prefix and let admins set the server prefix and manage the
 * per-guild alias table (which the messageCreate middleware expands).
 */

// ── prefix (self) ─────────────────────────────────────────────────────────────

const prefixCommand: Command = {
  meta: { name: 'prefix', aliases: ['setprefix'], description: 'View or change your personal prefix', category: 'general', subCategory: 'Prefix', usage: 'prefix [new|reset]', examples: ['m!prefix', 'm!prefix ?', 'm!prefix reset'] } as CommandMeta,
  requirements: { guildOnly: false },
  execute: async (ctx) => {
    const arg = ctx.args[0];
    if (!arg) {
      const user = await getUserSettings(ctx.message.author.id);
      return void reply(ctx.message, `🔧 Your personal prefix is ${user?.prefix ? `**${user.prefix}**` : '*(not set)*'}. The active prefix here is **${ctx.prefix}**.\nSet one with \`${ctx.prefix}prefix <new>\` or clear it with \`${ctx.prefix}prefix reset\`.`);
    }
    if (arg.toLowerCase() === 'reset') {
      await updateUserSettings(ctx.message.author.id, { prefix: null });
      return void reply(ctx.message, '🔧 Cleared your personal prefix.');
    }
    if (arg.length > 8) return void reply(ctx.message, '⚠️ Prefixes must be 8 characters or fewer.');
    await updateUserSettings(ctx.message.author.id, { prefix: arg });
    await reply(ctx.message, `🔧 Your personal prefix is now **${arg}**.`);
  },
};

// ── prefix (server) ───────────────────────────────────────────────────────────

const prefixServerCommand: Command = {
  meta: { name: 'prefixserver', aliases: ['serverprefix'], description: 'Set a custom prefix for this server', category: 'general', subCategory: 'Prefix', usage: 'prefixserver <new|reset>', examples: ['m!prefixserver !', 'm!prefixserver reset'] },
  requirements: { guildOnly: true },
  execute: async (ctx) => {
    const member = ctx.message.member as GuildMember;
    if (!isServerAdmin(member)) return void reply(ctx.message, '🚫 You need the Manage Server permission to change the server prefix.');

    const arg = ctx.args[0];
    if (!arg) {
      const settings = await getGuildSettings(ctx.message.guildId!);
      return void reply(ctx.message, `🔧 The server prefix is ${settings.prefix ? `**${settings.prefix}**` : `*(default: ${config.defaultPrefix})*`}.`);
    }
    if (arg.toLowerCase() === 'reset') {
      await updateGuildSettings(ctx.message.guildId!, { prefix: null });
      return void reply(ctx.message, `🔧 Reset the server prefix to the default (**${config.defaultPrefix}**).`);
    }
    if (arg.length > 8) return void reply(ctx.message, '⚠️ Prefixes must be 8 characters or fewer.');
    await updateGuildSettings(ctx.message.guildId!, { prefix: arg });
    await reply(ctx.message, `🔧 The server prefix is now **${arg}**.`);
  },
};

// ── prefix list ───────────────────────────────────────────────────────────────

const prefixListCommand: Command = {
  meta: { name: 'prefixlist', aliases: ['prefixes'], description: 'Get all available prefixes', category: 'general', subCategory: 'Prefix', usage: 'prefixlist', examples: ['m!prefixlist'] },
  requirements: { guildOnly: false },
  execute: async (ctx) => {
    const user = await getUserSettings(ctx.message.author.id);
    const parts = [`Default: **${config.defaultPrefix}**`];
    if (ctx.message.inGuild()) {
      const settings = await getGuildSettings(ctx.message.guildId);
      if (settings.prefix) parts.push(`Server: **${settings.prefix}**`);
    }
    if (user?.prefix) parts.push(`You: **${user.prefix}**`);
    await reply(ctx.message, `🔧 **Available prefixes**\n${parts.join('\n')}`);
  },
};

// ── alias add ─────────────────────────────────────────────────────────────────

const aliasCommand: Command = {
  meta: { name: 'alias', aliases: ['aliasadd'], description: 'Create a custom command alias', category: 'general', subCategory: 'Aliases', usage: 'alias <name> <command> [args]', examples: ['m!alias pp play', 'm!alias lofi play lofi hip hop radio'] },
  requirements: { guildOnly: true },
  execute: async (ctx) => {
    const member = ctx.message.member as GuildMember;
    if (!isServerAdmin(member)) return void reply(ctx.message, '🚫 You need the Manage Server permission to manage aliases.');

    const name = ctx.args[0]?.toLowerCase();
    const command = ctx.args[1]?.toLowerCase();
    if (!name || !command) return void reply(ctx.message, '⚠️ Usage: `alias <name> <command> [args]`.');
    if (!ctx.client.commands.has(command)) return void reply(ctx.message, `⚠️ \`${command}\` is not a known command.`);

    const guildId = ctx.message.guildId!;
    const args = ctx.args.slice(2).join(' ') || null;
    await prisma.commandAlias.upsert({
      where: { guildId_alias: { guildId, alias: name } },
      create: { guildId, alias: name, command, arguments: args, createdBy: member.id },
      update: { command, arguments: args },
    });
    invalidateAliasCache(guildId);
    await reply(ctx.message, `✅ Alias **${name}** → \`${command}${args ? ' ' + args : ''}\` created.`);
  },
};

// ── alias list ────────────────────────────────────────────────────────────────

const aliasListCommand: Command = {
  meta: { name: 'aliaslist', aliases: ['aliases'], description: 'List all custom command aliases', category: 'general', subCategory: 'Aliases', usage: 'aliaslist', examples: ['m!aliaslist'] },
  requirements: { guildOnly: true },
  execute: async (ctx) => {
    const rows = await prisma.commandAlias.findMany({ where: { guildId: ctx.message.guildId! } });
    if (rows.length === 0) return void reply(ctx.message, 'ℹ️ This server has no custom aliases.');
    const lines = rows.map((r) => `**${r.alias}** → \`${r.command}${r.arguments ? ' ' + r.arguments : ''}\``);
    await reply(ctx.message, `🔗 **Custom aliases**\n${lines.join('\n')}`);
  },
};

// ── alias remove / clear ──────────────────────────────────────────────────────

const aliasRemoveCommand: Command = {
  meta: { name: 'aliasremove', aliases: ['aliasdelete'], description: 'Remove a custom command alias', category: 'general', subCategory: 'Aliases', usage: 'aliasremove <name>', examples: ['m!aliasremove pp'] },
  requirements: { guildOnly: true },
  execute: async (ctx) => {
    const member = ctx.message.member as GuildMember;
    if (!isServerAdmin(member)) return void reply(ctx.message, '🚫 You need the Manage Server permission to manage aliases.');
    const name = ctx.args[0]?.toLowerCase();
    if (!name) return void reply(ctx.message, '⚠️ Usage: `aliasremove <name>`.');
    const deleted = await prisma.commandAlias.deleteMany({ where: { guildId: ctx.message.guildId!, alias: name } });
    invalidateAliasCache(ctx.message.guildId!);
    await reply(ctx.message, deleted.count ? `🗑️ Removed alias **${name}**.` : `ℹ️ No alias named **${name}**.`);
  },
};

const aliasClearCommand: Command = {
  meta: { name: 'aliasclear', aliases: [], description: 'Clear all custom command aliases', category: 'general', subCategory: 'Aliases', usage: 'aliasclear', examples: ['m!aliasclear'] },
  requirements: { guildOnly: true },
  execute: async (ctx) => {
    const member = ctx.message.member as GuildMember;
    if (!isServerAdmin(member)) return void reply(ctx.message, '🚫 You need the Manage Server permission to manage aliases.');
    const deleted = await prisma.commandAlias.deleteMany({ where: { guildId: ctx.message.guildId! } });
    invalidateAliasCache(ctx.message.guildId!);
    await reply(ctx.message, `🧹 Cleared **${deleted.count}** alias(es).`);
  },
};

/** All prefix & alias commands, exported for registration. */
export const CONFIG_COMMANDS: readonly Command[] = [
  prefixCommand,
  prefixServerCommand,
  prefixListCommand,
  aliasCommand,
  aliasListCommand,
  aliasRemoveCommand,
  aliasClearCommand,
];
