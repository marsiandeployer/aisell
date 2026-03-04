# aisell

Monorepo проекта **Noxon Digital Factory** — AI-конструкторы для создания веб-контента.

## 📦 Продукты (серия Simple*)

| Продукт | Описание | Конфиг | Webchat | Тип |
|---------|----------|--------|---------|-----|
| **SimpleSite** | AI конструктор простых сайтов | `products/simple_site/` | TBD | Генерация HTML |
| **SimpleDashboard** | AI конструктор бизнес-дашбордов | `products/simple_dashboard/` | `https://simpledashboard.wpmix.net` | Генерация HTML |
| **SimpleCrypto** | AI white-label crypto wallet | `products/simple_crypto/` | `https://simplecrypto.wpmix.net` | Конфигурация MCW |

### Product-as-Configuration Архитектура

Каждый продукт Simple* — это **конфигурация** на общей платформе `botplatform/`:
- **Единая кодовая база** — `botplatform/` обслуживает все продукты
- **Продукт = папка с конфигом** — `products/{product_name}/`
- **Один PM2 процесс на продукт** — например, `simpledashboard-web`

**Структура продукта:**
```
products/simple_dashboard/
├── product.yaml              # Метаданные, бот-токены, домены (gitignored)
├── SKILL.md                  # AI инструкции — используется как:
│                             #   1) шаблон в workspace юзера (webchat)
│                             #   2) skill для Claude Code (skillsmp.com)
├── marketplace.json          # Метаданные для skillsmp.com (name, tags, screenshots)
├── CLAUDE.md                 # Полные инструкции для разработчиков (gitignored)
├── .claude/skills/           # Product-specific skills (gitignored)
├── showcases/                # Демо-примеры для галереи
└── icons/                    # Иконки и брендинг
```

**Как бот выбирает инструкции:**
- `bot.ts:getClaudeMdTemplatePath()` ищет `products/{PRODUCT_TYPE}/SKILL.md`
- Если найден — копирует в workspace юзера как `CLAUDE.md`
- Если нет — fallback: `botplatform/CLAUDE.md.example`

**SimpleCrypto отличается:**
- Не генерирует HTML с нуля — конфигурирует MCW (MultiCurrencyWallet)
- Выход: `erc20tokens.js` + `variables.css` + `DEPLOY.md`
- MCW pre-built: `/root/MultiCurrencyWallet/build-mainnet/`

**Документация продуктов:** [`products/README.md`](./products/README.md)

**Workflow создания продукта:** см. skill `/root/.claude/skills/noxon-digital-factory.md`

## 🖥️ Интерфейсы

| Интерфейс | Реализация | Описание |
|-----------|------------|----------|
| **Webchat** | `botplatform/` | Web UI в браузере |
| **Chrome Extension** | `extensions/webchat-sidebar/` | Sidebar в браузере |
| **Telegram Bot** | `botplatform/` | Чат в Telegram |
| **Claude Skills Marketplace** | `products/*/SKILL.md` + `marketplace.json` | Standalone skill для Claude Code (skillsmp.com) |
| **Moltbook AI Agents** | `~/.config/moltbook/credentials.json` | AI agent marketplace (BNB Chain hackathon) |

## 🏗️ Структура monorepo

- `products/` — конфиги продуктов Simple* (YAML с showcases, описаниями, иконками)
- `botplatform/` — движок для всех интерфейсов (Telegram + Webchat); симлинк `noxonbot -> botplatform`
- `extensions/` — Chrome Extensions (webchat-sidebar)
- `bananzabot/` — конструктор Telegram-ботов (отдельный продукт)
- `shared/` — общий код (admin-рендеры, pyrogram testkit)

Рабочие папки пользователей: `/root/aisell/botplatform/group_data/user_{id}`.

## Схема серверов

### Application Server — `95.217.227.164` (основной, текущий)
**Весь код, все PM2 процессы, все данные.**

