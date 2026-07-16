# Gokai Music

A **1:1 functional clone of Jockie Music** for Discord, written in TypeScript with
**discord.js v14**. Strictly **prefix-only** (no slash commands), component-driven
UI, backed by **Lavalink v4** (via Kazagumo/Shoukaku) and **PostgreSQL + Prisma**.

> Status: **Phase 1 (Foundation)** and **Phase 2 (Help System & UI)** are complete.
> The core command layer (play, queue, sessions, collections, profiles, settings)
> lands in subsequent phases.

## Architecture

```
src/
├── index.ts                     # Composition root / bootstrap
├── client.ts                    # discord.js client factory (privileged intents)
├── config.ts                    # Validated, typed environment config
├── types/index.ts               # Command contract + shared types
├── lib/prisma.ts                # Prisma singleton (hot-reload safe)
├── util/format.ts               # Pure formatting helpers
├── audio/
│   └── AudioManager.ts          # Lavalink v4 wrapper + STATIC now-playing embed
├── core/
│   ├── SessionManager.ts        # Session lifecycle, ownership, permissions, 24/7
│   ├── QueueManager.ts          # Advanced queue ops (move/swap/sort/dedupe/…)
│   ├── SettingsService.ts       # Cached guild/user settings + prefix resolution
│   └── BlacklistService.ts      # Blacklist gate
├── events/
│   └── messageCreate.ts         # Prefix middleware: resolve → alias → gate → run
└── commands/
    ├── index.ts                 # Command registry
    └── help/
        ├── HelpCommand.ts       # Paginated, collector-driven help (Jockie parity)
        └── helpContent.ts       # Help catalog (pages / subcategories / commands)
```

### Layering

`AudioManager` (Lavalink) → `QueueManager` (order) → `SessionManager` (ownership &
permissions). Each layer only depends on the one below it.

## Key design decisions

- **Prefix resolution** follows Jockie precedence: **User → Server → Default**,
  implemented in `SettingsService.resolvePrefix` and read on every message
  (cached with a short TTL).
- **Now-Playing is static**: emitted from `AudioManager` on `playerStart` as a
  plain embed with **no buttons** — enforced at the audio layer so no command can
  accidentally attach controls.
- **Help uses one collector** per invocation with an `idle` timeout; components
  are disabled on end. No global collector registry ⇒ no leaks.
- **24/7 sessions** persist a queue snapshot and are restored on boot.

## Setup

1. `cp .env.example .env` and fill in the values.
2. Run a **Lavalink v4** node and point `LAVALINK_NODES` at it.
3. Run PostgreSQL and set `DATABASE_URL`.
4. Install & migrate:
   ```bash
   npm install
   npm run prisma:migrate -- --name init
   npm run build
   npm start
   ```
   For development: `npm run dev`.

## Requirements

- Node.js ≥ 18.17
- PostgreSQL
- A Lavalink v4 server
- The **Message Content** privileged intent enabled for the bot.
