import type { Kazagumo, KazagumoPlayer } from 'kazagumo';
import type { Client, GuildMember, VoiceBasedChannel } from 'discord.js';
import { LoopMode as PrismaLoopMode, type Session as SessionRow } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { config } from '@/config';
import { getGuildSettings } from '@/core/SettingsService';
import { QueueManager } from '@/core/QueueManager';
import { GOKAI_QUEUE_EMPTY } from '@/audio/AudioManager';

/**
 * SessionManager & MusicSession — the ownership / permission / lifecycle layer.
 *
 * A **MusicSession** is the runtime object binding together, for one voice
 * channel: the Lavalink player, the advanced QueueManager, and the social state
 * (owner, allow/deny lists, lock, 24/7). The **SessionManager** owns the set of
 * live sessions, brokers their creation/destruction, mirrors durable fields to
 * Postgres, and restores 24/7 sessions on boot.
 *
 * "Multi-session" here means the manager tracks many independent sessions (one
 * per active voice channel) concurrently; a single bot process can occupy one
 * voice channel per guild, so sessions are keyed by guild id. Running additional
 * bot tokens/shards, each with its own SessionManager, scales this horizontally.
 */

/** How long to linger in an empty channel before auto-leaving (non-24/7). */
const LEAVE_GRACE_MS = 30_000;

/** Outcome of a permission check, with a human-readable reason on denial. */
export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
}

/** Map Prisma's LoopMode enum ↔ Kazagumo's lowercase loop strings. */
const toKazagumoLoop: Record<PrismaLoopMode, 'none' | 'track' | 'queue'> = {
  [PrismaLoopMode.NONE]: 'none',
  [PrismaLoopMode.TRACK]: 'track',
  [PrismaLoopMode.QUEUE]: 'queue',
};

// ─────────────────────────────────────────────────────────────────────────────
//  MusicSession
// ─────────────────────────────────────────────────────────────────────────────

export class MusicSession {
  /** Advanced queue controller bound to this session's player. */
  public readonly queue: QueueManager;

  /** Explicit allow-list (userIds) — permitted even when the session is locked. */
  public readonly allowedUsers: Set<string>;
  /** Explicit deny-list (userIds) — never permitted to control the session. */
  public readonly deniedUsers: Set<string>;

  /** Pending auto-leave timer (null when the channel is populated / 24-7). */
  private leaveTimer: NodeJS.Timeout | null = null;

  public constructor(
    public readonly dbId: string,
    public readonly guildId: string,
    public voiceChannelId: string,
    public textChannelId: string,
    public readonly player: KazagumoPlayer,
    private readonly manager: SessionManager,
    init: {
      ownerId: string | null;
      mode247: boolean;
      autoplay: boolean;
      locked: boolean;
      allowedUsers: string[];
      deniedUsers: string[];
    },
  ) {
    this.queue = new QueueManager(player);
    this.ownerId = init.ownerId;
    this.mode247 = init.mode247;
    this.autoplay = init.autoplay;
    this.locked = init.locked;
    this.allowedUsers = new Set(init.allowedUsers);
    this.deniedUsers = new Set(init.deniedUsers);
  }

  // ── Social / control state ─────────────────────────────────────────────────

  /** Current owner (claimer). Null means the session is unclaimed / open. */
  public ownerId: string | null;
  /** 24/7 mode — stay connected on empty channel & restore after restart. */
  public mode247: boolean;
  /** Autoplay recommendations when the queue drains. */
  public autoplay: boolean;
  /** When locked, only owner / allowed / DJ may control playback. */
  public locked: boolean;

  // ── Ownership ──────────────────────────────────────────────────────────────

  /** Claim an unowned session. Fails if someone already owns it. */
  public async claim(userId: string): Promise<PermissionDecision> {
    if (this.ownerId && this.ownerId !== userId) {
      return { allowed: false, reason: `This session is already owned by <@${this.ownerId}>.` };
    }
    this.ownerId = userId;
    await this.persist();
    return { allowed: true };
  }

  /** Transfer ownership to another user (owner-or-bot-owner only, enforced by caller). */
  public async transfer(toUserId: string): Promise<void> {
    this.ownerId = toUserId;
    // The new owner must never remain on the deny-list.
    this.deniedUsers.delete(toUserId);
    await this.persist();
  }

  /** Relinquish ownership, leaving the session open for anyone to claim. */
  public async release(): Promise<void> {
    this.ownerId = null;
    await this.persist();
  }

  // ── Allow / deny lists ─────────────────────────────────────────────────────

  /** Grant a user explicit control (removes any deny entry). */
  public async allow(userId: string): Promise<void> {
    this.deniedUsers.delete(userId);
    this.allowedUsers.add(userId);
    await this.persist();
  }

  /** Deny a user control (removes any allow entry). The owner cannot be denied. */
  public async deny(userId: string): Promise<PermissionDecision> {
    if (userId === this.ownerId) {
      return { allowed: false, reason: 'You cannot deny the session owner.' };
    }
    this.allowedUsers.delete(userId);
    this.deniedUsers.add(userId);
    await this.persist();
    return { allowed: true };
  }

