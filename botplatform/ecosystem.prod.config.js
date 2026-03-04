// Production server (62.109.14.209) ecosystem config.
// Runs: clodeboxbot (RU), coderboxbot (EN), noxonbot-web (clodeboxbot.habab.ru), coderbox-web (coderbox.wpmix.net), noxonbot-admin.
// Main server dev bot (noxonbot) runs on 95.217.227.164 — see ecosystem.config.js.
module.exports = {
  apps: [
    // CHANGE: clodeboxbot — RU Telegram bot (@clodeboxbot / @claudeboxbot)
    // WHY: Isolated prod instance; no root-level group access; credentials synced from main server
    {
      name: 'clodeboxbot',
      cwd: '/root/aisell/noxonbot',
      script: 'npm',
      args: 'start',
      env: {
        IS_SANDBOX: '1',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        CLAUDE_USE_SDK_URL: 'true',
        // BOT_TOKEN loaded from .env file
        ENABLE_ONBOARDING: 'false',
        DISABLE_PAYMENT_FLOW: 'true',
        BOT_LANGUAGE: 'ru',
        PM2_PROCESS_NAME: 'clodeboxbot',
        OPENAI_API_KEY: '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',
        HTTPS_PROXY: 'http://user:ANbLn6LaXfzPT2@95.217.227.164:3128',
        PATH: '/root/.nvm/versions/node/v22.21.1/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      }
    },

    // CHANGE: coderboxbot — EN Telegram bot (@coderboxbot)
    // WHY: English-language isolated prod instance
    {
      name: 'coderboxbot',
      cwd: '/root/aisell/noxonbot',
      script: './start-coderbox.sh',
      interpreter: 'bash',
      env: {
        IS_SANDBOX: '1',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        CLAUDE_USE_SDK_URL: 'true',
        PATH: '/root/.nvm/versions/node/v22.21.1/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      }
    },

    // CHANGE: noxonbot-web — RU webchat UI for claudeboxbot.habab.ru / clodeboxbot.habab.ru (port 8091)
    {
      name: 'noxonbot-web',
      cwd: '/root/aisell/noxonbot',
      script: 'npm',
      args: 'run webchat',
      env: {
        IS_SANDBOX: '1',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        CLAUDE_USE_SDK_URL: 'true',
        NOXONBOT_DISABLE_AUTO_START: 'true',
        DISABLE_START_NOTIFICATIONS: 'true',
        SKIP_GLOBAL_MESSAGE_HISTORY: 'true',
        ENABLE_ONBOARDING: 'false',
        DISABLE_PAYMENT_FLOW: 'true',
        WEBCHAT_PORT: '8091',
        WEBCHAT_TITLE: 'Clodebox',
        WEBCHAT_SUBTITLE: 'AI assistant powered by Claude',
        PATH: '/root/.nvm/versions/node/v22.21.1/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      }
    },

    // CHANGE: coderbox-web — EN webchat UI for coderbox.wpmix.net / coderbox.onout.org (port 8092)
    {
      name: 'coderbox-web',
      cwd: '/root/aisell/noxonbot',
      script: './start-webchat-coderbox.sh',
      interpreter: 'bash',
      env: {
        IS_SANDBOX: '1',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        CLAUDE_USE_SDK_URL: 'true',
        NOXONBOT_DISABLE_AUTO_START: 'true',
        DISABLE_START_NOTIFICATIONS: 'true',
        SKIP_GLOBAL_MESSAGE_HISTORY: 'true',
        WEBCHAT_PORT: '8092',
        WEBCHAT_TITLE: 'Coderbox EN',
        WEBCHAT_SUBTITLE: 'AI coding assistant (EN)',
        PATH: '/root/.nvm/versions/node/v22.21.1/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      }
    },

    // Dedicated AITU webchat instance (wpmix subdomain), fixed docs workspace context.
    {
      name: 'aitu-web',
      cwd: '/root/aisell/noxonbot',
      script: './start-webchat-aitu.sh',
      interpreter: 'bash',
      env: {
        IS_SANDBOX: '1',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        CLAUDE_USE_SDK_URL: 'true',
        NOXONBOT_DISABLE_AUTO_START: 'true',
        DISABLE_START_NOTIFICATIONS: 'true',
        SKIP_GLOBAL_MESSAGE_HISTORY: 'true',
        ENABLE_ONBOARDING: 'false',
        DISABLE_PAYMENT_FLOW: 'true',
        WEBCHAT_PORT: '8093',
        WEBCHAT_TITLE: 'AITU Chat',
        WEBCHAT_SUBTITLE: 'Assistant over AITU knowledge base',
        WEBCHAT_INIT_WITH_START: 'false',
        WEBCHAT_FORCE_WORKING_DIR: '/root/space2/golova',
        PATH: '/root/.nvm/versions/node/v22.21.1/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      }
    },

    // CHANGE: noxonbot-admin — shared admin for web versions, exposed via nginx /admin.
    {
      name: 'noxonbot-admin',
      cwd: '/root/aisell/noxonbot',
      script: 'adminServer.js',
      env: {
        NOXONBOT_ADMIN_PORT: '8889',
        PATH: '/root/.nvm/versions/node/v22.21.1/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      }
    }
  ]
};
