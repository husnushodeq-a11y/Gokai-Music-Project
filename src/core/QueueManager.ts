import type { KazagumoPlayer, KazagumoTrack } from 'kazagumo';

/**
 * QueueManager — advanced, well-typed manipulation over a session's queue.
 *
 * Kazagumo already exposes a backing queue (`player.queue`, an `Array` subclass
 * with `.current` / `.previous`). Rather than maintaining a *parallel* array
 * (which risks drifting out of sync with what Lavalink actually plays next), we
 * operate **in place** on that same array. This keeps Kazagumo as the single
 * source of truth for playback order while giving us the rich Jockie-style
 * operations: move, swap, reverse, sort, de-duplicate and "remove absent users".
 *
 * Every mutating method is bounds-checked and returns a value describing what
 * happened, so command handlers can render accurate feedback and never crash on
 * out-of-range input.
 */

// ── Requester helpers ────────────────────────────────────────────────────────

/**
 * Normalise the polymorphic `track.requester` into a snowflake string.
 *
 * We set `requester` to a discord.js `User` when enqueuing, but callers may also
 * pass a raw id string or a `{ id }`-shaped object, so we defensively handle all
 * three shapes and return `null` when no id can be determined.
 */
export function requesterId(requester: unknown): string | null {
  if (!requester) return null;
  if (typeof requester === 'string') return requester;
  if (typeof requester === 'object' && 'id' in requester) {
    const id = (requester as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

// ── Sorting ──────────────────────────────────────────────────────────────────

/** Keys the queue can be sorted by (mirrors Jockie's sort options). */
export type SortKey = 'title' | 'author' | 'duration' | 'requester';
export type SortDirection = 'asc' | 'desc';

// ── Result types ─────────────────────────────────────────────────────────────

/** Result of a de-duplication / absent-removal pass. */
export interface RemovalResult {
  /** How many tracks were removed. */
  removed: number;
  /** The tracks that were removed, in original order. */
  tracks: KazagumoTrack[];
}

export class QueueManager {
  public constructor(private readonly player: KazagumoPlayer) {}

  // ── Read accessors ─────────────────────────────────────────────────────────

  /** The currently-playing track, if any. */
  public get current(): KazagumoTrack | null {
    return this.player.queue.current ?? null;
  }

  /**
   * The most-recently-played track, if any. Kazagumo tracks a full history
   * array; this getter returns just the latest entry for convenience.
   */
  public get previous(): KazagumoTrack | null {
    const history = this.player.queue.previous;
    return history.length ? history[history.length - 1]! : null;
  }

  /** Full play history (most recent last), copied so callers can't mutate it. */
  public get history(): KazagumoTrack[] {
    return [...this.player.queue.previous];
  }

  /** The upcoming tracks (excludes the currently playing one). */
  public get upcoming(): KazagumoTrack[] {
    // Copy so callers can't mutate the live array by accident.
    return [...this.player.queue];
  }

  /** Number of upcoming tracks (excludes current). */
  public get size(): number {
    return this.player.queue.length;
  }

  /** Total tracks including the one currently playing. */
  public get totalSize(): number {
    return this.size + (this.current ? 1 : 0);
  }

  /** Whether there are no upcoming tracks. */
  public get isEmpty(): boolean {
    return this.size === 0;
  }

  /** Total remaining duration in ms (upcoming tracks; excludes streams). */
  public get totalDuration(): number {
    return this.player.queue.reduce(
      (sum, t) => sum + (t.isStream ? 0 : t.length ?? 0),
      0,
    );
  }

  // ── Adding ─────────────────────────────────────────────────────────────────

  /**
   * Append one or more tracks. When `position` is provided the tracks are
   * inserted at that index (clamped into range) — used by "play next".
   */
  public add(tracks: KazagumoTrack | KazagumoTrack[], position?: number): number {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    if (list.length === 0) return this.size;

    if (position === undefined) {
      this.player.queue.add(list);
    } else {
      const index = this.clampIndex(position, this.size);
      this.player.queue.splice(index, 0, ...list);
    }
    return this.size;
  }

  // ── Removing ─────────────────────────────────────────────────────────────

  /** Remove a single track by index. Returns the removed track or null. */
  public remove(index: number): KazagumoTrack | null {
    if (!this.inRange(index)) return null;
    const [removed] = this.player.queue.splice(index, 1);
    return removed ?? null;
  }

  /**
   * Remove an inclusive range `[start, end]` of upcoming tracks.
   * Indices are clamped and swapped if reversed. Returns removed tracks.
   */
  public removeRange(start: number, end: number): KazagumoTrack[] {
    if (this.isEmpty) return [];
    let lo = this.clampIndex(Math.min(start, end), this.size - 1);
    const hi = this.clampIndex(Math.max(start, end), this.size - 1);
    const count = hi - lo + 1;
    return this.player.queue.splice(lo, count);
  }

  /** Remove every upcoming track (does not stop the current track). */
  public clear(): number {
    const count = this.size;
    this.player.queue.clear();
    return count;
  }

  // ── Re-ordering ────────────────────────────────────────────────────────────

  /**
   * Move the track at `from` to sit at index `to`, shifting the rest.
   * Returns the moved track, or null if `from` is out of range.
   */
  public move(from: number, to: number): KazagumoTrack | null {
    if (!this.inRange(from)) return null;
    const target = this.clampIndex(to, this.size - 1);
    const [track] = this.player.queue.splice(from, 1);
    if (!track) return null;
    this.player.queue.splice(target, 0, track);
    return track;
  }

  /** Swap the tracks at two indices. Returns false if either is out of range. */
  public swap(a: number, b: number): boolean {
    if (!this.inRange(a) || !this.inRange(b) || a === b) return false;
    const q = this.player.queue;
    const tmp = q[a]!;
    q[a] = q[b]!;
    q[b] = tmp;
    return true;
  }

  /** Reverse the order of all upcoming tracks in place. */
  public reverse(): void {
    this.player.queue.reverse();
  }

  /** Fisher–Yates shuffle of the upcoming tracks. */
  public shuffle(): void {
    const q = this.player.queue;
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = q[i]!;
      q[i] = q[j]!;
      q[j] = tmp;
    }
  }

  /**
   * Sort the upcoming tracks by a key/direction. Sorting is stable and operates
   * only on the *upcoming* portion; the currently-playing track is untouched.
   */
  public sort(key: SortKey, direction: SortDirection = 'asc'): void {
    const factor = direction === 'asc' ? 1 : -1;
    const sorted = [...this.player.queue].sort((a, b) => this.compare(a, b, key) * factor);
    this.replaceAll(sorted);
  }

  /**
   * Jump so that the track at `index` becomes the next to play: every track
   * before it is discarded. Returns the number of tracks skipped, or -1 if the
   * index is invalid. The caller is responsible for calling `player.skip()`.
   */
  public jumpTo(index: number): number {
    if (!this.inRange(index)) return -1;
    const removed = this.player.queue.splice(0, index);
    return removed.length;
  }

  // ── Advanced Jockie-style operations ─────────────────────────────────────

  /**
   * Remove duplicate upcoming tracks, keeping the **first** occurrence of each.
   * Identity is by track `uri` (falling back to `title|author`).
   */
  public removeDuplicates(): RemovalResult {
    const seen = new Set<string>();
    const kept: KazagumoTrack[] = [];
    const removed: KazagumoTrack[] = [];

    for (const track of this.player.queue) {
      const identity = track.uri ?? `${track.title}|${track.author ?? ''}`;
      if (seen.has(identity)) {
        removed.push(track);
      } else {
        seen.add(identity);
        kept.push(track);
      }
    }

    if (removed.length > 0) this.replaceAll(kept);
    return { removed: removed.length, tracks: removed };
  }

  /**
   * Remove every upcoming track whose requester is **not** currently present in
   * the voice channel — i.e. "clean up after people who left". Pass the set of
   * user ids currently in the session's voice channel.
   */
  public removeAbsent(presentUserIds: ReadonlySet<string>): RemovalResult {
    const kept: KazagumoTrack[] = [];
    const removed: KazagumoTrack[] = [];

    for (const track of this.player.queue) {
      const id = requesterId(track.requester);
      // Keep tracks whose requester is present (or unknown/system-added).
      if (id === null || presentUserIds.has(id)) {
        kept.push(track);
      } else {
        removed.push(track);
      }
    }

    if (removed.length > 0) this.replaceAll(kept);
    return { removed: removed.length, tracks: removed };
  }

  // ── Loop control (delegated to Kazagumo) ─────────────────────────────────

  /** Set the repeat mode. */
  public setLoop(mode: 'none' | 'track' | 'queue'): void {
    this.player.setLoop(mode);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  /**
   * Produce a JSON-serialisable snapshot of the queue (current + upcoming) for
   * durable 24/7 restore. We persist the minimal fields needed to re-resolve the
   * track on restart.
   */
  public snapshot(): SerializedQueue {
    const toEntry = (t: KazagumoTrack): SerializedTrack => ({
      title: t.title,
      author: t.author ?? null,
      uri: t.uri ?? null,
      length: t.length ?? null,
      isStream: Boolean(t.isStream),
      requesterId: requesterId(t.requester),
    });

    return {
      current: this.current ? toEntry(this.current) : null,
      upcoming: this.player.queue.map(toEntry),
    };
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /** Replace the entire upcoming queue array in place, preserving the instance. */
  private replaceAll(tracks: KazagumoTrack[]): void {
    this.player.queue.splice(0, this.player.queue.length, ...tracks);
  }

  /** True if `index` addresses an existing upcoming track. */
  private inRange(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.size;
  }

  /** Clamp `index` into `[0, upper]`. */
  private clampIndex(index: number, upper: number): number {
    if (!Number.isFinite(index)) return 0;
    return Math.min(Math.max(0, Math.trunc(index)), Math.max(0, upper));
  }

  /** Comparison used by `sort`. */
  private compare(a: KazagumoTrack, b: KazagumoTrack, key: SortKey): number {
    switch (key) {
      case 'title':
        return a.title.localeCompare(b.title);
      case 'author':
        return (a.author ?? '').localeCompare(b.author ?? '');
      case 'duration':
        return (a.length ?? 0) - (b.length ?? 0);
      case 'requester':
        return (requesterId(a.requester) ?? '').localeCompare(requesterId(b.requester) ?? '');
    }
  }
}

// ── Serialisation shapes ─────────────────────────────────────────────────────

export interface SerializedTrack {
  title: string;
  author: string | null;
  uri: string | null;
  length: number | null;
  isStream: boolean;
  requesterId: string | null;
}

export interface SerializedQueue {
  current: SerializedTrack | null;
  upcoming: SerializedTrack[];
}
