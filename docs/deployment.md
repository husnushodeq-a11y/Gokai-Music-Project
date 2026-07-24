# Deploying Gokai Music to a VPS

The stack has three parts: the **bot** (Node.js), **PostgreSQL**, and a
**Lavalink v4** node (Java). This guide covers two ways to run them on a VPS:

- **Option A — Docker Compose** (recommended): one command, everything wired up.
- **Option B — Bare metal** (systemd + PM2): more control, no Docker.

---

## 0. Before you start

**VPS**: any Ubuntu/Debian VPS with ~2 GB RAM works (Lavalink's JVM is the
biggest consumer; give it ~1 GB). 1 vCPU is fine for a handful of guilds.

**Discord application**:
1. Create a bot at <https://discord.com/developers/applications>.
2. Copy the **token** and the **application (client) id**.
3. Under **Bot → Privileged Gateway Intents**, enable **MESSAGE CONTENT INTENT**
   (this bot is prefix-only, so it *requires* this).
4. Invite it with the `bot` scope and the permissions: View Channels, Send
   Messages, Embed Links, Connect, Speak.

**Firewall**: only outbound HTTPS is needed. Do **not** expose PostgreSQL (5432)
or Lavalink (2333) to the internet — both options below keep them private.

---

## Option A — Docker Compose (recommended)

### 1. Install Docker
```bash
curl -fsSL https://get.docker.com | sh
```

### 2. Get the code and configure
```bash
git clone https://github.com/husnushodeq-a11y/gokai-music-project.git
cd gokai-music-project

# Secrets for the stack:
cp .env.docker.example .env
nano .env            # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, BOT_OWNER_IDS,
                     # POSTGRES_PASSWORD, LAVALINK_PASSWORD

# Lavalink node config (enables Spotify etc.):
cp lavalink/application.example.yml lavalink/application.yml
nano lavalink/application.yml   # optional: add Spotify clientId/secret
```
> The `LAVALINK_PASSWORD` in `.env` overrides the password in `application.yml`,
> so you don't have to edit it in two places.

### 3. Launch
```bash
docker compose up -d --build
```
That builds the bot image, starts PostgreSQL, Lavalink and the bot, applies the
database schema (`prisma db push`) automatically, and restarts everything on
reboot (`restart: unless-stopped`).

### 4. Verify
```bash
docker compose ps           # all three services "running"
docker compose logs -f bot  # look for "logged in as <BotName>"
```
In Discord, run `m!help`.

### Day-2 operations
```bash
# Update to the latest code:
git pull && docker compose up -d --build

# Logs:
docker compose logs -f bot
docker compose logs -f lavalink

# Restart / stop:
docker compose restart bot
docker compose down                 # stop (keeps data volumes)

# Back up the database:
docker compose exec postgres pg_dump -U gokai gokai_music > backup-$(date +%F).sql
```

---

## Option B — Bare metal (systemd + PM2)

### 1. System packages
```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql openjdk-17-jre-headless
sudo npm i -g pm2
```

### 2. PostgreSQL
```bash
sudo -u postgres psql -c "CREATE USER gokai WITH PASSWORD 'a-strong-password';"
sudo -u postgres psql -c "CREATE DATABASE gokai_music OWNER gokai;"
```

### 3. Lavalink
```bash
sudo mkdir -p /opt/lavalink && cd /opt/lavalink
# Grab the latest v4 jar from the releases page:
sudo curl -L -o Lavalink.jar \
  https://github.com/lavalink-devs/Lavalink/releases/latest/download/Lavalink.jar
# Copy the example config and set the password (+ Spotify creds if wanted):
sudo cp /path/to/gokai-music-project/lavalink/application.example.yml application.yml
sudo nano application.yml
```
Create `/etc/systemd/system/lavalink.service`:
```ini
[Unit]
Description=Lavalink
After=network.target

[Service]
WorkingDirectory=/opt/lavalink
ExecStart=/usr/bin/java -Xmx1G -jar Lavalink.jar
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now lavalink
sudo journalctl -u lavalink -f      # wait for "Lavalink is ready to accept connections"
```

### 4. The bot
```bash
cd /path/to/gokai-music-project
cp .env.example .env
nano .env     # DISCORD_TOKEN, DISCORD_CLIENT_ID, BOT_OWNER_IDS,
              # DATABASE_URL=postgresql://gokai:a-strong-password@localhost:5432/gokai_music?schema=public
              # LAVALINK_NODES=[{"name":"main","url":"localhost:2333","auth":"<your-lavalink-password>","secure":false}]

npm ci
npx prisma db push          # create the tables
npm run build

# Run under PM2 (auto-restart + boot persistence):
pm2 start dist/index.js --name gokai-music
pm2 save
pm2 startup                 # run the command it prints, to survive reboots
```

### Day-2 operations
```bash
pm2 logs gokai-music
pm2 restart gokai-music

# Update:
git pull && npm ci && npx prisma db push && npm run build && pm2 restart gokai-music
```

---

## Database migrations (optional, for stricter change control)

Both paths above use `prisma db push`, which syncs the schema without migration
history — perfect for a single deployment. For auditable, reversible schema
changes, generate migrations instead:

```bash
# Locally, whenever the schema changes:
npx prisma migrate dev --name <change>   # creates prisma/migrations/… ; commit it
```
Then on the server use `npx prisma migrate deploy` (and change the Dockerfile
`CMD` to run `migrate deploy` instead of `db push`).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bot logs `Missing required environment variable` | A value in `.env` is blank. |
| Bot connects but ignores commands | Enable the **Message Content** intent in the Developer Portal. |
| `No node is available` / no audio | Lavalink isn't up or the password/host in `LAVALINK_NODES` is wrong. |
| Spotify links say "No results" | Add the LavaSrc plugin + credentials — see [`spotify-setup.md`](spotify-setup.md). |
| DB errors on start | Check `DATABASE_URL`; ensure Postgres is reachable and `prisma db push` ran. |
