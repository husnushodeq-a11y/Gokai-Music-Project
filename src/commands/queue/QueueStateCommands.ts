import type { Command, CommandContext, CommandMeta, CommandRequirements } from '@/types';
import type { SortKey, SortDirection } from '@/core/QueueManager';
import { reply, requireController, parsePosition, sessionOf } from '@/util/commandHelpers';
import { formatDuration } from '@/util/format';

/**
 * Queue-state commands: the advanced manipulation surface from Jockie's
 * "Queue State" page. Every command is a thin wrapper over {@link QueueManager}
 * (which owns the in-place array operations) plus a control-permission gate.
 *
 * All responses are static text — these commands mutate state, the `queue`
 * command renders the interactive view.
 */

const CONTROL_REQ: CommandRequirements = {
  guildOnly: true,
  sessionRequired: true,
  voiceRequired: true,
  sameVoiceRequired: true,
};

/** Helper to define a simple control command from a name/meta + handler. */
function control(
  meta: CommandMeta,
  run: (ctx: CommandContext) => Promise<void>,
): Command {
  return { meta, requirements: CONTROL_REQ, execute: run };
}

// ── remove / clear ────────────────────────────────────────────────────────────

const removeCommand = control(
  { name: 'remove', aliases: ['rm'], description: 'Remove a track (or range) from the queue', category: 'queue', subCategory: 'Cleanup', usage: 'remove <index> [end]', examples: ['m!remove 3', 'm!remove 3 6'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const start = parsePosition(ctx.args[0]);
    if (start === null) return void reply(ctx.message, '⚠️ Give a queue position, e.g. `remove 3`.');

    const end = parsePosition(ctx.args[1]);
    if (end !== null) {
      const removed = ctrl.session.queue.removeRange(start, end);
      await ctrl.session.persist().catch(() => undefined);
      return void reply(ctx.message, `🗑️ Removed **${removed.length}** track(s) from the queue.`);
    }
    const track = ctrl.session.queue.remove(start);
    if (!track) return void reply(ctx.message, '⚠️ There is no track at that position.');
    await ctrl.session.persist().catch(() => undefined);
    await reply(ctx.message, `🗑️ Removed **${track.title}** from the queue.`);
  },
);

const clearCommand = control(
  { name: 'clear', aliases: [], description: 'Clear all upcoming tracks', category: 'queue', subCategory: 'Cleanup', usage: 'clear', examples: ['m!clear'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const count = ctrl.session.queue.clear();
    await ctrl.session.persist().catch(() => undefined);
    await reply(ctx.message, `🧹 Cleared **${count}** track(s) from the queue.`);
  },
);

// ── move / swap / massmove ────────────────────────────────────────────────────

const moveCommand = control(
  { name: 'move', aliases: [], description: 'Move a track to a new position', category: 'queue', subCategory: 'Reordering', usage: 'move <from> <to>', examples: ['m!move 5 1'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const from = parsePosition(ctx.args[0]);
    const to = parsePosition(ctx.args[1]);
    if (from === null || to === null) return void reply(ctx.message, '⚠️ Usage: `move <from> <to>`.');
    const track = ctrl.session.queue.move(from, to);
    if (!track) return void reply(ctx.message, '⚠️ There is no track at that position.');
    await ctrl.session.persist().catch(() => undefined);
    await reply(ctx.message, `↔️ Moved **${track.title}** to position **${to + 1}**.`);
  },
);

const swapCommand = control(
  { name: 'swap', aliases: [], description: 'Swap two tracks in the queue', category: 'queue', subCategory: 'Reordering', usage: 'swap <a> <b>', examples: ['m!swap 2 5'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const a = parsePosition(ctx.args[0]);
    const b = parsePosition(ctx.args[1]);
    if (a === null || b === null) return void reply(ctx.message, '⚠️ Usage: `swap <a> <b>`.');
    if (!ctrl.session.queue.swap(a, b)) return void reply(ctx.message, '⚠️ Could not swap those positions.');
    await ctrl.session.persist().catch(() => undefined);
    await reply(ctx.message, `🔀 Swapped positions **${a + 1}** and **${b + 1}**.`);
  },
);

const massMoveCommand = control(
  { name: 'massmove', aliases: ['movetracks'], description: 'Move multiple tracks in the queue', category: 'queue', subCategory: 'Reordering', usage: 'massmove <start> <end> <to>', examples: ['m!massmove 4 8 1'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const start = parsePosition(ctx.args[0]);
    const end = parsePosition(ctx.args[1]);
    const to = parsePosition(ctx.args[2]);
    if (start === null || end === null || to === null) return void reply(ctx.message, '⚠️ Usage: `massmove <start> <end> <to>`.');
    const moved = ctrl.session.queue.removeRange(start, end);
    if (moved.length === 0) return void reply(ctx.message, '⚠️ No tracks in that range.');
    ctrl.session.queue.add(moved, to);
    await ctrl.session.persist().catch(() => undefined);
    await reply(ctx.message, `↔️ Moved **${moved.length}** track(s) to position **${to + 1}**.`);
  },
);

// ── reverse / shuffle / sort ──────────────────────────────────────────────────

const reverseCommand = control(
  { name: 'reverse', aliases: [], description: 'Reverse the entire queue', category: 'queue', subCategory: 'Reordering', usage: 'reverse', examples: ['m!reverse'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    ctrl.session.queue.reverse();
    await ctrl.session.persist().catch(() => undefined);
    await reply(ctx.message, '🔄 Reversed the queue.');
  },
);

const shuffleCommand = control(
  { name: 'shuffle', aliases: [], description: 'Shuffle the queue randomly', category: 'queue', subCategory: 'Reordering', usage: 'shuffle', examples: ['m!shuffle'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    ctrl.session.queue.shuffle();
    await ctrl.session.persist().catch(() => undefined);
    await reply(ctx.message, '🔀 Shuffled the queue.');
  },
);

/** Map user input to a sort key, honouring a few synonyms. */
function toSortKey(input?: string): SortKey | null {
  switch (input?.toLowerCase()) {
    case 'title': case 'name': return 'title';
    case 'author': case 'artist': return 'author';
    case 'duration': case 'length': case 'time': return 'duration';
    case 'requester': case 'user': return 'requester';
    default: return null;
  }
}

const sortCommand = control(
  { name: 'sort', aliases: ['reorder'], description: 'Sort by title, author, duration or requester', category: 'queue', subCategory: 'Reordering', usage: 'sort <title|author|duration|requester> [asc|desc]', examples: ['m!sort duration', 'm!sort author desc'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const key = toSortKey(ctx.args[0]);
    if (!key) return void reply(ctx.message, '⚠️ Sort by `title`, `author`, `duration` or `requester`.');
    const dir: SortDirection = ctx.args[1]?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    ctrl.session.queue.sort(key, dir);
    await ctrl.session.persist().catch(() => undefined);
    await reply(ctx.message, `🔃 Sorted the queue by **${key}** (${dir}).`);
  },
);

// ── removedupes / removeabsent ────────────────────────────────────────────────

const removeDupesCommand = control(
  { name: 'removedupes', aliases: ['removeduplicates', 'dedupe'], description: 'Remove duplicate tracks', category: 'queue', subCategory: 'Cleanup', usage: 'removedupes', examples: ['m!removedupes'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const result = ctrl.session.queue.removeDuplicates();
    await ctrl.session.persist().catch(() => undefined);
    await reply(ctx.message, `🧹 Removed **${result.removed}** duplicate track(s).`);
  },
);

const removeAbsentCommand = control(
  { name: 'removeabsent', aliases: ['cleanup', 'leavecleanup'], description: 'Remove tracks queued by users who left', category: 'queue', subCategory: 'Cleanup', usage: 'removeabsent', examples: ['m!removeabsent'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const present = ctrl.session.getPresentUserIds(ctx.client);
    const result = ctrl.session.queue.removeAbsent(present);
    await ctrl.session.persist().catch(() => undefined);
    await reply(ctx.message, `🧹 Removed **${result.removed}** track(s) queued by absent users.`);
  },
);

// ── skipto / previous / rewind ────────────────────────────────────────────────

const skipToCommand = control(
  { name: 'skipto', aliases: ['jump'], description: 'Skip to the desired track', category: 'queue', subCategory: 'Index', usage: 'skipto <index>', examples: ['m!skipto 4'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const index = parsePosition(ctx.args[0]);
    if (index === null) return void reply(ctx.message, '⚠️ Usage: `skipto <index>`.');
    const target = ctrl.session.queue.upcoming[index];
    if (!target) return void reply(ctx.message, '⚠️ There is no track at that position.');
    ctrl.session.queue.jumpTo(index);
    if (ctrl.session.queue.current) ctrl.session.player.skip();
    await ctrl.session.persist().catch(() => undefined);
    await reply(ctx.message, `⏭️ Skipped to **${target.title}**.`);
  },
);

const previousCommand = control(
  { name: 'previous', aliases: ['prev', 'back'], description: 'Go to the previous track in the queue', category: 'queue', subCategory: 'Index', usage: 'previous', examples: ['m!previous'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const prev = ctrl.session.queue.previous;
    if (!prev) return void reply(ctx.message, 'ℹ️ There is no previous track.');
    await ctrl.session.player.play(prev).catch(() => undefined);
    await reply(ctx.message, `⏮️ Playing previous track: **${prev.title}**.`);
  },
);

const rewindCommand = control(
  { name: 'rewind', aliases: ['replay'], description: 'Rewind the current track to the start', category: 'queue', subCategory: 'Index', usage: 'rewind', examples: ['m!rewind'] },
  async (ctx) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;
    const current = ctrl.session.queue.current;
    if (!current || current.isStream || !current.isSeekable) {
      return void reply(ctx.message, '🚫 This track cannot be rewound.');
    }
    await ctrl.session.player.seek(0).catch(() => undefined);
    await reply(ctx.message, `⏪ Rewound **${current.title}** to the start.`);
  },
);

// ── history (recently played) — read-only, no control needed ──────────────────

const historyCommand: Command = {
  meta: { name: 'history', aliases: ['recentlyplayed'], description: 'Show recently played tracks', category: 'queue', subCategory: 'Viewing', usage: 'history', examples: ['m!history'] },
  requirements: { guildOnly: true, sessionRequired: true },
  execute: async (ctx) => {
    const session = sessionOf(ctx);
    const history = session.queue.history.slice(-10).reverse();
    if (history.length === 0) return void reply(ctx.message, 'ℹ️ No tracks have been played yet.');
    const lines = history.map((t, i) => `\`${i + 1}.\` ${t.title} \`${t.isStream ? 'LIVE' : formatDuration(t.length ?? 0)}\``);
    await reply(ctx.message, `🕑 **Recently played**\n${lines.join('\n')}`);
  },
};

/** All queue-state commands, exported for registration. */
export const QUEUE_STATE_COMMANDS: readonly Command[] = [
  removeCommand,
  clearCommand,
  moveCommand,
  swapCommand,
  massMoveCommand,
  reverseCommand,
  shuffleCommand,
  sortCommand,
  removeDupesCommand,
  removeAbsentCommand,
  skipToCommand,
  previousCommand,
  rewindCommand,
  historyCommand,
];
