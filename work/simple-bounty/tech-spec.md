---
created: 2026-03-06
status: draft
branch: feature/simple-bounty
size: L
---

# Tech Spec: simple-bounty

## Solution

Новый продукт Simple* — фабрика bounty-кампаний. Строится поверх существующей `botplatform` по той же модели, что и SimpleDashboard: конфигурация продукта в `products/simple_bounty/`, PM2 процесс `simplebounty-web` на порту **8097**, webchat-интерфейс создателя на `simplebounty.wpmix.net`.

Создатель ведёт диалог с AI через webchat — AI запрашивает название, описание, задания, награды в поинтах и создаёт кампанию через `/api/bounty/*` эндпоинты. После публикации кампания доступна на `d{creatorId}.wpmix.net` — участники авторизуются через Google OAuth, видят задания и сабмитят доказательства (текст или URL).

Вся бизнес-логика вынесена в `src/bounty-api.ts` (импортируется в webchat.ts) + `src/bounty-notifications.ts` (опциональные Telegram-уведомления). Хранилище — JSON per-user через существующий `/api/data/` механизм. Никаких новых npm-пакетов не нужно.

## Architecture

### What we're building/modifying

- **`products/simple_bounty/`** — папка продукта: `product.yaml`, `SKILL.md` (AI-диалог создателя), `CLAUDE.md.workspace` (контекст участника)
- **`start-webchat-simplebounty.sh`** — launch-скрипт с `PRODUCT_TYPE=simple_bounty`, `WEBCHAT_PORT=8097`
- **`botplatform/ecosystem.config.js`** — новая запись `simplebounty-web` в `apps[]`
- **`botplatform/src/bounty-api.ts`** — новый файл: все `/api/bounty/*` эндпоинты (campaigns, tasks, escrow, submissions, leaderboard)
- **`botplatform/src/bounty-notifications.ts`** — опциональные Telegram-уведомления создателю (если `SIMPLEBOUNTY_BOT_TOKEN` задан)
- **`botplatform/src/webchat.ts`** — импорт и монтирование bounty-api router
- **`products/simple_bounty/index.html.template`** — базовый шаблон SPA-страницы кампании (Google auth, задания, форма, лидерборд)
- **nginx vhost `simplebounty.wpmix.net`** — VM104 + reverse proxy 62.109.14.209

### How it works

**Создатель (webchat на simplebounty.wpmix.net):**
1. Webchat сессия (`requireSessionApi`) → `req.webUser.chatId` = creatorId
2. AI-диалог → вызов `/api/bounty/campaigns` (POST) — AI создаёт кампанию
3. AI добавляет задания через `/api/bounty/campaigns/:id/tasks` (POST)
4. Создатель пополняет эскроу через `/api/bounty/campaigns/:id/escrow/deposit` (POST, amount > 0)
5. AI рендерит `index.html` — SPA для участников
6. Создатель управляет заявками через `/api/bounty/submissions/:id/approve|reject` (POST)
   - Approve: **обязательно** проверяет `submission.campaignId → campaign.creatorId === req.webUser.userId`, иначе 403
   - Approve: debit escrow (read-after-write rollback если balance ушёл в минус), credit balances.json

**Участник (d{creatorId}.wpmix.net):**
1. Nginx wildcard → `group_data/user_{creatorId}/index.html`
2. Google OAuth via `/api/auth/google-dashboard-callback` с `redirect_to=d{creatorId}.wpmix.net`
   - `participantId` = Google `sub` field из ID token (стабильный server-side идентификатор, НЕ из request body)
3. `GET /api/bounty/campaigns/:id/tasks` — список заданий (публичный endpoint, без auth)
4. `POST /api/bounty/campaigns/:id/tasks/:taskId/submissions` — сабмит доказательства
   - proof проходит через HTML-entity encoding перед сохранением (XSS prevention)
   - Если URL — проверяется `http://` или `https://` scheme
