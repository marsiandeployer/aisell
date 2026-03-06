---
created: 2026-03-06
status: draft
branch: feature/simple-bounty
size: L
---

# Tech Spec: simple-bounty

## Solution

Новый продукт Simple* — фабрика bounty-кампаний. Строится поверх существующей `botplatform` по той же модели, что и SimpleDashboard: конфигурация продукта в `products/simple_bounty/`, PM2 процесс `simplebounty-web` на порту **8097**, webchat-интерфейс создателя на `simplebounty.wpmix.net`.

Создатель ведёт диалог с AI через webchat — AI запрашивает название, описание, задания, награды в поинтах, команду пополнения эскроу — и через инструменты сохраняет данные в JSON-коллекции пользователя. После публикации кампания доступна на `d{userId}.wpmix.net` — участники авторизуются через Google, видят задания и сабмитят доказательства (текст или URL).

Всё хранилище — JSON per-user через существующий `/api/data/` CRUD. Бизнес-логика (эскроу debit/credit, auto-approve, дубликаты, лидерборд) — новые `/api/bounty/*` эндпоинты в `webchat.ts`. Никаких новых npm-пакетов не нужно.

## Architecture

### What we're building/modifying

- **`products/simple_bounty/`** — папка нового продукта: `product.yaml`, `SKILL.md` (AI-промпт для webchat), `CLAUDE.md.workspace` (контекст для участника)
- **`start-webchat-simplebounty.sh`** — launch-скрипт с `PRODUCT_TYPE=simple_bounty`, `WEBCHAT_PORT=8097`
- **`botplatform/ecosystem.config.js`** — новая запись `simplebounty-web` в `apps[]`
- **`botplatform/src/webchat.ts`** — новые bounty API эндпоинты (`/api/bounty/*`), доступные на обоих вариантах запроса (creator session и visitor session на поддомене)
- **nginx vhost `simplebounty.wpmix.net`** — на VM104 (95.217.227.164) и reverse proxy (62.109.14.209)
- **Participant page (`index.html`)** — SPA-страница, генерируется AI через webchat; содержит Google auth, список заданий, форму сабмита, лидерборд; обращается к `/api/bounty/*`

### How it works

**Создатель (webchat на simplebounty.wpmix.net):**
1. Webchat сессия → AI-диалог → AI вызывает `/api/bounty/campaigns` (POST) для создания кампании
2. AI добавляет задания через `/api/bounty/campaigns/:id/tasks` (POST)
3. Создатель пополняет эскроу через `/api/bounty/campaigns/:id/escrow/deposit` (POST)
4. AI рендерит и сохраняет `index.html` — SPA-страница кампании
5. Создатель управляет заявками через `/api/bounty/submissions/:id/approve|reject` (POST)

**Участник (d{userId}.wpmix.net):**
1. Nginx wildcard роутит `d{userId}.wpmix.net` → `group_data/user_{userId}` → отдаёт `index.html`
2. Participant SPA: Google OAuth через `/api/auth/google` → получает session cookie
3. `GET /api/bounty/campaigns/:id/tasks` — список заданий
4. `POST /api/bounty/campaigns/:id/tasks/:taskId/submissions` — сабмит доказательства
5. `GET /api/bounty/campaigns/:id/tasks/:taskId/submissions/my` — проверка статуса; при запросе: если `submittedAt + 48h ≤ now` и `status === 'pending'` и `escrow.balance >= task.reward` → auto-approve
6. `GET /api/bounty/campaigns/:id/leaderboard` — топ-10 по sum approved points

**Данные** (JSON per-user в `group_data/user_{creatorId}/data/`):
- `campaigns.json` — список кампаний создателя
- `tasks.json` — задания (с campaignId)
- `submissions.json` — заявки участников
- `escrow_{campaignId}.json` — баланс и история транзакций эскроу
- `balances.json` — суммарные очки участников (key: participantId)

