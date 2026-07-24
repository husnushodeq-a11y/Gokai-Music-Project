// ─────────────────────────────────────────────────────────────────────────────
//  PM2 process definition for Gokai Music.
//
//  Usage (after `npm ci && npm run build`):
//    pm2 start ecosystem.config.js
//    pm2 save            # persist the process list
//    pm2 startup         # run the printed command so PM2 survives reboots
//
//  This file is CommonJS (package.json has "type": "commonjs").
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [
    {
      name: 'gokai-music',
      // The compiled entry point (run `npm run build` first).
      script: 'dist/index.js',
      // Anchor cwd to the project root so the app's dotenv finds ./.env.
      cwd: __dirname,

      // A Discord bot holds ONE gateway connection — never cluster it, or you
      // get duplicate logins and doubled command handling. Single fork only.
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      // Guard against slow leaks — PM2 recycles the process past this RSS.
      max_memory_restart: '400M',
      // If it crash-loops, back off instead of hammering.
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 3000,

      // Timestamped logs; combine stdout/stderr streams.
      time: true,
      merge_logs: true,

      env: {
        NODE_ENV: 'production',
        // Secrets are read from ./.env by the app (dotenv) — do not duplicate
        // DISCORD_TOKEN / DATABASE_URL / LAVALINK_NODES here.
      },
    },
  ],
};