  /** Remove a user from both allow & deny lists (reset to default). */
  public async resetUser(userId: string): Promise<void> {
    this.allowedUsers.delete(userId);
    this.deniedUsers.delete(userId);
    await this.persist();
  }

  // ── Modes ──────────────────────────────────────────────────────────────────

  /** Toggle/lock the session. */
  public async setLocked(locked: boolean): Promise<void> {
    this.locked = locked;
    await this.persist();
  }

  /** Enable/disable 24/7 mode; enabling cancels any pending auto-leave. */
  public async set247(enabled: boolean): Promise<void> {
    this.mode247 = enabled;
    if (enabled) this.cancelLeaveTimer();
    await this.persist();
  }

  /** Enable/disable autoplay recommendations. */
  public async setAutoplay(enabled: boolean): Promise<void> {
    this.autoplay = enabled;
    await this.persist();
  }

  // ── Permissions ────────────────────────────────────────────────────────────

  /**
   * Decide whether `member` may issue control commands against this session.
   *
   * Precedence:
   *   1. Bot owners always allowed.
   *   2. Explicit deny-list always blocks.
   *   3. Session owner always allowed.
   *   4. Explicit allow-list allowed.
   *   5. If the session is unlocked → anyone allowed (open).
   *   6. If locked → only DJs (guild DJ role) allowed, else denied.
   */
  public async canControl(member: GuildMember): Promise<PermissionDecision> {
    const userId = member.id;

    if (config.ownerIds.includes(userId)) return { allowed: true };
    if (this.deniedUsers.has(userId)) {
      return { allowed: false, reason: 'You have been denied control of this session.' };
    }
    if (this.ownerId === userId) return { allowed: true };
    if (this.allowedUsers.has(userId)) return { allowed: true };
    if (!this.locked) return { allowed: true };

    const settings = await getGuildSettings(this.guildId);
    if (settings.djRoleId && member.roles.cache.has(settings.djRoleId)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: 'This session is locked. Only the owner, allowed users or DJs can control it.',
    };
  }

  // ── Voice-channel awareness ────────────────────────────────────────────────

  /** The live voice channel object, if reachable in cache. */
  public getVoiceChannel(client: Client): VoiceBasedChannel | null {
    const channel = client.channels.cache.get(this.voiceChannelId);
    return channel?.isVoiceBased() ? channel : null;
  }

  /** The set of (non-bot) user ids currently in the session's voice channel. */
  public getPresentUserIds(client: Client): Set<string> {
    const channel = this.getVoiceChannel(client);
    if (!channel) return new Set();
    return new Set(
      channel.members.filter((m) => !m.user.bot).map((m) => m.id),
    );
  }

  /**
   * React to the voice channel becoming empty. In 24/7 mode we stay; otherwise
   * we start a grace timer and tear the session down if nobody returns.
   */
  public onChannelEmpty(client: Client): void {
    if (this.mode247) return;
    this.cancelLeaveTimer();
    this.leaveTimer = setTimeout(() => {
      // Re-check on fire: someone may have rejoined during the grace window.
      if (this.getPresentUserIds(client).size === 0 && !this.mode247) {
        void this.manager.destroy(this.guildId);
      }
    }, LEAVE_GRACE_MS);
  }

  /** Cancel a pending auto-leave (e.g. a listener rejoined). */
  public onChannelPopulated(): void {
    this.cancelLeaveTimer();
  }

  private cancelLeaveTimer(): void {
    if (this.leaveTimer) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }

