import type { CommandMeta, HelpCategory } from '@/types';

/**
 * Help content catalog — the single source of truth for the paginated help
 * embed. Each {@link HelpCategory} renders as exactly **one page**; sub-categories
 * become the bold sub-headings on that page, and each command becomes one
 * `**name**: *description*` line.
 *
 * In production this catalog can be generated from the live command registry
 * (grouping `client.commands` by `meta.category` / `meta.subCategory`). It is
 * declared statically here so the help surface is complete and stable while the
 * command layer is still being built out phase-by-phase.
 */

/** The clickable title link used on every page (matches Jockie's style). */
export const HELP_LINK_URL = 'https://jockiemusic.com';

/** The horizontal rule drawn above & below the category description. */
export const HELP_DIVIDER = '------------------------------';

/** Convenience for building a CommandMeta without repeating category noise. */
function meta(
  category: CommandMeta['category'],
  subCategory: string,
  name: string,
  description: string,
  usage: string,
  aliases: string[] = [],
  examples: string[] = [],
): CommandMeta {
  return { category, subCategory, name, description, usage, aliases, examples };
}

// ── The catalog ──────────────────────────────────────────────────────────────

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'general',
    name: 'General',
    description: 'Everyday utility commands to get you started and find your way around.',
    subCategories: [
      {
        name: 'Information',
        commands: [
          meta('general', 'Information', 'help', 'Show this interactive help menu', 'help [command]', ['h', 'commands'], ['m!help', 'm!help play']),
          meta('general', 'Information', 'ping', 'Check the bot & Lavalink latency', 'ping', ['latency']),
          meta('general', 'Information', 'invite', 'Get a link to invite the bot', 'invite'),
        ],
      },
      {
        name: 'Utility',
        commands: [
          meta('general', 'Utility', 'prefix', 'View or change your prefix', 'prefix [new prefix]', ['setprefix']),
          meta('general', 'Utility', 'alias', 'Create a custom command alias', 'alias <name> <command>', ['aliases']),
        ],
      },
    ],
  },
  {
    id: 'music',
    name: 'Music',
    description: 'Search, play and control audio playback from your favourite sources.',
    subCategories: [
      {
        name: 'Playback',
        commands: [
          meta('music', 'Playback', 'play', 'Play a track or playlist by search or URL', 'play <query>', ['p'], ['m!play never gonna give you up', 'm!play https://youtu.be/…']),
          meta('music', 'Playback', 'playnext', 'Queue a track to play next', 'playnext <query>', ['pn']),
          meta('music', 'Playback', 'pause', 'Pause the current track', 'pause'),
          meta('music', 'Playback', 'resume', 'Resume a paused track', 'resume', ['unpause']),
          meta('music', 'Playback', 'skip', 'Skip the current track (vote-aware)', 'skip [amount]', ['s', 'next']),
          meta('music', 'Playback', 'stop', 'Stop playback and clear the queue', 'stop'),
          meta('music', 'Playback', 'seek', 'Seek to a position in the track', 'seek <time>'),
        ],
      },
      {
        name: 'Sound',
        commands: [
          meta('music', 'Sound', 'volume', 'View or set the playback volume', 'volume [0-200]', ['vol']),
          meta('music', 'Sound', 'loop', 'Set loop mode: off, track or queue', 'loop <off|track|queue>', ['repeat']),
          meta('music', 'Sound', 'nowplaying', 'Show the track currently playing', 'nowplaying', ['np']),
        ],
      },
    ],
  },
  {
    id: 'queue',
    name: 'Queue',
    description: 'Powerful queue management — reorder, clean up and shape what plays next.',
    subCategories: [
      {
        name: 'Viewing',
        commands: [
          meta('queue', 'Viewing', 'queue', 'Show the interactive, paginated queue', 'queue', ['q']),
          meta('queue', 'Viewing', 'history', 'Show recently played tracks', 'history'),
        ],
      },
      {
        name: 'Reordering',
        commands: [
          meta('queue', 'Reordering', 'move', 'Move a track to a new position', 'move <from> <to>'),
          meta('queue', 'Reordering', 'swap', 'Swap two tracks in the queue', 'swap <a> <b>'),
          meta('queue', 'Reordering', 'reverse', 'Reverse the entire queue', 'reverse'),
          meta('queue', 'Reordering', 'shuffle', 'Shuffle the queue randomly', 'shuffle'),
          meta('queue', 'Reordering', 'sort', 'Sort by title, author, duration or requester', 'sort <key> [asc|desc]'),
        ],
      },
      {
        name: 'Cleanup',
        commands: [
          meta('queue', 'Cleanup', 'remove', 'Remove a track (or range) from the queue', 'remove <index> [end]', ['rm']),
          meta('queue', 'Cleanup', 'clear', 'Clear all upcoming tracks', 'clear'),
          meta('queue', 'Cleanup', 'removedupes', 'Remove duplicate tracks', 'removedupes', ['dedupe']),
          meta('queue', 'Cleanup', 'removeabsent', 'Remove tracks queued by users who left', 'removeabsent', ['cleanup', 'leavecleanup']),
        ],
      },
    ],
  },
  {
    id: 'sessions',
    name: 'Sessions',
    description: 'Claim, share and secure a music session, or keep the bot on 24/7.',
    subCategories: [
      {
        name: 'Ownership',
        commands: [
          meta('sessions', 'Ownership', 'claim', 'Claim ownership of the session', 'claim'),
          meta('sessions', 'Ownership', 'transfer', 'Transfer ownership to another user', 'transfer <@user>'),
          meta('sessions', 'Ownership', 'release', 'Release ownership of the session', 'release'),
        ],
      },
      {
        name: 'Permissions',
        commands: [
          meta('sessions', 'Permissions', 'lock', 'Lock the session to owner & allowed users', 'lock'),
          meta('sessions', 'Permissions', 'unlock', 'Unlock the session for everyone', 'unlock'),
          meta('sessions', 'Permissions', 'allow', 'Allow a user to control the session', 'allow <@user>'),
          meta('sessions', 'Permissions', 'deny', 'Deny a user control of the session', 'deny <@user>'),
        ],
      },
      {
        name: 'Modes',
        commands: [
          meta('sessions', 'Modes', '247', 'Toggle 24/7 always-on mode', '247', ['stay']),
          meta('sessions', 'Modes', 'autoplay', 'Toggle autoplay recommendations', 'autoplay', ['ap']),
        ],
      },
    ],
  },
  {
    id: 'collections',
    name: 'Collections',
    description: 'Save queues as reusable playlists and share them with a short code.',
    subCategories: [
      {
        name: 'Manage',
        commands: [
          meta('collections', 'Manage', 'collections', 'Browse your saved collections', 'collections', ['cols']),
          meta('collections', 'Manage', 'save', 'Save the current queue as a collection', 'save <name>'),
          meta('collections', 'Manage', 'delete', 'Delete one of your collections', 'delete <name>'),
        ],
      },
      {
        name: 'Share',
        commands: [
          meta('collections', 'Share', 'load', 'Load a collection into the queue', 'load <name|code>'),
          meta('collections', 'Share', 'share', 'Get the share code for a collection', 'share <name>'),
        ],
      },
    ],
  },
  {
    id: 'profiles',
    name: 'Profiles',
    description: 'Customise your public listening profile and show off your stats.',
    subCategories: [
      {
        name: 'Profile',
        commands: [
          meta('profiles', 'Profile', 'profile', 'View a listening profile', 'profile [@user]', ['p']),
          meta('profiles', 'Profile', 'setbio', 'Set your profile biography', 'setbio <text>'),
          meta('profiles', 'Profile', 'setcolor', 'Set your profile accent colour', 'setcolor <hex>'),
          meta('profiles', 'Profile', 'setfavorite', 'Pin a favourite track to your profile', 'setfavorite <query>'),
        ],
      },
    ],
  },
  {
    id: 'settings',
    name: 'Settings',
    description: 'Fine-grained server & session configuration for admins and DJs.',
    subCategories: [
      {
        name: 'Server',
        commands: [
          meta('settings', 'Server', 'settings', 'Open the interactive settings panel', 'settings', ['config']),
          meta('settings', 'Server', 'djrole', 'Set the DJ role', 'djrole <@role>'),
          meta('settings', 'Server', 'voteskip', 'Set the vote-skip percentage', 'voteskip <1-100>'),
        ],
      },
      {
        name: 'Playback Defaults',
        commands: [
          meta('settings', 'Playback Defaults', 'defaultvolume', 'Set the default session volume', 'defaultvolume <0-200>'),
          meta('settings', 'Playback Defaults', 'maxqueue', 'Set the maximum queue size', 'maxqueue <n>'),
          meta('settings', 'Playback Defaults', 'announce', 'Set the now-playing announcement template', 'announce <template>'),
        ],
      },
    ],
  },
];

/** Flat lookup of every command meta by name (for the detail view). */
export const HELP_COMMAND_INDEX: ReadonlyMap<string, CommandMeta> = new Map(
  HELP_CATEGORIES.flatMap((c) => c.subCategories).flatMap((s) => s.commands).map((c) => [c.name, c]),
);
