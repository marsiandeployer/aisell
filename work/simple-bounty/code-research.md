# Code Research: simple-bounty

**Date:** 2026-03-06
**Feature:** Фабрика bounty-кампаний (новый продукт Simple*)
**Based on:** user-spec interview (work/simple-bounty/logs/userspec/interview.yml)

---

## 1. Entry Points

Точки входа — существующий механизм создания Simple* продуктов.

### Запуск продукта — Shell-скрипт
**Pattern:** `/root/aisell/botplatform/start-webchat-simpledashboard.sh`

Каждый продукт запускается через отдельный bash-скрипт. Скрипт:
1. Загружает `.env` через `source`
2. Устанавливает product-специфичные `export` переменные (`PRODUCT_TYPE`, `WEBCHAT_PORT`, `WEBCHAT_TITLE`, etc.)
3. Вызывает `npm run webchat` из директории `/root/aisell/noxonbot`

Для simple-bounty нужно создать `/root/aisell/botplatform/start-webchat-simplebounty.sh`.

### PM2 Конфиг
**Файл:** `/root/aisell/botplatform/ecosystem.config.js`

Каждый продукт — отдельная запись в `apps[]`:
```js
{
  name: 'simpledashboard-web',
  cwd: '/root/aisell/botplatform',
  script: 'start-webchat-simpledashboard.sh',
  interpreter: 'bash',
  env: { PATH: '...' }
}
```
Для simple-bounty добавить аналогичную запись с `name: 'simplebounty-web'`.

### Webchat Сервер
**Файл:** `/root/aisell/botplatform/src/webchat.ts` (7012 строк)

Основная точка входа — функция `startWebchatServer()`, вызываемая через `npm run webchat`. Экспортирует Express app, поднимает HTTP-сервер на `process.env.WEBCHAT_PORT`.

Ключевые обработчики роутов:
- `GET /` — отдаёт HTML с webchat UI (рендер через template literals)
- `POST /api/message` — принимает сообщение, проксирует в bot engine, возвращает SSE
- `GET /api/stream` — SSE поток ответа AI
- `POST /api/auth/claim` — email/OAuth аутентификация участника
- `POST /api/auth/google` — Google OAuth callback
- `app.use(async (req, res, next) => {...})` — middleware для `d{userId}.wpmix.net` (статика + `/api/data/`)

### Bot Engine
**Файл:** `/root/aisell/botplatform/src/bot.ts` (6214 строк)

Экспортирует `NoxonBot`, `loadConfig`, `loadChatSettings`, `saveChatSettings`. Webchat инстанциирует `NoxonBot` с `skipTelegramHandlers: true`. Bot обрабатывает AI-диалог, вызывает Claude.

Точка продуктовой кастомизации:
```ts
// bot.ts line 1247
const productType = process.env.PRODUCT_TYPE?.toLowerCase();
if (productType === 'simple_dashboard') {
  await this.replyTr(ctx, 'start.simple_dashboard', {...});
  return;
}
```

---

## 2. Data Layer

### Пользовательские данные — JSON файлы
**Root:** `/root/aisell/botplatform/group_data/`

Структура папки пользователя (`user_{userId}/`):
```
user_{userId}/
  settings.json       — ChatSettings: chatId, ownerAddress, ownerPrivateKey, accessMode, lastModified
  CLAUDE.md           — контекст для AI (из CLAUDE.md.workspace шаблона)
  index.html          — сгенерированный продукт
  chat_log.json       — история диалога
  data/               — JSON-коллекции (через /api/data/ API)
    {collection}.json — массив объектов {id, ...fields}
```

Пример `settings.json` (webchat user):
```json
{
  "chatId": 9000000000175,
  "lastModified": "2026-03-04T07:26:38.877Z",
  "ownerAddress": "0x2B0eA506E...",
  "ownerPrivateKey": "0x321457bf..."
}
```

Интерфейс `ChatSettings` (bot.ts, line 358):
```ts
export interface ChatSettings {
  chatId: number;
  useBwrap?: boolean;
  ownerAddress?: string;
  ownerPrivateKey?: string;
  accessMode?: 'invite' | 'open';
  lastModified: string;
}
```

Для simple-bounty в `settings.json` нужно будет добавить поля: `escrowBalance`, `currency`, а bounty-специфичные данные (кампании, задания, сабмишны) хранить в `data/` коллекциях.

