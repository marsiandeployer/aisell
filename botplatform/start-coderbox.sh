#!/bin/bash
# CHANGE: Created separate start script for coderboxbot
# WHY: User request "тестовый бот пусть будет на английском"
# REF: User message 2026-02-04

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Load coderbox environment
set -a
source /root/aisell/noxonbot/.env.coderbox
set +a

# Start bot
cd /root/aisell/noxonbot
npm start
