# Авторизация в продуктах Noxon Digital Factory

## Обзор

SimpleDashboard (`d{userId}.wpmix.net`) поддерживает два типа пользователей:
- **Owner** — владелец дашборда, работает через webchat + Chrome Extension
- **Guest** — приглашённый пользователь, авторизуется через Google OAuth

Все потоки сходятся к единому механизму: **JWT-токен** (`mlToken`) в `localStorage` дашборда, который подтверждает право доступа к `/api/data/` и другим protected endpoint'ам.

---

## Поток 1: Owner Keypair (регистрация владельца)

**Когда:** Первый вход в webchat на `simpledashboard.wpmix.net` после установки расширения.

```
webchat.ts (браузер)
  └─ triggerKeypairFlow(email, dashboardId)   ← вызов после успешного Google login
       └─ postMessage → extension content-script
            └─ chrome.runtime.sendMessage({type: 'generate_keypair'})
                 └─ background.js → keypair-handlers.js
                      ├─ читает chrome.storage.local['sd_keypair']
                      ├─ если нет — ethers.Wallet.createRandom()
                      │   └─ сохраняет {address, privateKey} в chrome.storage.local
                      └─ возвращает address в webchat
       └─ webchat: POST /api/auth/register-owner
            └─ Auth API (порт 8095)
                 └─ INSERT INTO users + dashboard_access (PostgreSQL)
                      └─ сохраняет ownerAddress в ChatSettings (settings.json)
```

**Результат:** Ethereum-адрес владельца записан в `settings.json` (поле `ownerAddress`) и в PG-таблицу `dashboard_access`.

**Хранилище ключа:** `chrome.storage.local['sd_keypair']` — только в браузере с расширением. Приватный ключ никогда не покидает расширение.

---

## Поток 2: Dashboard Auth-check (вход владельца на d*.wpmix.net)

**Когда:** Владелец открывает `d{userId}.wpmix.net` (свой дашборд).

```
Страница дашборда загружается
  └─ webchat.ts: window.ethereum.request({method: 'eth_requestAccounts'})
       └─ ethereum-provider.js (MAIN world) → CustomEvent 'sd-eth-request'
            └─ content-script-ethereum.js (ISOLATED world) → chrome.runtime.sendMessage
                 └─ background.js → eth-request-handler.js
                      └─ читает chrome.storage.local['sd_keypair']
                           └─ возвращает [keypair.address]
  └─ webchat.ts: GET /api/auth/challenge
  └─ webchat.ts: window.ethereum.request({method: 'personal_sign', params: [challenge, address]})
       └─ [тот же мост] → eth-request-handler.js
            └─ ethers.Wallet(privateKey).signMessage(challenge)
                 └─ возвращает подпись
  └─ webchat.ts: POST /api/auth/verify
       └─ Auth API: ecrecover(challenge, signature) → ownerAddress
            ├─ проверяет в PG: есть ли запись dashboard_access для этого address+dashboardId
            └─ возвращает { mlToken: "JWT..." }
  └─ webchat.ts: сохраняет mlToken в localStorage
       └─ все /api/data/ запросы идут с заголовком Authorization: Bearer {mlToken}
```

**Архитектура расширения (4 слоя):**

| Слой | Файл | World | Роль |
|------|------|-------|------|
| Provider | `ethereum-provider.js` | MAIN | Инжектирует `window.ethereum` |
| Bridge | `content-script-ethereum.js` | ISOLATED | Мост CustomEvent ↔ chrome.runtime |
| Handler | `eth-request-handler.js` | Service Worker | Обрабатывает eth_* запросы |
| Storage | `keypair-handlers.js` + `background.js` | Service Worker | Управление ключами |

---

## Поток 3: Guest OAuth (вход гостя)

**Когда:** Приглашённый пользователь открывает `d{userId}.wpmix.net?invite=TOKEN`.

**Предусловие:** `GOOGLE_CLIENT_SECRET` задан в `.env.auth`. Без него `/api/auth/google-dashboard-callback` вернёт 500.

