import { EmbedBuilder, type GuildMember } from 'discord.js';
import type { Command, CommandContext, CommandMeta } from '@/types';
import { getGuildSettings, updateGuildSettings, invalidateSettingsCache } from '@/core/SettingsService';
import { isServerAdmin } from '@/util/permissions';
import { reply, ACCENT } from '@/util/commandHelpers';
import { clamp, formatDuration, parseTimeToMs } from '@/util/format';

/**
 * Server/session settings commands — the granular configuration surface from
 * Jockie's "Settings" pages. All require the Manage Server permission and write
 * through {@link updateGuildSettings} (which keeps the settings cache fresh).
 */

/** Build an admin-gated guild command. */
function admin(meta: CommandMeta, run: (ctx: CommandContext, member: GuildMember) => Promise<void>): Command {
  return {
    meta,
    requirements: { guildOnly: true },
    execute: async (ctx) => {
      const member = ctx.message.member as GuildMember;
      if (!isServerAdmin(member)) {
        return void reply(ctx.message, '🚫 You need the Manage Server permission to change settings.');
      }
      await run(ctx, member);
    },
  };
}

// ── settings (view) ───────────────────────────────────────────────────────────

const settingsCommand: Command = {
  meta: { name: 'settings', aliases: ['config'], description: 'View all session settings', category: 'settings', subCategory: 'Server', usage: 'settings', examples: ['m!settings'] },
  requirements: { guildOnly: true },
  execute: async (ctx) => {
    const s = await getGuildSettings(ctx.message.guildId!);
    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setAuthor({ name: 'Server Settings' })
      .addFields(
        { name: 'Prefix', value: s.prefix ?? '*(default)*', inline: true },
        { name: 'Default volume', value: `${s.defaultVolume}%`, inline: true },
        { name: 'Max queue size', value: s.maxQueueSize ? String(s.maxQueueSize) : 'Unlimited', inline: true },
        { name: 'Max track length', value: s.maxTrackDuration ? formatDuration(Number(s.maxTrackDuration)) : 'Unlimited', inline: true },
        { name: 'Min track length', value: s.minTrackDuration ? formatDuration(Number(s.minTrackDuration)) : 'None', inline: true },
        { name: 'Max user tracks', value: s.maxUserTracks ? String(s.maxUserTracks) : 'Unlimited', inline: true },
        { name: 'Vote skip', value: s.voteSkipEnabled ? `${s.voteSkipPercentage}%` : 'Disabled', inline: true },
        { name: 'DJ role', value: s.djRoleId ? `<@&${s.djRoleId}>` : 'None', inline: true },
        { name: 'Search type', value: s.searchType, inline: true },
        { name: 'Default 24/7', value: s.default247 ? 'On' : 'Off', inline: true },
        { name: 'Default autoplay', value: s.defaultAutoplay ? 'On' : 'Off', inline: true },
        { name: 'Blacklists', value: `${s.blacklistedTitles.length} titles • ${s.blacklistedAuthors.length} authors`, inline: true },
        { name: 'Announcement', value: `\`${s.announceTemplate}\``, inline: false },
      );
    await reply(ctx.message, { embeds: [embed] });
  },
};

// ── settings reset ────────────────────────────────────────────────────────────

const settingsResetCommand = admin(
  { name: 'settingsreset', aliases: [], description: 'Reset all the settings', category: 'settings', subCategory: 'Server', usage: 'settingsreset', examples: ['m!settingsreset'] },
  async (ctx) => {
    await updateGuildSettings(ctx.message.guildId!, {
      prefix: null, defaultVolume: 100, maxQueueSize: 1000, maxTrackDuration: BigInt(0),
      minTrackDuration: BigInt(0), maxUserTracks: 0, voteSkipEnabled: true, voteSkipPercentage: 50,
      djRoleId: null, searchType: 'youtube', default247: false, defaultAutoplay: false,
      announceTemplate: 'Now playing **{title}** by **{author}**',
      blacklistedTitles: [], blacklistedAuthors: [],
    });
    invalidateSettingsCache({ guildId: ctx.message.guildId! });
    await reply(ctx.message, '♻️ All server settings have been reset to their defaults.');
  },
);

