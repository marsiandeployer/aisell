---
bot_name: "noxonbot"
bot_username: "noxonbot"
session_name: "noxonbot_test"
env_file:
  - "/root/space2/hababru/.env"
  - "/root/space2/noxonbot/.env"

tests:
  - name: "Full Onboarding Flow Test"
    description: "Tests complete onboarding: /start → idea → subscription → activation code → folder creation"
    steps:
      # Step 1: Cleanup previous test data
      - type: cleanup
        name: "Cleanup previous test data"
        paths:
          - "/root/aisell/botplatform/group_data/user_{user_id}"

      # Step 2: Send /start command
      - type: send
        name: "Test /start command and onboarding greeting"
        message: "/start"
        wait: 1.5
        checks:
          - type: contains
            name: "Onboarding greeting shown"
            keywords:
              - "привет"
              - "помогу"
              - "расскажите"
              - "идея"
              - "проект"
              - "hello"
            mode: any

      # Step 3: Send project idea
      - type: send
        name: "Send project idea"
        message: "🚀 AI-powered project management tool with real-time collaboration"
        wait: 2.0
        save_as: "idea_response"
        checks:
          - type: contains
            name: "Bot acknowledges project idea"
            keywords:
              - "запомнил"
              - "отлично"
              - "idea"
            mode: any
          - type: has_buttons
            name: "Subscription buttons shown"

      # Step 4: Click subscription button
      - type: click
        name: "Click subscription button"
        callback_data: "sub_yours"
        wait: 2.0
        checks:
          - type: has_buttons
            name: "Payment method buttons shown"
          - type: button_exists
            name: "External payment button exists"
            callback_data: "pay_external"

      # Step 5: Click external payment button
      - type: click
        name: "Click external payment button"
        callback_data: "pay_external"
        wait: 2.0
        checks:
          - type: contains
            name: "Payment link shown"
            keywords:
              - "oplata"
              - "payment"
              - "https://"
            mode: any

      # Step 6: Send activation code
      - type: send
        name: "Enter activation code DIAMOND105"
        message: "DIAMOND105"
        wait: 2.0
        checks:
          - type: contains
            name: "Success message shown"
            keywords:
              - "поздравляю"
              - "активирована"
              - "нейронки"
              - "подключены"
              - "готово"
            mode: any
          - type: contains
            name: "Bot indicates ready status"
            keywords:
              - "готовы"
              - "готово"
              - "ready"
              - "работе"
            mode: any

      # Step 7: Wait for folder creation
      - type: delay
        name: "Wait for folder creation"
        seconds: 1.5

      # Step 8: Verify user folder created
      - type: file_check
        name: "Verify user folder created"
        path: "/root/aisell/botplatform/group_data/user_{user_id}"
        exists: true

      # Step 9: Verify CLAUDE.md file created
      - type: file_check
        name: "Verify CLAUDE.md file with project idea"
        path: "/root/aisell/botplatform/group_data/user_{user_id}/CLAUDE.md"
        exists: true
        contains:
          - "проект"
          - "идея"

      # Step 10: Test AI response after onboarding
      - type: send
        name: "Test AI response after onboarding"
        message: "Привет"
        wait: 2.0
        checks:
          - type: contains
            name: "Bot responds (not onboarding message)"
            keywords:
              - "начните"
              - "onboarding"
              - "идея"
              - "проект"
              - "подписка"
            mode: any
            # NOTE: This check expects NO onboarding keywords (inverted logic handled in tester)

      # Step 11: Final cleanup
      - type: cleanup
        name: "Cleanup test data"
        paths:
          - "/root/aisell/botplatform/group_data/user_{user_id}"

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
            mode: any

---

# noxonbot Testing Guide

## Универсальный агент для тестирования

Этот файл используется универсальным агентом `/root/aisell/shared/telegram_bot_tester.py`

## Запуск тестов

### Полный тест онбординга
```bash
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/noxonbot
```