5. `GET /api/bounty/campaigns/:id/tasks/:taskId/submissions/my` — проверка статуса + lazy auto-approve
6. `GET /api/bounty/campaigns/:id/leaderboard` — топ-10 (публичный; **возвращает только имя и поинты**, email НЕ включается)

**Telegram уведомления (опциональны, если `SIMPLEBOUNTY_BOT_TOKEN` задан):**
- Новая заявка → `bounty-notifications.ts: notifyNewSubmission(creatorChatId, taskTitle, proofSummary)`
- Auto-approve сработал → `notifyAutoApprove(creatorChatId, taskTitle, participantName, points)`
- Escrow = 0 при auto-approve → `notifyEmptyEscrow(creatorChatId, campaignTitle)`
- Все уведомления — best-effort (ошибка не блокирует основной flow)

**Данные** (JSON per-creator в `group_data/user_{creatorId}/data/`):
- `campaigns.json` — список кампаний создателя
- `tasks.json` — задания (с campaignId)
- `submissions.json` — заявки участников
- `escrow_{campaignId}.json` — баланс и история транзакций
- `balances.json` — суммарные поинты участников (key: Google `sub`)

## Decisions

### Decision 1: Хранилище — JSON vs SQLite
**Decision:** JSON per-creator через существующий `/api/data/` механизм
**Rationale:** Нулевые накладные расходы на миграции, существующая инфраструктура (`writeJsonAtomic`) уже работает. Трафик MVP — низкий.
**Alternatives considered:** SQLite — избыточно, нет готовой инфраструктуры; PostgreSQL — over-engineering, смешивает auth с product-данными.

### Decision 2: Auto-approve — lazy vs cron
**Decision:** Lazy-check при запросе статуса участником (GET `.../submissions/my`)
**Rationale:** Нет нового PM2 процесса. Участник мотивирован проверять статус (чтобы получить поинты). Поведение детерминировано. Accepted limitation: выплата происходит не ровно через 48ч, а при следующем запросе.
**Alternatives considered:** PM2 cron hourly sweep — дополнительный процесс, лишняя сложность.

### Decision 3: Эскроу — per-campaign файл
**Decision:** Отдельный `escrow_{campaignId}.json` на каждую кампанию
**Rationale:** Независимые эскроу (AC-13), история транзакций не смешивается.
**Alternatives considered:** Поле `escrowBalance` в settings.json — не поддерживает несколько кампаний.

### Decision 4: Bounty API — отдельный файл `bounty-api.ts`
**Decision:** Вся бизнес-логика в `src/bounty-api.ts`, импортируется в webchat.ts
**Rationale:** webchat.ts уже 7012 строк. Отдельный файл позволяет параллельную разработку tasks, избегает merge conflicts, упрощает тестирование unit-изоляции.
**Alternatives considered:** Всё в webchat.ts — merge conflicts при параллельной разработке tasks.

### Decision 5: participantId = Google `sub`
**Decision:** `participantId` всегда = поле `sub` из Google ID token, извлекается server-side при Google OAuth callback
**Rationale:** `sub` — стабильный идентификатор Google (не меняется даже при смене email). Client не может подменить его.
**Alternatives considered:** Email как ID — меняется; client-supplied ID — IDOR уязвимость.

### Decision 6: MVP scope — points only, Telegram уведомления опциональны
**Decision:** Только поинты. Telegram Stars, TON, токены вне скоупа. Telegram уведомления — опциональная функция (requires `SIMPLEBOUNTY_BOT_TOKEN`).
**Rationale:** Stars API ограничен в Telegraf v4.16. Telegram уведомления — best-effort, не блокируют MVP без бот-токена.
**Alternatives considered:** Stars as currency — API ограничения; Telegram Login — убрано из MVP явным решением.

