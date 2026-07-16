import type { Client, Collection, Message } from 'discord.js';
import type { Kazagumo } from 'kazagumo';
import type { SessionManager } from '@/core/SessionManager';

/**
 * Shared, cross-module type definitions and the command contract.
 *
 * Keeping the command interface here (rather than inside the command loader)
 * lets the Help system, the messageCreate middleware and the individual command
 * files all agree on the exact same shape without circular imports.
 */

// ── Command taxonomy ─────────────────────────────────────────────────────────

/**
 * Top-level command categories. These map 1:1 onto the *pages* of the help
 * embed — one category per page — so the ordering here is the ordering users see.
 */
export type CommandCategoryId =
  | 'general'
  | 'music'
  | 'queue'
  | 'information'
  | 'filters'
  | 'sessions'
  | 'collections'
  | 'profiles'
  | 'settings';

/**
 * The metadata every command must expose. The music/execution logic is separate
 * (`execute`) from the descriptive metadata (used to render help). All fields
 * that the Help embed reads are required so pages never render "undefined".
 */
export interface CommandMeta {
  /** Canonical name — the token typed after the prefix (e.g. "play"). */
  readonly name: string;
  /** Alternate trigger tokens (e.g. ["p"]). Case-insensitive. */
  readonly aliases: readonly string[];
  /** One-line description rendered *italicised* in the help list. */
  readonly description: string;
  /** The page/category this command belongs to. */
  readonly category: CommandCategoryId;
  /** The sub-heading within the category (groups commands on a page). */
  readonly subCategory: string;
  /** Usage string shown in the per-command detail view, e.g. "play <query>". */
  readonly usage: string;
  /** Concrete usage examples for the detail view. */
  readonly examples: readonly string[];
}

// ── Runtime guards / requirements a command can declare ──────────────────────

/** Declarative pre-conditions the middleware enforces before `execute` runs. */
export interface CommandRequirements {
  /** Command may only run inside a guild (never in DMs). Defaults to true. */
  readonly guildOnly?: boolean;
  /** Caller must be in a voice channel. */
  readonly voiceRequired?: boolean;
  /** Caller must be in the *same* voice channel as an existing session. */
  readonly sameVoiceRequired?: boolean;
  /** An active session must already exist for the guild. */
  readonly sessionRequired?: boolean;
  /** Only bot owners may run it. */
  readonly ownerOnly?: boolean;
  /** Only DJs / session owner may run it (respects GuildSettings.djRoleId). */
  readonly djOnly?: boolean;
}

// ── Command execution context ────────────────────────────────────────────────

/**
 * Everything a command needs, assembled once by the middleware and handed to
 * `execute`. This keeps command bodies focused on behaviour, not plumbing.
 */
export interface CommandContext {
  /** The originating message (guaranteed to be in a guild for guildOnly cmds). */
  readonly message: Message;
  /** Positional arguments after the command token, already split on whitespace. */
  readonly args: string[];
  /** The raw argument string (everything after the command token). */
  readonly rawArgs: string;
  /** The resolved prefix that triggered this invocation. */
  readonly prefix: string;
  /** The extended client. */
  readonly client: GokaiClient;
}

/** A fully-formed command: descriptive metadata + guards + behaviour. */
export interface Command {
  readonly meta: CommandMeta;
  readonly requirements?: CommandRequirements;
  /** Behaviour. May be async; throwing surfaces to the central error handler. */
  execute(ctx: CommandContext): Promise<void> | void;
}

// ── Help content model ───────────────────────────────────────────────────────

/** A group of commands under a bold sub-heading within a category page. */
export interface HelpSubCategory {
  readonly name: string;
  readonly commands: CommandMeta[];
}

/** One full help page. */
export interface HelpCategory {
  readonly id: CommandCategoryId;
  /** Bold, hyperlinked title on the page. */
  readonly name: string;
  /** The paragraph shown between the two divider rules. */
  readonly description: string;
  readonly subCategories: HelpSubCategory[];
}

// ── Extended discord.js client ───────────────────────────────────────────────

/**
 * Our client augments the base `Client` with the command registry and the
 * long-lived managers (audio + sessions) so any handler can reach them.
 */
export interface GokaiClient extends Client<true> {
  /** name/alias → Command registry, populated by the loader at boot. */
  commands: Collection<string, Command>;
  /** Kazagumo (Lavalink v4) audio facade. */
  audio: Kazagumo;
  /** Session lifecycle + permission manager. */
  sessions: SessionManager;
}
