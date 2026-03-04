// Main server (78.47.125.10) ecosystem config.
// Runs: noxonbot (RU, root access, dev groups), noxonbot-admin, cred-sync cron.
// Production bots (clodeboxbot, coderboxbot, coderbox-web) run on 62.109.14.209 — see ecosystem.prod.config.js.
//
// ⚠️ CLAUDE NOTE: Restarting `noxonbot` process (pm2 restart noxonbot) kills the bot process
// that is running YOUR current session. This means you effectively stop yourself mid-conversation.
// After restart the bot comes back up, but your Claude agent session is lost.
// Keep this in mind before running pm2 restart/reload on noxonbot.

// Load auth secrets from .env.auth (for dashboard-auth-api process)
const fs = require('fs');
const authEnvPath = '/root/aisell/botplatform/.env.auth';
const authSecrets = {};
try {
  const content = fs.readFileSync(authEnvPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) authSecrets[match[1]] = match[2];
  }
} catch (e) {
  // .env.auth not found — secrets will be empty, auth-api will fail to start
  console.warn('[ecosystem.config.js] Warning: .env.auth not found at', authEnvPath);
}

module.exports = {
  apps: [
    // CHANGE: noxonbot — RU bot with root/group access for dev work on this server
    // CHANGE: USE_BWRAP=1 by default for security (can be disabled per-chat via /settings)
    // WHY: User request - enable bwrap virtualization by default, allow disabling for specific chats
    {
      name: 'noxonbot',
      cwd: '/root/aisell/noxonbot',
      script: 'npm',
      args: 'start',
      env: {
        IS_SANDBOX: '1',
        USE_BWRAP: '1',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        // claritycult внутренний (chat -5122506589)
        CHAT_DIR__MINUS_5122506589: '/root/claritycult',
        // hostingpanel разработка (chat -5217914003)
        CHAT_DIR__MINUS_5217914003: '/root/hostingpanel',
        // MultiCurrencyWallet (chat -5135346794)
        CHAT_DIR__MINUS_5135346794: '/root/MultiCurrencyWallet',
        // golova — AITU Knowledge Base (chat -5264892294)
        CHAT_DIR__MINUS_5264892294: '/root/golova',
        PATH: '/root/.nvm/versions/node/v22.21.1/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      }
    },

    // CHANGE: noxonbot-admin — leads/onboarding admin panel (port 8889)
    {
      name: 'noxonbot-admin',
      cwd: '/root/aisell/noxonbot',
      script: 'adminServer.js',
      env: {
        NOXONBOT_ADMIN_PORT: '8889',
        PATH: '/root/.nvm/versions/node/v22.21.1/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      }
    },

    // CHANGE: noxonbot-webchat — web version on noxonbot.wpmix.net (port 8091)
    // WHY: User request "сделай чтоб noxonbot.wpmix.net был веб версией noxonbot"
    // REF: User message 2026-02-17
    // NOTE: All users work in bwrap sandbox except i448539@gmail.com (auto-disabled)
    {
      name: 'noxonbot-webchat',
      cwd: '/root/aisell/noxonbot',
      // Use dedicated launcher to force webchat-only mode and avoid Telegram polling 409 conflicts
      script: '/root/aisell/noxonbot/start-webchat-main.sh',
      interpreter: 'bash',
      env: {
        WEBCHAT_PORT: '8091',
        BOT_LANGUAGE: 'en',
        IS_SANDBOX: '1',
        USE_BWRAP: '1',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        WEBCHAT_TITLE: 'Noxonbot',
        WEBCHAT_INIT_WITH_START: 'true',
        // CHANGE: Webchat-only mode (no Telegram bot) to avoid 409 conflicts
        // WHY: Need clean webchat for showcase generation without Telegram interference
        // REF: User message 2026-02-18
        SKIP_GLOBAL_MESSAGE_HISTORY: 'true',
        // CHANGE: Google Auth enabled for noxonbot.wpmix.net
        // WHY: User provided Google OAuth credentials from mycity2-1033 project
        // REF: User message 2026-02-18
        ENABLE_GOOGLE_AUTH: 'true',
        GOOGLE_CLIENT_ID: '531979133429-uisb4r6j4u34d0v27igb4bhclkbbbhvf.apps.googleusercontent.com',
        // CHANGE: Disable onboarding for webchat - auto-create user workspace
        // WHY: User feedback - after Google OAuth login chat cleared, onboarding shown, UX confusing
        // REF: User message 2026-02-18 "отключим онбординг для новых пользователей именно на noxonbot.wpmix.net"
        ENABLE_ONBOARDING: 'false',
        PATH: '/root/.nvm/versions/node/v22.21.1/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      }
    },

    // CHANGE: dashboard-auth-api — Web3 auth service for SimpleDashboard (port 8095)
    // WHY: Ethereum ecrecover-based auth for dashboard pages (register, login, share, health)
    // REF: Task 2, dashboard-web3-auth feature
    // NOTE: Secrets loaded from .env.auth file (deployed in Task 11). Until then, set env vars manually.
    {
      name: 'dashboard-auth-api',
      cwd: '/root/aisell/noxonbot',
      script: './node_modules/.bin/tsx',
      args: 'src/auth-api.ts',
      interpreter: 'none',
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
        AUTH_API_PORT: '8095',
        PG_HOST: '10.10.10.2',
        PG_DB: 'dashboard_auth',
        PG_USER: 'dashboard_auth',
        PG_PASSWORD: authSecrets.PG_PASSWORD || '',
        JWT_SECRET: authSecrets.JWT_SECRET || '',
        INTERNAL_API_KEY: authSecrets.INTERNAL_API_KEY || '',
        PATH: '/root/.nvm/versions/node/v22.21.1/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      },
      error_file: '/root/.pm2/logs/dashboard-auth-api-error.log',
      out_file: '/root/.pm2/logs/dashboard-auth-api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },

    // CHANGE: cred-sync — syncs Claude + Codex credentials to prod server every 10 minutes
    // WHY: Prod server (62.109.14.209) needs fresh credentials for Claude/Codex CLI
    {
      name: 'cred-sync',
      cwd: '/root/aisell/noxonbot',
      script: './scripts/sync_creds_to_prod.sh',
      interpreter: 'bash',
      cron_restart: '*/10 * * * *',
      autorestart: false,
      watch: false,
      env: {
        PATH: '/root/.nvm/versions/node/v22.21.1/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      }
    }
  ]
};
