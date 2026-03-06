---
created: 2026-03-06
status: draft
branch: main
size: M
---

# Tech Spec: SD SDK — индустриальные методы и алиасы

## Solution

Расширяем `window.SD` в `getAuthSdkJs()` (`botplatform/src/webchat.ts`) добавлением алиасов и новых методов без изменения существующих. Параллельно добавляем один backend-хук для `getOne` в существующем GET-handler'е `/api/data/`. Все изменения backward-compatible.

## Architecture

### What we're building/modifying

- **`getAuthSdkJs()` в `webchat.ts` (~line 748–769)** — добавляем методы в `SD.data` и `SD.admin` объекты внутри строкового JS
- **GET handler `/api/data/` в `webchat.ts` (~line 4242)** — расширяем существующий GET-блок для поддержки `itemId`
- **`tests/test_sdk_methods.js`** — новый тест-файл для всех новых методов
- **`products/simple_dashboard/SKILL.md`** — обновляем API reference и паттерны
- **`botplatform/group_data/user_9000000000281/index.html`** — фиксируем getMembers/removeMember на новые методы

### How it works

```
Browser (d{N}.wpmix.net)                 simpledashboard-web (:8094)
  SDK: SD.data.create('tasks', data)
    → alias → SD.data.post('tasks', data)
      → POST /api/data/tasks              → webchat.ts: POST handler
        ← { id: 'abc', ...data }

  SDK: SD.data.getOne('tasks', 'abc')
    → GET /api/data/tasks/abc            → webchat.ts: GET handler (itemId branch)
        ← { id: 'abc', ...data } | null

  SDK: SD.data.upsert('members', 'email', data)
    → SD.data.get('members')             → GET /api/data/members
      → find by email
      → SD.data.put/post                 → PUT|POST /api/data/members/...

  SDK: SD.admin.getMembers()
    → SD.data.get('members')             → GET /api/data/members
      → map: добавить isOwner если email совпадает

  SDK: SD.admin.removeMember(email)
    → guard: if (!SD.isOwner()) throw
    → SD.data.get('members') → find → SD.data.del(id)
    → SD.admin.revokeAccess(email)       → DELETE /api/auth/admin/access
```

## Decisions

### Decision 1: Алиасы vs переименование
**Decision:** Добавляем алиасы поверх существующих методов, старые имена не трогаем
**Rationale:** Дашборды в `group_data/` используют `SD.data.get/post/put/del` — ломать их нельзя
**Alternatives considered:** Переименование + deprecated shim — сложнее, риск регрессий

### Decision 2: upsert клиентский vs серверный
**Decision:** Клиентский upsert: `GET` → find → `PUT|POST`
**Rationale:** Для MVP достаточно — один owner пишет в коллекцию, race condition маловероятен
**Alternatives considered:** Server-side `POST /api/data/{col}?upsertBy=key` — атомарен, без race condition, но требует больше изменений backend; отложено в v2

### Decision 3: getMembers — один источник
**Decision:** `SD.admin.getMembers()` = `SD.data.get('members')` + добавить `isOwner` флаг
**Rationale:** Если дашборд регистрирует пользователей в `sd:auth` (паттерн SKILL.md), `members` collection — единственный источник. `getUsers()` не нужен для merge
**Alternatives considered:** Merge auth `getUsers()` + members data — сложнее, требует нормализации email, избыточен

### Decision 4: getOne возвращает null vs 404
**Decision:** Backend возвращает `200 + null` если не найден
**Rationale:** SDK-level семантика: `getOne` возвращает `T | null`, а не бросает исключение. Это паттерн PocketBase/AppWrite
**Alternatives considered:** 404 → проще на backend, но клиент должен обрабатывать exception — лишний `try/catch` в каждом дашборде

### Decision 5: removeMember — порядок операций
**Decision:** Сначала `SD.data.del` из members, потом `revokeAccess`
**Rationale:** Если `del` упал — пользователь остаётся в members, видит ошибку, может повторить (запись цела). Если `revokeAccess` упал — запись удалена, но доступ остался; повторный вызов graceful (нет в members → skip del, всё равно revokeAccess)

