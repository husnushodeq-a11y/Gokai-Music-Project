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