```
Страница дашборда:
  └─ /api/auth/invite/verify?token=TOKEN
       ├─ OK: дашборд показывается под блюром + auth-widget
       └─ FAIL (отозван/не существует): overlay "no-access"

Пользователь нажимает "Войти через Google":
  └─ редирект → accounts.google.com → OAuth consent
       └─ callback: GET /api/auth/google-dashboard-callback?code=...&state=...
            └─ Auth API:
                 ├─ обменивает code → id_token (Google)
                 ├─ извлекает email пользователя
                 ├─ проверяет invite token → dashboardId (ещё не отозван)
                 ├─ генерирует серверную Ethereum-пару для гостя
                 │   └─ сохраняет в PG (таблица users + dashboard_access)
                 └─ возвращает { mlToken: "JWT..." }
  └─ страница дашборда: сохраняет mlToken → убирает блюр, скрывает виджет
```

---

## Поток 4: Returning Guest (гость возвращается)

**Когда:** Гость уже авторизовался ранее, у него есть `webchat_session`.

```
GET /api/auth/invite/status (с Cookie: webchat_session=...)
  └─ Auth API:
       ├─ читает session → email → ищет в PG по (email + dashboardId)
       ├─ если есть запись с serverPrivateKey:
       │   ├─ генерирует challenge
       │   ├─ подписывает своим serverPrivateKey
       │   └─ возвращает { mlToken: "JWT..." }
       └─ если нет записи → 401 (нужен повторный invite)
```

**Результат:** Гость получает `mlToken` без повторного Google OAuth — сессия «живая».

---

## Поток 5: Revoke Invite

**Когда:** Владелец нажимает «Отозвать ссылку» в разделе «Поделиться дашбордом» на `/profile`.

```
POST /api/auth/invite/revoke (с Cookie: webchat_session владельца)
  └─ Auth API:
       ├─ находит текущий активный invite для этого dashboardId
       ├─ помечает его как revoked в invites.json
       └─ у всех гостей с этим invite mlToken истекает при следующем запросе
            └─ overlay "no-access" появляется при попытке войти
```

---

## Хранилища

| Данные | Где хранится | Файл / Таблица |
|--------|-------------|----------------|
| Owner Ethereum keypair | Chrome Extension | `chrome.storage.local['sd_keypair']` |
| Owner address | Auth API PG | `dashboard_access.owner_address` |
| Owner address (кэш) | Файловая система | `settings.json` → `ChatSettings.ownerAddress` |
| Guest keypair (серверный) | Auth API PG | `users.server_private_key` |
| Invite tokens | Файловая система | `data/webchat/invites.json` |
| JWT claims | Stateless | `mlToken` в localStorage дашборда |
| Session | HTTP Cookie | `webchat_session` (сервер webchat) |

---

## Env-переменные (`.env.auth`)

| Переменная | Назначение |
|-----------|-----------|
| `JWT_SECRET` | Подписывает mlToken |
| `INTERNAL_API_KEY` | Авторизует межсервисные вызовы webchat → Auth API |
| `GOOGLE_CLIENT_SECRET` | Google OAuth (нужен для Guest flow) |
| `GOOGLE_AUTH_TEST_SECRET` | Обход Google JWT verify в тестах |

---

## Известные ограничения

- **`GOOGLE_CLIENT_SECRET` не задан** в `.env.auth` — Task 1 (`status: planned`). До его добавления Guest OAuth flow (поток 3) не работает в браузере (сервер вернёт 500 на `/api/auth/google-dashboard-callback`). Тест-режим через `GOOGLE_AUTH_TEST_SECRET` функционирует.
- **In-memory rate limiters** у Auth API и webchat сбрасываются только при перезапуске PM2. При прогоне всех тестов подряд появляются 429-ошибки — нужно `pm2 restart dashboard-auth-api simpledashboard-web` перед тестами.

---

**Последнее обновление:** 2026-03-04
**Feature:** multi-user-auth (waves 1–10)