### Data API (per-user JSON коллекции)
**Файл:** `/root/aisell/botplatform/src/webchat.ts`, line 4231

Middleware `d{userId}.wpmix.net` обрабатывает `GET|POST|PUT|DELETE /api/data/{collection}` и `GET|PUT|DELETE /api/data/{collection}/{id}`. Данные хранятся в `group_data/user_{id}/data/{collection}.json` как массив объектов с автогенерированным `id`.

Это готовый механизм хранения данных. Для bounty нужны коллекции: `campaigns`, `tasks`, `submissions`, `members`.

### PostgreSQL (Auth API)
**Файл:** `/root/aisell/botplatform/src/auth-api.ts`
**Соединение:** `pg.Pool` → host `10.10.10.2` (LXC 102), db `dashboard_auth`

Таблица `dashboard_access (user_id, dashboard_id, created_at)` — используется для авторизации участников. simple-bounty может переиспользовать эту таблицу (участник bounty = visitor на поддомен).

---

## 3. Similar Features

### SimpleDashboard — наиболее близкий аналог
**Продукт:** `/root/aisell/products/simple_dashboard/`
**Запуск:** `/root/aisell/botplatform/start-webchat-simpledashboard.sh`

SimpleDashboard является наиболее полным примером продукта. Использует:
- `PRODUCT_TYPE=simple_dashboard`
- Порт 8094
- Поддомен `d{userId}.wpmix.net` для статики
- `CLAUDE.md.workspace` шаблон для AI-контекста
- `ENABLE_GOOGLE_AUTH=true`
- `WEBCHAT_INIT_WITH_START=false`
- Auth SDK (`/sdk/auth.js`) для авторизации участников

Весь pipeline создания продукта через webchat переиспользуется без изменений.

### Auth SDK
**Файл:** `/root/aisell/botplatform/src/webchat.ts`, function `getAuthSdkJs()` (line 600)

SDK монтируется в `window.SD`, предоставляет методы `login`, `logout`, `getUser`, `getData/setData`. Уже используется в dashboards. simple-bounty использует тот же SDK.

### Telegram Stars Payment
**Файл:** `/root/aisell/botplatform/src/bot.ts`, lines 2739-2760, 3491-3566

Уже реализован полный flow:
- `ctx.replyWithInvoice(...)` с `currency: 'XTR'`, `provider_token: ''`
- Handler `pre_checkout_query` → `ctx.answerPreCheckoutQuery(true)`
- Handler `successful_payment` → создаёт workspace, обновляет state

Для bounty-эскроу нужно адаптировать `handleSuccessfulPayment` для пополнения `escrowBalance` вместо создания workspace.

---

## 4. Integration Points

### Добавление нового продукта в webchat.ts
**Файл:** `/root/aisell/botplatform/src/webchat.ts`

Сейчас webchat содержит SimpleDashboard-специфичную логику через `isSimpleDashboardProduct()`. Для simple-bounty нужно аналогично:
- Добавить `isSimpleBountyProduct()` функцию
- Расширить `maybeWriteWorkspaceClaude()` — уже generic, работает через `PRODUCT_TYPE`
- Добавить продуктовый `/api/bounty/` роут (или использовать существующий `/api/data/`)

### getClaudeMdTemplatePath (bot.ts, line 388)
```ts
function getClaudeMdTemplatePath(): string {
  const productType = (process.env.PRODUCT_TYPE || '').toLowerCase();
  if (productType) {
    const productPath = path.join(__dirname, `../../products/${productType}/SKILL.md`);
    if (fs.existsSync(productPath)) return productPath;
  }
  return CLAUDE_MD_TEMPLATE_PATH;
}
```
Generic. Нужно просто создать `/root/aisell/products/simple_bounty/SKILL.md`.

### maybeWriteWorkspaceClaude (webchat.ts, line 449)
Generic. Ищет `products/{productType}/CLAUDE.md.workspace`, затем `SKILL.md`. Переиспользуется без изменений.

### /api/data/ middleware (webchat.ts, line 4231)
Middleware для `d{userId}.wpmix.net`. Полностью generic CRUD для любых коллекций. simple-bounty использует его для хранения `campaigns`, `tasks`, `submissions`. Изменять не нужно.