## Data Models

Нет новых моделей. SDK использует существующие JSON файлы:

```
group_data/user_{USERID}/data/{collection}.json  →  [{ id: string, ...fields }]
```

`upsert` не меняет формат данных — `id` всегда строка, генерируется backend'ом при POST.

## Dependencies

### New packages
Нет

### Using existing (from project)
- `SD.data.get/post/put/del` — алиасы и upsert построены поверх них
- `SD.admin.revokeAccess(email)` — используется в `removeMember`
- `SD.isOwner()`, `SD.getUser()` — client-side guards и isOwner флаг
- `authHeaders()` — JWT bearer для `getOne` fetch

## Testing Strategy

**Feature size:** M

### Unit tests
Все через `tests/test_sdk_methods.js` — HTTP-тесты против реального запущенного сервера (паттерн как в `test_webchat_keypair.js`):

- `SD.data.list('col')` = ответ `SD.data.get('col')`
- `SD.data.create('col', data)` → возвращает объект с `id`
- `SD.data.update('col', id, data)` → возвращает обновлённый объект
- `SD.data.patch('col', id, data)` → то же что update
- `SD.data.delete('col', id)` → `{ deleted: id }`
- `SD.data.getOne('col', existingId)` → объект (не массив)
- `SD.data.getOne('col', 'nonexistent')` → null
- `SD.data.upsert('col', 'email', data)` — первый вызов: create; второй с тем же email: update
- Backward compat: `get/post/put/del` работают как раньше
- `SD.admin.getMembers()` → массив с isOwner для owner-записи
- `SD.admin.removeMember(email)` → запись удалена из members
- `SD.admin.removeMember(email)` non-owner → Error

### Integration tests
Нет отдельных — `test_sdk_methods.js` фактически интеграционный (real HTTP).

### E2E tests
Нет — ручная проверка dashboard 9000000000281 (см. "Как проверить").

## Agent Verification Plan

**Source:** user-spec "Как проверить".

### Verification approach
После деплоя: запустить `test_sdk_methods.js`, проверить логи, убедиться что dashboard 281 работает.

### Per-task verification

| Task | Verify | What to check |
|------|--------|--------------|
| 1 (webchat.ts) | bash | `npm run build` без ошибок TypeScript |
| 2 (тесты) | bash | `node tests/test_sdk_methods.js` — все зелёные |
| 3 (SKILL.md + 281) | user | `d9000000000281.wpmix.net` — список участников и удаление работают |
| 4 (QA) | bash | все тесты + `timeout 10s pm2 logs simpledashboard-web --lines 30 --nostream` без ошибок |
| 5 (deploy) | bash | PM2 рестарт, нет ошибок в логах |
| 6 (post-deploy) | curl | `GET /api/data/members/{id}` → объект, не массив |

### Tools required
- bash (тесты, pm2 logs)
- curl (ручная проверка getOne backend)

## Risks

| Risk | Mitigation |
|------|-----------|
| upsert race condition (GET → POST параллельно) | MVP допустимо; один owner; v2 — server-side atomic |
| `SD.data.delete` теперь существует — конфликт с `del` не возникает, но автодополнение IDE предложит оба | Задокументировать в SKILL.md: `delete` — основной, `del` — deprecated |
| getOne backend возвращает `null` с HTTP 200 — нестандартно | Это SDK-уровень; внутренний endpoint; зафиксировано в тесте |
| removeMember: del OK + revokeAccess 500 — частичный успех | throw + graceful retry; зафиксировано в тесте |

## Acceptance Criteria

- [ ] Все 12 тестов в `test_sdk_methods.js` проходят
- [ ] Backward compat: существующие тесты (`test_webchat_keypair.js`, `test_auth_api.js`) не падают
- [ ] `GET /api/data/{col}/{id}` возвращает `200 + null` если не найден (не 404)
- [ ] `SD.admin.removeMember` от non-owner бросает `Error` (не возвращает Promise.reject)
- [ ] Нет console.log с секретами (хук проверяет)
- [ ] `npm run build` без ошибок TypeScript
- [ ] Dashboard 9000000000281: список участников и удаление работают без ошибок

