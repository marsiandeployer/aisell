---
feature: multi-user-dashboard-access
type: feature
status: approved
created: 2026-03-03
size: L
product: SimpleDashboard
---

# User Spec: Multi-User Dashboard Access (Guest Mode)

## Зачем

Владелец дашборда хочет показать его сотрудникам, партнёрам, клиентам — с любого устройства, без Chrome Extension. Сейчас нет варианта «смотреть без расширения»: дашборд либо публичен, либо требует Extension.

Дополнительная проблема: слать гостя на `simpledashboard.wpmix.net` нельзя — там webchat предлагает создать свой дашборд, что путает.

**Решение:** встроить auth-виджет прямо в `d{userId}.wpmix.net`. Гость логинится через Google прямо на странице дашборда. Webchat остаётся только для владельца.

---

## Персоны

| Персона | Контекст | Устройство |
|---------|----------|------------|
| **Владелец** | Создаёт дашборд в webchat, контролирует доступ | Desktop + Chrome Extension |
| **Гость** | Получил ссылку, хочет видеть/взаимодействовать с дашбордом | Любой браузер, любое устройство |

---

## Что делаем

### Для владельца (в `/profile`)
- Секция «Поделиться дашбордом»: кнопка создать invite-ссылку → URL для копирования
- Кнопка «Отозвать ссылку» — старый токен становится невалидным
- Список email-адресов гостей, получивших доступ

### Для гостей (на `d{userId}.wpmix.net`)
- Auth-виджет, инжектируемый сервером поверх дашборда (blur фон)
- Google OAuth кнопка + email-fallback
- После входа — blur снимается, гость видит и взаимодействует с данными
- Нет webchat, нет Profile link, нет «Back to chat»

---

## Как должно работать

### Первый визит гостя по invite-ссылке

```
d123.wpmix.net?invite=TOKEN
        ↓
Сервер видит ?invite=TOKEN, сохраняет в sessionStorage
        ↓
Auth-виджет: "Войти через Google"
        ↓
OAuth redirect → Google
        ↓
Google → simpledashboard.wpmix.net/api/auth/google-dashboard-callback
              ?redirect_to=d123.wpmix.net&invite=TOKEN
        ↓
simpledashboard-web обрабатывает callback:
  1. Находит/создаёт WebUser (email, name)
  2. Если нет keypair в PG → генерирует Ethereum keypair server-side
     → POST /api/auth/register (INTERNAL_API_KEY)
     → адрес сохраняется в ChatSettings
  3. Проверяет invite-токен → если валидный:
     → POST /api/auth/share (INTERNAL_API_KEY)
     → гость добавлен в dashboard_access
  4. Подписывает challenge server-side ключом гостя
     → POST /api/auth/login → получает dashboard JWT
  5. Генерирует одноразовый ml-токен → кладёт в magicLinkTokens
        ↓
HTTP 302 → https://d123.wpmix.net?ml=ML_TOKEN
        ↓
Уже существующий инжектированный скрипт на d123.wpmix.net:
  GET /api/auth/ml?token=ML_TOKEN → JWT → sessionStorage.dashboard_jwt
        ↓
Blur снят, виджет скрыт, дашборд доступен
```

**Ключевые архитектурные решения:**
- OAuth callback обрабатывается на `simpledashboard.wpmix.net` (один зарегистрированный redirect_uri), затем пользователь перекидывается на дашборд через `?ml=TOKEN`
- JWT передаётся через `?ml=TOKEN` → существующий magic link механизм. `sessionStorage` разные у разных доменов — напрямую передать нельзя
- Keypair генерируется и хранится на сервере. Сервер подписывает challenge от имени гостя. Гость не знает о Ethereum, Extension не нужен.

### Возвращающийся гость

```
d123.wpmix.net (без invite)
        ↓
Webchat-сервер видит webchat_session cookie (жива)
        ↓
Проверяет dashboard_access → есть запись → подписывает challenge server-side
        ↓
JWT → dashboard_jwt → blur снят без виджета
```

### Гость с существующим keypair (уже регистрировался)

```
Открывает любой дашборд, нажимает Google OAuth
        ↓
Сервер находит email в PG users → keypair уже есть → пропускает регистрацию
        ↓
Проверяет dashboard_access → если есть → JWT → доступ
        ↓
Если нет → но invite-токен в sessionStorage валидный → добавляет в dashboard_access → JWT
        ↓
Если нет ни того ни другого → overlay no-access
```

**Гость никогда не видит и не вводит приватный ключ.** Ключ хранится на сервере. Если данные потеряны (PG, бэкап) — поддержка.