### Авторизация участников (webchat.ts, line 5526+)
`POST /api/auth/claim` + `POST /api/auth/google` — уже работают. Для Telegram Login нужно добавить новый endpoint `POST /api/auth/telegram`. Он верифицирует Telegram Login Widget hash (HMAC-SHA256 по bot token).

### Auth API (auth-api.ts, port 8095)
Telegram Login endpoint нужно добавить в `auth-api.ts` (или в `webchat.ts`). Auth API использует PostgreSQL для хранения `dashboard_access`. Bounty-участники могут использовать ту же таблицу.

### nginx — поддомен d{userId}.wpmix.net
**Файл:** `/etc/nginx/sites-enabled/d-wildcard.wpmix.net` (на VM104)
**Файл на reverse-proxy:** `62.109.14.209` — аналогичный wildcard vhost

Wildcard уже настроен: `~^d(?<userid>\d+)\.wpmix\.net$` → `/root/aisell/botplatform/group_data/user_$userid`. simple-bounty использует те же поддомены, дополнительных nginx изменений не нужно.

Нужен новый nginx vhost только для `simplebounty.wpmix.net` (webchat интерфейс):
```nginx
server {
  listen 80;
  server_name simplebounty.wpmix.net;
  location / {
    proxy_pass http://127.0.0.1:8097;
    ...
  }
}
```

### PM2 экосистема
**Файл:** `/root/aisell/botplatform/ecosystem.config.js`

Новый блок нужно добавить в `apps[]` по аналогии с `simpledashboard-web`.

### Telegram Stars Bot
Для приёма/отправки Stars нужен отдельный Telegram бот с включёнными Payments. Токен хранится в env-переменной (например `SIMPLEBOUNTY_BOT_TOKEN`). Существующий mechanism `ctx.replyWithInvoice` в `NoxonBot` переиспользуется.

---

## 5. Existing Tests

**Директория:** `/root/aisell/botplatform/tests/`

Framework: нет отдельного тест-раннера, тесты Node.js с ручным assert. Python тесты используют Pyrogram.

Репрезентативные тест-сигнатуры:

```js
// test_sdk_methods.js — интеграционный, реальный HTTP
// Предпосылка: simpledashboard-web на порту 8094, JWT_SECRET в env
// Паттерн: fetch('/api/data/{col}', {method: 'POST', headers: authHeaders(), body: JSON.stringify(item)})
// Проверяет: status code, структуру ответа, идемпотентность

// test_auth_api.js — тесты Auth API на порту 8095
// Паттерн: fetch('http://localhost:8095/api/auth/register', {method: 'POST', body: JSON.stringify(payload)})
// Проверяет: JWT возвращается, 409 при повторной регистрации
```

```python
# test_webchat_flow.py — E2E через реальный HTTP
# Паттерн: requests.post(base_url + '/api/auth/claim', json={email, name})
# Проверяет: сессионный cookie, история сообщений
```

Покрыто: auth flow, SDK методы, rate limit, security, session. Не покрыто: Telegram Stars flow, auto-approve logic, submission workflow.

---

## 6. Shared Utilities

### writeJsonAtomic / readJsonFile (webchat.ts, line 100-118)
Атомарная запись JSON (write-to-tmp + rename). Используется повсюду. simple-bounty использует тот же механизм через `/api/data/`.

### SlidingWindowRateLimiter (webchat.ts, line 220; auth-api.ts, line 51)
Скользящее окно, in-memory. Реализована в обоих местах (копия). Для новых endpoints bounty использовать имеющиеся инстансы `rlGlobalIp1m`, `rlMessageUser1m`, или создавать новые в том же паттерне.

### enforceRateLimit (webchat.ts, line 393)
```ts
function enforceRateLimit(req, res, probes: {limiter, key}[]): boolean
```
Проверяет список rate limiters и возвращает 429 если превышен. Все новые endpoints используют этот хелпер.

### requireSessionApi (webchat.ts, line 4799)
```ts
function requireSessionApi(req, res, next): void
```
Middleware проверки webchat сессии. Устанавливает `req.webUser`. Все protected endpoints bounty используют этот middleware.

