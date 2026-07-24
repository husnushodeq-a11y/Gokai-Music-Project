# ─────────────────────────────────────────────────────────────────────────────
#  Gokai Music — production image (multi-stage)
#
#  Stage 1 installs deps (running `prisma generate` via postinstall) and compiles
#  TypeScript → dist/. Stage 2 is a slim runtime that carries only the generated
#  node_modules + dist, and applies the DB schema before starting the bot.
# ─────────────────────────────────────────────────────────────────────────────

# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
# Prisma's query engine needs openssl (and libc6-compat) on Alpine.
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app

# Install dependencies first for better layer caching. `prisma` must be present
# before `npm ci` runs the postinstall `prisma generate`, so copy the schema too.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Compile the TypeScript sources (tsc + tsc-alias → dist/).
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
ENV NODE_ENV=production

# Carry over the installed (and Prisma-generated) modules, the build output and
# the schema needed by `prisma db push` at start-up.
COPY package.json ./
COPY prisma ./prisma
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Apply the schema to the database, then launch. `db push` is idempotent and
# needs no migration files; swap for `prisma migrate deploy` once you commit
# migrations for stricter production change control.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