### Decision 7: Race condition — read-after-write rollback (accepted limitation)
**Decision:** После debit читаем файл снова; если balance < 0 — откатываем (записываем старое значение обратно). Concurrent approvals при MVP-нагрузке обрабатываются так.
**Rationale:** User-spec явно принимает это ограничение для MVP при низком трафике: «Accepted limitation для MVP при низком трафике».
**Alternatives considered:** in-memory mutex Map per campaignId — более надёжно, но добавляет сложность; сбрасывается при pm2 restart.

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
  reward: number;       // points, must be > 0
  createdAt: string;
}

// submissions.json (массив)
interface Submission {
  id: string;
  campaignId: string;
  taskId: string;
  participantId: string;     // Google sub (from server-side ID token verification)
  participantName: string;   // Google display name
  proof: string;             // HTML-entity encoded text or validated URL (http/https only)
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  reviewedAt?: string;
  pointsAwarded?: number;    // = task.reward при approve
}
// NOTE: participantEmail is NOT stored — not needed for business logic, avoids PII exposure

// escrow_{campaignId}.json (один файл на кампанию)
interface Escrow {
  campaignId: string;
  balance: number;
  transactions: EscrowTx[];
}
interface EscrowTx {
  type: 'deposit' | 'debit';
  amount: number;
  ref: string;            // submissionId или 'manual'
  initiatedBy: 'creator' | 'auto-approve';  // аудит trail
  createdAt: string;
}

// balances.json (один файл на creatorId space; ключ = Google sub участника)
type Balances = Record<string, number>; // participantId → total approved points

// Leaderboard response (публичный, БЕЗ email)
interface LeaderboardEntry {
  participantId: string;  // Google sub (не email)
  participantName: string;
  totalPoints: number;
}
```

## Dependencies

### New packages
Нет. `crypto` (built-in Node.js) для HMAC если нужно. `telegraf` уже установлен.

### Using existing (from project)
- `webchat.ts: writeJsonAtomic / readJsonFile` (line 100-118) — атомарная запись JSON
- `webchat.ts: requireSessionApi` (line 4799) — проверка webchat сессии создателя
- `webchat.ts: enforceRateLimit / SlidingWindowRateLimiter` (line 393, 220) — rate limiting
- `webchat.ts: /api/data/ CRUD middleware` (line 4231) — базовое хранилище
- `webchat.ts: /api/auth/google-dashboard-callback` (line 6005) — Google OAuth flow (переиспользуется)
- `webchat.ts: getAuthSdkJs()` (line 600) — Auth SDK для participant page
- `webchat.ts: maybeWriteWorkspaceClaude` (line 449) — product CLAUDE.md routing
- `bot.ts: getClaudeMdTemplatePath` (line 388) — product SKILL.md routing по PRODUCT_TYPE
- `ecosystem.config.js` — добавить новый PM2 процесс

## Testing Strategy

**Feature size:** L

### Unit tests
(`botplatform/tests/test_bounty_unit.js` — автономные, без HTTP, без filesystem через моки)
- Escrow debit при balance > reward → balance уменьшается, транзакция создана с `initiatedBy`
- Escrow debit при balance === reward → success (граничное условие)
- Escrow debit при balance < reward → ошибка, balance не изменён
- Escrow debit rollback: если после write баланс < 0 → откат до предыдущего значения
- Balances credit при approve: prevBalance + reward = newBalance (проверяем накопление)
- Auto-approve: `submittedAt + 48h <= now` + `escrow.balance >= reward` → статус approved, debit+credit выполнены
- Auto-approve: `submittedAt + 48h === now` (ровно 48h) → approved (граничное условие)
- Auto-approve: `submittedAt + 47h 59m < now` → pending (срок не вышел)
- Auto-approve: `submittedAt + 49h` + `escrow.balance = 0` → pending, no debit
- Escrow cold-start: readJsonFile при отсутствующем файле (ENOENT) → начальный баланс 0
- Duplicate submission: повторный (campaignId+taskId+participantId) → 409
- Task delete с pending submissions → все pending → rejected
- Leaderboard aggregation: filter approved, sum per participantId, sort desc, slice top-10 — correctness test
- Reject: status=rejected, escrow без изменений, balances без изменений

### Integration tests
(`botplatform/tests/test_bounty_integration.js` — реальный HTTP к запущенному simplebounty-web)
- POST `/api/bounty/campaigns` → 201, id в ответе, campaign в campaigns.json
- POST `/api/bounty/campaigns/:id/escrow/deposit {amount:100}` → balance=100 в escrow файле
- POST `.../tasks/:id/submissions` → статус pending, запись в submissions.json
- GET `.../submissions/my` с `submittedAt = now - 49h` и escrow > 0 → статус approved
- POST `.../submissions/:id/approve` → debit escrow, balance уменьшился, balances.json обновился
- POST `.../submissions/:id/approve` для чужой кампании → 403 (ownership check)
- Дублирующий сабмит → 409 с текстом «Вы уже отправили заявку»
- Полный escrow-цикл: deposit 50 → approve (reward=50) → balance=0 → approve при balance=0 → 402
- POST `.../submissions/:id/reject` → status=rejected, escrow без изменений
- GET `/api/bounty/campaigns/:id/leaderboard` после нескольких approvals → корректный топ-10

### E2E tests
(`botplatform/tests/test_bounty_e2e.js` — Chrome CDP localhost:9222)
- Создатель создаёт кампанию через webchat API → GET `d{userId}.wpmix.net` → задания видны в HTML
- Участник сабмитит → создатель апрувит → balances.json участника увеличился на reward
- Auto-approve: прямая запись `submittedAt = now - 49h` в submissions.json → GET my-status → approved
- Повторный сабмит → 409 с корректным сообщением
- Лидерборд обновляется после approve (GET /leaderboard → участник виден)

## Agent Verification Plan

**Source:** user-spec "Как проверить" раздел.

### Verification approach
Агент верифицирует через curl к `http://localhost:8097`. Для participant endpoints — curl с заголовком `Host: d{userId}.wpmix.net`. JSON-файлы читаются напрямую для проверки состояния.

