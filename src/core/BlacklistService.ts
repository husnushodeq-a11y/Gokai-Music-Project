import { BlacklistScope } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * BlacklistService — fast gate consulted by the messageCreate middleware.
 *
 * Blacklists are checked on every command invocation, so results are cached with
 * a short TTL. A single lookup answers "may this (user, guild) pair run commands
 * right now?" by consulting GLOBAL, GUILD and USER scoped entries and honouring
 * expiry.
 */

const CACHE_TTL_MS = 30_000;

interface CachedDecision {
  blocked: boolean;
  reason?: string;
  expiresAt: number;
}

const cache = new Map<string, CachedDecision>();

/** Cache key for a (user, guild) pair. */
function keyFor(userId: string, guildId: string | null): string {
  return `${userId}:${guildId ?? 'dm'}`;
}

/** Result of a blacklist evaluation. */
export interface BlacklistResult {
  blocked: boolean;
  reason?: string;
}

/**
 * Determine whether the given user (optionally within a guild) is blacklisted.
 * Expired entries are treated as inactive. Results are cached briefly.
 */
export async function isBlacklisted(
  userId: string,
  guildId: string | null,
): Promise<BlacklistResult> {
  const key = keyFor(userId, guildId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { blocked: cached.blocked, reason: cached.reason };
  }

  const now = new Date();

  // Any matching, non-expired entry across the three scopes blocks the caller.
  const entry = await prisma.blacklist.findFirst({
    where: {
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        {
          OR: [
            { scope: BlacklistScope.GLOBAL, targetId: userId },
            { scope: BlacklistScope.USER, targetId: userId, guildId: null },
            guildId
              ? { scope: BlacklistScope.USER, targetId: userId, guildId }
              : { id: '__never__' },
            guildId
              ? { scope: BlacklistScope.GUILD, targetId: guildId }
              : { id: '__never__' },
          ],
        },
      ],
    },
  });

  const result: BlacklistResult = entry
    ? { blocked: true, reason: entry.reason ?? 'You are blacklisted from using this bot.' }
    : { blocked: false };

  cache.set(key, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

/** Invalidate cached blacklist decisions (call after add/remove). */
export function invalidateBlacklistCache(): void {
  cache.clear();
}
