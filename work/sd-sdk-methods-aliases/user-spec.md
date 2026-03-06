---
created: 2026-03-06
status: approved
type: feature
size: M
---

# User Spec: SD SDK — индустриальные методы и алиасы

## Что делаем

Расширяем `window.SD` клиентский SDK индустриально-стандартными именами методов и двумя новыми возможностями: `getOne` (получить одну запись) и `upsert` (идемпотентный create-or-update). Добавляем `SD.admin.getMembers()` и `SD.admin.removeMember()` для управления участниками дашборда.

## Зачем

Claude-агент, генерирующий код дашбордов, обучен на паттернах Supabase/PocketBase/AppWrite и пишет `SD.data.create()`, `SD.data.update()`, `SD.data.delete()`, `SD.data.getOne()` — методов с такими именами в SDK нет, результат — RuntimeError в браузере. Конкретный случай: dashboard 9000000000281 — ошибка "Ошибка при удалении" из-за несуществующего `SD.data.delete`. Все крупные BaaS используют семантические имена (create/update/delete), а не HTTP-глаголы (post/put/del) на уровне SDK.

## Как должно работать

### Алиасы (backward compatible)

Новые имена — полные синонимы старых. Старые методы остаются:

```javascript
// Новые имена (основные в SKILL.md)          Старые имена (остаются)
SD.data.list('tasks')                       // = SD.data.get('tasks')
SD.data.create('tasks', { name: 'Fix' })   // = SD.data.post('tasks', {...})
SD.data.update('tasks', id, { done: true })// = SD.data.put('tasks', id, {...})
SD.data.patch('tasks', id, { done: true }) // = SD.data.put('tasks', id, {...})
SD.data.delete('tasks', id)                // = SD.data.del('tasks', id)
```

### SD.data.getOne(collection, id)

Возвращает один объект или `null`. Сейчас нет, все BaaS имеют:

```javascript
// Вместо:
const items = await SD.data.get('tasks');
const task = items.find(i => i.id === taskId);

// Теперь:
const task = await SD.data.getOne('tasks', taskId); // null если не найден
```

### SD.data.upsert(collection, keyField, data)

Идемпотентный create-or-update по произвольному полю. Убирает самый частый повторяющийся паттерн:

```javascript
// Вместо (текущий паттерн из SKILL.md — 5 строк + race condition):
var existing = await SD.data.get('members');
var found = existing.find(m => m.email === user.email);
if (found) {
  await SD.data.put('members', found.id, { ...found, lastSeen: new Date() });
} else {
  await SD.data.post('members', { email: user.email, lastSeen: new Date() });
}

// Теперь (1 строка):
await SD.data.upsert('members', 'email', { email: user.email, lastSeen: new Date() });
```

Логика: найти запись где `record[keyField] === data[keyField]` → если найдена: update, иначе create.

Поведение граничных случаев:
- Если `keyField` отсутствует в `data` → create новой записи (нет ключа для поиска совпадения)
- Если несколько записей с одинаковым `keyField` → update первой найденной

### SD.admin.getMembers()

Возвращает `SD.data.get('members')`, обогащая запись текущего пользователя флагом `isOwner`. Единственный источник данных — `members` collection, куда дашборд регистрирует каждого пользователя при логине (паттерн из SKILL.md):

```javascript
// Все пользователи получают один и тот же список из members collection:
[
  { email: 'alice@example.com', name: 'Alice', isOwner: true,  id: 'abc123' },
  { email: 'bob@example.com',   name: 'Bob',   isOwner: false, joinedAt: '...', id: 'xyz456' }
]
// isOwner: true добавляется для записи с email текущего пользователя (SD.getUser().email)
// если SD.isOwner() === true
```

### SD.admin.removeMember(email)

Owner-only. Атомарно: удаляет запись из `SD.data('members')` по email + вызывает `SD.admin.revokeAccess(email)`:

```javascript
await SD.admin.removeMember('bob@example.com');
// 1. SD.data.get('members') → find by email → SD.data.del(id)
// 2. SD.admin.revokeAccess('bob@example.com')
// Non-owner → throw Error('SD.admin methods require owner access')
```

## Критерии приёмки

