import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type BaseMessageOptions,
  type Message,
} from 'discord.js';
import type { Command, CommandContext, CommandMeta, HelpCategory } from '@/types';
import {
  HELP_CATEGORIES,
  HELP_COMMAND_INDEX,
  HELP_DIVIDER,
  HELP_LINK_URL,
} from '@/commands/help/helpContent';
import { truncate } from '@/util/format';

/**
 * HelpCommand — an interactive, paginated help menu that reproduces Jockie's
 * layout 1:1.
 *
 * Rendering rules (must match the spec exactly):
 *   Description string per page:
 *     Page {currentPage}/{totalPages}
 *
 *     [**{CategoryName}**]({link})
 *     ------------------------------
 *     {CategoryDescription}
 *     ------------------------------
 *
 *     {SubCategoryName}
 *     **{command}**: *{description}*
 *
 *   Components:
 *     Row 1 → StringSelectMenu, placeholder "Select a command for more information"
 *     Row 2 → Buttons  <<   <   >   >>   x
 *
 * Collector hygiene: a single component collector is bound to the sent message
 * with an **idle** timeout. On end we strip the components. Because nothing but
 * the (now-ended) collector references the closures, everything is eligible for
 * GC immediately — there is no global registry of collectors to leak.
 */

// ── Custom id constants (namespaced to this command). ──────────────────────────
const ID = {
  select: 'help:select',
  first: 'help:first',
  prev: 'help:prev',
  next: 'help:next',
  last: 'help:last',
  delete: 'help:delete',
} as const;

/** How long the menu stays interactive without input before self-closing. */
const IDLE_MS = 120_000;

class HelpCommandImpl implements Command {
  public readonly meta: CommandMeta = {
    name: 'help',
    aliases: ['h', 'commands'],
    description: 'Show this interactive help menu',
    category: 'general',
    subCategory: 'Information',
    usage: 'help [command]',
    examples: ['m!help', 'm!help play'],
  };

  public readonly requirements = { guildOnly: false as const };