### Per-task verification

| Task | Verify | What to check |
|------|--------|---------------|
| T1: Infrastructure | bash | `pm2 status simplebounty-web` → online; `curl http://localhost:8097` → 200 |
| T2: Campaigns API | curl | POST `/api/bounty/campaigns` → 201, campaign_id; GET `/api/bounty/campaigns/:id/tasks` без auth → 200 (public) |
| T3: Escrow API | curl | deposit 100 → balance=100; deposit -1 → 400; approve при balance=0 → 402 |
| T4: Submissions API | curl | POST → pending; GET с submittedAt=now-49h → approved; POST approve чужой кампании → 403; XSS probe in proof → response содержит `&lt;script&gt;` |
| T5: Leaderboard | curl | GET after approvals → список без email полей; top-10 упорядочен по убыванию points |
| T6: SKILL.md | curl | POST `/api/message` "создай кампанию" → AI создаёт campaign через tool call |
| T7: Participant page | curl | `curl -H "Host: d{userId}.wpmix.net" http://localhost:8097` → 200, `<html>` в ответе |
| T8: Telegram notifications | bash | `SIMPLEBOUNTY_BOT_TOKEN=test node tests/test_bounty_notifications.js` → mock Telegram call logged |
| T9: Unit tests | bash | `node tests/test_bounty_unit.js` → 0 failures |
| T10: Integration tests | bash | `node tests/test_bounty_integration.js` → 0 failures |
| T11: E2E tests | bash | `node tests/test_bounty_e2e.js` → 0 failures |

### Tools required
- `curl` — API проверки
- `bash` — запуск тестов, `pm2 status`
- Chrome CDP (`localhost:9222`) — E2E тесты

## Risks