- [ ] `SD.data.list('col')` возвращает то же что `SD.data.get('col')`
- [ ] `SD.data.create('col', data)` возвращает созданный объект с `id`
- [ ] `SD.data.update('col', id, data)` возвращает обновлённый объект
- [ ] `SD.data.patch('col', id, data)` возвращает то же что `update`
- [ ] `SD.data.delete('col', id)` возвращает `{ deleted: id }`
- [ ] `SD.data.getOne('col', existingId)` возвращает один объект (не массив)
- [ ] `SD.data.getOne('col', missingId)` возвращает `null`
- [ ] `SD.data.upsert('members', 'email', data)` при совпадении email → update существующей записи
- [ ] `SD.data.upsert('members', 'email', data)` при отсутствии email → create новой записи
- [ ] `SD.admin.getMembers()` возвращает `SD.data.get('members')` с добавленным `isOwner: true` для текущего пользователя-owner
- [ ] `SD.admin.removeMember(email)` удаляет из members collection И отзывает доступ
- [ ] `SD.admin.removeMember(email)` от non-owner бросает `Error` с понятным сообщением
- [ ] `SD.admin.removeMember(email)` когда email не найден в members collection → всё равно вызывает `revokeAccess` (graceful)
- [ ] Старые методы `get/post/put/del` продолжают работать без изменений
- [ ] SKILL.md обновлён: новые имена как основные, старые помечены как deprecated

## Ограничения

- Основные изменения в клиентском SDK (`getAuthSdkJs()` в `webchat.ts`); backend: минимальное расширение существующего data-handler для поддержки `getOne`
- Никаких внешних BaaS: Supabase засыпает на free tier, PocketBase требует auth bridging
- `upsert` реализуется клиентски — не атомарен, допустимо для MVP (один владелец пишет в коллекцию)
- Порядок операций в `removeMember`: сначала `del` из members, затем `revokeAccess`

## Риски

- **Upsert race condition:** GET + conditional POST/PUT не атомарен. **Митигация:** для MVP допустимо — один пользователь пишет в коллекцию; server-side atomic upsert — в v2.
- **getMembers пустой при первом входе:** если дашборд не регистрирует пользователя в `members` на `sd:auth` — список будет пуст. **Митигация:** SKILL.md показывает паттерн регистрации как обязательный при `sd:auth`.
- **removeMember частичный успех:** `del` OK, `revokeAccess` 500 — запись удалена, доступ остался. **Митигация:** `throw` на ошибке; повторный `removeMember` пройдёт gracefully (нет в members → skip del, всё равно revokeAccess).

## Технические решения

- Мы решили **добавлять алиасы, а не переименовывать**, потому что сломать существующие дашборды недопустимо.
- Мы решили **добавить backend endpoint для `getOne`**, потому что тянуть всю коллекцию ради одного элемента неэффективно.
- Мы решили **использовать `SD.data('members')` как единственный источник** для `getMembers`, потому что auth `getUsers()` — это технический список доступа, а `members` — бизнес-данные о людях; если дашборд регистрирует пользователя в `sd:auth`, оба списка совпадают.
- Мы решили **не использовать внешние BaaS**, потому что Supabase засыпает после 7 дней неактивности (hard blocker для продакшена).
- Мы решили **не добавлять realtime/subscriptions**, потому что текущие дашборды не требуют live-данных — `setInterval` достаточно.
- Мы решили **не добавлять server-side query/filter API**, потому что коллекции малые (<1000 записей) — client-side `Array.filter()` достаточно.
- Мы решили **добавить `SD.data.patch` как alias для `update`**, потому что HTTP-знакомые разработчики ожидают `patch` для partial update.
- Мы решили **не добавлять `SD.request`**, потому что для внешних запросов уже есть `/api/fetch` proxy endpoint — дублирование не нужно.

## Тестирование

**Unit-тесты:** делаются всегда.

**Интеграционные тесты:** делаем — новый файл `tests/test_sdk_methods.js`, тестирует каждый новый метод через реальный HTTP + проверяет backward compat старых имён.

**E2E тесты:** не делаем — достаточно ручной проверки dashboard 9000000000281.

## Как проверить

### Агент проверяет

| Шаг | Инструмент | Ожидаемый результат |
|-----|-----------|-------------------|
| 1. Собрать и перезапустить | `npm run build && pm2 restart simpledashboard-web` | Без ошибок |
| 2. Запустить автотесты | `node tests/test_sdk_methods.js` | Все тесты зелёные |
| 3. Проверить backward compat | `get/post/put/del` в тесте | Работают как раньше |

### Пользователь проверяет

- Открыть `d9000000000281.wpmix.net` как owner → список участников отображается
- Нажать удалить участника → удаление проходит без ошибки "Ошибка при удалении"
- Попытаться зайти удалённым аккаунтом → получить `no_access`
