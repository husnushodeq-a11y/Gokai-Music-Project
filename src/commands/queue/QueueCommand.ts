import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type BaseMessageOptions,
  type GuildMember,
  type Message,
} from 'discord.js';
import type { KazagumoTrack } from 'kazagumo';
import type { Command, CommandContext, CommandMeta, CommandRequirements } from '@/types';
import type { MusicSession } from '@/core/SessionManager';
import { requesterId } from '@/core/QueueManager';
import { formatDuration, truncate } from '@/util/format';

/**
 * QueueCommand — `m!queue`.
 *
 * An interactive, paginated view of the session queue. Reuses the same
 * collector discipline as the help menu: a single component collector bound to
 * the message, an `idle` timeout, per-user filtering, controls disabled on end,
 * and message deletion on the `x` button — so there are no leaked collectors.
 *
 * Components:
 *   Row 1 → StringSelectMenu "Jump to a track…" (jumps playback to a selection;
 *           gated on control permission).
 *   Row 2 → `<<`  `<`  `>`  `>>`  `x`
 */

const ACCENT = 0x5865f2;
const PAGE_SIZE = 10;
const IDLE_MS = 120_000;

const ID = {
  select: 'queue:jump',
  first: 'queue:first',
  prev: 'queue:prev',
  next: 'queue:next',
  last: 'queue:last',
  delete: 'queue:delete',
} as const;

class QueueCommandImpl implements Command {
  public readonly meta: CommandMeta = {
    name: 'queue',
    aliases: ['q'],
    description: 'Show the interactive, paginated queue',
    category: 'queue',
    subCategory: 'Viewing',
    usage: 'queue',
    examples: ['m!queue'],
  };

  public readonly requirements: CommandRequirements = { guildOnly: true, sessionRequired: true };

