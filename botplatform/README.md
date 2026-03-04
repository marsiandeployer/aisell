# Noxonbot

## Production Bot

**Public bot:** [@clodeboxbot](https://t.me/clodeboxbot) — free tier, shared Claude/Codex
**Premium (your own instance):** [@noxonbot](https://t.me/noxonbot)

## Infrastructure

- **Main server (this):** `95.217.227.164` — code, all bots, PM2
- **Production clodeboxbot:** `62.109.14.209` — runs from `~/aisell/noxonbot` via `ecosystem.clodeboxbot.config.js`
- **External noxonbot instance:** `95.81.120.145` — runs from `/root/noxonbot` via PM2
- **Deploy to prod:** `ssh root@62.109.14.209 /root/deploy_clodeboxbot.sh`
- **Sync code:** `git push` here → `git pull` on prod → `npm run build` → `pm2 restart`

### How to Deploy Updates to 95.81.120.145

This server runs noxonbot from `/root/noxonbot` with `npm start` via PM2.

**From main server (95.217.227.164):**

```bash
# 1. Build and create update package
cd /root/aisell/botplatform
npm run build

# 2. Create deployment archive (exclude large/unnecessary files)
tar -czf /tmp/noxonbot-update.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='group_data' \
  --exclude='aisellusers' \
  --exclude='*.log' \
  package.json \
  tsconfig.json \
  ecosystem.config.js \
  src/ \
  dist/ \
  README.md \
  CLAUDE.md

# 3. Copy to remote server
scp /tmp/noxonbot-update.tar.gz root@95.81.120.145:/tmp/

# 4. Deploy on remote server
ssh root@95.81.120.145 "cd /root/noxonbot && \
  echo '--- Creating backup ---' && \
  cp -r /root/noxonbot /root/noxonbot.backup-\$(date +%Y%m%d-%H%M%S) && \
  echo '--- Extracting update ---' && \
  tar -xzf /tmp/noxonbot-update.tar.gz && \
  echo '--- Installing dependencies ---' && \
  npm install --production && \
  echo '--- Reloading PM2 ---' && \
  pm2 reload noxonbot && \
  sleep 2 && \
  echo '--- Checking status ---' && \
  pm2 list | grep noxonbot && \
  timeout 10s pm2 logs noxonbot --lines 20 --nostream"
```

**Quick check after deployment:**

```bash
ssh root@95.81.120.145 "pm2 status noxonbot && timeout 10s pm2 logs noxonbot --lines 30 --nostream"
```

**Important notes:**
- Backup is automatically created before each deployment
- `.env` file is NOT overwritten (contains server-specific credentials)
- `node_modules` are reinstalled to ensure dependencies are up-to-date
- PM2 uses `reload` (zero-downtime restart)
- Old backups can be cleaned manually from `/root/noxonbot.backup-*`

## User Isolation (clodeboxbot)

- Each user gets `/root/aisell/botplatform/group_data/user_{chatId}` (mode 700), auto-created on first message
- bwrap sandbox: no `/etc/shadow`, no `/etc/sudoers`, no access to other users' dirs
- Per-user sandbox home: `data/ai_sandbox_homes/claude/user_{id}` and `codex/user_{id}`

## Tests & Docs

- All tests must be in `tests/` subdirectory
- All documentation must be in `docs/` subdirectory

---

# Noxon Bot (@noxonbot)

Telegram бот для запуска Claude и Codex CLI через короткие команды - написан на TypeScript без `any`.

## Возможности

- ✅ Запуск Claude CLI через команду `кл <промпт>` (обратная совместимость с `p`/`п`)
- ✅ Запуск Codex CLI через команду `ко <промпт>` (обратная совместимость с `к`/`/k`) — **Codex может отвечать 10+ минут**
- ✅ Для Codex добавлен обязательный финальный текст-резюме, чтобы не приходил ответ "✅ Команда выполнена успешно (без вывода)"
- ✅ Если Codex вернул ответ в `stderr` (а `stdout` пустой), бот достает финальный текст из `stderr` (с фильтрацией ANSI/метаданных) и отправляет пользователю
- ✅ **Автоматическая отправка файлов через Telegram** когда Claude упоминает файл в ответе
- ✅ **Резервная загрузка на i.wpmix.net** если файл >50MB или отправка не удалась
- ✅ Опциональное ограничение доступа по username/ID через .env (по умолчанию разрешены все)
- ✅ Отслеживание статуса выполнения (обновления каждые 30 сек)
- ✅ Автоматическая отправка результата в чат
- ✅ Поддержка длительных задач: Claude до 30 минут, Codex до 60 минут (настраивается)
- ✅ В личном/групповом чате работает режим "interrupt + queue":
  - 1 активная задача одновременно
  - 2-е сообщение прерывает текущую задачу и запускает объединенный (старый+новый) запрос
  - 3-е и последующие сообщения ставятся в очередь
- ✅ Возможность отменить активную задачу (`/cancel`)
- ✅ Автоматическая загрузка контекста (до 20 сообщений)
- ✅ Поддержка изображений, видео, документов в истории
- ✅ Распознавание аудио/voice через OpenAI STT + ссылки на скачанные файлы в истории
- ✅ Автоматическая отправка расшифровки аудио в чат
- ✅ Ответы очищаются от Markdown перед отправкой в Telegram
- ✅ Команда `/getchatid` для получения ID чата
- ✅ Автоматическое приветствие с chat ID при добавлении в группу
- ✅ Строгая типизация TypeScript (no `any`)
- ✅ Graceful shutdown

## Технологии

- **Node.js** + **TypeScript** (strict mode)
- **Telegraf** - современная библиотека для Telegram Bot API
- **tsx** - TypeScript execution и hot reload

## Структура проекта

- Документацию складываем в `docs/`
- Тесты и артефакты тестов — в `tests/`
- Пользовательские данные — в `/root/aisell/botplatform/group_data/user_{id}/`
- Групповые данные — в `/root/aisell/noxonbot/group_data/{chat_id}/`

## Установка

```bash
cd /root/aisell/noxonbot
npm install
```

## Конфигурация

Файл `.env`:

```env
BOT_TOKEN=your_telegram_bot_token_here
CLAUDE_WORKING_DIR=/root/uutik

# (Опционально) Таймаут выполнения (в минутах)
# Codex ("ко"/"co") часто работает дольше, поэтому для него таймаут отдельный.
MAX_EXECUTION_TIME_MINUTES=30
CODEX_MAX_EXECUTION_TIME_MINUTES=60

# (Опционально) Экспериментальный transport Claude через hidden --sdk-url
# При true бот показывает live-текст ассистента из SDK stream в статусе задачи.
CLAUDE_USE_SDK_URL=false

# Поведение в sdk-url режиме:
# - финальный ответ берется из websocket stream ассистента (не из служебного stdout CLI)
# - если текстового ответа нет, бот не генерирует fallback-саммари workspace
# - в статусе задачи показываются realtime-фазы (connect/stream/tools/finalize)
# - для UX добавлена метрика First token latency

# OpenAI API ключ для расшифровки аудио/голосовых сообщений
# При получении аудио бот автоматически расшифрует его и отправит текст в чат
OPENAI_API_KEY=sk-...

# (Опционально) Отключить экраны оплаты/активации (временно сделать onboarding бесплатным)
DISABLE_PAYMENT_FLOW=true

# (Опционально) Отключить уведомления оператору при /start (удобно для web-режима)
DISABLE_START_NOTIFICATIONS=true

# (Только для встраивания) Не запускать Telegraf автоматически при импорте модуля
NOXONBOT_DISABLE_AUTO_START=true

# Маппинг chat_id -> рабочая директория для групп
# Для отрицательных ID (группы) минус заменяется на _MINUS_
# Формат: CHAT_DIR_{chat_id}=/path/to/directory

# Пример для группы с ID -1002915963269
CHAT_DIR__MINUS_1002915963269=/root/claritycult

# Группа -5076866886 (slovvesa)
CHAT_DIR__MINUS_5076866886=/root/slovvesa

# Группа -5130032815 (exp)
CHAT_DIR__MINUS_5130032815=/root/exp

# Дополнительный список пользователей
# Комбинируйте username и числовые ID через запятую.
ALLOWED_USERNAMES=sashanoxon,ovchinnikovaleks
ALLOWED_USER_IDS=123456789,987654321
PRIMARY_TELEGRAM_ID=123456789
```

### Ограничение доступа

По умолчанию бот принимает команды от всех. Чтобы ограничить доступ:

1. Добавьте в `.env`:
   - `ALLOWED_USERNAMES` — список username через запятую (регистр не важен).
   - `ALLOWED_USER_IDS` — список числовых ID через запятую.
   - Дополнительно можно указать `PRIMARY_TELEGRAM_ID` или `OWNER_TELEGRAM_ID` для основного владельца.
2. Перезапустите бота: `pm2 restart noxonbot --update-env`.

Если списки пустые, бот не ограничивает доступ.

### Настройка рабочих директорий для групп

Каждая группа может работать в своей директории. Для этого нужно:

1. Узнать `chat_id` группы (бот показывает его при добавлении или через `/getchatid`)
2. Добавить переменную в `.env`:
   - Для `chat_id = -1002915963269` → `CHAT_DIR__MINUS_1002915963269=/path`
   - Минус заменяется на `_MINUS_`
3. Перезапустить бота: `pm2 restart noxonbot --update-env`

**Поведение:**
- **Личные чаты** (ID > 0): используют `/root/aisell/botplatform/group_data/user_{id}` (создаётся через onboarding по `/start`)
- **Группы без конфига**: автоматически создаются в `/root/aisell/noxonbot/group_data/{chat_id}`
- **Группы с конфигом**: работают в указанной директории из `.env`
- **Обратная совместимость**: старые группы в `/root/{chat_id}` продолжают работать

### Шаблон `CLAUDE.md` для новых проектов

- Для новых пользовательских папок файл `CLAUDE.md` теперь создаётся из шаблона `CLAUDE.md.example`
- Подстановка идеи проекта выполняется через плейсхолдер `{{PROJECT_IDEA}}`
- Изменяйте `CLAUDE.md.example`, если нужно обновить стартовые инструкции для всех новых проектов

### Реферальный `/start` параметр

- Deep-link вида `https://t.me/<bot>?start=t_ChannelName` обрабатывается в `/start`
- Бот отправляет уведомление оператору (`@sashanoxon`) с user ID и `start` параметром
- Источник сохраняется в `user_referrals.json` (`referralSource`, `referralParam`, `referralDate`)

### Быстрый SSH старт в onboarding

- Если в шаге идеи первое слово сообщения — `ssh` (например `ssh root@1.2.3.4 -p 22`), бот трактует это как SSH креды и сразу отправляет команду деплоя в рабочую группу.
- В этом сценарии пользователь пропускает экран "идея проекта".

## Запуск

### Разработка (с hot reload)

```bash
npm run dev
```

### Продакшен через pm2

Рекомендуемый запуск через ecosystem (в нем уже проброшена переменная `IS_SANDBOX=1`, чтобы обходить ограничения `--dangerously-skip-permissions`).

```bash
pm2 start ecosystem.config.js
pm2 status noxonbot
```

## Web Mode (No Telegram)

В проекте есть отдельный web-чат интерфейс (как Telegram диалог), чтобы запускать бота без Telegram аккаунта.

### Требования

Авторизация: **имя + email** (без подтверждения). Письма не отправляются, email нужен только чтобы в будущем вернуться к диалогу.

### Запуск через PM2

```bash
# RU web (noxonbot engine)
pm2 start ecosystem.config.js --only noxonbot-web

# EN web (coderbox engine)
pm2 start ecosystem.config.js --only coderbox-web
```

### URLs

- Noxon Web (RU): `http://localhost:8091`
- Coderbox EN (web): `http://localhost:8092`
- Healthcheck: `/health`
- Chrome extension zip: `/downloads/chrome-sidebar-extension.zip` (ссылка также есть в меню веб-чата)

### Как обновляется чат

- Основной способ: SSE (`/api/stream`)
- Fallback: polling `/api/history` (нужен для некоторых reverse proxy, которые буферизуют SSE)

### Данные

- Web-транскрипты: `noxonbot/data/webchat/chats/{userId}.json`
- Web auth state: `noxonbot/data/webchat/users.json`, `noxonbot/data/webchat/sessions.json`

### E2E тест (UI)

```bash
# По умолчанию тестирует https://claudeboxbot.habab.ru
node tests/test_webchat_e2e.js

# Можно указать другой URL (например EN)
WEBCHAT_URL="https://coderbox.wpmix.net" node tests/test_webchat_e2e.js
```

### Автоподтверждение запросов Claude/Codex

- Claude запускается с флагами `--permission-mode bypassPermissions --dangerously-skip-permissions` для автоматического выполнения
- Codex запускается через `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check`, что тоже отключает любые паузы на апрувы
- Если включить `CLAUDE_USE_SDK_URL=true`, Claude запускается в режиме `--sdk-url` (`stream-json`) и live-текст/события отображаются в статусе выполнения.

### Автоматическая загрузка файлов

Бот автоматически определяет когда в чате запрашивают файл и загружает его на сервер:

1. **Автоматическое распознавание**: Бот анализирует последние 3 сообщения на наличие просьб о файле
2. **Загрузка на сервер**: Файлы загружаются в `/root/space2/image-share/uploads/files/`
3. **Публичная ссылка**: Генерируется ссылка вида `https://i.wpmix.net/files/{filename}`
4. **Отправка в чат**: Бот автоматически отправляет ссылку для скачивания

Ключевые слова для распознавания:
- "прислать файл", "исходники", "send file", "source"
- В caption документа: "файл", "file", "исходник"

**Автоматическая отправка файлов из ответов Claude:**
- Бот автоматически распознает упоминания файлов в ответах (пути типа `/root/path/file.md`, `./file.txt`, `README.md`)
- **Отправляет файл напрямую через Telegram** (до 50MB) с caption и размером
- Одновременно копирует файл на сервер для публичного доступа: `https://i.wpmix.net/files/{filename}`
- Если файл >50MB или отправка не удалась, отправляет только публичную ссылку
- Поддерживаются расширения: md, txt, json, yaml, ts, js, py, go, java, cpp, sh, sql, html, css, pdf, doc, xls, zip, tar, gz и др.

### Просмотр логов

```bash
pm2 logs noxonbot
pm2 logs noxonbot --lines 100
```

### Управление

```bash
pm2 restart noxonbot
pm2 stop noxonbot
pm2 delete noxonbot
pm2 status noxonbot
```

## Использование в Telegram

🗣️ **В личном чате** можно просто писать без команды (например, `Привет`) — по умолчанию запустится Claude.  
💡 Если Claude ответил лимитом (`You've hit your limit`), используйте Codex: `ко ...` или `co ...` (в группах — `/ко` или `/co`).

### Команды:

```
/start - Приветствие и информация
/help - Справка
/cancel - Отменить активную задачу
/getchatid - Узнать ID текущего чата

кл <ваш промпт> - Запустить Claude CLI в личных чатах (поддерживаются p/п)
Кл, <ваш промпт> - Вариант с заглавной и запятой (для удобства в обращении)
кл, <ваш промпт> - Вариант с запятой (без пробела)
/кл <ваш промпт> - Запустить Claude CLI в группах/супергруппах (поддерживается /p)

ко <ваш промпт> - Запустить Codex CLI в личных чатах (поддерживается к)
Ко, <ваш промпт> - Вариант с заглавной и запятой (для удобства в обращении)
ко, <ваш промпт> - Вариант с запятой (без пробела)
/ко <ваш промпт> - Запустить Codex CLI в группах (поддерживаются /k и /к)

co <ваш промпт> - То же что "ко" (латиницей, удобно в англ. раскладке / для @coderboxbot)
/co <ваш промпт> - То же что "/ко"

```

> 🛈 Telegram скрывает обычные сообщения от ботов в группах при включенной приватности, поэтому там всегда используйте `/кл` и `/ко` (или `/co`) (или отключите privacy mode у бота через @BotFather).

### Примеры:

```
кл покажи структуру проекта (личка)
Кл, найди все TODO в коде (обращение с запятой)
кл, создай файл test.txt с Hello World (короткий вариант)
кл какие процессы запущены в pm2? (личка)
ко сформируй план задач по проекту (Codex)
Ко, запусти сборку (обращение к Codex)
/ко запусти сборку в группе (Codex в группе)
```

> Старые команды `p`/`п`/`к`/`/k` продолжают работать, но рекомендуется переходить на `кл`/`ко`. Новые варианты с запятой (`Кл,`/`кл,`/`Ко,`/`ко,`) делают обращение более естественным.

### Контекстная работа:

Бот автоматически загружает 5 предыдущих сообщений для контекста:

```
User1: У нас баг в функции auth
User2: Да, там ошибка в строке 42
User2: [отправляет скриншот с кодом]
User3: кл найди и исправь этот баг

→ CLI (Claude или Codex) получит всю историю обсуждения + скриншот
```

## Архитектура

```
User Message → Telegraf → NoxonBot Handler
                               ↓
                    Get 5 previous messages
                               ↓
                    Format history + prompt
                               ↓
                         spawn('claude' | 'codex')
                               ↓
                    Monitor (updates every 30s)
                               ↓
                    Collect stdout/stderr
                               ↓
                    Send result to user
```

### Основные компоненты:

- **BotConfig** - типизированная конфигурация
- **ActiveTask** - состояние выполняемой команды
- **MessageHistory** - структура для хранения истории сообщений
- **ExecutionResult** - результат выполнения CLI команды
- **NoxonBot** - основной класс с обработчиками

### Особенности получения истории:

⚠️ **Важно**: Telegram Bot API не предоставляет прямой доступ к истории сообщений.

**Текущая реализация** использует локальное кэширование:
- Бот кэширует все входящие сообщения через middleware
- Автоматически скачивает медиа-файлы (фото/видео/документы) в `/tmp/noxonbot-media/`
- Хранит последние 10 сообщений для каждого чата в памяти
- При запуске команды к модели берет последние 5 сообщений из кэша
- Передает пути к скачанным файлам в Claude для чтения через Read tool
- **Быстро и надежно** - без дополнительных обращений к Telegram API

**Ограничения**:
- История доступна только для сообщений после запуска бота
- При перезапуске бота кэш очищается
- Не видит сообщения до добавления бота в чат
- Файлы больше 20MB не скачиваются (лимит Telegram Bot API)

**Возможные улучшения**:
1. Персистентное хранилище (Redis/SQLite) для сохранения между перезапусками
2. Использовать MTProto (pyrogram/telethon) для доступа к полной истории
3. Увеличить размер кэша

## Безопасность

- ✅ Строгая типизация (TypeScript strict mode)
- ✅ Валидация конфигурации при запуске
- ✅ Таймауты для предотвращения зависания
- ✅ Graceful shutdown
- ✅ Обработка всех ошибок
- ✅ Защита от spam (одна задача на чат)

## Ограничения

- **Время выполнения**: Максимум 10 минут
- **Размер ответа**: ~4000 символов на сообщение (лимит Telegram)
- **Одновременные задачи**: 1 задача на чат
- **Рабочая директория**: `/root/space2` для любых AI команд (если не переопределено для чата)

## Типизация

### No `any` policy

Весь код написан без использования `any`:
- Строгая типизация всех переменных
- Type guards для проверки типов во время выполнения
- Explicit typing для всех функций
- Strict null checks

### Основные типы:

```typescript
interface BotConfig {
  token: string;
  workingDir: string;
  maxExecutionTime: number;
  statusUpdateInterval: number;
}

interface ActiveTask {
  process: ChildProcess;
  startTime: number;
  prompt: string;
  statusMessageId: number;
  chatId: number;
}

interface MessageHistory {
  text?: string;
  from: string;
  date: Date;
  hasPhoto?: boolean;
  hasVideo?: boolean;
  hasDocument?: boolean;
  caption?: string;
}

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}
```

## Тестирование

### Тест структуры папок

Автоматический тест проверяет правильность размещения пользовательских и групповых данных:

```bash
node tests/test_folder_structure.js
```

**Что проверяется:**
- ✅ Пользовательские папки находятся в `/root/aisell/botplatform/group_data/user_{id}/`
- ✅ Групповые папки находятся в `/root/aisell/noxonbot/group_data/{chat_id}/`
- ✅ В `/root/` нет старых папок user_* или групповых
- ✅ История чатов (chat_log.json) сохранена
- ✅ CLAUDE.md файлы на месте

## Troubleshooting

### Бот не отвечает

```bash
pm2 status noxonbot
pm2 logs noxonbot --lines 100
pm2 restart noxonbot
```

### Claude не запускается

```bash
which claude
cd /root/space2
claude -p "test"
```

### TypeScript ошибки

```bash
npm run build
# Проверка типов без запуска
npx tsc --noEmit
```

## История

### 2026-01-20

**v8 - Исправлена обработка URL с подчеркиваниями**
- ✅ Исправлена функция `sanitizeForTelegram()` для корректной обработки URL
- ✅ URL с подчеркиваниями (типа `https://habab.ru/products/industrial_news_radar`) больше не обрезаются
- ✅ Добавлена защита URL через временные плейсхолдеры перед обработкой markdown
- ✅ Использован метод `split().join()` для точной замены плейсхолдеров (вместо regex)
- ✅ **КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ**: Устранена тройная санитизация текста
  - Проблема: `sanitizeForTelegram()` вызывалась 3 раза подряд (строки 1680, 1707, 1722)
  - Каждый вызов создавал новый пустой Map, оставляя плейсхолдеры предыдущих вызовов
  - Решение: Убрана повторная санитизация - теперь одна обработка на сообщение
- ✅ Telegram автоматически делает URL кликабельными без необходимости markdown форматирования

**Коммиты**:
- `0e3ce6d` - Fix URL handling (базовая защита плейсхолдерами)
- `ddf75c3` - Improve placeholder handling (улучшенный формат)
- `5475ad6` - Fix triple sanitization bug (критическое исправление)

### 2026-01-05

**v7 - Автоматическая загрузка файлов**
- ✅ Убрана ротация credentials (используем прямой `claude` вместо `cm`)
- ✅ Добавлена автоматическая загрузка файлов на i.wpmix.net
- ✅ Распознавание запросов на файлы в истории чата
- ✅ Автоматическое распознавание путей к файлам в ответах Claude (regex паттерны)
- ✅ Генерация публичных ссылок для скачивания
- ✅ Автоматическая отправка ссылки в чат

### 2025-12-16

**v5 - Поддержка команд с запятой**
- ✅ Добавлена поддержка обращений с запятой: `Кл,` / `кл,` / `Ко,` / `ко,`
- ✅ Более естественное обращение к боту ("Кл, помоги" вместо "кл помоги")
- ✅ Поддержка как с пробелом после запятой, так и без него

### 2025-12-04

**v4 - Автоматическая расшифровка аудио**
- ✅ Добавлена автоматическая отправка расшифровки аудио в чат
- ✅ Интеграция с OpenAI Whisper API для STT
- ✅ Проверка размера файлов перед скачиванием (лимит 20MB)
- ✅ Улучшена обработка ошибок в middleware кэширования

### 2025-11-13

**v3 - Медиа-файлы и скачивание**
- ✅ Автоматическое скачивание медиа-файлов (фото/видео/документы)
- ✅ Передача путей к файлам в Claude для чтения через Read tool
- ✅ Claude может читать изображения и видеть их содержимое
- ✅ Включена обратно загрузка истории в промпт

### 2025-11-11

**v2 - Контекст и chat ID**
- ✅ Автоматическая загрузка 5 предыдущих сообщений в контекст
- ✅ Поддержка изображений, видео, документов в истории
- ✅ Команда `/getchatid` для получения ID чата
- ✅ Автоматическое приветствие с chat ID при добавлении в группу

**v1 - Базовая функциональность**
- ✨ Создан бот на TypeScript без `any`
- ✅ Добавлена команда "p" для запуска Claude CLI
- ✅ Реализован мониторинг статуса
- ✅ Добавлена поддержка длительных задач
- ✅ Добавлена команда `/cancel` для отмены активной задачи
- ✅ Строгая типизация всего кода