  public async execute(ctx: CommandContext): Promise<void> {
    const { message } = ctx;

    // `m!help <command>` jumps straight to that command's detail view, opened on
    // the page of the category it belongs to.
    const query = ctx.args[0]?.toLowerCase();
    const directDetail = query ? HELP_COMMAND_INDEX.get(query) : undefined;
    let page = directDetail
      ? Math.max(0, HELP_CATEGORIES.findIndex((c) => c.id === directDetail.category))
      : 0;

    const initialEmbed = directDetail ? buildDetailEmbed(directDetail) : buildPageEmbed(page);

    const sent: Message = await message.reply({
      embeds: [initialEmbed],
      components: buildComponents(page, false),
      allowedMentions: { repliedUser: false },
    });

    // One collector, bound to this message, auto-closing on inactivity.
    const collector = sent.createMessageComponentCollector({ idle: IDLE_MS });

    collector.on('collect', async (interaction) => {
      // Only the person who ran the command may drive the menu; others get a
      // quiet ephemeral notice rather than a silent "interaction failed".
      if (interaction.user.id !== message.author.id) {
        await interaction
          .reply({ content: 'This help menu belongs to someone else — run `help` yourself!', ephemeral: true })
          .catch(() => undefined);
        return;
      }

      // ── Button navigation ──────────────────────────────────────────────────
      if (interaction.isButton()) {
        if (interaction.customId === ID.delete) {
          collector.stop('deleted');
          return;
        }

        switch (interaction.customId) {
          case ID.first:
            page = 0;
            break;
          case ID.prev:
            page = Math.max(0, page - 1);
            break;
          case ID.next:
            page = Math.min(HELP_CATEGORIES.length - 1, page + 1);
            break;
          case ID.last:
            page = HELP_CATEGORIES.length - 1;
            break;
        }

        await interaction
          .update({ embeds: [buildPageEmbed(page)], components: buildComponents(page, false) })
          .catch(() => undefined);
        return;
      }

      // ── Select menu → per-command detail view ──────────────────────────────
      if (interaction.isStringSelectMenu()) {
        const commandName = interaction.values[0];
        const detail = commandName ? HELP_COMMAND_INDEX.get(commandName) : undefined;
        const embed = detail ? buildDetailEmbed(detail) : buildPageEmbed(page);
        await interaction
          .update({ embeds: [embed], components: buildComponents(page, false) })
          .catch(() => undefined);
      }
    });

    collector.on('end', async (_collected, reason) => {
      if (reason === 'deleted') {
        // The `x` button (or a manual delete) → remove the menu entirely.
        await sent.delete().catch(() => undefined);
        return;
      }
      // Timed out → leave the content but disable the controls so stale clicks
      // don't produce "interaction failed" errors.
      await sent.edit({ components: buildComponents(page, true) }).catch(() => undefined);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Rendering helpers (pure — trivially testable)
// ─────────────────────────────────────────────────────────────────────────────

/** Build the exact Jockie-style description string for a category page. */
function buildPageDescription(category: HelpCategory, pageIndex: number): string {
  const lines: string[] = [];

  lines.push(`Page ${pageIndex + 1}/${HELP_CATEGORIES.length}`);
  lines.push('');
  lines.push(`[**${category.name}**](${HELP_LINK_URL})`);
  lines.push(HELP_DIVIDER);
  lines.push(category.description);
  lines.push(HELP_DIVIDER);
  lines.push('');

  for (const sub of category.subCategories) {
    lines.push(sub.name);
    for (const cmd of sub.commands) {
      lines.push(`**${cmd.name}**: *${cmd.description}*`);
    }
    lines.push('');
  }

  // Trim the trailing blank line for a clean render.
  return lines.join('\n').trimEnd();
}

/** Wrap the page description in an embed. */
function buildPageEmbed(pageIndex: number): EmbedBuilder {
  const category = HELP_CATEGORIES[pageIndex]!;
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription(buildPageDescription(category, pageIndex));
}

/** Build the per-command detail embed shown after a select. */
function buildDetailEmbed(cmd: CommandMeta): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Command: ${cmd.name}`)
    .setDescription(`*${cmd.description}*`)
    .addFields(
      { name: 'Usage', value: `\`${cmd.usage}\``, inline: false },
      {
        name: 'Aliases',
        value: cmd.aliases.length ? cmd.aliases.map((a) => `\`${a}\``).join(', ') : '—',
        inline: true,
      },
      { name: 'Category', value: `${capitalize(cmd.category)} › ${cmd.subCategory}`, inline: true },
    );

  if (cmd.examples.length) {
    embed.addFields({ name: 'Examples', value: cmd.examples.map((e) => `\`${e}\``).join('\n') });
  }

  return embed;
}

/**
 * Build the two component rows for a given page.
 * @param disabled when true (menu ended) every control is disabled.
 */
function buildComponents(pageIndex: number, disabled: boolean): BaseMessageOptions['components'] {
  const category = HELP_CATEGORIES[pageIndex]!;
  const commands = category.subCategories.flatMap((s) => s.commands);
  const isFirst = pageIndex === 0;
  const isLast = pageIndex === HELP_CATEGORIES.length - 1;

  // Row 1 — the "more information" select menu (Discord caps at 25 options).
  const select = new StringSelectMenuBuilder()
    .setCustomId(ID.select)
    .setPlaceholder('Select a command for more information')
    .setDisabled(disabled)
    .addOptions(
      commands.slice(0, 25).map((cmd) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(cmd.name)
          .setDescription(truncate(cmd.description, 100))
          .setValue(cmd.name),
      ),
    );

  // Row 2 — pagination + cancel.
  const buttons = [
    new ButtonBuilder().setCustomId(ID.first).setLabel('<<').setStyle(ButtonStyle.Secondary).setDisabled(disabled || isFirst),
    new ButtonBuilder().setCustomId(ID.prev).setLabel('<').setStyle(ButtonStyle.Secondary).setDisabled(disabled || isFirst),
    new ButtonBuilder().setCustomId(ID.next).setLabel('>').setStyle(ButtonStyle.Secondary).setDisabled(disabled || isLast),
    new ButtonBuilder().setCustomId(ID.last).setLabel('>>').setStyle(ButtonStyle.Secondary).setDisabled(disabled || isLast),
    new ButtonBuilder().setCustomId(ID.delete).setLabel('x').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  ];

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons),
  ];
}

/** Title-case the first letter of a category id for display. */
function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1);
}

/** The command instance the loader registers. */
export const HelpCommand: Command = new HelpCommandImpl();
