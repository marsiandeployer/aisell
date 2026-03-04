---
bot_name: "bananzabot"
bot_username: "bananzabot"
session_name: "bananzabot_test"
env_file:
  - "/root/space2/hababru/.env"
  - "/root/aisell/bananzabot/.env"

tests:
  - name: "Welcome Message Test"
    description: "Tests that bot responds to /start with welcome message"
    steps:
      - type: send
        name: "Send /start command"
        message: "/start"
        wait: 1.5
        checks:
          - type: contains
            name: "Welcome message shown"
            keywords:
              - "привет"
              - "bananza"
              - "hello"
              - "добро пожаловать"
            mode: any

  - name: "Bot Creation Flow Test"
    description: "Tests bot creation and prompt generation"
    steps:
      # Step 1: Start bot creation
      - type: send
        name: "Initiate bot creation"
        message: "/create"
        wait: 2.0
        checks:
          - type: contains
            name: "Bot creation prompt shown"
            keywords:
              - "создать"
              - "бот"
              - "название"
              - "create"
            mode: any

      # Step 2: Provide bot name
      - type: send
        name: "Provide bot name"
        message: "Test Support Bot"
        wait: 2.0
        checks:
          - type: contains
            name: "Bot asks for description"
            keywords:
              - "описание"
              - "description"
              - "цель"
              - "purpose"
            mode: any

      # Step 3: Provide bot description
      - type: send
        name: "Provide bot description"
        message: "Customer support bot for answering common questions about products"
        wait: 3.0
        checks:
          - type: contains
            name: "Bot generates prompt or confirms creation"
            keywords:
              - "готов"
              - "создан"
              - "prompt"
              - "system"
              - "ready"
            mode: any

  - name: "Quick Health Check"
    description: "Fast test to verify bot is responsive"
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
              - "bananza"
            mode: any

      - type: send
        name: "Send /help"
        message: "/help"
        wait: 1.5
        checks:
          - type: contains
            name: "Help message shown"
            keywords:
              - "помощь"
              - "команд"
              - "help"
              - "commands"
            mode: any

  - name: "E2E Dialog Test"
    description: "Tests bot conversation flow with user"
    steps:
      # Simulate user conversation
      - type: send
        name: "User greeting"
        message: "Привет!"
        wait: 2.0
        checks:
          - type: contains
            name: "Bot responds to greeting"
            keywords:
              - "привет"
              - "здравствуй"
              - "hello"
              - "hi"
            mode: any

      - type: send
        name: "User asks question"
        message: "Как тебя зовут?"
        wait: 2.0
        checks:
          - type: contains
            name: "Bot provides answer"
            keywords:
              - "bananza"
              - "бот"
              - "меня"
              - "я"
            mode: any

---

# bananzabot Testing Guide

## Универсальный агент для тестирования

Этот файл используется универсальным агентом `/root/aisell/shared/telegram_bot_tester.py`

## Запуск тестов

### Полный тест создания бота
```bash
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/bananzabot
```

### Быстрая проверка работоспособности
```bash
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/bananzabot quick
```

### Тест приветствия
```bash
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/bananzabot welcome
```

## Структура проекта

```
bananzabot/
├── tests/
│   ├── fixtures/           # E2E тест-кейсы в JSON
│   ├── testRunner.js       # Запускает E2E тесты через AI
│   ├── testEvaluator.js    # Оценивает качество диалогов
│   └── test_welcome_message.js
├── pyrogram.test.md        # ЭТОТ ФАЙЛ - тесты через Telegram API
├── adminServer.js          # Web админка на порту 3182
└── bot.js                  # Основной код бота
```

## Два подхода к тестированию

### 1. Pyrogram Tests (Реальный Telegram API)
- **Файл**: `pyrogram.test.md`
- **Агент**: `/root/aisell/shared/telegram_bot_tester.py`
- **Что тестирует**: Реальное взаимодействие с ботом через Telegram
- **Когда использовать**:
  - Проверка работоспособности бота
  - Тестирование команд и базовых ответов
  - CI/CD health checks

### 2. E2E AI Tests (Симуляция через AI)
- **Файлы**: `tests/testRunner.js`, `tests/testEvaluator.js`
- **Что тестирует**: Качество диалогов, логику бота, системные промпты
- **Когда использовать**:
  - Тестирование сложных диалогов
  - Оценка качества промптов
  - Regression testing системного промпта

