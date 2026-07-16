/**
 * Small, dependency-free formatting helpers shared across commands and the
 * audio layer. Kept pure so they are trivially unit-testable.
 */

/**
 * Format a millisecond duration as `H:MM:SS` (or `M:SS` under an hour).
 * Streams / unknown lengths should be handled by the caller before this.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';

  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => n.toString().padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/** Truncate a string to `max` chars, appending an ellipsis when clipped. */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1))}…`;
}

/** Clamp a number into the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Parse a human time expression into **milliseconds**, or null if unparseable.
 *
 * Accepts:
 *   - Colon notation:  "90" → 90s, "1:30" → 90s, "1:02:03" → 1h2m3s
 *   - Unit notation:   "90s", "2m", "1h30m", "1h2m3s"
 */
export function parseTimeToMs(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  // Colon notation (ss / mm:ss / hh:mm:ss).
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((p) => Number(p));
    if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
    let seconds = 0;
    for (const part of parts) seconds = seconds * 60 + part;
    return Math.round(seconds * 1000);
  }

  // Plain number → seconds.
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

  // Unit notation (1h2m3s, 90s, 2m, …).
  const unitPattern = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
  const match = unitPattern.exec(trimmed);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

/**
 * Render a textual progress bar for a track, e.g. `▬▬▬🔘▬▬▬▬▬▬`.
 * `position` and `length` are in milliseconds.
 */
export function progressBar(position: number, length: number, size = 18): string {
  if (length <= 0) return '🔘' + '▬'.repeat(Math.max(0, size - 1));
  const ratio = clamp(position / length, 0, 1);
  const knob = Math.min(size - 1, Math.floor(ratio * size));
  return '▬'.repeat(knob) + '🔘' + '▬'.repeat(Math.max(0, size - knob - 1));
}
