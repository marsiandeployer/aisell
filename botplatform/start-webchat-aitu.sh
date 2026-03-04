#!/bin/bash
# Dedicated AITU webchat instance (separate domain), powered by aisell webchat engine.
# Uses a fixed workspace context for all web users.

set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

set -a
source /root/aisell/noxonbot/.env.coderbox
set +a

export NOXONBOT_DISABLE_AUTO_START="${NOXONBOT_DISABLE_AUTO_START:-true}"
export DISABLE_START_NOTIFICATIONS="${DISABLE_START_NOTIFICATIONS:-true}"
export SKIP_GLOBAL_MESSAGE_HISTORY="${SKIP_GLOBAL_MESSAGE_HISTORY:-true}"
export ENABLE_ONBOARDING="${ENABLE_ONBOARDING:-false}"
export DISABLE_PAYMENT_FLOW="${DISABLE_PAYMENT_FLOW:-true}"
# CHANGE: Disable bwrap for AITU chat - all users have root access to WEBCHAT_FORCE_WORKING_DIR
# WHY: User request - "другие пользователи тоже должны быть как рут но только для этого чата"
# REF: User request 2026-02-18
export USE_BWRAP="${USE_BWRAP:-0}"

export WEBCHAT_PORT="${WEBCHAT_PORT:-8093}"
export WEBCHAT_TITLE="${WEBCHAT_TITLE:-AITU Chat}"
export WEBCHAT_SUBTITLE="${WEBCHAT_SUBTITLE:-Assistant over AITU knowledge base}"
export WEBCHAT_INIT_MESSAGE="${WEBCHAT_INIT_MESSAGE:-👋 Здравствуйте! Я ассистент базы знаний Astana IT University.\n\n💡 Задайте мне вопрос о правилах приёма, программах обучения, организации учебного процесса или других аспектах университета.}"
export WEBCHAT_INIT_WITH_START="${WEBCHAT_INIT_WITH_START:-false}"
export WEBCHAT_FORCE_WORKING_DIR="${WEBCHAT_FORCE_WORKING_DIR:-/root/space2/golova}"

cd /root/aisell/noxonbot
npm run webchat