**Запуск E2E AI тестов**:
```bash
cd /root/aisell/bananzabot
npm test
npm run test:e2e
```

## Примеры тест-кейсов

### Простой тест команды
```yaml
- type: send
  name: "Test /start"
  message: "/start"
  wait: 1.5
  checks:
    - type: contains
      keywords: ["привет", "hello"]
      mode: any
```

### Тест с кнопками
```yaml
- type: send
  name: "Request menu"
  message: "/menu"
  wait: 2.0
  checks:
    - type: has_buttons
      name: "Menu buttons shown"
    - type: button_exists
      callback_data: "create_bot"

- type: click
  name: "Click create bot button"
  callback_data: "create_bot"
  wait: 2.0
  checks:
    - type: contains
      keywords: ["название", "name"]
```

### Тест диалога
```yaml
steps:
  - type: send
    message: "Привет!"
    checks:
      - type: contains
        keywords: ["привет", "здравствуй"]
        mode: any

  - type: send
    message: "Как дела?"
    checks:
      - type: contains
        keywords: ["хорошо", "отлично", "нормально"]
        mode: any
```

## Переменные окружения

Загружаются из:
- `/root/space2/hababru/.env` - Telegram credentials
- `/root/aisell/bananzabot/.env` - Bot configuration

Необходимые переменные:
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_STRING`
- `BOT_TOKEN` (для бота)

## Добавление новых тестов

1. Откройте `pyrogram.test.md`
2. Добавьте новый тест в секцию `tests:`
3. Определите шаги (steps)
4. Добавьте проверки (checks)
5. Запустите тест

Пример нового теста:
```yaml
tests:
  - name: "Custom Command Test"
    description: "Tests /custom command"
    steps:
      - type: send
        name: "Test custom command"
        message: "/custom"
        wait: 2.0
        checks:
          - type: contains
            name: "Custom response shown"
            keywords:
              - "custom"
              - "команда"
            mode: any
```

## Интеграция с CI/CD

### Автоматический запуск каждые 6 часов
```bash
# PM2 cron
pm2 start "python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/bananzabot" \
  --cron "0 */6 * * *" \
  --name "bananzabot-test-cron"

# System crontab
0 */6 * * * python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/bananzabot >> /var/log/bananzabot-test.log 2>&1
```

### Pre-deployment тесты
```bash
# Before deployment
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/bananzabot && \
npm test && \
pm2 restart bananzabot
```

## Сравнение с E2E AI тестами

| Критерий | Pyrogram Tests | E2E AI Tests |
|----------|---------------|--------------|
| **Скорость** | 🟢 Быстро (5-10 сек) | 🟡 Медленно (1-2 мин) |
| **Реализм** | 🟢 Реальный Telegram | 🟡 Симуляция через AI |
| **Сложность** | 🟢 Простые команды | 🟢 Сложные диалоги |
| **Оценка качества** | 🔴 Только текст | 🟢 AI evaluator |
| **CI/CD** | 🟢 Отлично | 🟡 Требует API ключ |

## Рекомендации

1. **Для быстрых проверок**: используйте Pyrogram тесты
   ```bash
   python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/bananzabot quick
   ```

2. **Для тестирования промптов**: используйте E2E AI тесты
   ```bash
   npm test
   ```

3. **Перед деплоем**: запустите оба типа тестов
   ```bash
   python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/bananzabot && npm test
   ```

## Troubleshooting

### Bot не отвечает
```bash
pm2 status bananzabot
pm2 logs bananzabot --lines 50
pm2 restart bananzabot
```

### Тест падает на "No response"
```bash
# Check bot is actually running
curl -s https://api.telegram.org/bot${BOT_TOKEN}/getMe | jq

# Check last bot updates
curl -s https://api.telegram.org/bot${BOT_TOKEN}/getUpdates | jq '.result[-1]'
```

### Credentials не найдены
```bash
source /root/space2/hababru/.env
echo "API_ID: $TELEGRAM_API_ID"
echo "BOT_TOKEN: ${BOT_TOKEN:0:20}..."
```

## Web Админка

Доступ к админке для просмотра истории тестов:
- URL: http://localhost:3182/admin
- Файл: `test_history.json`

---

**Last Updated**: 2026-02-06
**Status**: ✅ PRODUCTION READY
**Agent**: `/root/aisell/shared/telegram_bot_tester.py`
**E2E Tests**: `npm test` (separate system)