| PM2 процесс | Порт | Что делает |
|-------------|------|------------|
| `noxonbot` | — | RU Telegram-бот |
| `noxonbot-webchat` | 8091 | RU webchat UI |
| `aitu-web` | 8093 | AITU webchat UI |
| `simpledashboard-web` | 8094 | SimpleDashboard webchat |
| `dashboard-auth-api` | 8095 | Auth API (keypair, invite, JWT) |
| `simplecrypto-web` | 8096 | SimpleCrypto webchat |
| `noxonbot-admin` | 8889 | Админка лидов |
| `bananzabot` | — | Конструктор ботов (Telegram) |
| `bananzabot-admin` | 3182 | Web admin Bananzabot |
| `bananzatestbot` | — | Тестовый бот Bananzabot |
| `cred-sync` | — | Синк Claude/Codex кредов каждые 10 мин |

**Prod-only процессы** (`ecosystem.prod.config.js`, запускать только на `62.109.14.209`):
`clodeboxbot`, `coderboxbot`, `noxonbot-web` (8091), `coderbox-web` (8092)

### Reverse Proxy — `62.109.14.209` (только SSL-терминация)
**Только nginx + SSL. Никакого кода, никаких PM2 процессов.**

| Домен | Проксирует на |
|-------|---------------|
| `clodeboxbot.habab.ru` | `95.217.227.164:8091` |
| `coderbox.wpmix.net` | `95.217.227.164:8092` |
| `simpledashboard.wpmix.net` | `95.217.227.164:8094` |
| `simplecrypto.wpmix.net` | `95.217.227.164:8096` |
| `d{USERID}.wpmix.net` | `95.217.227.164` (статика) |

**SSH:** `ssh root@62.109.14.209` — только для nginx конфигов и SSL.

**Деплой:** ВСЕГДА на `95.217.227.164`. Reverse proxy не деплоится (только если меняется nginx конфиг).

## Деплой

### Автоматический (GitHub Actions CI/CD)

При `git push origin main` автоматически:
1. `check-skip` — пропускает если только README/docs изменены
2. `test` — TypeScript build + npm test + security checks
3. `deploy` — SSH на `95.217.227.164`, `git pull`, `pm2 reload`

```bash
cd /root/aisell
git add -p
git commit -m "feat(simple_dashboard): add feature"
git push origin main   # → GitHub Actions → auto-deploy
```

### Ручной (если CI/CD не отработал)

```bash
# На сервере 95.217.227.164
cd /root/aisell && git pull origin main
cd botplatform && npm install --omit=dev
pm2 reload ecosystem.config.js --update-env
```

**SimpleDashboard** требует TypeScript-сборки перед reload:
```bash
cd /root/aisell/botplatform && npm run build
pm2 reload simpledashboard-web --update-env
```

## Синхронизация Claude/Codex credentials

Credentials (`.claude.json`, `.claude/settings.json`, `.codex/auth.json` и др.)
хранятся на main server и автоматически синхронизируются на prod через PM2 процесс `cred-sync`.

Ручной запуск:
```bash
bash /root/aisell/botplatform/scripts/sync_creds_to_prod.sh
```

Логи:
```bash
timeout 10s pm2 logs cred-sync --lines 20 --nostream
```

## Запуск PM2 (первый раз)

```bash
pm2 start /root/aisell/bananzabot/ecosystem.config.js
pm2 start /root/aisell/botplatform/ecosystem.config.js
pm2 save
```

Для prod-ботов (на `62.109.14.209`):
```bash
pm2 start /root/aisell/botplatform/ecosystem.prod.config.js
```

Логи (всегда через `timeout`):
```bash
timeout 30s pm2 logs noxonbot --lines 200 --nostream
timeout 30s pm2 logs simpledashboard-web --lines 100 --nostream
timeout 30s pm2 logs dashboard-auth-api --lines 50 --nostream
timeout 30s pm2 logs cred-sync --lines 50 --nostream
```

## Admin

- Bananzabot: `http://localhost:3182/admin`
- Bananzabot публично: `http://bananzabot.wpmix.net/admin`
- Bananzabot CRM: `http://localhost:3182/admin/crm`
- Noxonbot admin: `http://localhost:8889/admin`

Доступ к админкам ограничен IP allowlist + Basic Auth (`digital`).