**Auth routing:**
- Webchat session (`simplebounty.wpmix.net`) → `requireSessionApi` → `req.webUser.chatId` = creatorId
- Participant session (`d{userId}.wpmix.net`) → Google OAuth → session cookie; `userId` берётся из subdomain regex

## Decisions

### Decision 1: Хранилище — JSON vs SQLite
**Decision:** JSON per-user через существующий `/api/data/` CRUD
**Rationale:** Нулевые накладные расходы на миграции, нулевая зависимость от SQLite. Существующая инфраструктура (`writeJsonAtomic`, `/api/data/` middleware) уже работает. Трафик MVP — низкий.
**Alternatives considered:** SQLite — избыточно для MVP, нет готовой инфраструктуры; PostgreSQL (уже есть pg на auth-api) — over-engineering, смешивает auth-данные с product-данными.

### Decision 2: Auto-approve — lazy vs cron
**Decision:** Lazy-check: проверяется при запросе статуса участником (`GET .../submissions/my`)
**Rationale:** Нет нового PM2 процесса, нет clock skew, участник мотивирован открывать статус (чтобы получить поинты). Поведение детерминировано.
**Alternatives considered:** PM2 cron (`cron_restart: '0 * * * *'`) — дополнительный процесс, лишняя сложность, writes без trigger.

### Decision 3: Эскроу — в settings.json vs отдельный файл
**Decision:** Отдельный файл `escrow_{campaignId}.json` на кампанию в `data/`
**Rationale:** Независимые эскроу для каждой кампании, история транзакций не смешивается, AC-13 (несколько кампаний) выполняется без конфликтов.
**Alternatives considered:** Поле `escrowBalance` в settings.json — не поддерживает несколько кампаний, нет истории транзакций.

### Decision 4: Bounty API — новые endpoints vs чистый /api/data/
**Decision:** Новые `/api/bounty/*` эндпоинты в `webchat.ts` для бизнес-логики
**Rationale:** `/api/data/` — CRUD без бизнес-правил. Эскроу debit, auto-approve, duplicate check требуют логики. Новые endpoints инкапсулируют её.
**Alternatives considered:** Чистый `/api/data/` + логика на клиенте — нарушает security (client не авторитетен для баланса).

### Decision 5: MVP scope — points only
**Decision:** Только поинты (числа в JSON). Telegram Stars, TON, токены — вне скоупа.
**Rationale:** `sendStarTransaction` нет в Telegraf v4.16 (только `refundStarPayment`), Telegram Login добавляет XL-сложность. MVP валидирует core-механику. Stars/Telegram подключаются как отдельные модули.
**Alternatives considered:** Stars as currency — заблокировано API ограничениями Telegraf; Telegram Login — убрано из MVP явным решением.

### Decision 6: Participant page — AI-generated SPA
**Decision:** AI генерирует `index.html` с встроенным JS, который обращается к `/api/bounty/*`
**Rationale:** Соответствует паттерну SimpleDashboard. AI создаёт уникальный визуальный стиль и фон. Клиентский JS — thin client, вся логика на сервере.
**Alternatives considered:** Server-rendered HTML — нет realtime без перезагрузки; Отдельный React SPA — over-engineering.

## Data Models

```typescript
// campaigns.json (массив)
interface Campaign {
  id: string;           // uuid
  creatorId: number;    // webchat userId (из session)
  title: string;
  description: string;
  status: 'draft' | 'published';
  createdAt: string;    // ISO 8601
}

// tasks.json (массив)
interface Task {
  id: string;
  campaignId: string;
  title: string;
  description: string;
  reward: number;       // points
  createdAt: string;
}

// submissions.json (массив)
interface Submission {
  id: string;
  campaignId: string;
  taskId: string;
  participantId: string;     // Google sub (stable identifier)
  participantEmail: string;
  participantName: string;
  proof: string;             // text or URL
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  reviewedAt?: string;
  pointsAwarded?: number;    // = task.reward при approve
}

// escrow_{campaignId}.json (один файл на кампанию)
interface Escrow {
  campaignId: string;
  balance: number;
  transactions: EscrowTx[];
}
interface EscrowTx {
  type: 'deposit' | 'debit';
  amount: number;
  ref: string;    // submissionId или 'manual'
  createdAt: string;
}

// balances.json (один файл на юзера, общий для всех кампаний)
type Balances = Record<string, number>; // participantId → total approved points
```