### getWorkingDirForChat / loadChatSettings / saveChatSettings (bot.ts, line 563-614)
```ts
export function loadChatSettings(chatId: number): ChatSettings
export function saveChatSettings(settings: ChatSettings): void
```
Читают/пишут `group_data/user_{id}/settings.json`. Нужно расширить `ChatSettings` новыми полями для bounty или хранить bounty-настройки кампании в `data/campaigns.json`.

### signChallenge (webchat.ts, line 588)
```ts
async function signChallenge(privateKey, dashboardId): Promise<{challenge, signature}>
```
Ethereum подпись для auth flow. Переиспользуется без изменений.

---

## 7. Potential Problems

### Порт 8097 свободен, но нужно проверить
Занятые порты: 8091 (noxonbot-webchat), 8092 (coderbox — на prod сервере), 8093 (aitu), 8094 (simpledashboard-web), 8095 (dashboard-auth-api), 8096 (simplecrypto-web). Порт **8097 свободен** для simple-bounty.

### Auto-approve: нет механизма scheduled jobs
В кодовой базе нет cron/scheduler кроме PM2 `cron_restart`. Для auto-approve через 2 дня нужен либо:
- PM2 процесс с `cron_restart: '0 * * * *'` для hourly sweep (аналог `cred-sync`)
- Или lazy-approve: проверять `createdAt + 48h < now` при каждом запросе статуса submission

Lazy подход проще и без накладных расходов, но не гарантирует точного времени выплаты.

### Telegram Stars выплата: асимметрия API
Telegram Bot API позволяет **принять** Stars (invoice → payment). Для **отправки** Stars участнику используется `refundStarPayment` (возврат) или `sendStarTransaction` (Bot API 8.0+). API `sendStarTransaction` существует, но требует бот с правами на Transfers. Необходимо проверить, доступен ли этот метод в Telegraf v4.16.

Риск: при выплате Stars может не быть готового механизма, потребуется прямой HTTP вызов к Bot API.

### in-memory Rate Limiters теряются при рестарте
Все rate limiters в памяти. При `pm2 restart simplebounty-web` бюджет сбрасывается. Для bounty это некритично.

### JSON-хранилище без транзакций
`writeJsonAtomic` атомарна для одного файла, но параллельные запросы к `/api/data/{col}` могут привести к race condition (read-modify-write). При низкой нагрузке MVP это допустимо. При высокой — нужна блокировка или переход на SQLite.

### Telegram Login Widget — требует бота с username
`POST /api/auth/telegram` должен верифицировать data hash через `HMAC-SHA256(SHA256(bot_token), data_check_string)`. Bot token должен быть доступен серверу. Если Simple-bounty использует тот же бот, что и для Stars — это один token.

### Пустой эскроу при создании кампании
По user-spec: создатель видит предупреждение, но может опубликовать. Нужно явное предупреждение в UI при нулевом балансе, иначе участники будут сдавать работы без возможности получить награду.

---

## 8. Constraints & Infrastructure

### Порты (занято / свободно)
| Порт | Процесс |
|------|---------|
| 8091 | noxonbot-webchat |
| 8092 | coderbox (prod сервер 62.109.14.209) |
| 8093 | aitu.wpmix.net |
| 8094 | simpledashboard-web |
| 8095 | dashboard-auth-api |
| 8096 | simplecrypto-web |
| **8097** | **свободен → simple-bounty** |

### Node.js версия
`/root/.nvm/versions/node/v22.21.1` (из PATH в ecosystem.config.js).

### TypeScript / tsx
Все `.ts` файлы запускаются через `tsx` (без компиляции). `package.json` botplatform: `tsx ^4.20.6`. TypeScript 5.9.3.

### Зависимости (уже установлены в botplatform)
- `telegraf ^4.16.3` — Telegram Bot API
- `ethers ^6.16.0` — Ethereum keypair + подписи
- `jsonwebtoken ^9.0.3` — JWT
- `pg ^8.19.0` — PostgreSQL
- `google-auth-library ^10.1.0` — Google OAuth
- `express ^4.21.2` — HTTP сервер
- `@sentry/node ^10.41.0` — error tracking

Новых npm пакетов для MVP не требуется. `crypto` (встроенный Node) достаточен для Telegram Login Widget verification.

### Pre-commit hooks
В репозитории нет `.husky` или pre-commit конфига в `/root/aisell/`. Gitleaks отсутствует. Проверка проходит без хуков.

