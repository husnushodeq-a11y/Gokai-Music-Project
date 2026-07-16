import { EmbedBuilder } from 'discord.js';
import type { Command } from '@/types';
import { prisma } from '@/lib/prisma';
import { reply, resolveTargetId, ACCENT } from '@/util/commandHelpers';
import { truncate } from '@/util/format';

/**
 * Profile commands — a customizable, public listening profile backed by the
 * UserProfile model. `profile` views a card; `profile set <field> <value>`
 * mutates the caller's own profile (mirroring Jockie's "profile set …" grouping).
 */

const HEX = /^#?[0-9a-fA-F]{6}$/;

/** Parse a hex string into a numeric colour, or null. */
function parseHex(input: string): number | null {
  if (!HEX.test(input)) return null;
  return parseInt(input.replace('#', ''), 16);
}

const profileCommand: Command = {
  meta: {
    name: 'profile',
    aliases: [],
    description: 'View or customize your listening profile',
    category: 'profiles',
    subCategory: 'Profile',
    usage: 'profile [@user] | profile set <color|bio|favorite|privacy|avatar> <value>',
    examples: ['m!profile', 'm!profile @Alice', 'm!profile set color #ff8800', 'm!profile set bio I love lofi'],
  },
  requirements: { guildOnly: false },
  execute: async (ctx) => {
    // ── profile set <field> <value> ──────────────────────────────────────────
    if (ctx.args[0]?.toLowerCase() === 'set') {
      await handleSet(ctx.args[1]?.toLowerCase(), ctx.args.slice(2).join(' ').trim(), ctx);
      return;
    }

    // ── profile [@user] — view ───────────────────────────────────────────────
    const targetId = resolveTargetId(ctx.message, ctx.args[0]) ?? ctx.message.author.id;
    const isSelf = targetId === ctx.message.author.id;

    const profile = await prisma.userProfile.findUnique({ where: { userId: targetId } });
    if (!profile) {
      return void reply(ctx.message, isSelf
        ? 'ℹ️ You have no profile yet. Set one up with `profile set bio <text>`.'
        : 'ℹ️ That user has no profile.');
    }
    if (profile.visibility === 'private' && !isSelf) {
      return void reply(ctx.message, '🔒 That profile is private.');
    }

    const color = HEX.test(profile.accentColor) ? parseInt(profile.accentColor.replace('#', ''), 16) : ACCENT;
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(profile.displayName ?? `Profile`)
      .setDescription(profile.bio ?? '*No biography set.*')
      .addFields(
        { name: 'Tracks played', value: String(profile.tracksPlayed), inline: true },
        { name: 'Time listened', value: `${Math.round(Number(profile.msListened) / 3_600_000)}h`, inline: true },
        { name: 'Favourite', value: profile.favoriteTrack ?? '—', inline: false },
      )
      .setFooter({ text: `Badges: ${profile.badges.length ? profile.badges.join(', ') : 'none'}` });
    await reply(ctx.message, { embeds: [embed] });
  },
};

/** Apply a `profile set <field> <value>` mutation for the caller. */
async function handleSet(field: string | undefined, value: string, ctx: Parameters<Command['execute']>[0]): Promise<void> {
  const userId = ctx.message.author.id;

  switch (field) {
    case 'color': {
      const hex = parseHex(value);
      if (hex === null) return void reply(ctx.message, '⚠️ Provide a hex colour, e.g. `#ff8800`.');
      await upsert(userId, { accentColor: `#${value.replace('#', '').toLowerCase()}` });
      return void reply(ctx.message, `🎨 Profile colour updated.`);
    }
    case 'bio': {
      if (!value) return void reply(ctx.message, '⚠️ Provide some text for your bio.');
      await upsert(userId, { bio: truncate(value, 300) });
      return void reply(ctx.message, '📝 Bio updated.');
    }
    case 'favorite':
    case 'favourite': {
      if (!value) return void reply(ctx.message, '⚠️ Provide a track to pin as your favourite.');
      const result = await ctx.client.audio.search(value, { requester: ctx.message.author }).catch(() => null);
      const track = result?.tracks[0];
      const display = track ? `[${track.title}](${track.uri ?? ''})` : truncate(value, 120);
      await upsert(userId, { favoriteTrack: display });
      return void reply(ctx.message, '⭐ Favourite track updated.');
    }
    case 'privacy':
    case 'visibility': {
      const v = value.toLowerCase();
      if (v !== 'public' && v !== 'private') return void reply(ctx.message, '⚠️ Choose `public` or `private`.');
      await upsert(userId, { visibility: v });
      return void reply(ctx.message, `🔒 Profile visibility set to **${v}**.`);
    }
    case 'avatar': {
      const v = value.toLowerCase();
      if (v !== 'circle' && v !== 'square') return void reply(ctx.message, '⚠️ Choose `circle` or `square`.');
      await upsert(userId, { avatarShape: v });
      return void reply(ctx.message, `🖼️ Avatar shape set to **${v}**.`);
    }
    case 'name':
    case 'displayname': {
      if (!value) return void reply(ctx.message, '⚠️ Provide a display name.');
      await upsert(userId, { displayName: truncate(value, 60) });
      return void reply(ctx.message, '🏷️ Display name updated.');
    }
    default:
      return void reply(ctx.message, '⚠️ Set one of: `color`, `bio`, `favorite`, `privacy`, `avatar`, `name`.');
  }
}

/** Upsert a partial profile patch for a user. */
async function upsert(userId: string, data: Record<string, unknown>): Promise<void> {
  await prisma.userProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

/** Build a direct `set<field>` shortcut command that forwards to `handleSet`. */
function setShortcut(name: string, aliases: string[], field: string, description: string, usage: string): Command {
  return {
    meta: { name, aliases, description, category: 'profiles', subCategory: 'Profile', usage, examples: [`m!${name} …`] },
    requirements: { guildOnly: false },
    execute: async (ctx) => handleSet(field, ctx.rawArgs.trim(), ctx),
  };
}

/** All profile commands, exported for registration. */
export const PROFILE_COMMANDS: readonly Command[] = [
  profileCommand,
  setShortcut('setbio', [], 'bio', 'Set your profile biography', 'setbio <text>'),
  setShortcut('setcolor', [], 'color', 'Set your profile accent colour', 'setcolor <hex>'),
  setShortcut('setfavorite', ['setfavourite'], 'favorite', 'Pin a favourite track to your profile', 'setfavorite <query>'),
];
