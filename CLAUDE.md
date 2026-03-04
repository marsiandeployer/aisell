# Проект AISELL - Claude Instructions

## 📦 Описание проекта

Monorepo **Noxon Digital Factory** — AI-конструкторы для создания веб-контента.

### Основные компоненты:

1. **botplatform/** — общая платформа для всех продуктов (Telegram + Webchat + Admin)
2. **products/** — продукты серии Simple* (конфигурации на botplatform):
   - **SimpleSite** — AI конструктор простых сайтов
   - **SimpleDashboard** — AI конструктор бизнес-дашбордов
3. **bananzabot/** — конструктор Telegram-ботов + web-админка + E2E тесты диалогов
4. **extensions/webchat-sidebar/** — Chrome Extension для webchat в сайдбаре

### Product-as-Configuration
Продукты Simple* — это **конфигурации** (не отдельные приложения):
- Общая кодовая база `botplatform/`
- Продукт = папка `products/{name}/` с `product.yaml` + `CLAUDE.md.template` + showcases
- Webchat на продукт через `start-webchat-{product}.sh` (один PM2 процесс)
- Результат работы — статический `index.html` на домене `d{USERID}.wpmix.net`

**Клиентская изоляция:**
- `CLAUDE.md.template` — копируется в workspace юзера (безопасный, без внутренних деталей)
- `CLAUDE.md` — полные инструкции для разработчиков (НЕ видны юзеру)
- Выбор шаблона: `bot.ts:getClaudeMdTemplatePath()` по `PRODUCT_TYPE` env var

**Workflow создания продукта:** см. skill `/root/.claude/skills/noxon-digital-factory.md`

Подробная архитектура и схема серверов: см. [README.md](./README.md)

## 🎯 Релевантные Skills для этого проекта

### Commands (вызываются через `/command-name`)

| Command | Описание |
|---------|----------|
| `/create-bot` | Создание Telegram-бота через Bananzabot |
| `/product-preview` | Создание промо-скриншота продукта (чат + фрейм) |
| `/make-landing-page-with-ai-background` | Создание лендинга с AI-фоном |
| `/tick` | Периодические задачи: CRM follow-up лидов, квалификация и т.п. |

### Skills (справочники в `/root/.claude/skills/`)

| Skill | Назначение | Когда использовать |
|-------|------------|-------------------|
| `telegram-operations.md` | Работа с Telegram (отправка, чтение сообщений, каналы) | Тестирование ботов, отправка уведомлений |
| `typescript-linter.md` | TypeScript правила и best practices | Код ревью, написание TS кода |
| `server-config.md` | Конфигурация серверов (порты, DNS, API ключи) | Деплой, настройка окружения |
| `image-generation.md` | Генерация изображений через Hydra AI | Создание фонов для лендингов, превью |
| `chrome-devtools-automation.md` | Автоматизация браузера через Chrome DevTools | E2E тесты webchat, проверка UI |
| `product-preview.md` | Создание промо-скриншотов (чат + фрейм) | Используется через команду `/product-preview` |
| `noxon-digital-factory.md` | Архитектура экосистемы, workflow создания продуктов | Создание нового продукта, понимание архитектуры |
| `chrome-extension-publishing.md` | Публикация расширений в Chrome Web Store | Релиз webchat-sidebar extension |
| `.claude/skills/crm-followup-operations.md` | CRM follow-up система Bananzabot (локальный skill) | `/tick`, генерация и отправка follow-up |

## 📂 Структура проекта

```
/root/aisell/
├── bananzabot/              # Конструктор ботов
│   ├── adminServer.js       # Web-админка (порт 3182)
│   ├── bots_database/       # База данных ботов
│   └── ecosystem.config.js  # PM2 конфиг
├── botplatform/             # Бот-платформа (ex-noxonbot)
│   ├── bot.js               # Telegram бот
│   ├── webServer.js         # Webchat сервер (порт 8091/8092)
│   ├── adminServer.js       # Админка (порт 8889)
│   └── ecosystem.config.js  # PM2 конфиг
├── extensions/
│   └── webchat-sidebar/     # Chrome Extension
│       ├── build.js         # Билд-скрипт
│       └── manifest.json    # Extension манифест
├── shared/                  # Общий код
└── README.md                # Основная документация
```

## 🔑 Ключевые технологии

- **Node.js** + **TypeScript** - основной стек
- **Telegram Bot API** - для ботов
- **Pyrogram** - для автотестов и telegram_operations
- **PM2** - управление процессами
- **Hydra AI** - генерация изображений
- **Chrome Extension API** - для sidebar extension
- **Bubblewrap (bwrap)** - изоляция CLI для безопасности

## ⚙️ Важные правила для разработки

1. **Креды синхронизируются автоматически** - не копируй `.claude.json` / `.codex` вручную на prod, используй `cred-sync` процесс
2. **Логи только через timeout** - `timeout 30s pm2 logs process_name --lines 200 --nostream`
3. **Тесты запускать с main server** - Telegram тесты с Pyrogram только с `78.47.125.10` (там креды)
4. **Webchat rate limit** - не отключай в продакшене (`WEBCHAT_RATE_LIMIT=0` только для дебага)
5. **Безопасность** - не используй `--dangerously-bypass-approvals-and-sandbox` для пользовательских запросов

## 🚀 Быстрые команды

### Деплой (всегда на 95.217.227.164)
```bash
# Application server — единственное место для деплоя
cd /root/aisell
git add -p
git commit -m "feat(simple_dashboard): add feature"
git push origin main

# Перезапуск PM2
pm2 reload ecosystem.config.js --update-env

# Или конкретный процесс
# SimpleDashboard запускается через launch script:
# bash /root/aisell/botplatform/start-webchat-simpledashboard.sh
```

**Важно:**
- Весь код, PM2, данные на `95.217.227.164`
- `62.109.14.209` — только reverse proxy (nginx + SSL)
- Деплой на reverse proxy НЕ нужен (только если меняется nginx config)

### Логи основных процессов
```bash
# Application server (95.217.227.164) — ВСЕ процессы здесь
timeout 30s pm2 logs noxonbot --lines 200 --nostream
timeout 30s pm2 logs bananzabot --lines 200 --nostream
timeout 30s pm2 logs cred-sync --lines 50 --nostream
```

### Тесты
```bash
# Bananzabot
cd /root/aisell/bananzabot && npm test

# Noxonbot webchat
cd /root/aisell/noxonbot && npm run build && python3 tests/test_webchat_flow.py

# Bilingual onboarding (только с main server!)
cd /root/aisell/noxonbot && REMOTE_SSH_HOST=root@62.109.14.209 python3 tests/test_onboarding_bilingual.py
```

### Сборка Chrome Extension
```bash
cd /root/aisell/extensions/webchat-sidebar

# RU версия (Noxon)
node build.js --name "Noxon Sidebar" --url "https://claudeboxbot.habab.ru"

# EN версия (Coderbox)
node build.js --name "Coderbox Sidebar" --url "https://coderbox.wpmix.net"

# SimpleDashboard
node build.js --name "SimpleDashboard" --url "https://simpledashboard.wpmix.net"
```

## 🌐 Домены и эндпоинты

### Production (через reverse proxy 62.109.14.209 → app server 95.217.227.164)
- `https://clodeboxbot.habab.ru` - RU webchat (noxonbot)
- `https://coderbox.wpmix.net` - EN webchat (coderbox)
- `https://simpledashboard.wpmix.net` - SimpleDashboard webchat
- `https://d{USERID}.wpmix.net` - Пользовательские дашборды/сайты
- `https://clodeboxbot.habab.ru/admin` - Админка (IP whitelist + Basic Auth)
- `https://clodeboxbot.habab.ru/extension` - Extension landing page

### Local development (на 95.217.227.164)
- `http://localhost:8091` - RU webchat (noxonbot)
- `http://localhost:8092` - EN webchat (coderbox)
- `http://localhost:8094` - SimpleDashboard webchat
- `http://localhost:3182/admin` - Bananzabot admin
- `http://localhost:8889/admin` - Noxonbot admin

## 🔄 CRM Follow-up (команда `/tick`)

Автогенерация follow-up отключена (pm2 процессы `crm-auto-followup` и `crm-auto-qualifier` остановлены). Вместо этого follow-up генерируются вручную по команде `/tick`.

### Что делает `/tick` для bananzabot CRM:
1. Подтянуть список лидов из `bananzabot/user_data/crm_followups.json`
2. Показать eligible лидов (commercial, не bot_created, без `personalFollowupSentAt`)
3. Для каждого лида: показать историю диалога и написать персональный follow-up текст
4. Отправка — только после подтверждения, через админку или `telegram_sender.py`

### Ключевые правила:
- **Личный follow-up (от аккаунта)** — строго 1 раз на пользователя (поле `personalFollowupSentAt`)
- **Follow-up от бота** — через `@bananza_bot`, менее рискованно, но тоже не спамить
- Данные лидов: `bananzabot/user_data/conversations/[userId]/conversation.json`
- CRM состояние: `bananzabot/user_data/crm_followups.json`
- Админка CRM: `http://localhost:3182/admin/crm`

## 📝 См. также

- [README.md](./README.md) - полная документация проекта
- [/root/CLAUDE.md](/root/CLAUDE.md) - глобальные инструкции
- [bananzabot/README.md](./bananzabot/README.md) - документация конструктора ботов
- [botplatform/README.md](./botplatform/README.md) - документация бот-платформы

---

**Последнее обновление:** 2026-02-18
**Версия:** 1.0
