import { EmbedBuilder } from 'discord.js';
import type { Command, CommandContext, CommandMeta } from '@/types';
import { requesterId } from '@/core/QueueManager';
import { reply, sessionOf, resolveTargetId, ACCENT } from '@/util/commandHelpers';
import { formatDuration, truncate } from '@/util/format';

/**
 * Information commands — read-only views over the current session & queue.
 * None require control permission; they only need an active session.
 */

const READ_REQ = { guildOnly: true, sessionRequired: true } as const;

function readCommand(meta: CommandMeta, run: (ctx: CommandContext) => Promise<void>): Command {
  return { meta, requirements: READ_REQ, execute: run };
}

// ── upcoming ──────────────────────────────────────────────────────────────────

const upcomingCommand = readCommand(
  { name: 'upcoming', aliases: ['up'], description: 'Get a list of all the upcoming tracks', category: 'information', subCategory: 'Other', usage: 'upcoming', examples: ['m!upcoming'] },
  async (ctx) => {
    const session = sessionOf(ctx);
    const upcoming = session.queue.upcoming.slice(0, 10);
    if (upcoming.length === 0) return void reply(ctx.message, 'ℹ️ There are no upcoming tracks.');
    const lines = upcoming.map((t, i) => `\`${i + 1}.\` ${truncate(t.title, 60)} \`${t.isStream ? 'LIVE' : formatDuration(t.length ?? 0)}\``);
    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setTitle('Upcoming tracks')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${session.queue.size} track(s) • ${formatDuration(session.queue.totalDuration)}` });
    await reply(ctx.message, { embeds: [embed] });
  },
);

// ── nextup ────────────────────────────────────────────────────────────────────

const nextUpCommand = readCommand(
  { name: 'nextup', aliases: ['nextsong'], description: 'Get information about the next track', category: 'information', subCategory: 'Other', usage: 'nextup', examples: ['m!nextup'] },
  async (ctx) => {
    const session = sessionOf(ctx);
    const next = session.queue.upcoming[0];
    if (!next) return void reply(ctx.message, 'ℹ️ There is no track queued up next.');
    const req = requesterId(next.requester);
    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setAuthor({ name: 'Up Next' })
      .setTitle(next.title)
      .setURL(next.uri ?? null)
      .addFields(
        { name: 'Author', value: next.author ?? 'Unknown', inline: true },
        { name: 'Duration', value: next.isStream ? '🔴 LIVE' : formatDuration(next.length ?? 0), inline: true },
        { name: 'Requested by', value: req ? `<@${req}>` : 'Unknown', inline: true },
      );
    if (next.thumbnail) embed.setThumbnail(next.thumbnail);
    await reply(ctx.message, { embeds: [embed] });
  },
);

// ── requested ─────────────────────────────────────────────────────────────────

const requestedCommand = readCommand(
  { name: 'requested', aliases: [], description: 'Get all the tracks requested by a user', category: 'information', subCategory: 'Other', usage: 'requested [@user]', examples: ['m!requested', 'm!requested @Bob'] },
  async (ctx) => {
    const session = sessionOf(ctx);
    const targetId = resolveTargetId(ctx.message, ctx.args[0]) ?? ctx.message.author.id;
    const tracks = session.queue.upcoming.filter((t) => requesterId(t.requester) === targetId).slice(0, 15);
    if (tracks.length === 0) return void reply(ctx.message, `ℹ️ <@${targetId}> has no tracks in the queue.`);
    const lines = tracks.map((t, i) => `\`${i + 1}.\` ${truncate(t.title, 60)} \`${t.isStream ? 'LIVE' : formatDuration(t.length ?? 0)}\``);
    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setTitle('Requested tracks')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Requested by a specific user` });
    await reply(ctx.message, { embeds: [embed] });
  },
);

// ── sessioninfo ───────────────────────────────────────────────────────────────

const sessionInfoCommand = readCommand(
  { name: 'sessioninfo', aliases: ['sessioninformation', 'session'], description: 'Get information about the current session', category: 'information', subCategory: 'Other', usage: 'sessioninfo', examples: ['m!sessioninfo'] },
  async (ctx) => {
    const session = sessionOf(ctx);
    const listeners = session.getPresentUserIds(ctx.client).size;
    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setAuthor({ name: 'Session Information' })
      .addFields(
        { name: 'Owner', value: session.ownerId ? `<@${session.ownerId}>` : 'Unclaimed', inline: true },
        { name: 'Locked', value: session.locked ? '🔒 Yes' : '🔓 No', inline: true },
        { name: '24/7', value: session.mode247 ? '♾️ On' : 'Off', inline: true },
        { name: 'Autoplay', value: session.autoplay ? 'On' : 'Off', inline: true },
        { name: 'Volume', value: `${session.player.volume}%`, inline: true },
        { name: 'Loop', value: session.player.loop, inline: true },
        { name: 'Listeners', value: String(listeners), inline: true },
        { name: 'Queue', value: `${session.queue.size} track(s)`, inline: true },
        { name: 'Allowed / Denied', value: `${session.allowedUsers.size} / ${session.deniedUsers.size}`, inline: true },
      );
    await reply(ctx.message, { embeds: [embed] });
  },
);

/** All information commands, exported for registration. */
export const INFO_COMMANDS: readonly Command[] = [
  upcomingCommand,
  nextUpCommand,
  requestedCommand,
  sessionInfoCommand,
];
