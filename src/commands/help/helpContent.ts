import type { CommandMeta, HelpCategory } from '@/types';

/**
 * Help content catalog — the single source of truth for the paginated help
 * embed. Each {@link HelpCategory} renders as exactly **one page**; sub-categories
 * become the bold sub-headings on that page, and each command becomes one
 * `**name**: *description*` line.
 *
 * The catalog is kept in sync with the registered command layer: every entry
 * here corresponds to a real command (or alias) the middleware can dispatch.
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
    description: 'Everyday utility commands, prefixes and custom aliases.',
    subCategories: [
      {
        name: 'Information',
        commands: [
          meta('general', 'Information', 'help', 'Show this interactive help menu', 'help [command]', ['h', 'commands'], ['m!help', 'm!help play']),
        ],
      },
      {
        name: 'Prefix',
        commands: [
          meta('general', 'Prefix', 'prefix', 'View or change your personal prefix', 'prefix [new|reset]', ['setprefix'], ['m!prefix ?', 'm!prefix reset']),
          meta('general', 'Prefix', 'prefixserver', 'Set a custom prefix for this server', 'prefixserver <new|reset>', ['serverprefix']),
          meta('general', 'Prefix', 'prefixlist', 'Get all available prefixes', 'prefixlist', ['prefixes']),
        ],
      },
      {
        name: 'Aliases',
        commands: [
          meta('general', 'Aliases', 'alias', 'Create a custom command alias', 'alias <name> <command> [args]', ['aliasadd'], ['m!alias pp play']),
          meta('general', 'Aliases', 'aliaslist', 'List all custom command aliases', 'aliaslist', ['aliases']),
          meta('general', 'Aliases', 'aliasremove', 'Remove a custom command alias', 'aliasremove <name>', ['aliasdelete']),
          meta('general', 'Aliases', 'aliasclear', 'Clear all custom command aliases', 'aliasclear'),
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
          meta('music', 'Playback', 'play', 'Play a track or playlist by search or URL', 'play <query>', ['p'], ['m!play never gonna give you up']),
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
        name: 'Index',
        commands: [
          meta('queue', 'Index', 'skipto', 'Skip to the desired track', 'skipto <index>', ['jump']),
          meta('queue', 'Index', 'previous', 'Go to the previous track', 'previous', ['prev', 'back']),
          meta('queue', 'Index', 'rewind', 'Rewind the current track to the start', 'rewind', ['replay']),
        ],
      },
      {
        name: 'Reordering',
        commands: [
          meta('queue', 'Reordering', 'move', 'Move a track to a new position', 'move <from> <to>'),
          meta('queue', 'Reordering', 'massmove', 'Move multiple tracks in the queue', 'massmove <start> <end> <to>', ['movetracks']),
          meta('queue', 'Reordering', 'swap', 'Swap two tracks in the queue', 'swap <a> <b>'),
          meta('queue', 'Reordering', 'reverse', 'Reverse the entire queue', 'reverse'),
          meta('queue', 'Reordering', 'shuffle', 'Shuffle the queue randomly', 'shuffle'),
          meta('queue', 'Reordering', 'sort', 'Sort by title, author, duration or requester', 'sort <key> [asc|desc]', ['reorder']),
        ],
      },
      {
        name: 'Cleanup',
        commands: [
          meta('queue', 'Cleanup', 'remove', 'Remove a track (or range) from the queue', 'remove <index> [end]', ['rm']),
          meta('queue', 'Cleanup', 'clear', 'Clear all upcoming tracks', 'clear'),
          meta('queue', 'Cleanup', 'removedupes', 'Remove duplicate tracks', 'removedupes', ['dedupe']),
          meta('queue', 'Cleanup', 'removeabsent', 'Remove tracks queued by users who left', 'removeabsent', ['cleanup']),
        ],
      },
      {
        name: 'Viewing',
        commands: [
          meta('queue', 'Viewing', 'queue', 'Show the interactive, paginated queue', 'queue', ['q']),
          meta('queue', 'Viewing', 'history', 'Show recently played tracks', 'history', ['recentlyplayed']),
        ],
      },
    ],
  },
  {
    id: 'information',
    name: 'Information',
    description: 'Read-only views over the current session and its queue.',
    subCategories: [
      {
        name: 'Now',
        commands: [
          meta('information', 'Now', 'nowplaying', 'Get information about the current track', 'nowplaying', ['np']),
          meta('information', 'Now', 'nextup', 'Get information about the next track', 'nextup', ['nextsong']),
        ],
      },
      {
        name: 'Queue',
        commands: [
          meta('information', 'Queue', 'upcoming', 'Get a list of all the upcoming tracks', 'upcoming', ['up']),
          meta('information', 'Queue', 'requested', 'Get all the tracks requested by a user', 'requested [@user]'),
        ],
      },
      {
        name: 'Session',
        commands: [
          meta('information', 'Session', 'sessioninfo', 'Get information about the current session', 'sessioninfo', ['session']),
          meta('information', 'Session', 'permissions', 'Get the permissions of the session or a user', 'permissions [@user]', ['perms']),
        ],
      },
    ],
  },
  {
    id: 'filters',
    name: 'Effects',
    description: 'Apply audio effects to the current session.',
    subCategories: [
      {
        name: 'Effects',
        commands: [
          meta('filters', 'Effects', 'filter', 'Apply an effect: bassboost, nightcore, 8d, vaporwave, karaoke…', 'filter <effect|clear>', ['effect'], ['m!filter bassboost', 'm!filter clear']),
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
          meta('sessions', 'Permissions', 'permissionsreset', 'Reset the permissions of the session', 'permissionsreset'),
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
    id: 'profiles',
    name: 'Profiles',
    description: 'Customise your public listening profile and show off your stats.',
    subCategories: [
      {
        name: 'Profile',
        commands: [
          meta('profiles', 'Profile', 'profile', 'View or customise your profile', 'profile [@user] | profile set <field> <value>', [], ['m!profile', 'm!profile set color #ff8800']),
          meta('profiles', 'Profile', 'setbio', 'Set your profile biography', 'profile set bio <text>'),
          meta('profiles', 'Profile', 'setcolor', 'Set your profile accent colour', 'profile set color <hex>'),
          meta('profiles', 'Profile', 'setfavorite', 'Pin a favourite track to your profile', 'profile set favorite <query>'),
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
          meta('settings', 'Server', 'settings', 'View all session settings', 'settings', ['config']),
          meta('settings', 'Server', 'settingsreset', 'Reset all the settings', 'settingsreset'),
          meta('settings', 'Server', 'djrole', 'Set the DJ role', 'djrole <@role|reset>'),
          meta('settings', 'Server', 'voteskip', 'Set the vote-skip percentage or toggle it', 'voteskip <1-100|off>'),
          meta('settings', 'Server', 'searchtype', 'Set the default track search type', 'searchtype <source>'),
        ],
      },
      {
        name: 'Playback Defaults',
        commands: [
          meta('settings', 'Playback Defaults', 'defaultvolume', 'Set the default session volume', 'defaultvolume <0-200>'),
          meta('settings', 'Playback Defaults', 'maxqueue', 'Set the maximum queue size', 'maxqueue <n|0>'),
          meta('settings', 'Playback Defaults', 'maxtracklength', 'Set the max track length', 'maxtracklength <time|0>', ['maxlength']),
          meta('settings', 'Playback Defaults', 'mintracklength', 'Set the min track length', 'mintracklength <time|0>', ['minlength']),
          meta('settings', 'Playback Defaults', 'maxusertracks', 'Set the max queued tracks per user', 'maxusertracks <n|0>'),
          meta('settings', 'Playback Defaults', 'announce', 'Set the now-playing announcement template', 'announce <template|reset>'),
        ],
      },
      {
        name: 'Blacklist',
        commands: [
          meta('settings', 'Blacklist', 'blacklist', 'Blacklist tracks by title or author', 'blacklist <title|author> <value>'),
          meta('settings', 'Blacklist', 'unblacklist', 'Remove a title or author blacklist', 'unblacklist <title|author> <value>'),
          meta('settings', 'Blacklist', 'blacklisted', 'View all blacklisted titles and authors', 'blacklisted', ['blacklistedtitles']),
        ],
      },
    ],
  },
];

/** Flat lookup of every command meta by name (for the detail view). */
export const HELP_COMMAND_INDEX: ReadonlyMap<string, CommandMeta> = new Map(
  HELP_CATEGORIES.flatMap((c) => c.subCategories).flatMap((s) => s.commands).map((c) => [c.name, c]),
);
