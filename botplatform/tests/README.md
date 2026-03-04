# noxonbot Onboarding Auto-Test Suite

## Telegram Session Setup

**IMPORTANT**: Tests require a Telegram session file to authenticate.

### Where to get the session:
```bash
# Copy from shared location (habab.ru project)
cp /root/space2/hababru/telegram_session.session /root/aisell/noxonbot/tests/.test_session.session

# Or from other available sessions:
# - /root/space2/hababru/habab_session.session
# - /root/space2/hababru/hababru_session.session
```

**Location**: Session files are stored in `/root/space2/hababru/` and shared across projects.

## Quick Start

```bash
# Run the FULL onboarding test
cd /root/aisell/noxonbot
python3 tests/test_onboarding.py

# Run Web Chat (No Telegram) test (RU+EN by default: 8091, 8092)
python3 tests/test_webchat_flow.py

# Run Web Chat UI E2E (Puppeteer, checks live updates without reload)
node tests/test_webchat_e2e.js

# Expected output: 100% success rate (17/17 tests)
```

## Files

- `test_onboarding.py` - FULL END-TO-END onboarding flow test with real button clicks
- `test_onboarding_bilingual.py` - onboarding language checks for RU/EN bots
- `test_start_referral_bilingual.py` - `/start t_*` referral tracking + notification checks for RU/EN bots
- `test_webchat_flow.py` - Web Chat flow (guest bootstrap, claim by email, history persistence on disk)
- `test_webchat_e2e.js` - Web Chat UI E2E (Puppeteer): login modal + live updates + relative timestamps
- `test_claude_md_templates.js` - Product-aware CLAUDE.md template system (56 checks)
- `test_folder_structure.js` - Folder structure + product template validation

## What Gets Tested (Real User Flow)

### ✅ ALL TESTS ARE FULLY AUTOMATED
The test performs a complete user onboarding journey:

1. **👋 Test 1**: `/start` command → Bot sends onboarding greeting
2. **💡 Test 2**: Send project idea → Bot shows subscription buttons → **Test CLICKS button** (real callback!)
3. **💳 Test 3**: Bot shows payment link → **Test sends activation code DIAMOND105**
4. **📁 Test 4**: Bot creates `/root/aisell/botplatform/group_data/user_{userId}` folder (real filesystem)
5. **📄 Test 5**: Bot creates `CLAUDE.md` with project idea (real file with content)
6. **🤖 Test 6**: Bot ready to respond with AI (after onboarding complete)

### Result after each test:
```
✅ User folder: /root/aisell/botplatform/group_data/user_6119567381/ (created)
✅ CLAUDE.md: contains project idea
✅ Success message: "🎉 Нейронки подключены и готовы к работе!"
✅ Bot state: Moved from onboarding to normal AI mode
✅ Auto-cleanup: Test folder removed
```

## Running the Test

```bash
# Single run
python3 tests/test_onboarding.py

# Output includes:
# - Each test stage details
# - Folder creation confirmation
# - CLAUDE.md content preview
# - Final summary: ✅ Passed: 17, ❌ Failed: 0, 🎯 100%
```

## What Happens During Test

1. Connects to Telegram via pyrogram
2. Sends `/start` to @noxonbot
3. Types project idea: "🚀 AI-powered project management tool..."
4. **Clicks subscription button** via callback query
5. Bot responds with payment link
6. Types activation code: `DIAMOND105`
7. **Verifies folder exists** on filesystem
8. **Verifies CLAUDE.md exists** with project idea
9. Confirms bot responds to normal messages
10. Cleans up test folder

## Quick Troubleshooting

```bash
# Check bot is running
pm2 status noxonbot

# View bot logs to see folder creation
pm2 logs noxonbot --lines 20

# Restart bot if needed
pm2 restart noxonbot

# Run test again
python3 tests/test_onboarding.py
```

## Full Documentation

See [CLAUDE.md](../CLAUDE.md) for:
- Prerequisites and credentials setup
- CI/CD integration options (cron, PM2, GitHub Actions)
- Complete troubleshooting guide
- Testing strategy and best practices

## Test Coverage

| Stage | Test Type | Status | Real Action |
|-------|-----------|--------|------------|
| /start | Automated | ✅ | Bot responds |
| Idea input | Automated | ✅ | Bot acknowledges |
| Subscription | Automated | ✅ | **REAL button click** |
| Activation code | Automated | ✅ | Sends DIAMOND105 |
| Folder creation | Verified | ✅ | **Real filesystem check** |
| CLAUDE.md | Verified | ✅ | **Real file content check** |
| AI response | Verified | ✅ | Post-onboarding mode |
| **Overall** | **FULL FLOW** | ✅ | **17/17 (100%)** |

---

**Last Updated**: 2026-02-06
**Status**: ✅ FULL END-TO-END TEST (100% success rate)
**Test Count**: 17 checks
**Execution Time**: ~30-40 seconds
**Real Actions**: Button clicks, folder creation, file generation, cleanup