  public async execute(ctx: CommandContext): Promise<void> {
    const session = ctx.client.sessions.get(ctx.message.guildId!)!;
    const member = ctx.message.member as GuildMember;

    if (!session.queue.current && session.queue.isEmpty) {
      await safeReply(ctx.message, 'ℹ️ The queue is empty and nothing is playing.');
      return;
    }

    let page = 0;
    const render = () => renderQueue(session, page);

    const sent = await ctx.message.reply({
      ...render(),
      allowedMentions: { repliedUser: false },
    });

    const collector = sent.createMessageComponentCollector({ idle: IDLE_MS });

    collector.on('collect', async (interaction) => {
      if (interaction.user.id !== ctx.message.author.id) {
        await interaction
          .reply({ content: 'This queue menu belongs to someone else.', ephemeral: true })
          .catch(() => undefined);
        return;
      }

      const totalPages = pageCount(session);

      if (interaction.isButton()) {
        if (interaction.customId === ID.delete) {
          collector.stop('deleted');
          return;
        }
        switch (interaction.customId) {
          case ID.first: page = 0; break;
          case ID.prev: page = Math.max(0, page - 1); break;
          case ID.next: page = Math.min(totalPages - 1, page + 1); break;
          case ID.last: page = totalPages - 1; break;
        }
        await interaction.update(render() as BaseMessageOptions).catch(() => undefined);
        return;
      }

      if (interaction.isStringSelectMenu()) {
        // Jumping playback is a control action — respect lock / deny-list.
        const decision = await session.canControl(member);
        if (!decision.allowed) {
          await interaction
            .reply({ content: `🚫 ${decision.reason ?? 'You cannot control this session.'}`, ephemeral: true })
            .catch(() => undefined);
          return;
        }
        const index = Number(interaction.values[0]);
        if (Number.isInteger(index)) {
          const target = session.queue.upcoming[index];
          session.queue.jumpTo(index); // discard tracks before the selection
          if (session.queue.current) session.player.skip(); // advance into it
          await session.persist().catch(() => undefined);
          page = 0;
          const note = target ? ` Jumped to **${truncate(target.title, 80)}**.` : '';
          await interaction
            .update({ ...(render() as BaseMessageOptions) })
            .catch(() => undefined);
          await interaction.followUp({ content: `⏭️${note}`, ephemeral: true }).catch(() => undefined);
        }
      }
    });

    collector.on('end', async (_c, reason) => {
      if (reason === 'deleted') {
        await sent.delete().catch(() => undefined);
        return;
      }
      await sent.edit(renderQueue(session, page, true)).catch(() => undefined);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Rendering
// ─────────────────────────────────────────────────────────────────────────────

/** Number of pages for the current upcoming queue (minimum 1). */
function pageCount(session: MusicSession): number {
  return Math.max(1, Math.ceil(session.queue.size / PAGE_SIZE));
}

/** Build the full message payload (embed + components) for a queue page. */
function renderQueue(session: MusicSession, rawPage: number, disabled = false): BaseMessageOptions {
  const upcoming = session.queue.upcoming;
  const total = pageCount(session);
  const page = Math.min(Math.max(0, rawPage), total - 1);
  const start = page * PAGE_SIZE;
  const slice = upcoming.slice(start, start + PAGE_SIZE);

  const embed = new EmbedBuilder().setColor(ACCENT).setTitle('Queue');

  const lines: string[] = [];

  // Now-playing header.
  const current = session.queue.current;
  if (current) {
    const dur = current.isStream ? '🔴 LIVE' : formatDuration(current.length ?? 0);
    lines.push(`**Now Playing**\n[${truncate(current.title, 80)}](${current.uri ?? 'https://jockiemusic.com'}) \`${dur}\``);
    lines.push('');
  }

  // Up-next list.
  if (upcoming.length === 0) {
    lines.push('*No tracks in the queue.*');
  } else {
    lines.push('**Up Next**');
    slice.forEach((track, i) => {
      lines.push(formatQueueLine(start + i + 1, track));
    });
  }

  embed.setDescription(truncate(lines.join('\n'), 4000));

  const totalMs = session.queue.totalDuration;
  embed.setFooter({
    text: `Page ${page + 1}/${total} • ${session.queue.size} track(s) • ${formatDuration(totalMs)} • loop: ${session.player.loop}`,
  });

  return { embeds: [embed], components: buildComponents(session, page, total, slice, start, disabled) };
}

/** Format a single "N. [title](uri) `dur` • @requester" line. */
function formatQueueLine(position: number, track: KazagumoTrack): string {
  const dur = track.isStream ? 'LIVE' : formatDuration(track.length ?? 0);
  const req = requesterId(track.requester);
  const by = req ? ` • <@${req}>` : '';
  return `\`${position}.\` [${truncate(track.title, 60)}](${track.uri ?? 'https://jockiemusic.com'}) \`${dur}\`${by}`;
}

/** Build the two component rows (jump select + pagination). */
function buildComponents(
  _session: MusicSession,
  page: number,
  total: number,
  pageTracks: KazagumoTrack[],
  start: number,
  disabled: boolean,
): BaseMessageOptions['components'] {
  const rows: (ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>)[] = [];

  // Row 1 — jump select (only when the page actually has tracks; Discord
  // rejects a select menu with zero options).
  if (pageTracks.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(ID.select)
      .setPlaceholder('Jump to a track…')
      .setDisabled(disabled)
      .addOptions(
        pageTracks.map((track, i) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(truncate(`${start + i + 1}. ${track.title}`, 100))
            .setDescription(truncate(track.author ?? 'Unknown', 100))
            .setValue(String(start + i)),
        ),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  // Row 2 — pagination + cancel.
  const isFirst = page === 0;
  const isLast = page >= total - 1;
  const buttons = [
    new ButtonBuilder().setCustomId(ID.first).setLabel('<<').setStyle(ButtonStyle.Secondary).setDisabled(disabled || isFirst),
    new ButtonBuilder().setCustomId(ID.prev).setLabel('<').setStyle(ButtonStyle.Secondary).setDisabled(disabled || isFirst),
    new ButtonBuilder().setCustomId(ID.next).setLabel('>').setStyle(ButtonStyle.Secondary).setDisabled(disabled || isLast),
    new ButtonBuilder().setCustomId(ID.last).setLabel('>>').setStyle(ButtonStyle.Secondary).setDisabled(disabled || isLast),
    new ButtonBuilder().setCustomId(ID.delete).setLabel('x').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  ];
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));

  return rows;
}

/** Reply helper that never throws. */
async function safeReply(message: Message, content: string): Promise<void> {
  try {
    await message.reply({ content, allowedMentions: { repliedUser: false } });
  } catch {
    /* swallow */
  }
}

/** The command instance the loader registers. */
export const QueueCommand: Command = new QueueCommandImpl();