### Быстрая проверка работоспособности
```bash
python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/noxonbot quick
```

## Структура тестов

### Типы шагов (steps)

1. **send** - Отправить сообщение боту
   ```yaml
   - type: send
     name: "Test /start command"
     message: "/start"
     wait: 1.5
     save_as: "start_response"  # Опционально: сохранить ответ
     checks:
       - type: contains
         keywords: ["привет", "hello"]
         mode: any
   ```

2. **click** - Нажать на inline кнопку
   ```yaml
   - type: click
     name: "Click subscription button"
     callback_data: "sub_yours"
     wait: 2.0
     checks:
       - type: has_buttons
       - type: button_exists
         callback_data: "pay_external"
   ```

3. **file_check** - Проверить файл
   ```yaml
   - type: file_check
     name: "Check CLAUDE.md exists"
     path: "/root/aisell/botplatform/group_data/user_{user_id}/CLAUDE.md"
     exists: true
     contains:
       - "проект"
       - "идея"
   ```

4. **cleanup** - Удалить файлы/папки
   ```yaml
   - type: cleanup
     name: "Remove test data"
     paths:
       - "/root/aisell/botplatform/group_data/user_{user_id}"
       - "/tmp/test_file.txt"
   ```

5. **delay** - Подождать
   ```yaml
   - type: delay
     name: "Wait for processing"
     seconds: 2.0
   ```

### Типы проверок (checks)

1. **contains** - Текст содержит ключевые слова
   ```yaml
   - type: contains
     name: "Success message shown"
     keywords:
       - "успешно"
       - "готово"
       - "success"
     mode: any  # 'any' или 'all'
   ```

2. **has_buttons** - Сообщение имеет inline кнопки
   ```yaml
   - type: has_buttons
     name: "Buttons present"
   ```

3. **button_exists** - Конкретная кнопка существует
   ```yaml
   - type: button_exists
     name: "Payment button exists"
     callback_data: "pay_external"
   ```

## Переменные

Автоматически доступные переменные:
- `{user_id}` - ID тестового пользователя
- `{username}` - Username тестового пользователя

Использование:
```yaml
path: "/root/aisell/botplatform/group_data/user_{user_id}/CLAUDE.md"
message: "Hello {username}!"
```

## Окружение

Переменные загружаются из:
- `/root/space2/hababru/.env`
- `/root/space2/noxonbot/.env`

Необходимые переменные:
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_STRING`

## Добавление новых тестов

1. Добавьте новый тест в секцию `tests:`
2. Укажите шаги (steps)
3. Добавьте проверки (checks)
4. Запустите тест

Пример:
```yaml
tests:
  - name: "My New Test"
    description: "Test something specific"
    steps:
      - type: send
        name: "Test command"
        message: "/mycommand"
        checks:
          - type: contains
            keywords: ["expected", "response"]
```

## CI/CD Integration

### PM2 Cron
```bash
pm2 start "python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/noxonbot" \
  --cron "0 */6 * * *" \
  --name "noxonbot-test-cron"
```

### System Crontab
```bash
0 */6 * * * python3 /root/aisell/shared/telegram_bot_tester.py /root/aisell/noxonbot >> /var/log/noxonbot-test.log 2>&1
```

## Troubleshooting

### Bot не отвечает
```bash
pm2 status noxonbot
pm2 logs noxonbot --lines 50
pm2 restart noxonbot
```

### Credentials не найдены
```bash
# Check environment
source /root/space2/hababru/.env
echo "API_ID: $TELEGRAM_API_ID"
```

### Тесты падают на file_check
```bash
# Verify paths manually
ls -la /root/aisell/botplatform/group_data/user_*
cat /root/aisell/botplatform/group_data/user_*/CLAUDE.md
```

---

**Last Updated**: 2026-02-06
**Status**: ✅ PRODUCTION READY
**Agent**: `/root/aisell/shared/telegram_bot_tester.py`
