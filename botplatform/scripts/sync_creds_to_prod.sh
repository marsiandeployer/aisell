#!/bin/bash
# Sync Claude + Codex credentials from main server (78.47.125.10) to production (62.109.14.209).
# Only the minimum auth/config files needed for bot.ts to run Claude/Codex CLI are synced.
# Runs every 10 minutes via PM2 cron.
set -euo pipefail

PROD="root@62.109.14.209"
LOG_PREFIX="[cred-sync $(date '+%Y-%m-%dT%H:%M:%S')]"

echo "$LOG_PREFIX Starting credential sync to prod..."

# Claude auth token (.claude.json)
if [ -f /root/.claude.json ]; then
  rsync -q --chmod=F600 /root/.claude.json "${PROD}:/root/.claude.json" \
    && echo "$LOG_PREFIX ✅ .claude.json synced" \
    || echo "$LOG_PREFIX ❌ .claude.json sync failed"
fi

# Claude OAuth credentials (.claude/.credentials.json) — needed for Claude CLI auth inside bwrap sandbox
if [ -f /root/.claude/.credentials.json ]; then
  ssh -o ConnectTimeout=10 "${PROD}" "mkdir -p /root/.claude && chmod 700 /root/.claude" 2>/dev/null
  rsync -q --chmod=F600 /root/.claude/.credentials.json "${PROD}:/root/.claude/.credentials.json" \
    && echo "$LOG_PREFIX ✅ .claude/.credentials.json synced" \
    || echo "$LOG_PREFIX ❌ .claude/.credentials.json sync failed"
  # Copy credentials to all user sandboxes (bwrap uses HOME=/home/sandbox -> .claude_home/.claude/)
  ssh -o ConnectTimeout=10 "${PROD}" '
    for d in /root/aisellusers/user_*/.claude_home/.claude/; do
      [ -d "$d" ] && cp /root/.claude/.credentials.json "$d/.credentials.json" 2>/dev/null
    done
  ' && echo "$LOG_PREFIX ✅ sandbox credentials updated" \
    || echo "$LOG_PREFIX ❌ sandbox credentials update failed"
fi

# Claude settings (ONLY settings.json — NOT the full .claude/ directory which has GB of history)
if [ -f /root/.claude/settings.json ]; then
  rsync -q --chmod=F600 /root/.claude/settings.json "${PROD}:/root/.claude/settings.json" \
    && echo "$LOG_PREFIX ✅ .claude/settings.json synced" \
    || echo "$LOG_PREFIX ❌ .claude/settings.json sync failed"
fi

# Claude config settings (proxy + IS_SANDBOX flags)
if [ -f /root/.config/claude/settings.json ]; then
  ssh -o ConnectTimeout=10 "${PROD}" "mkdir -p /root/.config/claude && chmod 700 /root/.config/claude" 2>/dev/null
  rsync -q --chmod=F600 /root/.config/claude/settings.json "${PROD}:/root/.config/claude/settings.json" \
    && echo "$LOG_PREFIX ✅ .config/claude/settings.json synced" \
    || echo "$LOG_PREFIX ❌ .config/claude/settings.json sync failed"
fi

# Codex auth
if [ -f /root/.codex/auth.json ]; then
  ssh -o ConnectTimeout=10 "${PROD}" "mkdir -p /root/.codex && chmod 700 /root/.codex" 2>/dev/null
  rsync -q --chmod=F600 /root/.codex/auth.json "${PROD}:/root/.codex/auth.json" \
    && echo "$LOG_PREFIX ✅ .codex/auth.json synced" \
    || echo "$LOG_PREFIX ❌ .codex/auth.json sync failed"
fi

# Codex config
if [ -f /root/.codex/config.toml ]; then
  rsync -q --chmod=F600 /root/.codex/config.toml "${PROD}:/root/.codex/config.toml" \
    && echo "$LOG_PREFIX ✅ .codex/config.toml synced" \
    || echo "$LOG_PREFIX ❌ .codex/config.toml sync failed"
fi

echo "$LOG_PREFIX Done."