### Invite-ссылка

- Открытая: любой кто перейдёт по `?invite=TOKEN` может зарегистрироваться и получить доступ
- Один активный токен на дашборд (новый вызов перезаписывает старый в invite Map)
- Без TTL — живёт до отзыва владельцем
- Хранится in-memory (Map `{ dashboardUserId → token }`) + сохраняется на диск (`data/webchat/invites.json`) чтобы пережить рестарт

---

## Критерии приёмки

### Invite-ссылка
- [ ] `POST /api/auth/invite` (requireSessionApi) возвращает `{ url: "https://d{userId}.wpmix.net?invite=TOKEN" }` → HTTP 200
- [ ] Повторный вызов `POST /api/auth/invite` возвращает новый URL, старый токен становится невалидным → старый `?invite=OLD` после логина → overlay `no-access`
- [ ] Токен сохраняется в `data/webchat/invites.json` и переживает рестарт сервера
- [ ] Rate limit: не более 20 новых invite-токенов в час на userId → HTTP 429

### Auth-виджет на дашборде
- [ ] При GET `d*.wpmix.net/*.html` сервер инжектирует `<script id="auth-widget-loader">` в `</body>`
- [ ] Виджет не показывается если `sessionStorage.dashboard_jwt` уже установлен (magic link path)
- [ ] Виджет не показывается на дашбордах без `ownerAddress` (незащищённый дашборд — данные видны всем)
- [ ] Нажатие "Войти через Google" запускает OAuth, redirect_uri = `https://simpledashboard.wpmix.net/api/auth/google-dashboard-callback?redirect_to=d{userId}.wpmix.net`

### Google OAuth flow
- [ ] `GET /api/auth/google-dashboard-callback` на `simpledashboard.wpmix.net` обрабатывает code → обменивает на Google ID Token → выполняет keypair/share/login → генерирует ml-токен → HTTP 302 на `https://d{userId}.wpmix.net?ml=ML_TOKEN`
- [ ] Существующий magic link скрипт на `d{userId}.wpmix.net` обменивает `?ml=ML_TOKEN` на JWT → blur снят
- [ ] Находит или создаёт WebUser по email из Google ID Token
- [ ] Если invite-токен в sessionStorage и валидный → `POST /api/auth/share` → `POST /api/auth/login` server-side → `sessionStorage.dashboard_jwt` → HTTP redirect на `d{userId}.wpmix.net` (без `?invite=`)
- [ ] Если invite-токен невалидный/отсутствует, но email уже в `dashboard_access` → то же самое (без share)
- [ ] Если invite-токен невалидный и email не в `dashboard_access` → overlay `no-access`
- [ ] Blur снят, auth-виджет скрыт после успешного JWT

### Keypair автогенерация
- [ ] Если email не существует в PG `users` → сервер генерирует Ethereum keypair → `POST /api/auth/register` → запись появляется в PG
- [ ] Если email уже есть в PG → новый keypair НЕ генерируется
- [ ] Гость не видит никаких UI-элементов про keypair (никаких модалок, полей ввода)

### Возвращающийся гость
- [ ] Если `webchat_session` жива и email в `dashboard_access` → `sessionStorage.dashboard_jwt` выставляется без показа виджета
- [ ] Если сессия истекла → виджет появляется, Google OAuth → сессия восстановлена, JWT выдан

### Гость не видит webchat
- [ ] На `d*.wpmix.net` нет ссылки на `/`, нет `Back to chat`, нет `Profile`, нет `Logout` (не нужны гостю)

### Profile владельца
- [ ] Секция "Поделиться дашбордом" с кнопкой "Создать invite-ссылку" → URL в поле для копирования
- [ ] Кнопка "Отозвать ссылку" → `POST /api/auth/invite/revoke` → старый токен удалён, новый сгенерирован → ответ `{ url: "https://d{userId}.wpmix.net?invite=NEW_TOKEN" }`
- [ ] Список email гостей в `dashboard_access` (из Auth API или local cache)

### Гость и `/api/data/`
- [ ] Авторизованный гость (с `dashboard_jwt` в sessionStorage) может выполнять GET/POST/PUT/DELETE на `/api/data/{collection}` — полный доступ к CRUD
- [ ] Неавторизованный запрос к `/api/data/` на `d*.wpmix.net` без `dashboard_jwt` возвращает HTTP 401

