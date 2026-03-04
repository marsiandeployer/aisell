#!/bin/bash
# Start webchat server for SimpleCrypto (simplecrypto.wpmix.net)
# Port 8096, AI White-Label Crypto Wallet Configurator

set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

set -a
source /root/aisell/noxonbot/.env
# Load auth secrets (JWT_SECRET needed for webchat)
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
export ENABLE_GOOGLE_AUTH="${ENABLE_GOOGLE_AUTH:-false}"

# SimpleCrypto specific settings
export PRODUCT_TYPE="${PRODUCT_TYPE:-simple_crypto}"
export WEBCHAT_PORT="${WEBCHAT_PORT:-8096}"
export WEBCHAT_TITLE="${WEBCHAT_TITLE:-SimpleCrypto - AI Wallet Configurator}"
export WEBCHAT_SUBTITLE="${WEBCHAT_SUBTITLE:-White-label crypto wallet in minutes}"
export WEBCHAT_INIT_MESSAGE="${WEBCHAT_INIT_MESSAGE:-🔐 Welcome to SimpleCrypto!

I help you configure and deploy a white-label crypto wallet powered by MultiCurrencyWallet (MCW).

🚀 What I'll help you with:
• Configure supported blockchains (BNB Chain, Ethereum, Polygon...)
• Add your custom tokens (BEP-20, ERC-20)
• Set up brand colors and UI customization
• Configure commission fees (earn on every swap)
• Generate ready-to-deploy config files

💬 Tell me: What's your wallet called and which blockchain do you want to support?}"
export WEBCHAT_INIT_WITH_START="false"

cd /root/aisell/noxonbot
npm run webchat