## Implementation Tasks

### Wave 1 (независимые)

#### Task 1: Расширить webchat.ts — SDK методы + backend handler
- **Description:** Все изменения в `botplatform/src/webchat.ts`. 1) В `getAuthSdkJs()` расширить `SD.data` пятью алиасами (`list`, `create`, `update`, `patch`, `delete`), `getOne` (fetch к `/api/data/{col}/{id}`, возвращает объект или `null`) и `upsert` (get → find by keyField → put or post). 2) В `SD.admin` добавить `getMembers()` (get members + добавить `isOwner: true` для owner) и `removeMember(email)` (guard isOwner → del → revokeAccess). 3) В GET handler `/api/data/`: если `itemId` задан → найти по id → `res.json(item ?? null)`. Результат: все новые методы работают, `npm run build` без ошибок.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** bash — `npm run build` без ошибок TypeScript
- **Files to modify:** `botplatform/src/webchat.ts`
- **Files to read:** `botplatform/src/webchat.ts` (SD.data object ~line 748, SD.admin ~line 762, GET handler ~line 4242)

### Wave 2 (зависит от Wave 1)

#### Task 2: Тест-файл tests/test_sdk_methods.js
- **Description:** Создать `botplatform/tests/test_sdk_methods.js` — интеграционные тесты всех новых методов через реальный HTTP. Паттерн: как `test_webchat_keypair.js` (получить JWT → вызвать методы → проверить ответы). Тесты: aliases, getOne (found + not found), upsert (create + update), getMembers (isOwner flag), removeMember (success + non-owner error), backward compat (`get/post/put/del`). Результат: `node tests/test_sdk_methods.js` зелёный.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** bash — `node tests/test_sdk_methods.js`
- **Files to modify:** `botplatform/tests/test_sdk_methods.js` (новый файл)
- **Files to read:** `botplatform/tests/test_webchat_keypair.js` (паттерн)

#### Task 3: SKILL.md + dashboard 281 fix
- **Description:** 1) В `products/simple_dashboard/SKILL.md` обновить секцию SD API: новые методы как основные (`list/create/update/delete/getOne/upsert/getMembers/removeMember`), старые (`get/post/put/del`) пометить deprecated. Убрать ⚠️ предупреждение о несуществующих методах. 2) В `botplatform/group_data/user_9000000000281/index.html` заменить вызовы на новые методы: `SD.admin.getMembers()` вместо `SD.data.get('members')` в loadMembers, `SD.admin.removeMember(email)` вместо ручного del+revoke. Результат: SKILL.md актуален, dashboard 281 работает.
- **Skill:** code-writing
- **Reviewers:** code-reviewer
- **Verify:** user — открыть d9000000000281.wpmix.net, список участников виден, удаление работает без ошибки
- **Files to modify:** `products/simple_dashboard/SKILL.md`, `botplatform/group_data/user_9000000000281/index.html`
- **Files to read:** `products/simple_dashboard/SKILL.md`, `botplatform/group_data/user_9000000000281/index.html`

### Final Wave

#### Task 4: Pre-deploy QA
- **Description:** Acceptance testing: `npm run build`, `node tests/test_sdk_methods.js`, `node tests/test_webchat_keypair.js`, `node tests/test_auth_api.js`. Verify все критерии приёмки из user-spec и tech-spec.
- **Skill:** pre-deploy-qa
- **Reviewers:** none

#### Task 5: Deploy
- **Description:** `cd /root/aisell/botplatform && npm run build && pm2 restart simpledashboard-web --update-env`. Проверить `timeout 10s pm2 logs simpledashboard-web --lines 30 --nostream` — нет ошибок.
- **Skill:** deploy-pipeline
- **Reviewers:** none

#### Task 6: Post-deploy verification
- **Description:** Проверить на живом окружении: `d9000000000281.wpmix.net` — список участников загружается, удаление работает. curl getOne endpoint.
- **Skill:** post-deploy-qa
- **Reviewers:** none
