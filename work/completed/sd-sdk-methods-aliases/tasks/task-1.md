---
status: done
depends_on: []
wave: 1
skills: [code-writing]
verify: bash
reviewers: [code-reviewer, security-auditor, test-reviewer]
teammate_name: coder-webchat
---

# Task 1: Расширить webchat.ts — SDK методы + backend handler

## Required Skills

Перед выполнением задачи загрузи:
- `/skill:code-writing` — [skills/code-writing/SKILL.md](~/.claude/skills/code-writing/SKILL.md)

## Description

Добавляем новые методы в `window.SD` клиентский SDK (генерируется в `getAuthSdkJs()`) и расширяем backend GET handler для поддержки одного элемента.

**Все изменения в одном файле:** `botplatform/src/webchat.ts`.

SDK изменения (в строковом JS внутри `getAuthSdkJs()`):
- `SD.data`: 5 алиасов + `getOne` + `upsert`
- `SD.admin`: `getMembers` + `removeMember`

Backend изменение (~line 4242):
- GET handler: если `itemId` задан → вернуть один элемент или `null`

## What to do

1. Найти объект `SD.data` в `getAuthSdkJs()` (~line 748) — добавить после `del`:
   - `list(collection)` → alias для `get`
   - `create(collection, item)` → alias для `post`
   - `update(collection, id, item)` → alias для `put`
   - `patch(collection, id, item)` → alias для `put`
   - `delete(collection, id)` → alias для `del`
   - `getOne(collection, id)` → `fetch('/api/data/' + col + '/' + id, authHeaders)` → `r.ok ? r.json() : Promise.resolve(null)`
   - `upsert(collection, keyField, data)` → `SD.data.get(col)` → find where `item[keyField] === data[keyField]` → if found: `SD.data.put(col, found.id, data)` else `SD.data.post(col, data)`

2. Найти объект `SD.admin` (~line 762) — добавить после `revokeAccess`:
   - `getMembers()` → `SD.data.get('members')` → `.then(members => members.map(m => m.email === SD.getUser()?.email && SD.isOwner() ? Object.assign({}, m, {isOwner: true}) : m))`
   - `removeMember(email)` → guard `if (!SD.isOwner()) throw new Error('SD.admin methods require owner access')` → `SD.data.get('members')` → find by email → `del` if found → `SD.admin.revokeAccess(email)`

3. Найти GET handler (`req.method === 'GET'`) в `/api/data/` блоке (~line 4242) — разбить на две ветки:
   ```
   if (req.method === 'GET') {
     if (itemId) {
       const item = readCollection().find(i => i.id === itemId) ?? null;
       res.json(item);
       return;
     }
     res.json(readCollection());
     return;
   }
   ```

## TDD Anchor

Тесты пишем в `tests/test_sdk_methods.js` (Task 2), но убедиться что build проходит:

- `npm run build` — должно компилироваться без ошибок TypeScript

## Acceptance Criteria

- [ ] `SD.data.list`, `create`, `update`, `patch`, `delete` существуют и являются функциями
- [ ] `SD.data.getOne('col', id)` возвращает Promise (тип функция)
- [ ] `SD.data.upsert('col', 'email', data)` возвращает Promise (тип функция)
- [ ] `SD.admin.getMembers()` существует и является функцией
- [ ] `SD.admin.removeMember(email)` существует и является функцией
- [ ] `GET /api/data/{col}/{id}` возвращает один объект или `null`, не массив
- [ ] `npm run build` без ошибок TypeScript
- [ ] Старые методы `get/post/put/del` и `getUsers/revokeAccess` не затронуты

## Context Files

- [user-spec.md](../user-spec.md)
- [tech-spec.md](../tech-spec.md)
- `botplatform/src/webchat.ts` lines 748–772 (SD.data + SD.admin объекты)
- `botplatform/src/webchat.ts` lines 4242–4244 (GET handler)

## Verification Steps

- Шаг 1: `cd /root/aisell/botplatform && npm run build` → должно завершиться без ошибок
- Шаг 2: `timeout 5s pm2 logs simpledashboard-web --lines 10 --nostream` → нет crash/error

## Details

**Files:**
- `botplatform/src/webchat.ts` — вся работа здесь

**Edge cases:**
- `getOne` — если fetch вернул 404 (нет элемента), backend возвращает `null` с HTTP 200, не выбрасывать exception
- `upsert` — если `data[keyField]` === undefined → create (нет ключа для поиска)
- `upsert` — если несколько записей с одним keyField → update первой найденной
- `removeMember` — если email не найден в members → всё равно вызвать `revokeAccess` (graceful)
- `removeMember` — если `revokeAccess` вернул ошибку → throw (частичный успех недопустим)

**Implementation hints:**
- SDK генерируется как строка JS — весь код внутри `getAuthSdkJs()` является обычным JavaScript (без TypeScript типов)
- Отступы внутри строки JS: смотри существующий код (tab + spaces или spaces — следуй существующему стилю)
- `authHeaders()` уже определён выше в SDK — использовать для `getOne` fetch
- `dashboardId` и `AUTH_API` уже доступны как переменные в closure

## Reviewers

- **code-reviewer** → `logs/working/task-1/code-reviewer-{round}.json`
- **security-auditor** → `logs/working/task-1/security-auditor-{round}.json`
- **test-reviewer** → `logs/working/task-1/test-reviewer-{round}.json`

## Post-completion

- [ ] Записать краткий отчёт в decisions.md
- [ ] Если отклонились от спека — описать отклонение и причину
