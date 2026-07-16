import { PrismaClient } from '@prisma/client';

/**
 * Process-wide Prisma singleton.
 *
 * A `PrismaClient` opens a connection pool, so we must never construct more than
 * one. During `ts-node-dev` hot reloads the module cache is cleared, which would
 * otherwise leak a new client (and pool) on every restart — so we stash the
 * instance on `globalThis` and reuse it.
 */

// Augment the global scope with an optional cached client (dev-reload safe).
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
