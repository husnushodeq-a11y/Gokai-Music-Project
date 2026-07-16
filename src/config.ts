import 'dotenv/config';

/**
 * Strongly-typed, validated view of the process environment.
 *
 * Everything the bot needs from `.env` is parsed and sanity-checked exactly once
 * here, so the rest of the codebase can import a typed object instead of poking
 * at `process.env` (which is `string | undefined` everywhere and easy to misuse).
 */

/** A single Lavalink v4 node descriptor as consumed by the AudioManager. */
export interface LavalinkNodeConfig {
  /** Friendly identifier for the node. */
  name: string;
  /** `host:port` of the Lavalink REST/WS endpoint. */
  url: string;
  /** The node password (`server.password` in application.yml). */
  auth: string;
  /** Whether to use wss/https. */
  secure: boolean;
}

/** Read a required string env var or throw a descriptive error at boot. */
function required(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === '') {
    throw new Error(`[config] Missing required environment variable: ${key}`);
  }
  return value.trim();
}

/** Read an optional string env var, falling back to `fallback`. */
function optional(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

/** Parse a comma-separated snowflake list into a de-duplicated array. */
function parseIdList(raw: string): string[] {
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
}

/** Parse the `LAVALINK_NODES` JSON blob with a friendly error on malformed input. */
function parseLavalinkNodes(raw: string): LavalinkNodeConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[config] LAVALINK_NODES is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('[config] LAVALINK_NODES must be a non-empty JSON array.');
  }
  return parsed.map((node, i) => {
    const n = node as Partial<LavalinkNodeConfig>;
    if (!n.name || !n.url || n.auth === undefined) {
      throw new Error(`[config] LAVALINK_NODES[${i}] is missing name/url/auth.`);
    }
    return { name: n.name, url: n.url, auth: n.auth, secure: Boolean(n.secure) };
  });
}

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
  },
  /** The system-wide fallback prefix (bottom of the resolution chain). */
  defaultPrefix: optional('DEFAULT_PREFIX', 'm!'),
  /** Owner ids that bypass every permission / blacklist / DJ check. */
  ownerIds: parseIdList(optional('BOT_OWNER_IDS', '')),
  lavalink: {
    nodes: parseLavalinkNodes(optional('LAVALINK_NODES', '[]')),
  },
} as const;

export type Config = typeof config;
