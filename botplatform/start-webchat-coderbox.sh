#!/bin/bash
# Start the webchat server using coderboxbot (EN) environment.
# NOTE: dotenv in src/bot.ts will load .env but will NOT override already-set env vars.

set -euo pipefail

# Load NVM (pm2 may not have node in PATH in all environments).
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Load coderbox environment
set -a
source /root/aisell/noxonbot/.env.coderbox
set +a

# Enforce webchat embedding mode
export NOXONBOT_DISABLE_AUTO_START="${NOXONBOT_DISABLE_AUTO_START:-true}"
export DISABLE_START_NOTIFICATIONS="${DISABLE_START_NOTIFICATIONS:-true}"

cd /root/aisell/noxonbot
npm run webchat