### Обработка ошибок (error-path)
- [ ] Auth API (8095) недоступен при guest login → HTTP 200 с overlay `service-unavailable` в HTML (не 502)
- [ ] PG ошибка при keypair генерации → overlay `service-unavailable`, в логах: `[ERROR] guest keypair generation failed for email=...`
- [ ] Google OAuth callback с невалидным `code` → редирект на `d{userId}.wpmix.net?error=auth_failed` → overlay `service-unavailable`
- [ ] Invite-токен валидный, но `POST /api/auth/share` вернул ошибку → overlay `service-unavailable`, не `no-access`

---

## Edge Cases

| Сценарий | Ожидаемое поведение |
|----------|---------------------|
| Invite-токен истёк/отозван, гость ещё не в `dashboard_access` | После Google OAuth → overlay `no-access`: «Ссылка недействительна. Попросите новую у владельца.» |
| Гость открывает дашборд без `?invite=` и без доступа | Overlay `no-access`: «Нет доступа к этому дашборду» |
| PG недоступен при keypair-генерации | overlay `service-unavailable`: «Сервис временно недоступен. Попробуйте позже.» |
| Google OAuth отменён пользователем (закрыл popup) | Виджет остаётся, кнопка разблокируется |
| Дашборд без `ownerAddress` | Auth-виджет не показывается, данные видны без авторизации |
| Владелец открывает свой `d{userId}.wpmix.net` | Extension-keypair flow (существующий), не затрагивается |
| Два гостя одновременно регистрируются | Каждый получает свою запись в `dashboard_access`, race condition — `ON CONFLICT DO NOTHING` в PG |
| Владелец перегенерировал invite, старые гости снова заходят | Они уже в `dashboard_access` → JWT выдаётся без invite-токена |
| Email гостя совпадает с email владельца | Владелец не нуждается в гостевом flow — его webchat-сессия авторизует через Extension |
| Auth API (8095) недоступен | overlay `service-unavailable` |

---

## Ограничения

- Гость **никогда** не видит webchat и не может редактировать дашборд через AI-чат
- Гость **не знает** о своём keypair — нет UI для просмотра или экспорта
- Восстановление keypair гостя — только через поддержку (support@onout.org)
- Invite-ссылка открытая — владелец несёт ответственность за то, кому её отправляет
- Отзыв конкретного гостя (удалить из `dashboard_access`) — вне MVP

---

## Технические решения

| Решение | Обоснование |
|---------|-------------|
| **Server-side keypair generation + signing** (РЕШЕНО) | Гость не имеет Extension, значит не может подписать challenge через `window.ethereum`. Webchat-сервер генерирует Ethereum keypair через ethers.js, сохраняет в PG через `POST /api/auth/register`, затем сам подписывает challenge при каждом login → Auth API выдаёт JWT. Это не нарушает безопасность: PG уже хранит приватные ключи (owner flow тоже хранит в PG). |
| **Google OAuth redirect через simpledashboard.wpmix.net + ml-токен** (РЕШЕНО) | Google не поддерживает wildcard `d*.wpmix.net`. Callback идёт на `simpledashboard.wpmix.net/api/auth/google-dashboard-callback?redirect_to=d123.wpmix.net`. После обработки сервер генерирует ml-токен и редиректит на `d123.wpmix.net?ml=TOKEN`. Существующий magic link механизм передаёт JWT клиенту. sessionStorage разных доменов изолированы — передача через URL обязательна. |
| **Invite хранится на диске** (РЕШЕНО) | In-memory Map теряется при рестарте. Сохраняем `{ dashboardUserId: string, token: string }[]` в `data/webchat/invites.json` — аналогично сессиям. |
| **Один invite-токен на дашборд** | Достаточно для MVP. Несколько ссылок с разными ролями — вне скоупа. |
| **Гостевой `/api/data/` — полный доступ (read + write)** | Гость может заполнять формы, добавлять заявки, ставить галочки. Ограничение — владелец контролирует что и как выводит дашборд в UI. Если нужен read-only — владелец не делает write-кнопок в index.html. |

## Риски

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| **Server-side keypair signing** — webchat-сервер сам подписывает challenge через ethers.js, имея приватный ключ гостя из ChatSettings. Auth API не знает, кто подписал — клиент или сервер. Схема работает, но требует хранения приватного ключа в памяти webchat-процесса при подписании | Средняя | Решено в «Технические решения». Приватный ключ берётся из ChatSettings (загружается при каждом запросе, не держится в памяти). |
| **Google OAuth redirect_uri wildcard** — Google не поддерживает `d*.wpmix.net` как один redirect_uri | Высокая | Использовать `simpledashboard.wpmix.net/api/auth/google-dashboard-callback?redirect_to=d123.wpmix.net` как промежуточный URL |
| **In-memory invite Map** теряется при рестарте | Средняя | Сохранять в `data/webchat/invites.json` (как сессии) |
| **Plaintext private key** в PG и ChatSettings | Средняя | Существующая проблема (не новая), документировать как known limitation |
| **dashboard_access без expiry** — нет механизма отзыва конкретного гостя | Средняя | Добавить `DELETE /api/auth/access` в auth-api.ts или оставить на следующий спринт |
| **Несколько дашбордов у одного гостя** — гость invited на 3 разных дашборда → 3 разных `dashboard_access` записи | Низкая | Auth API поддерживает, проблем нет |