## Dependencies

### New packages
Нет новых пакетов. `crypto` (built-in Node.js) достаточен для всего.

### Using existing (from project)
- `webchat.ts: writeJsonAtomic / readJsonFile` — атомарная запись JSON, везде в bounty API
- `webchat.ts: requireSessionApi` — middleware проверки webchat сессии создателя
- `webchat.ts: enforceRateLimit / SlidingWindowRateLimiter` — rate limiting новых endpoints
- `webchat.ts: /api/data/ CRUD middleware` — базовое хранилище коллекций
- `webchat.ts: /api/auth/google` — Google OAuth (переиспользуется без изменений)
- `webchat.ts: Auth SDK (/sdk/auth.js)` — участник авторизуется через него
- `bot.ts: getClaudeMdTemplatePath / maybeWriteWorkspaceClaude` — product routing по PRODUCT_TYPE
- `ecosystem.config.js` — добавить новый процесс

## Testing Strategy

**Feature size:** L

### Unit tests
(в `botplatform/tests/test_bounty_unit.js`)
- Escrow debit при balance ≥ reward → balance уменьшается, транзакция создана
- Escrow debit при balance < reward → ошибка, balance не изменён
- Auto-approve: `submittedAt + 48h ≤ now` + `escrow.balance ≥ reward` → статус approved, debit выполнен
- Auto-approve: `submittedAt + 48h ≤ now` + `escrow.balance = 0` → статус остаётся pending
- Auto-approve: `submittedAt + 47h ≤ now` → статус остаётся pending (срок не вышел)
- Duplicate submission: повторный сабмит (campaignId + taskId + participantId) → ошибка 409
- Task delete с pending submissions → все pending заявки → rejected

### Integration tests
(в `botplatform/tests/test_bounty_integration.js`)
- POST `/api/bounty/campaigns` → создаёт запись в campaigns.json, возвращает id
- POST `/api/bounty/campaigns/:id/escrow/deposit` → balance увеличивается, транзакция записана
- POST `.../tasks/:id/submissions` → создаёт запись, статус pending
- POST `.../submissions/:id/approve` → debit escrow, balance уменьшился, submission.pointsAwarded = reward
- Полный escrow-цикл: deposit → approve × N → balance = 0 → approve → 402

### E2E tests
(в `botplatform/tests/test_bounty_e2e.js`, через Chrome CDP localhost:9222)
- Создатель создаёт кампанию через webchat API → участник видит задания на `d{userId}.wpmix.net`
- Участник сабмитит доказательство → создатель апрувит → `balances.json` участника увеличился
- Auto-approve: установить `submittedAt = now - 49h` в submissions.json → GET `.../submissions/my` → статус approved
- Повторный сабмит → ответ 409 с текстом «Вы уже отправили заявку»

## Agent Verification Plan

**Source:** user-spec "Как проверить" раздел.

### Verification approach
Агент верифицирует через curl к `http://localhost:8097` (simplebounty-web) и через прямой доступ к JSON-файлам. Live-среда (поддомен) проверяется через curl с Host-заголовком.

### Per-task verification

| Task | Verify | What to check |
|------|--------|---------------|
| T1: Инфраструктура | bash | `pm2 status simplebounty-web` → online; `curl http://localhost:8097` → 200 |
| T2: Campaigns & Tasks API | curl | POST `/api/bounty/campaigns` → 200, campaign_id в ответе |
| T3: Escrow API | curl | POST `.../escrow/deposit {amount:100}` → balance=100; POST `.../approve` при balance=0 → 402 |
| T4: Submissions API | curl | POST сабмит → pending; повторный → 409; GET статус с submittedAt=now-49h → approved |
| T5: Campaign participant page | curl | `curl -H "Host: d{userId}.wpmix.net" http://localhost:8097` → 200, задания в HTML |
| T6: Creator panel | user | creator видит submissions list, кнопки approve/reject работают |
| T7: AI webchat prompt | curl | POST `/api/message` с "создай кампанию" → AI создаёт кампанию через tool call |
| T8: Unit tests | bash | `node tests/test_bounty_unit.js` → все ОК |
| T9: Integration tests | bash | `node tests/test_bounty_integration.js` → все ОК |
| T10: E2E tests | bash | `node tests/test_bounty_e2e.js` → все ОК |

