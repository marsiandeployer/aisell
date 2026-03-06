---
status: done
depends_on: [1]
wave: 2
skills: [code-writing]
verify: user
reviewers: [code-reviewer]
teammate_name: coder-docs
---

# Task 3: SKILL.md обновление + dashboard 281 fix + уникальность в sd:auth

## Required Skills

Перед выполнением задачи загрузи:
- `/skill:code-writing` — [skills/code-writing/SKILL.md](~/.claude/skills/code-writing/SKILL.md)

## Description

Два файла:

1. **SKILL.md** — обновить API reference на новые методы, исправить паттерн `sd:auth` чтобы использовал `upsert` вместо ручного GET+find+POST (устраняет дублирование участников при повторном логине).

2. **dashboard 9000000000281/index.html** — заменить сломанные вызовы на новые SDK методы.

**Важное пожелание пользователя:** Сейчас при повторном логине пользователь дублируется в коллекции `members`. Исправить паттерн в SKILL.md: вместо `SD.data.post('members', {...})` использовать `SD.data.upsert('members', 'email', {...})` — это гарантирует уникальность по email.

## What to do

### SKILL.md

1. Найти секцию SD API (методы данных) — обновить таблицу:
   - Добавить новые методы как **основные**: `list`, `create`, `update`, `patch`, `delete`, `getOne`, `upsert`
   - Помечать старые (`get`, `post`, `put`, `del`) как `(deprecated)`
   - Добавить `SD.admin.getMembers()` и `SD.admin.removeMember(email)` в admin секцию

2. Найти паттерн `sd:auth` (пример регистрации пользователя при логине) — ИСПРАВИТЬ:
   ```javascript
   // БЫЛО (дублирует при повторном логине):
   window.addEventListener('sd:auth', async function(e) {
     var user = e.detail;
     if (!user) return;
     var members = await SD.data.get('members');
     var exists = members.some(m => m.email === user.email);
     if (!exists) await SD.data.post('members', { email: user.email, name: user.name });
   });

   // СТАЛО (upsert — нет дублей):
   window.addEventListener('sd:auth', async function(e) {
     var user = e.detail;
     if (!user) return;
     await SD.data.upsert('members', 'email', { email: user.email, name: user.name, lastSeen: new Date().toISOString() });
   });
   ```

3. Убрать ⚠️ предупреждение о несуществующих методах (`patch`, `delete`, `getMembers`) — они теперь есть

4. Добавить примеры для `getOne` и `upsert` в секцию примеров

5. Добавить `getMembers` и `removeMember` в секцию управления участниками (owner patterns)

### dashboard 9000000000281/index.html

1. Найти функцию `loadMembers()` — если использует `SD.data.get('members')` напрямую: заменить на `SD.admin.getMembers()` для автоматического добавления isOwner флага

2. Найти функцию удаления участника (`deleteMember` или аналог) — заменить на `SD.admin.removeMember(email)`

3. Найти регистрацию в `sd:auth` — заменить `SD.data.post` на `SD.data.upsert('members', 'email', {...})`

## TDD Anchor

Нет автоматических тестов для документации. Верификация ручная.

## Acceptance Criteria

- [ ] SKILL.md: новые методы (`list`, `create`, `update`, `patch`, `delete`, `getOne`, `upsert`) задокументированы
- [ ] SKILL.md: `SD.admin.getMembers()` и `SD.admin.removeMember()` задокументированы
- [ ] SKILL.md: паттерн `sd:auth` использует `SD.data.upsert` (не `post`) — нет дублирования
- [ ] SKILL.md: старые методы помечены deprecated
- [ ] SKILL.md: ⚠️ предупреждение о несуществующих методах убрано
- [ ] dashboard 281: список участников загружается без ошибок
- [ ] dashboard 281: удаление участника работает без ошибки "Ошибка при удалении"
- [ ] dashboard 281: повторный логин не дублирует запись в members (upsert)

## Context Files

- [user-spec.md](../user-spec.md)
- [tech-spec.md](../tech-spec.md)
- `products/simple_dashboard/SKILL.md` — текущая SD API документация
- `botplatform/group_data/user_9000000000281/index.html` — дашборд с ошибками

## Verification Steps

- Шаг 1: Открыть `https://d9000000000281.wpmix.net` как owner
- Шаг 2: Список участников должен отображаться (не пустой)
- Шаг 3: Нажать удалить участника → нет ошибки "Ошибка при удалении"
- Шаг 4: Зайти повторно тем же аккаунтом → в списке одна запись, не две

## Details

**Files:**
- `products/simple_dashboard/SKILL.md`
- `botplatform/group_data/user_9000000000281/index.html`

**Edge cases:**
- Если в index.html уже есть `sd:auth` с `upsert` (из предыдущего фикса) — не дублировать, только проверить корректность
- `SD.admin.removeMember` требует email пользователя — убедиться что он передаётся корректно
- `SD.admin.getMembers()` — доступен всем (не только owner), но `isOwner: true` добавляется только для owner-записи

## Reviewers

- **code-reviewer** → `logs/working/task-3/code-reviewer-{round}.json`

## Post-completion

- [ ] Записать краткий отчёт в decisions.md
