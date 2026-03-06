---
status: done
depends_on: [1]
wave: 2
skills: [code-writing]
verify: bash
reviewers: [code-reviewer, test-reviewer]
teammate_name: coder-tests
---

# Task 2: Тест-файл tests/test_sdk_methods.js

## Required Skills

Перед выполнением задачи загрузи:
- `/skill:code-writing` — [skills/code-writing/SKILL.md](~/.claude/skills/code-writing/SKILL.md)

## Description

Создаём интеграционный тест-файл для всех новых методов SDK. Паттерн взят из `test_webchat_keypair.js` — реальные HTTP запросы к запущенному серверу, получение JWT через Auth API, вызов методов и проверка ответов.

## What to do

1. Изучить паттерн авторизации в `botplatform/tests/test_webchat_keypair.js` — понять как получить JWT
2. Создать `botplatform/tests/test_sdk_methods.js`:
   - Получить JWT для тестового дашборда (userId `9000000000281` или создать временный)
   - Написать хелперы: `apiGet/apiPost/apiPut/apiDelete` с Bearer токеном

3. Реализовать тест-секции:

   **Backward compat** — старые методы работают:
   - POST/GET/PUT/DELETE к `/api/data/test_compat` → ожидаемые ответы

   **Aliases** — новые имена возвращают то же что старые:
   - GET через `list` = GET через `get` (сравнить ответы)
   - POST через `create` → объект с `id`
   - PUT через `update` → обновлённый объект
   - PUT через `patch` → то же что `update`
   - DELETE через `delete` → `{ deleted: id }`

   **getOne**:
   - GET `/api/data/test_getone/{existingId}` → объект (не массив)
   - GET `/api/data/test_getone/nonexistent_id_xyz` → `null`

   **upsert** (через последовательность HTTP запросов):
   - POST к test collection
   - POST снова с тем же keyField → должен обновить (проверить через GET)
   - GET → убедиться что одна запись, не две

   **getMembers** (SDK вызов через браузерный контекст — через eval или проверка endpoint):
   - `GET /api/data/members` → массив
   - Проверить что owner-запись имеет `isOwner: true` (если SDK загружен)

   **removeMember** (owner):
   - Добавить тестовую запись в members
   - Вызвать removeMember → запись удалена из members
   - Non-owner: вызов → Error (можно протестировать через прямой JS eval или заглушку)

4. Очищать тестовые данные после каждого теста (`DELETE /api/data/test_*` без itemId = clear collection)

## TDD Anchor

Тест-файл IS тест. Запустить после создания:
- `node tests/test_sdk_methods.js` — все тесты зелёные

## Acceptance Criteria

- [ ] `node tests/test_sdk_methods.js` завершается успешно (exit code 0)
- [ ] Тест проверяет: все aliases, getOne (found + not found), upsert (create + update), backward compat
- [ ] Тест очищает тестовые данные после завершения
- [ ] Нет hardcoded секретов в тест-файле

## Context Files

- [user-spec.md](../user-spec.md)
- [tech-spec.md](../tech-spec.md)
- `botplatform/tests/test_webchat_keypair.js` — паттерн авторизации и HTTP вызовов
- `botplatform/src/webchat.ts` lines 748–772 — SDK методы (что тестируем)
- `botplatform/src/webchat.ts` lines 4242–4282 — backend handler (что вызывается)

## Verification Steps

- Шаг 1: `cd /root/aisell/botplatform && node tests/test_sdk_methods.js`
- Шаг 2: Ожидаем все тесты зелёные, exit code 0
- Шаг 3: `node tests/test_webchat_keypair.js` — убедиться что backward compat не сломан

## Details

**Files:** `botplatform/tests/test_sdk_methods.js` (новый файл)

**Dependencies:** Task 1 должна быть выполнена (методы существуют в SDK)

**Edge cases:**
- Тестовый дашборд может не иметь `members` collection — создать тестовую запись перед тестом getMembers
- Rate limiter — не делать слишком много запросов подряд, вставить небольшие паузы если нужно
- `upsert` тестируется через последовательные HTTP запросы: POST → POST с тем же ключом → GET → проверить 1 запись

## Reviewers

- **code-reviewer** → `logs/working/task-2/code-reviewer-{round}.json`
- **test-reviewer** → `logs/working/task-2/test-reviewer-{round}.json`

## Post-completion

- [ ] Записать краткий отчёт в decisions.md