### Tools required
- `curl` — все API проверки
- `bash` — запуск тестов, `pm2 status`
- Chrome CDP (`localhost:9222`) — E2E тесты

## Risks

| Risk | Mitigation |
|------|-----------|
| Race condition эскроу при concurrent approvals | read-after-write check: после debit читаем файл снова, если balance < 0 — rollback. Accepted limitation для MVP при низком трафике. |
| Auto-approve не срабатывает если участник не открывает страницу | Lazy-check — accepted для MVP; участник мотивирован проверять статус |
| webchat.ts разрастается (уже 7012 строк) | Bounty endpoints выносить в отдельный файл `bounty-api.ts`, импортировать в webchat.ts |
| Subdomain routing конфликтует с bounty API | Проверить middleware порядок: bounty routes должны быть до wildcard static |

## Acceptance Criteria

Технические критерии приёмки (дополняют пользовательские из user-spec):

- [ ] TC-1: `pm2 status simplebounty-web` → online, порт 8097
- [ ] TC-2: `curl http://localhost:8097` → 200 (webchat UI)
- [ ] TC-3: POST `/api/bounty/campaigns` с валидной сессией → 201, `{id, ...}`
- [ ] TC-4: POST `/api/bounty/campaigns/:id/escrow/deposit` → 200, баланс обновлён в `escrow_{id}.json`
- [ ] TC-5: POST `/api/bounty/.../submissions` дважды с теми же creatorId+taskId+participantId → второй → 409
- [ ] TC-6: POST `.../submissions/:id/approve` при balance=0 → 402 с текстом ошибки
- [ ] TC-7: GET `.../submissions/my` с `submittedAt = now - 49h`, escrow > 0 → статус `approved`, баланс участника увеличился
- [ ] TC-8: Все unit-тесты проходят (`node tests/test_bounty_unit.js` — 0 failures)
- [ ] TC-9: Все integration-тесты проходят (`node tests/test_bounty_integration.js` — 0 failures)
- [ ] TC-10: Нет регрессий в `test_sdk_methods.js` (SimpleDashboard tests)

## Implementation Tasks

<!-- Tasks are brief scope descriptions. AC, TDD, and detailed steps are created during task-decomposition. -->

### Wave 1 (независимые)

#### Task 1: Product setup — folder, launch script, PM2, nginx
- **Description:** Создать `products/simple_bounty/` с `product.yaml` и `CLAUDE.md.workspace` (placeholder). Добавить `start-webchat-simplebounty.sh` и запись `simplebounty-web` в `ecosystem.config.js`. Настроить nginx vhost `simplebounty.wpmix.net` на VM104 и reverse proxy. Результат: `pm2 start simplebounty-web` → сервер отвечает на порту 8097.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, infrastructure-reviewer
- **Verify:** bash — `pm2 status simplebounty-web` online; `curl http://localhost:8097` → 200
- **Files to modify:** `botplatform/ecosystem.config.js`, `/etc/nginx/sites-available/simplebounty.wpmix.net`
- **Files to read:** `botplatform/start-webchat-simpledashboard.sh`, `botplatform/ecosystem.config.js`, `products/simple_dashboard/product.yaml`