// ── djrole ────────────────────────────────────────────────────────────────────

const djRoleCommand = admin(
  { name: 'djrole', aliases: [], description: 'Set the DJ role', category: 'settings', subCategory: 'Server', usage: 'djrole <@role|reset>', examples: ['m!djrole @DJ', 'm!djrole reset'] },
  async (ctx) => {
    const arg = ctx.args[0];
    if (arg?.toLowerCase() === 'reset' || !arg) {
      await updateGuildSettings(ctx.message.guildId!, { djRoleId: null });
      return void reply(ctx.message, '🎧 Cleared the DJ role.');
    }
    const roleId = ctx.message.mentions.roles.first()?.id ?? (/^\d{17,20}$/.test(arg) ? arg : null);
    if (!roleId) return void reply(ctx.message, '⚠️ Mention a role or provide a role id.');
    await updateGuildSettings(ctx.message.guildId!, { djRoleId: roleId });
    await reply(ctx.message, `🎧 DJ role set to <@&${roleId}>.`);
  },
);

// ── voteskip (percentage / toggle) ────────────────────────────────────────────

const voteSkipCommand = admin(
  { name: 'voteskip', aliases: [], description: 'Set the vote-skip percentage or toggle it', category: 'settings', subCategory: 'Server', usage: 'voteskip <1-100|off>', examples: ['m!voteskip 60', 'm!voteskip off'] },
  async (ctx) => {
    const arg = ctx.args[0]?.toLowerCase();
    if (arg === 'off' || arg === 'disable') {
      await updateGuildSettings(ctx.message.guildId!, { voteSkipEnabled: false });
      return void reply(ctx.message, '🗳️ Vote-skip disabled — controllers now skip instantly.');
    }
    const pct = Number(arg);
    if (!Number.isFinite(pct)) return void reply(ctx.message, '⚠️ Usage: `voteskip <1-100|off>`.');
    const value = clamp(Math.round(pct), 1, 100);
    await updateGuildSettings(ctx.message.guildId!, { voteSkipEnabled: true, voteSkipPercentage: value });
    await reply(ctx.message, `🗳️ Vote-skip set to **${value}%** of listeners.`);
  },
);

// ── defaultvolume ─────────────────────────────────────────────────────────────

const defaultVolumeCommand = admin(
  { name: 'defaultvolume', aliases: [], description: 'Set the default session volume', category: 'settings', subCategory: 'Playback Defaults', usage: 'defaultvolume <0-200>', examples: ['m!defaultvolume 80'] },
  async (ctx) => {
    const v = Number(ctx.args[0]);
    if (!Number.isFinite(v)) return void reply(ctx.message, '⚠️ Usage: `defaultvolume <0-200>`.');
    const value = clamp(Math.round(v), 0, 200);
    await updateGuildSettings(ctx.message.guildId!, { defaultVolume: value });
    await reply(ctx.message, `🔊 Default volume set to **${value}%**.`);
  },
);

// ── maxqueue / maxtracklength / mintracklength / maxusertracks ────────────────

const maxQueueCommand = admin(
  { name: 'maxqueue', aliases: [], description: 'Set the maximum queue size', category: 'settings', subCategory: 'Playback Defaults', usage: 'maxqueue <n|0>', examples: ['m!maxqueue 500'] },
  async (ctx) => {
    const n = Number(ctx.args[0]);
    if (!Number.isInteger(n) || n < 0) return void reply(ctx.message, '⚠️ Usage: `maxqueue <n|0>` (0 = unlimited).');
    await updateGuildSettings(ctx.message.guildId!, { maxQueueSize: n });
    await reply(ctx.message, `📋 Max queue size set to **${n === 0 ? 'unlimited' : n}**.`);
  },
);

