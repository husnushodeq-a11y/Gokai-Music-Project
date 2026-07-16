import type { GuildSettings, UserSettings } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { config } from '@/config';

/**
 * SettingsService — cached read-through access to guild & user settings.
 *
 * These rows are read on *every* message (prefix resolution) and on every
 * session mutation, so hitting Postgres each time would be wasteful. We keep a
 * small in-memory cache with a short TTL; writes go through here so the cache
 * is invalidated immediately and never serves stale data after a change.
 */

const CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const guildCache = new Map<string, CacheEntry<GuildSettings>>();
const userCache = new Map<string, CacheEntry<UserSettings>>();

/** Read guild settings, creating a default row on first access. */
export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  const cached = guildCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const settings = await prisma.guildSettings.upsert({
    where: { guildId },
    create: { guildId },
    update: {},
  });

  guildCache.set(guildId, { value: settings, expiresAt: Date.now() + CACHE_TTL_MS });
  return settings;
}

/** Read user settings without creating a row (returns null if none exists). */
export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (settings) {
    userCache.set(userId, { value: settings, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return settings;
}

/** Patch guild settings and refresh the cache with the returned row. */
export async function updateGuildSettings(
  guildId: string,
  data: Partial<Omit<GuildSettings, 'guildId' | 'createdAt' | 'updatedAt'>>,
): Promise<GuildSettings> {
  const settings = await prisma.guildSettings.upsert({
    where: { guildId },
    create: { guildId, ...data },
    update: data,
  });
  guildCache.set(guildId, { value: settings, expiresAt: Date.now() + CACHE_TTL_MS });
  return settings;
}

/** Patch user settings and refresh the cache with the returned row. */
export async function updateUserSettings(
  userId: string,
  data: Partial<Omit<UserSettings, 'userId' | 'createdAt' | 'updatedAt'>>,
): Promise<UserSettings> {
  const settings = await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  userCache.set(userId, { value: settings, expiresAt: Date.now() + CACHE_TTL_MS });
  return settings;
}

/**
 * Resolve the effective command prefix for a message using Jockie's precedence:
 *
 *   1. **User** personal prefix (if set)      — highest priority
 *   2. **Server** prefix (if set)
 *   3. **Default** prefix (from config)        — lowest priority
 *
 * Reads are cached, so this is cheap enough to run on every message.
 */
export async function resolvePrefix(
  guildId: string | null,
  userId: string,
): Promise<string> {
  const user = await getUserSettings(userId);
  if (user?.prefix) return user.prefix;

  if (guildId) {
    const guild = await getGuildSettings(guildId);
    if (guild.prefix) return guild.prefix;
  }

  return config.defaultPrefix;
}

/** Drop cached settings for a guild/user (used by admin reset flows). */
export function invalidateSettingsCache(opts: { guildId?: string; userId?: string }): void {
  if (opts.guildId) guildCache.delete(opts.guildId);
  if (opts.userId) userCache.delete(opts.userId);
}