  /** Clear timers before the session is discarded. */
  public dispose(): void {
    this.cancelLeaveTimer();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /** Mirror the durable fields of this session into Postgres. */
  public async persist(): Promise<void> {
    const loopMode =
      this.player.loop === 'track'
        ? PrismaLoopMode.TRACK
        : this.player.loop === 'queue'
          ? PrismaLoopMode.QUEUE
          : PrismaLoopMode.NONE;

    await prisma.session.update({
      where: { id: this.dbId },
      data: {
        voiceChannelId: this.voiceChannelId,
        textChannelId: this.textChannelId,
        ownerId: this.ownerId,
        mode247: this.mode247,
        autoplay: this.autoplay,
        locked: this.locked,
        volume: this.player.volume,
        loopMode,
        allowedUsers: [...this.allowedUsers],
        deniedUsers: [...this.deniedUsers],
        // Persist a queue snapshot so 24/7 sessions can be rebuilt after a restart.
        queueSnapshot: this.mode247 ? (this.queue.snapshot() as object) : undefined,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SessionManager
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  ownerId: string | null;
}

export class SessionManager {
  /** guildId → live session. One active session per guild for this process. */
  private readonly sessions = new Map<string, MusicSession>();

  public constructor(
    private readonly client: Client,
    private readonly audio: Kazagumo,
  ) {
    // When a queue drains, apply 24/7 / auto-leave semantics.
    this.audio.on(GOKAI_QUEUE_EMPTY as never, (player: KazagumoPlayer) => {
      const session = this.sessions.get(player.guildId);
      if (session && session.getPresentUserIds(this.client).size === 0) {
        session.onChannelEmpty(this.client);
      }
    });
  }

  /** Whether a live session exists for the guild. */
  public has(guildId: string): boolean {
    return this.sessions.has(guildId);
  }

  /** Fetch the live session for a guild, if any. */
  public get(guildId: string): MusicSession | undefined {
    return this.sessions.get(guildId);
  }

  /** All live sessions (read-only view). */
  public all(): ReadonlyMap<string, MusicSession> {
    return this.sessions;
  }

  /**
   * Create a brand-new session: spin up a Lavalink player, persist a row, and
   * register the runtime object. Throws if one already exists for the guild.
   */
  public async create(input: CreateSessionInput): Promise<MusicSession> {
    if (this.sessions.has(input.guildId)) {
      throw new Error(`A session already exists for guild ${input.guildId}.`);
    }

    const settings = await getGuildSettings(input.guildId);

    // Create (or reuse) the durable row keyed by (guild, voice channel).
    const row = await prisma.session.upsert({
      where: {
        guildId_voiceChannelId: {
          guildId: input.guildId,
          voiceChannelId: input.voiceChannelId,
        },
      },
      create: {
        guildId: input.guildId,
        voiceChannelId: input.voiceChannelId,
        textChannelId: input.textChannelId,
        ownerId: input.ownerId,
        volume: settings.defaultVolume,
        mode247: settings.default247,
        autoplay: settings.defaultAutoplay,
      },
      update: {
        textChannelId: input.textChannelId,
        ownerId: input.ownerId,
      },
    });

    const player = await this.audio.createPlayer({
      guildId: input.guildId,
      voiceId: input.voiceChannelId,
      textId: input.textChannelId,
      volume: row.volume,
      deaf: true,
    });

    player.setLoop(toKazagumoLoop[row.loopMode]);

    const session = this.buildSession(row, player);
    this.sessions.set(input.guildId, session);
    return session;
  }

  /** Fetch the existing session or create one for the given voice channel. */
  public async getOrCreate(input: CreateSessionInput): Promise<MusicSession> {
    return this.sessions.get(input.guildId) ?? (await this.create(input));
  }

  /**
   * Tear down a session: stop the player, drop the runtime object, and remove
   * the durable row **unless** it is a 24/7 session (which we keep so it can be
   * restored later).
   */
  public async destroy(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session) return;

    session.dispose();
    this.sessions.delete(guildId);

    // Persist a final snapshot for 24/7 before disconnecting; else delete row.
    if (session.mode247) {
      await session.persist().catch(() => undefined);
    } else {
      await prisma.session
        .delete({ where: { id: session.dbId } })
        .catch(() => undefined);
    }

    await session.player.destroy().catch(() => undefined);
  }

  /**
   * On boot, restore every 24/7 session: reconnect to its voice channel and
   * re-queue the persisted snapshot (best-effort — tracks are re-resolved from
   * their stored URIs).
   */
  public async restoreAll(): Promise<void> {
    const rows = await prisma.session.findMany({ where: { mode247: true } });
    for (const row of rows) {
      try {
        await this.restoreOne(row);
      } catch (err) {
        console.error(`[sessions] failed to restore guild ${row.guildId}:`, err);
      }
    }
  }

  /** Restore a single persisted 24/7 session row. */
  private async restoreOne(row: SessionRow): Promise<void> {
    const guild = this.client.guilds.cache.get(row.guildId);
    const voice = guild?.channels.cache.get(row.voiceChannelId);
    if (!guild || !voice?.isVoiceBased()) return;

    const player = await this.audio.createPlayer({
      guildId: row.guildId,
      voiceId: row.voiceChannelId,
      textId: row.textChannelId,
      volume: row.volume,
      deaf: true,
    });
    player.setLoop(toKazagumoLoop[row.loopMode]);

    const session = this.buildSession(row, player);
    this.sessions.set(row.guildId, session);

    // Re-resolve and enqueue the snapshot (URIs → tracks) if present.
    const snapshot = row.queueSnapshot as { upcoming?: { uri?: string | null }[] } | null;
    if (snapshot?.upcoming?.length) {
      for (const entry of snapshot.upcoming) {
        if (!entry.uri) continue;
        const result = await this.audio.search(entry.uri).catch(() => null);
        const track = result?.tracks[0];
        if (track) session.queue.add(track);
      }
      if (!player.playing && !player.paused) await player.play();
    }
  }

  /** Construct a MusicSession runtime object from a durable row + live player. */
  private buildSession(row: SessionRow, player: KazagumoPlayer): MusicSession {
    return new MusicSession(row.id, row.guildId, row.voiceChannelId, row.textChannelId, player, this, {
      ownerId: row.ownerId,
      mode247: row.mode247,
      autoplay: row.autoplay,
      locked: row.locked,
      allowedUsers: row.allowedUsers,
      deniedUsers: row.deniedUsers,
    });
  }
}