const maxTrackLengthCommand = admin(
  { name: 'maxtracklength', aliases: ['maxlength'], description: 'Set the max track length', category: 'settings', subCategory: 'Playback Defaults', usage: 'maxtracklength <time|0>', examples: ['m!maxtracklength 10:00', 'm!maxtracklength 0'] },
  async (ctx) => {
    const arg = ctx.args[0];
    if (arg === '0') { await updateGuildSettings(ctx.message.guildId!, { maxTrackDuration: BigInt(0) }); return void reply(ctx.message, '⏱️ Max track length: unlimited.'); }
    const ms = parseTimeToMs(arg ?? '');
    if (ms === null) return void reply(ctx.message, '⚠️ Usage: `maxtracklength <time|0>` (e.g. `10:00`).');
    await updateGuildSettings(ctx.message.guildId!, { maxTrackDuration: BigInt(ms) });
    await reply(ctx.message, `⏱️ Max track length set to **${formatDuration(ms)}**.`);
  },
);

const minTrackLengthCommand = admin(
  { name: 'mintracklength', aliases: ['minlength'], description: 'Set the min track length', category: 'settings', subCategory: 'Playback Defaults', usage: 'mintracklength <time|0>', examples: ['m!mintracklength 0:30'] },
  async (ctx) => {
    const arg = ctx.args[0];
    if (arg === '0') { await updateGuildSettings(ctx.message.guildId!, { minTrackDuration: BigInt(0) }); return void reply(ctx.message, '⏱️ Min track length: none.'); }
    const ms = parseTimeToMs(arg ?? '');
    if (ms === null) return void reply(ctx.message, '⚠️ Usage: `mintracklength <time|0>`.');
    await updateGuildSettings(ctx.message.guildId!, { minTrackDuration: BigInt(ms) });
    await reply(ctx.message, `⏱️ Min track length set to **${formatDuration(ms)}**.`);
  },
);

const maxUserTracksCommand = admin(
  { name: 'maxusertracks', aliases: [], description: 'Set the max queued tracks for a single user', category: 'settings', subCategory: 'Playback Defaults', usage: 'maxusertracks <n|0>', examples: ['m!maxusertracks 25'] },
  async (ctx) => {
    const n = Number(ctx.args[0]);
    if (!Number.isInteger(n) || n < 0) return void reply(ctx.message, '⚠️ Usage: `maxusertracks <n|0>` (0 = unlimited).');
    await updateGuildSettings(ctx.message.guildId!, { maxUserTracks: n });
    await reply(ctx.message, `👤 Max tracks per user set to **${n === 0 ? 'unlimited' : n}**.`);
  },
);

// ── announce template ─────────────────────────────────────────────────────────

const announceCommand = admin(
  { name: 'announce', aliases: [], description: 'Set the now-playing announcement template', category: 'settings', subCategory: 'Playback Defaults', usage: 'announce <template|reset>', examples: ['m!announce Now spinning {title}!'] },
  async (ctx) => {
    const raw = ctx.rawArgs.trim();
    if (!raw || raw.toLowerCase() === 'reset') {
      await updateGuildSettings(ctx.message.guildId!, { announceTemplate: 'Now playing **{title}** by **{author}**' });
      return void reply(ctx.message, '📢 Reset the announcement template.');
    }
    await updateGuildSettings(ctx.message.guildId!, { announceTemplate: raw.slice(0, 500) });
    await reply(ctx.message, `📢 Announcement template set. Placeholders: \`{title}\` \`{author}\` \`{duration}\` \`{requester}\` \`{url}\`.`);
  },
);

// ── searchtype ────────────────────────────────────────────────────────────────