#### Task 2: Bounty Campaigns & Tasks API
- **Description:** Добавить CRUD-эндпоинты для кампаний и заданий: `POST|GET /api/bounty/campaigns`, `PUT|DELETE /api/bounty/campaigns/:id`, `POST|DELETE /api/bounty/campaigns/:id/tasks`. Данные хранятся в `campaigns.json` и `tasks.json` через `writeJsonAtomic`. При удалении задания с pending submissions — автоматически rejected (AC-14). Требует webchat session (creator).
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** curl — POST `/api/bounty/campaigns` → 201 + id; DELETE задания с pending → submissions rejected
- **Files to modify:** `botplatform/src/webchat.ts` (или новый `bounty-api.ts`)
- **Files to read:** `botplatform/src/webchat.ts` (requireSessionApi, writeJsonAtomic, enforceRateLimit)

#### Task 3: Escrow API
- **Description:** Добавить эндпоинты управления эскроу: `POST /api/bounty/campaigns/:id/escrow/deposit` (creator) и `GET /api/bounty/campaigns/:id/escrow` (creator). Хранить в `escrow_{campaignId}.json` с историей транзакций. Debit-функция для approve: atomic read-modify-write с post-write validation. При balance=0 — не блокировать кампанию, только предупреждение в GET-ответе.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** curl — deposit 100 → balance=100; approve при balance=0 → 402
- **Files to modify:** `botplatform/src/webchat.ts` (или `bounty-api.ts`)
- **Files to read:** `botplatform/src/webchat.ts` (writeJsonAtomic, readJsonFile)

### Wave 2 (зависит от Wave 1)

#### Task 4: Submissions API with auto-approve
- **Description:** Добавить эндпоинты: `POST /api/bounty/campaigns/:id/tasks/:taskId/submissions` (participant), `GET .../submissions/my` (participant + lazy auto-approve logic), `GET /api/bounty/campaigns/:id/submissions` (creator), `POST /api/bounty/submissions/:id/approve|reject` (creator). Auto-approve: при GET my-статуса проверить 48h + escrow. Duplicate block: 409 при повторном сабмите. `balances.json` обновляется при approve.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** curl — сабмит → pending; повтор → 409; approve → escrow decrease + balance increase; auto-approve c submittedAt=now-49h
- **Files to modify:** `botplatform/src/webchat.ts` (или `bounty-api.ts`)
- **Files to read:** Task 2 и Task 3 файлы, `botplatform/src/webchat.ts` (requireSessionApi, visitor auth)

#### Task 5: Leaderboard API
- **Description:** Добавить `GET /api/bounty/campaigns/:id/leaderboard` (public endpoint, не требует auth). Агрегирует approved submissions → sum points per participantId → топ-10. Обновляется при каждом approve без кэша (данные маленькие).
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** curl — GET leaderboard после N approvals → упорядоченный список топ-10
- **Files to modify:** `botplatform/src/webchat.ts` (или `bounty-api.ts`)
- **Files to read:** Task 4 файлы (submissions.json structure)

### Wave 3 (зависит от Wave 2)

#### Task 6: AI webchat prompt (SKILL.md)
- **Description:** Создать `products/simple_bounty/SKILL.md` — инструкция для AI как вести диалог создания кампании: запрашивать название, описание, добавлять задания с наградами, депозит эскроу, публикация. AI должен вызывать bounty API через webchat tool-calls. Обновить `CLAUDE.md.workspace` для участников (что за продукт, что можно делать). Добавить продуктовую ветку в `bot.ts` (`PRODUCT_TYPE=simple_bounty`).
- **Skill:** code-writing
- **Reviewers:** code-reviewer
- **Verify:** curl — POST `/api/message` "создай кампанию Тест, задание: Напиши отзыв, 50 поинтов" → AI создаёт campaign + task через API
- **Files to modify:** `products/simple_bounty/SKILL.md`, `products/simple_bounty/CLAUDE.md.workspace`, `botplatform/src/bot.ts`
- **Files to read:** `products/simple_dashboard/SKILL.md`, `botplatform/src/bot.ts` (PRODUCT_TYPE routing), `botplatform/src/webchat.ts` (tool-call mechanism)

