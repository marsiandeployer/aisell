#!/bin/bash
# Start webchat server for SimpleBounty (simplebounty.wpmix.net)
# Port 8097, AI Bounty Campaign Builder product

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

export SENSITIVE_CRED_FILES="${SENSITIVE_CRED_FILES:-/root/.claude.json,/root/.claude/.credentials.json,/root/.codex/auth.json}"
export NOXONBOT_DISABLE_AUTO_START="${NOXONBOT_DISABLE_AUTO_START:-true}"
export DISABLE_START_NOTIFICATIONS="${DISABLE_START_NOTIFICATIONS:-true}"
export SKIP_GLOBAL_MESSAGE_HISTORY="${SKIP_GLOBAL_MESSAGE_HISTORY:-true}"
export ENABLE_ONBOARDING="false"
export DISABLE_PAYMENT_FLOW="true"

# English interface
export BOT_LANGUAGE="${BOT_LANGUAGE:-en}"
export ENABLE_GOOGLE_AUTH="${ENABLE_GOOGLE_AUTH:-true}"

# SimpleBounty specific settings
export PRODUCT_TYPE="${PRODUCT_TYPE:-simple_bounty}"
export WEBCHAT_PORT="${WEBCHAT_PORT:-8097}"
export WEBCHAT_TITLE="${WEBCHAT_TITLE:-SimpleBounty - AI Bounty Campaign Builder}"
export WEBCHAT_SUBTITLE="${WEBCHAT_SUBTITLE:-Create bounty campaigns with AI}"
export GOOGLE_OAUTH_REDIRECT_URI="${GOOGLE_OAUTH_REDIRECT_URI:-https://simplebounty.wpmix.net/api/auth/google-dashboard-callback}"
export WEBCHAT_INIT_MESSAGE="${WEBCHAT_INIT_MESSAGE:-Welcome to SimpleBounty — your AI assistant for creating bounty campaigns.

Create tasks, set point rewards, and let participants earn by completing them.

Tell me about your campaign:
- What is the goal of your campaign?
- What tasks should participants complete?
- How many points per task?

I will set everything up for you!}"
export WEBCHAT_INIT_MESSAGE_RU="${WEBCHAT_INIT_MESSAGE_RU:-SimpleBounty — AI-помощник для создания bounty-кампаний.

Создавайте задания, назначайте награды в поинтах, и участники будут зарабатывать, выполняя их.

Расскажите о вашей кампании:
- Какова цель кампании?
- Какие задания должны выполнить участники?
- Сколько поинтов за каждое задание?

Я всё настрою для вас!}"
export WEBCHAT_INIT_WITH_START="false"

cd /root/aisell/noxonbot
npm run webchat