const searchTypeCommand = admin(
  { name: 'searchtype', aliases: [], description: 'Set the default track search type', category: 'settings', subCategory: 'Server', usage: 'searchtype <youtube|youtube_music|soundcloud>', examples: ['m!searchtype soundcloud'] },
  async (ctx) => {
    const valid = ['youtube', 'youtube_music', 'soundcloud'];
    const type = ctx.args[0]?.toLowerCase();
    if (!type || !valid.includes(type)) return void reply(ctx.message, `⚠️ Choose one of: ${valid.map((v) => `\`${v}\``).join(', ')}.`);
    await updateGuildSettings(ctx.message.guildId!, { searchType: type });
    await reply(ctx.message, `🔎 Default search source set to **${type}**.`);
  },
);

// ── blacklist / unblacklist ───────────────────────────────────────────────────

const blacklistCommand = admin(
  { name: 'blacklist', aliases: [], description: 'Blacklist tracks by title or author', category: 'settings', subCategory: 'Blacklist', usage: 'blacklist <title|author> <value>', examples: ['m!blacklist author Rick Astley'] },
  async (ctx) => {
    const kind = ctx.args[0]?.toLowerCase();
    const value = ctx.args.slice(1).join(' ').trim().toLowerCase();
    if ((kind !== 'title' && kind !== 'author') || !value) return void reply(ctx.message, '⚠️ Usage: `blacklist <title|author> <value>`.');
    const s = await getGuildSettings(ctx.message.guildId!);
    const list = kind === 'title' ? s.blacklistedTitles : s.blacklistedAuthors;
    if (list.includes(value)) return void reply(ctx.message, 'ℹ️ That is already blacklisted.');
    const next = [...list, value];
    await updateGuildSettings(ctx.message.guildId!, kind === 'title' ? { blacklistedTitles: next } : { blacklistedAuthors: next });
    await reply(ctx.message, `⛔ Blacklisted ${kind} **${value}**.`);
  },
);

const unblacklistCommand = admin(
  { name: 'unblacklist', aliases: [], description: 'Remove a title or author blacklist', category: 'settings', subCategory: 'Blacklist', usage: 'unblacklist <title|author> <value>', examples: ['m!unblacklist author Rick Astley'] },
  async (ctx) => {
    const kind = ctx.args[0]?.toLowerCase();
    const value = ctx.args.slice(1).join(' ').trim().toLowerCase();
    if ((kind !== 'title' && kind !== 'author') || !value) return void reply(ctx.message, '⚠️ Usage: `unblacklist <title|author> <value>`.');
    const s = await getGuildSettings(ctx.message.guildId!);
    const list = kind === 'title' ? s.blacklistedTitles : s.blacklistedAuthors;
    const next = list.filter((v) => v !== value);
    if (next.length === list.length) return void reply(ctx.message, 'ℹ️ That was not blacklisted.');
    await updateGuildSettings(ctx.message.guildId!, kind === 'title' ? { blacklistedTitles: next } : { blacklistedAuthors: next });
    await reply(ctx.message, `✅ Removed ${kind} blacklist **${value}**.`);
  },
);

const blacklistedCommand: Command = {
  meta: { name: 'blacklisted', aliases: ['blacklistedtitles', 'blacklistedauthors'], description: 'View all blacklisted titles and authors', category: 'settings', subCategory: 'Blacklist', usage: 'blacklisted', examples: ['m!blacklisted'] },
  requirements: { guildOnly: true },
  execute: async (ctx) => {
    const s = await getGuildSettings(ctx.message.guildId!);
    const titles = s.blacklistedTitles.length ? s.blacklistedTitles.map((t) => `\`${t}\``).join(', ') : '*none*';
    const authors = s.blacklistedAuthors.length ? s.blacklistedAuthors.map((a) => `\`${a}\``).join(', ') : '*none*';
    const embed = new EmbedBuilder().setColor(ACCENT).setTitle('Blacklists')
      .addFields({ name: 'Titles', value: titles }, { name: 'Authors', value: authors });
    await reply(ctx.message, { embeds: [embed] });
  },
};

/** All settings commands, exported for registration. */
export const SETTINGS_COMMANDS: readonly Command[] = [
  settingsCommand,
  settingsResetCommand,
  djRoleCommand,
  voteSkipCommand,
  defaultVolumeCommand,
  maxQueueCommand,
  maxTrackLengthCommand,
  minTrackLengthCommand,
  maxUserTracksCommand,
  announceCommand,
  searchTypeCommand,
  blacklistCommand,
  unblacklistCommand,
  blacklistedCommand,
];
