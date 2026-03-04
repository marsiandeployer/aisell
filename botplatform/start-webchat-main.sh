#!/bin/bash
# Start the main webchat server for noxonbot.wpmix.net
# Port 8091, no Telegram bot initialization

set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

set -a
source /root/aisell/noxonbot/.env
set +a

export NOXONBOT_DISABLE_AUTO_START="${NOXONBOT_DISABLE_AUTO_START:-true}"
export DISABLE_START_NOTIFICATIONS="${DISABLE_START_NOTIFICATIONS:-true}"
export SKIP_GLOBAL_MESSAGE_HISTORY="${SKIP_GLOBAL_MESSAGE_HISTORY:-true}"
export ENABLE_ONBOARDING="${ENABLE_ONBOARDING:-false}"
export DISABLE_PAYMENT_FLOW="${DISABLE_PAYMENT_FLOW:-true}"

# CHANGE: English interface for noxonbot.wpmix.net
# WHY: User request "все еще руский интерфейс"
# REF: User message 2026-02-18
export BOT_LANGUAGE="${BOT_LANGUAGE:-en}"
export ENABLE_GOOGLE_AUTH="${ENABLE_GOOGLE_AUTH:-true}"

export WEBCHAT_PORT="${WEBCHAT_PORT:-8091}"
export WEBCHAT_TITLE="${WEBCHAT_TITLE:-NoxonBot - AI Website Builder}"
export WEBCHAT_SUBTITLE="${WEBCHAT_SUBTITLE:-Build websites with AI}"
export WEBCHAT_INIT_MESSAGE="${WEBCHAT_INIT_MESSAGE:-👋 Hello! I will help you create an AI bot or web application.\n\n💡 Tell me in simple words what you want to build.}"
export WEBCHAT_INIT_WITH_START="${WEBCHAT_INIT_WITH_START:-false}"

cd /root/aisell/noxonbot
npm run webchat