| Risk | Mitigation |
|------|-----------|
| Race condition эскроу при concurrent approvals | read-after-write check: если после debit баланс < 0 → rollback (записать старое значение). Accepted limitation для MVP при низком трафике. |
| Stored XSS в proof поле | HTML-entity encoding probe field перед сохранением; URL scheme validation (только http/https). Добавить в Task 4 acceptance criteria. |
| Google OAuth redirect_uri: hardcoded к simpledashboard в webchat.ts | Нужно зарегистрировать `simplebounty.wpmix.net/api/auth/google-dashboard-callback` в Google Cloud Console и задать `GOOGLE_OAUTH_REDIRECT_URI` в start-webchat-simplebounty.sh. |
| GET .../submissions/my с side-effect (auto-approve) — нарушение HTTP idempotency | Accepted для MVP (user-spec явно выбрал lazy-check на GET). Если участник повторит запрос, повторный auto-approve не сработает (уже approved). |
| Leaderboard PII exposure (email) | participantEmail не хранится. Leaderboard response включает только `participantId` (Google sub) + `participantName` + `totalPoints`. |
| Auto-approve: участник не открывает страницу — выплаты не происходит | Accepted для MVP. Участник мотивирован проверять статус. |
| webchat.ts разрастается | Вся bounty-логика в `bounty-api.ts`, webchat.ts только монтирует router. |

## Acceptance Criteria

Технические критерии приёмки (дополняют пользовательские из user-spec):

- [ ] TC-1: `pm2 status simplebounty-web` → online, порт 8097
- [ ] TC-2: `curl http://localhost:8097` → 200 (webchat UI)
- [ ] TC-3: POST `/api/bounty/campaigns` с валидной сессией → 201, `{id, ...}`
- [ ] TC-4: POST `/api/bounty/campaigns/:id/escrow/deposit {amount: -1}` → 400
- [ ] TC-5: POST `/api/bounty/campaigns/:id/escrow/deposit {amount: 100}` → balance=100 в escrow файле
- [ ] TC-6: POST `.../submissions` с `proof: "<script>alert(1)</script>"` → сохраняется как `&lt;script&gt;alert(1)&lt;/script&gt;`
- [ ] TC-7: POST `.../submissions` дважды с (creatorId+taskId+participantId) → второй → 409
- [ ] TC-8: POST `.../submissions/:id/approve` при balance=0 → 402
- [ ] TC-9: POST `.../submissions/:id/approve` при campaignId принадлежащем другому creator → 403
- [ ] TC-10: GET `.../submissions/my` с `submittedAt = now - 49h`, escrow > 0 → статус `approved`
- [ ] TC-11: GET `/api/bounty/campaigns/:id/leaderboard` → ответ НЕ содержит поля `email`
- [ ] TC-12: Все unit-тесты: `node tests/test_bounty_unit.js` → 0 failures
- [ ] TC-13: Все integration-тесты: `node tests/test_bounty_integration.js` → 0 failures
- [ ] TC-14: Нет регрессий в `test_sdk_methods.js` (SimpleDashboard tests)

## Implementation Tasks

<!-- Tasks are brief scope descriptions. AC, TDD, and detailed steps are created during task-decomposition. -->

### Wave 1 (независимые)