### Environment Variables
Нужны новые:
- `SIMPLEBOUNTY_BOT_TOKEN` — Telegram бот для Stars
- `PRODUCT_TYPE=simple_bounty`
- `WEBCHAT_PORT=8097`
- `INTERNAL_API_KEY` — уже в `.env.auth`, переиспользуется

### Nginx
VM104 (`95.217.227.164`): добавить `/etc/nginx/sites-available/simplebounty.wpmix.net` + symlink.
Reverse proxy (`62.109.14.209`): добавить аналогичный vhost + certbot для SSL.

### Wildcard поддомен d{userId}.wpmix.net
Уже настроен. Новый продукт использует тот же wildcard без изменений.

---

## 9. External Libraries

### Telegram Stars API (Telegraf v4.16)
Существующие handlers в `bot.ts`:
```ts
// Создание invoice
ctx.replyWithInvoice({
  title: '...', description: '...',
  payload: `bounty_deposit_${campaignId}_${userId}`,
  provider_token: '',       // пустой для Stars
  currency: 'XTR',
  prices: [{ label: 'Deposit', amount: starsAmount }]
});

// Pre-checkout
bot.on('pre_checkout_query', ctx => ctx.answerPreCheckoutQuery(true));

// Successful payment
bot.on('successful_payment', ctx => {
  const payment = ctx.message.successful_payment;
  // payment.total_amount — количество Stars
  // payment.invoice_payload — содержит campaignId, userId
});
```

Для **выплаты** Stars участнику — использовать Telegram Bot API метод `sendStarTransaction` (доступен с Bot API 8.0). В Telegraf прямой поддержки нет, вызов через `ctx.telegram.callApi('sendStarTransaction', { user_id, amount, ... })`.

Альтернатива для MVP: хранить эскроу только в поинтах; Stars используются только для пополнения; выплата Stars вне платформы (создатель делает вручную или через отдельный бот).

### Telegram Login Widget
Верификация по официальной документации:
```ts
// Node.js crypto (built-in)
import crypto from 'crypto';

function verifyTelegramLogin(data: Record<string, string>, botToken: string): boolean {
  const hash = data.hash;
  const checkString = Object.entries(data)
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
  return hmac === hash;
}
```
Никаких новых пакетов не нужно.

---

## Выводы для планирования

### Переиспользуем без изменений
- Весь webchat UI (webchat.ts) — только добавить новые endpoints
- `/api/data/` CRUD middleware — готов для хранения campaigns/tasks/submissions
- `requireSessionApi` middleware
- `SlidingWindowRateLimiter` + `enforceRateLimit`
- `maybeWriteWorkspaceClaude` — generic, работает через PRODUCT_TYPE
- `writeJsonAtomic` / `readJsonFile`
- Wildcard nginx для `d{userId}.wpmix.net`
- Auth SDK (`/sdk/auth.js`) на поддомене
- Telegram Stars invoice + pre_checkout + successful_payment handlers
- Google OAuth flow

### Создаём с нуля
- `/root/aisell/products/simple_bounty/` — папка продукта (product.yaml, SKILL.md, CLAUDE.md.workspace)
- `/root/aisell/botplatform/start-webchat-simplebounty.sh` — launch скрипт
- Запись в ecosystem.config.js для `simplebounty-web` на порту 8097
- nginx vhost `simplebounty.wpmix.net` на VM104 + reverse proxy
- `POST /api/auth/telegram` endpoint — Telegram Login Widget verification
- Bounty-панель (`index.html`) — SPA для участников (создаётся AI через webchat диалог)
- Auto-approve процесс (PM2 cron или lazy check в /api/data/)
- Escrow логика (debit/credit escrowBalance в settings.json)

### Ключевые риски
1. **Stars выплата участникам**: `sendStarTransaction` в Telegraf v4.16 — нужно проверить через `callApi`. Митигация: MVP без прямой выплаты Stars (только поинты выплачиваются напрямую).
2. **Race condition в эскроу**: concurrent submissions при низкой нагрузке ОК, но нужен explicit check `escrowBalance >= reward` перед approve.
3. **Auto-approve timing**: lazy-check проще cron, но выплата происходит при следующем запросе, не точно через 48 ч.
