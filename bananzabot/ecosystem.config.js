// CHANGE: PM2 ecosystem config for bananzabot
// WHY: Configure proper kill_timeout for graceful shutdown of all bot instances
// REF: Fix for 409 Conflict errors during restart

module.exports = {
  apps: [{
    name: 'bananzabot',
    script: '/root/aisell/bananzabot/node_modules/.bin/tsx',
    args: 'bananzabot.ts',
    interpreter: 'none',
    cwd: '/root/aisell/bananzabot',

    // Give 10 seconds for graceful shutdown (stop 12+ bot instances)
    kill_timeout: 10000,

    // Wait before considering app as online
    wait_ready: true,
    listen_timeout: 5000,

    // Don't watch files in production
    watch: false,

    // Environment
    env: {
      NODE_ENV: 'production',
      WEBHOOK_PORT: '3183',
      WEBHOOK_BASE_URL: 'https://bananzabot.wpmix.net'
    },

    // Restart policy
    max_restarts: 10,
    min_uptime: '10s',

    // Logs
    error_file: '/root/.pm2/logs/bananzabot-error.log',
    out_file: '/root/.pm2/logs/bananzabot-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  },
  // CHANGE: Add admin web UI process to browse dialogs with IP allowlist.
  // WHY: Need web admin links to all author and bot dialogs with restricted access.
  // QUOTE(ТЗ): "сделай в вебадминке ссылки на все диалоги с авторами и внутри ссылки на все диалоги созданных ботов . короче чтоб я все диалоги мог читать разреши только доступ с ip 212.193.45.174 и 89.185.84.184"
  // REF: user request 2026-01-28
  {
    name: 'bananzabot-admin',
    script: '/root/aisell/bananzabot/node_modules/.bin/tsx',
    args: 'adminServer.ts',
    interpreter: 'none',
    cwd: '/root/aisell/bananzabot',

    watch: false,

    env: {
      NODE_ENV: 'production',
      BANANZABOT_ADMIN_PORT: '3182'
    },

    max_restarts: 10,
    min_uptime: '10s',

    error_file: '/root/.pm2/logs/bananzabot-admin-error.log',
    out_file: '/root/.pm2/logs/bananzabot-admin-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  },
  // CHANGE: Manage the shared test bot in PM2 via tsx.
  // WHY: Gradual migration to TypeScript without build step (tsx is acceptable in prod).
  {
    name: 'bananzatestbot',
    cwd: '/root/aisell/bananzabot',
    script: '/root/aisell/bananzabot/node_modules/.bin/tsx',
    args: 'bananzatestbot.ts',
    interpreter: 'none',
    watch: false,
    env: {
      NODE_ENV: 'production'
    },
    max_restarts: 10,
    min_uptime: '10s',
    error_file: '/root/.pm2/logs/bananzatestbot-error.log',
    out_file: '/root/.pm2/logs/bananzatestbot-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  },
  // CHANGE: Auto-qualify CRM leads every 10 minutes via cron
  // WHY: Automatically process unqualified leads in background instead of manual button
  // REF: user request 2026-02-11 "сделай квалификацию по крону раз в 10 минут всех не квалифицированныз"
  {
    name: 'crm-auto-qualifier',
    script: 'crmAutoQualifier.js',
    cwd: '/root/aisell/bananzabot',
    watch: false,
    env: {
      NODE_ENV: 'production',
      HYDRA_API_KEY: 'sk-hydra-ai-cGcgmlN8P48dq2F0TuzzvhjpPYie99w.bRk..74qvQGA5pJw_d._OSY5Em9N7tKD',
      HYDRA_BASE_URL: 'https://api.hydraai.ru/v1'
    },
    max_restarts: 10,
    min_uptime: '10s',
    error_file: '/root/.pm2/logs/crm-auto-qualifier-error.log',
    out_file: '/root/.pm2/logs/crm-auto-qualifier-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  },
  // CHANGE: Auto-generate follow-up messages for commercial leads daily
  // WHY: Automatically reach out to users who didn't complete bot creation after 24 hours
  // REF: user request 2026-02-12 "добавь так же по крону в пм2 автогенерацию фоловапа, фоловап через день после последнего сообщения от него"
  {
    name: 'crm-auto-followup',
    script: 'crmAutoFollowup.js',
    cwd: '/root/aisell/bananzabot',
    watch: false,
    env: {
      NODE_ENV: 'production',
      HYDRA_API_KEY: 'sk-hydra-ai-cGcgmlN8P48dq2F0TuzzvhjpPYie99w.bRk..74qvQGA5pJw_d._OSY5Em9N7tKD',
      HYDRA_BASE_URL: 'https://api.hydraai.ru/v1',
      TELEGRAM_BOT_TOKEN: '174536660:AAETKoSfokrZek1pwf07SwrqqjfaybUSIK8'
    },
    max_restarts: 10,
    min_uptime: '10s',
    error_file: '/root/.pm2/logs/crm-auto-followup-error.log',
    out_file: '/root/.pm2/logs/crm-auto-followup-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  },
  // CHANGE: Auto-send educational tips to bot creators after deployment
  // WHY: Users don't discover features (buttons, notifications, broadcast) on their own
  // REF: user request 2026-02-20 "настрой серию фоловапов с hint лайвхаками"
  {
    name: 'tips-auto-sender',
    script: 'tipsAutoSender.js',
    cwd: '/root/aisell/bananzabot',
    watch: false,
    env: {
      NODE_ENV: 'production',
      HYDRA_API_KEY: 'sk-hydra-ai-cGcgmlN8P48dq2F0TuzzvhjpPYie99w.bRk..74qvQGA5pJw_d._OSY5Em9N7tKD',
      HYDRA_BASE_URL: 'https://api.hydraai.ru/v1',
      TELEGRAM_BOT_TOKEN: '174536660:AAETKoSfokrZek1pwf07SwrqqjfaybUSIK8'
    },
    max_restarts: 10,
    min_uptime: '10s',
    error_file: '/root/.pm2/logs/tips-auto-sender-error.log',
    out_file: '/root/.pm2/logs/tips-auto-sender-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
