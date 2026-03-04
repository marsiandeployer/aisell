# Quick Start Guide - Universal Telegram Bot Tester

## Быстрый старт

### 1. Запуск тестов

```bash
# Тест noxonbot (полный онбординг)
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/noxonbot

# Тест bananzabot (быстрая проверка)
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/bananzabot
```

### 2. Создание тестов для нового бота

#### Шаг 1: Создайте файл `pyrogram.test.md`

```yaml
---
bot_name: "My Bot"
bot_username: "mybot"
session_name: "mybot_test"
env_file:
  - "/root/space2/hababru/.env"

tests:
  - name: "Basic Test"
    description: "Test /start command"
    steps:
      - type: send
        name: "Send /start"
        message: "/start"
        wait: 1.5
        checks:
          - type: contains
            name: "Bot responds"
            keywords:
              - "привет"
              - "hello"
            mode: any
---
```

#### Шаг 2: Запустите тест

```bash
python3 /root/aisell/shared/telegram_bot_tester.py /path/to/mybot
```

### 3. Типичные тест-кейсы

#### Тест команды

```yaml
- type: send
  name: "Test /help"
  message: "/help"
  wait: 1.5
  checks:
    - type: contains
      keywords: ["команд", "help"]
      mode: any
```

#### Тест с кнопками

```yaml
- type: send
  name: "Show menu"
  message: "/menu"
  checks:
    - type: has_buttons

- type: click
  name: "Click button"
  callback_data: "menu_item_1"
  wait: 2.0
  checks:
    - type: contains
      keywords: ["выбрано", "selected"]
```

#### Тест файлов

```yaml
- type: file_check
  name: "Check config file"
  path: "/root/aisell/botplatform/group_data/user_{user_id}/config.json"
  exists: true
  contains:
    - "user_id"
    - "settings"
```

#### Очистка после теста

```yaml
- type: cleanup
  name: "Remove test data"
  paths:
    - "/root/aisell/botplatform/group_data/user_{user_id}"
    - "/tmp/test_*"
```

### 4. Переменные

Доступны везде (messages, paths, callback_data):

- `{user_id}` - ID тестового пользователя
- `{username}` - Username пользователя

Пример:
```yaml
message: "Hello {username}!"
path: "/root/aisell/botplatform/group_data/user_{user_id}/data.json"
```

### 5. CI/CD Integration

#### Запуск каждые 6 часов

```bash
# PM2
pm2 start "python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/noxonbot" \
  --cron "0 */6 * * *" \
  --name "noxonbot-test"

# Crontab
0 */6 * * * python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/noxonbot >> /var/log/noxonbot-test.log 2>&1
```

#### Pre-deployment скрипт

```bash
#!/bin/bash
# test.sh
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/noxonbot || exit 1
echo "✅ Tests passed"
pm2 restart noxonbot
```

### 6. Troubleshooting

#### Bot не отвечает

```bash
# Check bot status
pm2 status mybot
pm2 logs mybot --lines 50
pm2 restart mybot
```

#### Credentials не найдены

```bash
# Verify environment
source /root/space2/hababru/.env
echo "API_ID: $TELEGRAM_API_ID"
```

#### Тест падает

```bash
# Run with verbose output
export DEBUG=1
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/mybot
```

### 7. Примеры

#### Простой health check

```yaml
tests:
  - name: "Health Check"
    steps:
      - type: send
        message: "/start"
        checks:
          - type: contains
            keywords: ["hello"]
```

#### Полный онбординг flow

```yaml
tests:
  - name: "Onboarding"
    steps:
      - type: send
        message: "/start"
        checks:
          - type: has_buttons

      - type: click
        callback_data: "begin"
        checks:
          - type: contains
            keywords: ["started"]

      - type: send
        message: "User Input"
        checks:
          - type: contains
            keywords: ["success"]

      - type: file_check
        path: "/root/aisell/botplatform/group_data/user_{user_id}/profile.json"
        exists: true

      - type: cleanup
        paths:
          - "/root/aisell/botplatform/group_data/user_{user_id}"
```

### 8. Полная документация

- [shared/README.md](README.md) - Полная документация агента
- [noxonbot/pyrogram.test.md](../noxonbot/pyrogram.test.md) - Пример noxonbot
- [bananzabot/pyrogram.test.md](../bananzabot/pyrogram.test.md) - Пример bananzabot

---

**Created**: 2026-02-06
**Last Updated**: 2026-02-06
**Status**: ✅ PRODUCTION READY