---

## Тестирование

### Ручная проверка (smoke test)
1. Владелец: `/profile` → "Создать invite-ссылку" → скопировать URL
2. Открыть URL в другом браузере (incognito) → виджет видно, данные за blur
3. Нажать "Войти через Google" → пройти OAuth → blur снят
4. Закрыть и снова открыть дашборд → вход без виджета (сессия жива)
5. Владелец: "Отозвать ссылку" → открыть старую ссылку в новом incognito → overlay `no-access`

### Автотесты (новые файлы)
- `tests/test_invite_flow.js` — generate/revoke invite, guest login, dashboard_access check
- `tests/test_guest_auth_widget.js` — widget injection, blur removal, no-webchat-links
- `tests/test_server_side_keypair.js` — keypair generation via Auth API, no duplicate on re-login

---

## Как проверить (Acceptance Verification Plan)

### Агент проверяет (curl / автотесты)

```bash
# 1. Invite generation → new URL
curl -s -X POST http://localhost:8094/api/auth/invite \
  -H "Cookie: webchat_session=OWNER_SESSION" -H "Content-Type: application/json"
# → { url: "https://d999999999.wpmix.net?invite=TOKEN" }   HTTP 200

# 2. Auth widget script инжектирован в HTML
curl -s "http://localhost:8094/" -H "Host: d999999999.wpmix.net" | grep "auth-widget-loader"
# → нашли script#auth-widget-loader

# 3. Auth widget ОТСУТСТВУЕТ если нет ownerAddress (незащищённый дашборд)
# (создать тестовый дашборд без ownerAddress)
curl -s "http://localhost:8094/" -H "Host: dUNPROTECTED.wpmix.net" | grep -c "auth-widget-loader"
# → 0

# 4. Revoke → возвращает новый URL
curl -s -X POST http://localhost:8094/api/auth/invite/revoke \
  -H "Cookie: webchat_session=OWNER_SESSION"
# → { url: "https://d999999999.wpmix.net?invite=NEW_TOKEN" }   HTTP 200

# 5. Старый токен после revoke → невалидный
# Попытка использовать OLD_TOKEN через Google OAuth callback → overlay no-access в HTML

# 6. Rate limit: 21-й запрос → 429
for i in $(seq 1 21); do
  curl -s -X POST http://localhost:8094/api/auth/invite \
    -H "Cookie: webchat_session=OWNER_SESSION"
done | tail -1 | grep "429\|Too many"

# 7. Нет webchat-ссылок на дашборде
curl -s "http://localhost:8094/" -H "Host: d999999999.wpmix.net" \
  | grep -c "Back to chat\|href=\"/profile\"\|href=\"/logout\""
# → 0

# 8. /api/data/ требует авторизации
curl -s "http://localhost:8094/api/data/test" -H "Host: d999999999.wpmix.net"
# → 401 { error: "Unauthorized" }

# 9. /api/data/ работает с dashboard_jwt
curl -s "http://localhost:8094/api/data/test" \
  -H "Host: d999999999.wpmix.net" \
  -H "Authorization: Bearer DASHBOARD_JWT"
# → []   HTTP 200
```

### Пользователь проверяет (браузер)

1. Владелец: `/profile` → "Поделиться дашбордом" → кнопка "Создать invite-ссылку" → URL появился
2. Открыть URL в incognito → дашборд за blur, виджет с кнопкой "Войти через Google"
3. Нажать Google → OAuth → вернуться на дашборд → blur снят, виджет исчез
4. Закрыть вкладку → снова открыть `d{userId}.wpmix.net` → без виджета (сессия жива)
5. Владелец: "Отозвать ссылку" → в новом incognito открыть старую ссылку → войти → overlay "нет доступа"

---

## Out of Scope (MVP)

- Revoke конкретного гостя (удалить из `dashboard_access`)
- Роли (viewer / editor)
- Email-уведомление при invite
- Ограничение кол-ва гостей на дашборд
- Invite с TTL
- Аналитика посещений
- Invite по конкретному email (whitelist)
