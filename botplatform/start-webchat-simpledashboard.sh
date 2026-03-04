#!/bin/bash
# Start webchat server for SimpleDashboard (simpledashboard.wpmix.net)
# Port 8093, AI Dashboard Builder product

set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

set -a
source /root/aisell/noxonbot/.env
# Load auth secrets (INTERNAL_API_KEY needed for register-owner proxy to Auth API)
if [ -f /root/aisell/botplatform/.env.auth ]; then
  source /root/aisell/botplatform/.env.auth
fi
set +a

export NOXONBOT_DISABLE_AUTO_START="${NOXONBOT_DISABLE_AUTO_START:-true}"
export DISABLE_START_NOTIFICATIONS="${DISABLE_START_NOTIFICATIONS:-true}"
export SKIP_GLOBAL_MESSAGE_HISTORY="${SKIP_GLOBAL_MESSAGE_HISTORY:-true}"
export ENABLE_ONBOARDING="false"
export DISABLE_PAYMENT_FLOW="true"

# English interface
export BOT_LANGUAGE="${BOT_LANGUAGE:-en}"
export ENABLE_GOOGLE_AUTH="${ENABLE_GOOGLE_AUTH:-true}"

# SimpleDashboard specific settings
export PRODUCT_TYPE="${PRODUCT_TYPE:-simple_dashboard}"
export WEBCHAT_PORT="${WEBCHAT_PORT:-8094}"
export WEBCHAT_TITLE="${WEBCHAT_TITLE:-SimpleDashboard - AI Analytics Builder}"
export WEBCHAT_SUBTITLE="${WEBCHAT_SUBTITLE:-Build dashboards with AI}"
export WEBCHAT_INIT_MESSAGE="${WEBCHAT_INIT_MESSAGE:-📊 Hello! I'm SimpleDashboard — your AI assistant for building business analytics dashboards.

📁 I work with any data source:
• Excel / CSV / Google Sheets
• Google Ads, Yandex.Direct, Meta Ads
• CRM systems (Bitrix24, AmoCRM, Salesforce, HubSpot)
• Telephony & call tracking (Mango Office, Sipuni, Asterisk)
• Web analytics (Google Analytics, Yandex.Metrica)
• Databases (PostgreSQL, MySQL, MongoDB)
• Any REST / GraphQL API

💬 What system or data source do you use? Tell me and I'll build a dashboard for you!}"
export WEBCHAT_INIT_MESSAGE_RU="${WEBCHAT_INIT_MESSAGE_RU:-📊 Привет! Я SimpleDashboard — AI-помощник для создания бизнес-дашбордов.

📁 Работаю с любыми источниками данных:
• Excel / CSV / Google Sheets
• Google Ads, Яндекс.Директ, VK Реклама
• CRM-системы (Битрикс24, AmoCRM, 1С, Salesforce)
• Телефония и коллтрекинг (Mango Office, Sipuni, Asterisk)
• Веб-аналитика (Google Analytics, Яндекс.Метрика)
• Базы данных (PostgreSQL, MySQL, MongoDB)
• Любой REST / GraphQL API

💬 Какую систему или данные вы используете? Расскажите — и я построю дашборд!}"
export WEBCHAT_INIT_WITH_START="false"

cd /root/aisell/noxonbot
npm run webchat