#### Task 1: Product infrastructure
- **Description:** Создать `products/simple_bounty/` (product.yaml, пустой CLAUDE.md.workspace placeholder). Добавить `start-webchat-simplebounty.sh` (PRODUCT_TYPE=simple_bounty, WEBCHAT_PORT=8097, GOOGLE_OAUTH_REDIRECT_URI=https://simplebounty.wpmix.net/api/auth/google-dashboard-callback) и запись `simplebounty-web` в `ecosystem.config.js`. Настроить nginx vhost `simplebounty.wpmix.net` на VM104 и reverse proxy. Результат: pm2 start → сервер отвечает на порту 8097.
- **Skill:** infrastructure-setup
- **Reviewers:** infrastructure-reviewer
- **Verify:** bash — `pm2 status simplebounty-web` → online; `curl http://localhost:8097` → 200
- **Files to modify:** `botplatform/ecosystem.config.js`, `botplatform/start-webchat-simplebounty.sh` (new), `/etc/nginx/sites-available/simplebounty.wpmix.net` (new)
- **Files to read:** `botplatform/start-webchat-simpledashboard.sh`, `botplatform/ecosystem.config.js`, `products/simple_dashboard/product.yaml`

### Wave 2 (зависит от Wave 1)

#### Task 2: Campaigns & Tasks API
- **Description:** Создать `src/bounty-api.ts` с CRUD-эндпоинтами для кампаний и заданий. GET `/api/bounty/campaigns/:id/tasks` — публичный (без auth). POST/DELETE требуют webchat session + `campaign.creatorId === req.webUser.userId`. При удалении задания с pending submissions — автоматически rejected (AC-14). Задания: reward должен быть > 0. Монтировать роутер в webchat.ts.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** curl — POST `/api/bounty/campaigns` → 201; GET tasks без auth → 200; DELETE задания с pending → submissions rejected
- **Files to modify:** `botplatform/src/bounty-api.ts` (new), `botplatform/src/webchat.ts` (mount router)
- **Files to read:** `botplatform/src/webchat.ts` (requireSessionApi, writeJsonAtomic, enforceRateLimit, router mounting pattern)

### Wave 3 (зависит от Wave 2)

#### Task 3: Escrow API
- **Description:** Добавить escrow эндпоинты в `bounty-api.ts`: POST deposit (creator, amount > 0) и GET balance (creator). Функция debit: atomic read-modify-write + post-write rollback если balance < 0 (записать старый баланс обратно). EscrowTx включает `initiatedBy: 'creator' | 'auto-approve'`. GET balance предупреждает в ответе если balance === 0. Approve при balance < reward → 402.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** curl — deposit 100 → balance=100; deposit -1 → 400; approve при balance=0 → 402
- **Files to modify:** `botplatform/src/bounty-api.ts`
- **Files to read:** `botplatform/src/webchat.ts` (writeJsonAtomic, readJsonFile), `botplatform/src/bounty-api.ts` (Task 2 output)

#### Task 6: AI webchat prompt (SKILL.md)
- **Description:** Создать `products/simple_bounty/SKILL.md` — промпт для AI-диалога: как запрашивать название кампании, описание, добавлять задания с наградами, инструировать по депозиту эскроу и публикации. Обновить `CLAUDE.md.workspace` для участников. Добавить ветку `PRODUCT_TYPE=simple_bounty` в `bot.ts` (аналогично `simple_dashboard` на line 1252).
- **Skill:** prompt-master
- **Reviewers:** prompt-reviewer
- **Verify:** curl — POST `/api/message` "создай кампанию Тест, задание: Напиши отзыв, 50 поинтов" → AI создаёт campaign+task через API
- **Files to modify:** `products/simple_bounty/SKILL.md` (new), `products/simple_bounty/CLAUDE.md.workspace`, `botplatform/src/bot.ts`
- **Files to read:** `products/simple_dashboard/SKILL.md`, `botplatform/src/bot.ts` (PRODUCT_TYPE routing, line 1247-1265)

### Wave 4 (зависит от Wave 3)

#### Task 4: Submissions API with auto-approve
- **Description:** Добавить в `bounty-api.ts`: POST submission (participant Google auth required; participantId = Google `sub` из server-side session, НЕ из body; proof HTML-encoded + URL scheme validated; 409 при дубликате). GET my-status с lazy auto-approve (48h check, escrow debit, balances credit, `initiatedBy: 'auto-approve'`). POST approve/reject (creator, **обязательная** ownership check: submission.campaignId → campaign.creatorId === req.webUser.userId → 403 если не совпадает). balances.json обновляется атомарно при каждом approve.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** curl — POST → pending; дубликат → 409; approve чужой → 403; XSS probe → `&lt;script&gt;` в ответе; auto-approve с now-49h → approved
- **Files to modify:** `botplatform/src/bounty-api.ts`
- **Files to read:** Task 2, 3 output; `botplatform/src/webchat.ts` (Google OAuth callback, participantId extraction pattern, lines 6039-6041)

#### Task 7: Campaign participant page
- **Description:** Создать базовый `index.html` шаблон: Google auth (Auth SDK), AI-генерируемый фон/стиль, список заданий с наградами, форма сабмита (текст/URL с client-side URL validation), отображение статуса заявки, лидерборд топ-10. JS обращается к `/api/bounty/*` публичным и authenticated endpoints. `GOOGLE_OAUTH_REDIRECT_URI` настроен на `simplebounty.wpmix.net/api/auth/google-dashboard-callback` (зарегистрировать в Google Cloud Console). Creator-предупреждение если escrow=0.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** curl — `curl -H "Host: d{userId}.wpmix.net" http://localhost:8097` → 200, HTML с `<script>` тегами
- **Files to modify:** `products/simple_bounty/index.html.template` (new)
- **Files to read:** `botplatform/src/webchat.ts` (getAuthSdkJs, Auth SDK interface), `products/simple_dashboard/` (UI patterns)

### Wave 5 (зависит от Wave 4)

#### Task 5: Leaderboard API
- **Description:** Добавить `GET /api/bounty/campaigns/:id/leaderboard` (публичный endpoint) в `bounty-api.ts`. Агрегирует approved submissions: sum points per participantId, sort descending, top-10. Ответ содержит только `{participantId, participantName, totalPoints}` — **никакого email** (PII protection). Читает submissions.json напрямую без кэша.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** curl — GET после N approvals → список без `email` поля, упорядочен по убыванию totalPoints
- **Files to modify:** `botplatform/src/bounty-api.ts`
- **Files to read:** Task 4 output (submissions.json structure)

#### Task 8: Telegram notifications
- **Description:** Создать `src/bounty-notifications.ts` с функциями: `notifyNewSubmission`, `notifyAutoApprove`, `notifyEmptyEscrow`. Используют Telegraf bot instance с `SIMPLEBOUNTY_BOT_TOKEN`. Вызываются из bounty-api.ts после ключевых событий (best-effort: try/catch, ошибка не блокирует response). Работают только если `SIMPLEBOUNTY_BOT_TOKEN` задан. Creator's Telegram chatId берётся из их webchat session userId (если создатель зарегистрирован через Telegram-бот, иначе уведомление пропускается).
- **Skill:** code-writing
- **Reviewers:** code-reviewer
- **Verify:** bash — `SIMPLEBOUNTY_BOT_TOKEN=fake node -e "require('./src/bounty-notifications').notifyNewSubmission(123, ...)"` → логирует attempt without crash
- **Files to modify:** `botplatform/src/bounty-notifications.ts` (new), `botplatform/src/bounty-api.ts` (import + calls)
- **Files to read:** `botplatform/src/bot.ts` (Telegraf setup pattern), Task 4 output

### Wave 6 (зависит от Wave 5)

#### Task 9: Creator management panel
- **Description:** Добавить creator-панель в webchat UI (или отдельный `/panel` endpoint): список кампаний, per-campaign submissions с статусом и отображением proof (XSS-safe, HTML-escaped), кнопки Одобрить/Отклонить, индикатор баланса эскроу с badge-предупреждением при balance=0, счётчик pending submissions. Панель использует webchat session (creator).
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** user — creator видит panel badge при pending submissions, approve → поинты начислены, badge исчезает
- **Files to modify:** `botplatform/src/webchat.ts` (или новый panel endpoint в bounty-api.ts)
- **Files to read:** Task 2-8 output; `botplatform/src/webchat.ts` (requireSessionApi, webchat UI render)

### Wave 7 (зависит от Wave 6)

#### Task 10: Unit tests
- **Description:** Написать unit-тесты (автономные, файловая система через моки) для: escrow debit при balance > reward, = reward, < reward; rollback при balance < 0; balances credit accumulation; auto-approve timer (граничный 48h, 47h59m, 49h, 0-escrow); cold-start ENOENT escrow file; duplicate submission block; task delete cascade; leaderboard aggregation (filter/sum/sort/slice); reject flow (status+escrow+balances без изменений).
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** bash — `node tests/test_bounty_unit.js` → 0 failures
- **Files to modify:** `botplatform/tests/test_bounty_unit.js` (new)
- **Files to read:** `botplatform/src/bounty-api.ts`, `botplatform/tests/test_sdk_methods.js` (test pattern)

#### Task 11: Integration tests
- **Description:** Написать HTTP-интеграционные тесты к запущенному simplebounty-web: создание кампании, добавление задания, deposit, submit, approve, reject, полный escrow-цикл до 0, auto-approve с прямой записью submittedAt, GET leaderboard (проверить структуру ответа без email), ownership check (403), дубликат (409), concurrent approve (`Promise.all` 2 approve при balance на 1 → проверить balance >= 0).
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** bash — `node tests/test_bounty_integration.js` → 0 failures
- **Files to modify:** `botplatform/tests/test_bounty_integration.js` (new)
- **Files to read:** `botplatform/tests/test_sdk_methods.js`, Task 2-9 API схема

### Wave 8 (зависит от Wave 7)

#### Task 12: E2E tests
- **Description:** E2E тесты через Chrome CDP (localhost:9222): создатель через webchat API создаёт кампанию → открываем `d{userId}.wpmix.net` → задания видны; участник сабмитит → создатель апрувит → balances обновился; auto-approve (прямая запись в submissions.json) → GET my-status → approved; лидерборд обновился; XSS probe в proof → rendered safe; повторный сабмит → 409.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** bash — `node tests/test_bounty_e2e.js` → 0 failures
- **Files to modify:** `botplatform/tests/test_bounty_e2e.js` (new)
- **Files to read:** `botplatform/tests/test_webchat_flow.py` (E2E pattern), `/root/tools/chrome-daemon/cspy.js`

### Final Wave

#### Task 13: Pre-deploy QA
- **Description:** Запустить полный тест-сьют (unit + integration + E2E), проверить все acceptance criteria из user-spec (AC-1 — AC-14) и tech-spec (TC-1 — TC-14). Зафиксировать результаты.
- **Skill:** pre-deploy-qa
- **Reviewers:** none
- **Verify:** bash — все тесты green
- **Files to modify:** none
- **Files to read:** `work/simple-bounty/user-spec.md`, `work/simple-bounty/tech-spec.md`

#### Task 14: Deploy
- **Description:** Запустить `pm2 start simplebounty-web` на prod (95.217.227.164). Добавить DNS-запись `simplebounty.wpmix.net → 62.109.14.209`. Nginx reload на VM104 и reverse proxy. SSL через certbot для `simplebounty.wpmix.net`. Зарегистрировать redirect URI в Google Cloud Console.
- **Skill:** deploy-pipeline
- **Reviewers:** none
- **Verify:** bash — `curl https://simplebounty.wpmix.net` → 200
- **Files to modify:** `/etc/nginx/sites-enabled/simplebounty.wpmix.net` (symlink), reverse proxy nginx config
- **Files to read:** `botplatform/ecosystem.config.js`, Task 1 nginx config

#### Task 15: Post-deploy verification
- **Description:** Live-верификация через curl на prod: создать кампанию → подать заявку → одобрить → проверить лидерборд. Проверить HTTPS, Google OAuth redirect, Telegram уведомление (если бот настроен).
- **Skill:** post-deploy-qa
- **Reviewers:** none
- **Verify:** curl — все AC из user-spec "Как проверить" (таблица шагов 1-9) пройдены на prod
- **Files to modify:** none
- **Files to read:** `work/simple-bounty/user-spec.md` (Как проверить секция)