#### Task 7: Campaign participant page (index.html template)
- **Description:** Создать базовый `index.html` шаблон для страницы кампании с AI-генерируемым фоном, Google auth (через Auth SDK), отображением заданий, формой сабмита доказательства (текст/URL), статусом заявки и лидербордом. JS обращается к `/api/bounty/*` эндпоинтам. AI кастомизирует дизайн под кампанию (цвета, фон). Escrow warning для создателя.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** user — открыть `d{userId}.wpmix.net` → авторизоваться через Google → видеть задания и лидерборд
- **Files to modify:** `products/simple_bounty/index.html.template` (или генерация через SKILL.md)
- **Files to read:** `products/simple_dashboard/showcases/` (примеры UI), `botplatform/src/webchat.ts` (Auth SDK, getAuthSdkJs)

### Wave 4 (зависит от Wave 3)

#### Task 8: Creator management panel
- **Description:** Добавить creator-панель в webchat UI (или отдельная страница `/panel`): список всех кампаний, per-campaign список submissions со статусом и доказательствами, кнопки Одобрить/Отклонить, индикатор баланса эскроу с предупреждением при balance=0. Панель использует webchat session (auth).
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** user — создатель нажимает Одобрить → поинты начисляются, эскроу уменьшился; видит warning при пустом эскроу
- **Files to modify:** `botplatform/src/webchat.ts` (или отдельный панельный html в `products/simple_bounty/`)
- **Files to read:** Task 2-5 эндпоинты, webchat UI render functions

### Wave 5 (зависит от Wave 4)

#### Task 9: Unit tests
- **Description:** Написать unit-тесты для core business logic: escrow debit/credit при разных состояниях balance, auto-approve timer logic (мок `Date.now`), duplicate submission block, task delete → cascade reject. Тесты должны быть автономными (без HTTP, без файловой системы через моки).
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** bash — `node tests/test_bounty_unit.js` → 0 failures
- **Files to modify:** `botplatform/tests/test_bounty_unit.js`
- **Files to read:** Task 2-5 реализация, `botplatform/tests/test_sdk_methods.js` (паттерн)

#### Task 10: Integration tests
- **Description:** Написать интеграционные тесты через реальный HTTP к запущенному `simplebounty-web`: создание кампании + task, deposit escrow, submit proof, approve → balance check, полный escrow-цикл до 0. Тесты используют test-аккаунт (тот же что в test_sdk_methods.js).
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** bash — `node tests/test_bounty_integration.js` → 0 failures
- **Files to modify:** `botplatform/tests/test_bounty_integration.js`
- **Files to read:** `botplatform/tests/test_sdk_methods.js`, Task 2-5 API схема

#### Task 11: E2E tests
- **Description:** Написать E2E тесты через Chrome CDP (localhost:9222): создатель создаёт кампанию → участник открывает поддомен, авторизуется через Google → сабмитит → создатель апрувит → баланс увеличился; auto-approve сценарий с мок-временем через прямую запись в submissions.json.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** bash — `node tests/test_bounty_e2e.js` → 0 failures
- **Files to modify:** `botplatform/tests/test_bounty_e2e.js`
- **Files to read:** `botplatform/tests/test_webchat_flow.py` (паттерн E2E), chrome-daemon `/root/tools/chrome-daemon/cspy.js`

### Final Wave

#### Task 12: Pre-deploy QA
- **Description:** Запустить полный тест-сьют (unit + integration + E2E), проверить все acceptance criteria из user-spec и tech-spec. Зафиксировать результаты.
- **Skill:** pre-deploy-qa
- **Reviewers:** none

#### Task 13: Deploy
- **Description:** `pm2 start simplebounty-web` на prod, nginx reload, DNS-запись `simplebounty.wpmix.net` → 62.109.14.209, SSL через certbot. Проверить доступность webchat и поддоменов.
- **Skill:** code-writing
- **Reviewers:** none

#### Task 14: Post-deploy verification
- **Description:** Live-проверка через curl и браузер: создать кампанию, подать заявку, одобрить, проверить лидерборд на prod-URL.
- **Skill:** post-deploy-qa
- **Reviewers:** none