## Web Chat

| URL | Процесс | Назначение |
|-----|---------|------------|
| `http://localhost:8091` | `noxonbot-webchat` | RU webchat (локально) |
| `https://clodeboxbot.habab.ru` | via proxy | RU webchat (публично) |
| `http://localhost:8093` | `aitu-web` | AITU webchat |
| `http://localhost:8094` | `simpledashboard-web` | SimpleDashboard (локально) |
| `https://simpledashboard.wpmix.net` | via proxy | SimpleDashboard (публично) |
| `http://localhost:8096` | `simplecrypto-web` | SimpleCrypto (локально) |
| `https://simplecrypto.wpmix.net` | via proxy | SimpleCrypto (публично) |
| `https://d{USERID}.wpmix.net` | статика | Пользовательские дашборды |

Webchat на `localhost` работает без логина (`userId=999999999`). Поддерживается `?prompt=...` для автоотправки.

История webchat: `botplatform/data/webchat/chats/{id}.json`. При наличии workspace синхронизируется в `group_data/user_{id}/chat_log.json`.

## Security Notes

- `noxonbot` запускает Claude/Codex CLI в `bwrap` (bubblewrap) изоляции — внутрь монтируется только рабочая папка пользователя.
- В AI CLI не прокидывается `process.env` (чтобы нельзя было вытянуть секреты через `env`).
- Webchat API защищён rate limit'ом по IP и userId. Отключать только для отладки: `WEBCHAT_RATE_LIMIT=0`.
- `dashboard-auth-api` (порт 8095) и `simpledashboard-web` (порт 8094) имеют **in-memory rate limiters** — сбрасываются только при `pm2 restart`. При прогоне тестов подряд → 429; лечится рестартом обоих процессов.

## Chrome Extension (Sidebar)

```bash
cd /root/aisell/extensions/webchat-sidebar

# SimpleDashboard
node build.js --name "SimpleDashboard" --short-name "SimpleDashboard" --url "https://simpledashboard.wpmix.net"

# Noxon (RU)
node build.js --name "Noxon Sidebar" --short-name "Noxon" --url "https://clodeboxbot.habab.ru"

# Coderbox (EN)
node build.js --name "Coderbox Sidebar" --short-name "Coderbox" --url "https://coderbox.wpmix.net"
```

**Важно:** всегда передавать `--short-name` — без него дефолт "Codebox" для всех продуктов.

Установка: `chrome://extensions` → Developer mode → Load unpacked → `out/webchat-sidebar/`.

Скачать готовый zip: `/downloads/chrome-sidebar-extension.zip` (из webchat).

## Автотесты

**Bananzabot**:
```bash
cd /root/aisell/bananzabot
npm test
npm run test:e2e
```

**botplatform (unit/integration)**:
```bash
cd /root/aisell/botplatform

# TypeScript/синтаксис
node tests/test_ts_syntax.js
node tests/test_rendered_client_js.js

# Webchat foundation
node tests/test_webchat_foundation.js

# SimpleDashboard auth (multi-user-auth feature)
export $(cat .env.auth | xargs)   # нужно для JWT_SECRET и др.
node tests/test_invite_flow.js
node tests/test_guest_auth_widget.js
node tests/test_server_side_keypair.js
node tests/test_google_auth.js
node tests/test_auth_api.js
node tests/test_webchat_keypair.js
node tests/test_profile_share.js
```

**Telegram E2E (Pyrogram)** — запускать только на `95.217.227.164` (там лежат креды):
```bash
cd /root/aisell/botplatform
python3 tests/test_onboarding.py
python3 tests/test_onboarding_bilingual.py
```

## 📝 Документация

- [AUTH-FLOWS.md](./AUTH-FLOWS.md) — авторизация в продуктах: Owner keypair, Dashboard auth-check, Guest OAuth, Returning Guest, Revoke
- [ARCHITECTURE.md](./ARCHITECTURE.md) — архитектура monorepo
- [BACKUP_GUIDE.md](./BACKUP_GUIDE.md) — резервное копирование
- [products/README.md](./products/README.md) — документация продуктов Simple*
