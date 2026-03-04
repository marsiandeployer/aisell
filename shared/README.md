# Shared Resources

Shared code and utilities used across multiple bots in the aisell monorepo.

## telegram_bot_tester.py

Universal testing agent for Telegram bots using Pyrogram.

### Features

- ✅ **Universal**: Works with ANY Telegram bot
- ✅ **Declarative**: Tests defined in YAML format
- ✅ **Comprehensive**: Supports messages, buttons, file checks, cleanup
- ✅ **CI/CD Ready**: Easy integration with cron, PM2, GitHub Actions
- ✅ **Variables**: Runtime variable substitution (`{user_id}`, `{username}`)

### Usage

```bash
# Run all tests for a bot
python3 /root/aisell/shared/telegram_bot_tester.py /path/to/bot/project

# Run specific test by name
python3 /root/aisell/shared/telegram_bot_tester.py /path/to/bot/project test_name

# Examples
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/noxonbot
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/bananzabot quick
```

### Configuration

Each bot project must have a `pyrogram.test.md` file with test configuration:

```yaml
---
bot_name: "My Bot"
bot_username: "mybot"
session_name: "mybot_test"
env_file:
  - "/path/to/.env"

tests:
  - name: "Test Name"
    description: "What this test does"
    steps:
      - type: send
        message: "/start"
        checks:
          - type: contains
            keywords: ["hello"]
---
```

### Step Types

1. **send** - Send message to bot
   ```yaml
   - type: send
     name: "Send command"
     message: "/start"
     wait: 1.5
     save_as: "response"  # Optional: save response
     checks:
       - type: contains
         keywords: ["hello", "привет"]
         mode: any  # 'any' or 'all'
   ```

2. **click** - Click inline button
   ```yaml
   - type: click
     name: "Click button"
     callback_data: "button_id"
     wait: 2.0
     checks:
       - type: has_buttons
       - type: button_exists
         callback_data: "next_button"
   ```

3. **file_check** - Verify file existence/content
   ```yaml
   - type: file_check
     name: "Check file"
     path: "/path/to/file.txt"
     exists: true
     contains:
       - "expected text"
       - "another pattern"
   ```

4. **cleanup** - Remove files/folders
   ```yaml
   - type: cleanup
     name: "Remove test data"
     paths:
       - "/tmp/test_folder"
       - "/tmp/test_file.txt"
   ```

5. **delay** - Wait for specified time
   ```yaml
   - type: delay
     name: "Wait for processing"
     seconds: 2.0
   ```

### Check Types

1. **contains** - Text contains keywords
   ```yaml
   - type: contains
     name: "Check response"
     keywords: ["success", "готово"]
     mode: any  # 'any' = at least one, 'all' = all must match
   ```

2. **has_buttons** - Message has inline keyboard
   ```yaml
   - type: has_buttons
     name: "Buttons present"
   ```

3. **button_exists** - Specific button exists
   ```yaml
   - type: button_exists
     name: "Button found"
     callback_data: "specific_button_id"
   ```

### Variables

Automatically available in all messages, paths, and callback_data:
- `{user_id}` - Test user's Telegram ID
- `{username}` - Test user's Telegram username

Usage:
```yaml
path: "/root/aisell/botplatform/group_data/user_{user_id}/CLAUDE.md"
message: "Hello {username}!"
callback_data: "action_{user_id}"
```

### Environment Variables

Required in `.env` files:
- `TELEGRAM_API_ID` - Telegram API ID
- `TELEGRAM_API_HASH` - Telegram API hash
- `TELEGRAM_SESSION_STRING` - Pyrogram session string

### Integration Examples

#### PM2 Cron
```bash
pm2 start "python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/noxonbot" \
  --cron "0 */6 * * *" \
  --name "noxonbot-test"
```

#### System Crontab
```bash
0 */6 * * * python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/noxonbot >> /var/log/noxonbot-test.log 2>&1
```

#### Pre-deployment Script
```bash
#!/bin/bash
# test_before_deploy.sh
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/noxonbot || exit 1
npm run build || exit 1
pm2 restart noxonbot
```

### Output Format

```
============================================================
🤖 Bot Name Testing Suite
============================================================

📋 Test Step Name
✅ Check passed - detail text
❌ Check failed - error detail

============================================================
📊 Test Summary
============================================================
✅ Passed: 15
❌ Failed: 2
📈 Total: 17
🎯 Success rate: 88.2%
============================================================
```

### Troubleshooting

#### Connection issues
```bash
# Check credentials
source /root/space2/hababru/.env
echo "API_ID: $TELEGRAM_API_ID"
echo "API_HASH: ${TELEGRAM_API_HASH:0:10}..."
```

#### Bot not responding
```bash
# Verify bot is running
pm2 status botname
pm2 logs botname --lines 50
```

#### Invalid test config
```bash
# Validate YAML syntax
python3 -c "import yaml; yaml.safe_load(open('/path/to/pyrogram.test.md').read().split('---')[1])"
```

## admin/

Shared admin interface components (if any).

---

## Related Documentation

- [noxonbot pyrogram.test.md](../noxonbot/pyrogram.test.md)
- [bananzabot pyrogram.test.md](../bananzabot/pyrogram.test.md)
- [Main README](../README.md)
