---
created: 2026-02-27
status: approved
type: feature
size: L
---

# User Spec: Web3-авторизация для дашбордов (dashboard-web3-auth)

## Что делаем

Добавляем авторизацию дашбордов через Chrome extension, который работает как web3-кошелёк. Extension инжектит `window.ethereum` провайдер на страницы `d*.wpmix.net`. Защищённый дашборд запрашивает подпись у extension, Auth API проверяет её через Ethereum ecrecover. Без extension — данные заблюрены, видно предложение установить расширение.

Один keypair на пользователя — генерируется при первом создании дашборда с auth в webchat. Owner address вшивается в `index.html`. Extension хранит keypair в `chrome.storage` — пользователь не видит raw private keys. При посещении чужого дашборда extension подписывает challenge, но Auth API отклоняет (address ≠ owner) — данные остаются заблюрены. Auth опциональна — Claude добавляет её по запросу или когда данные чувствительные.

## Зачем

Дашборды публичные — любой по ссылке `d{userid}.wpmix.net` видит бизнес-данные (выручку, заказы, клиентов). Авторизация закрывает данные от случайного просмотра. Дополнительная ценность: extension-based auth драйвит установки extension (основной канал дистрибуции продукта).

**Уровень защиты:** визуальный замок (blur данных на клиенте). HTML файл с данными технически доступен через curl — это осознанный компромисс для MVP, сохраняющий single-file архитектуру. Защита от casual access, не от целенаправленного взлома.

## Как должно работать

### Первый запуск extension (генерация keypair)
1. Пользователь устанавливает extension из Chrome Web Store
2. При первом создании дашборда в webchat — webchat запрашивает keypair у extension
3. Extension генерирует Ethereum keypair и сохраняет в `chrome.storage`
4. Extension возвращает address и private key webchat'у
5. Webchat отправляет private key и email на Auth API (server-to-server) для серверного backup
6. Пользователь не видит raw keys — всё происходит автоматически

### Создание дашборда с auth (в webchat через extension)
1. Пользователь в webchat (extension sidebar) просит создать дашборд
2. Claude решает что auth нужна (пользователь попросил или данные чувствительные)
3. Webchat берёт address из extension (keypair уже существует или генерируется — см. "Первый запуск")
4. Webchat backend вызывает Auth API: `POST /api/auth/register` с `{address, email, dashboardId}` (server-to-server)
5. Claude генерирует `index.html` с вшитым `OWNER_ADDRESS` и auth-кодом (проверка `window.ethereum`, blur overlay, fetch к Auth API)
6. Пользователь получает дашборд, доступ автоматический — extension уже хранит keypair

### Открытие защищённого дашборда (extension установлен)
1. Пользователь открывает `d{id}.wpmix.net`
2. Дашборд обнаруживает `window.ethereum` провайдер (инжектируется extension)
3. Дашборд запрашивает подпись challenge у extension
4. Extension подписывает challenge единственным keypair'ом пользователя
5. Дашборд отправляет подпись на Auth API для проверки (ecrecover === owner address)
6. Auth API возвращает JWT → данные разблюриваются

### Открытие защищённого дашборда (extension НЕ установлен)
1. Пользователь открывает `d{id}.wpmix.net`
2. `window.ethereum` не найден
3. Видит заголовок дашборда и описание, данные/графики заблюрены
4. Видит overlay: "Для доступа к данным установите SimpleDashboard" + ссылка на Chrome Web Store
5. Данные остаются заблюренными

### Посещение чужого дашборда (extension установлен)
1. Пользователь с extension открывает чужой защищённый дашборд
2. Extension подписывает challenge своим keypair'ом
3. Auth API проверяет: ecrecover(signature) — address не в списке допущенных → 401
4. Данные остаются заблюрены, overlay: "У вас нет доступа к этому дашборду"

### Шаринг доступа (админ добавляет email)
1. Владелец дашборда просит в webchat: "Дай доступ user@example.com"
2. Webchat вызывает Auth API: добавить email в список допущенных для этого дашборда
3. Auth API ищет address по email в БД (юзер должен быть зарегистрирован — т.е. иметь extension с keypair)
4. Если email найден → address добавляется в список допущенных. Если не найден → ответ: "Пользователь не зарегистрирован, попросите его установить extension"
5. Приглашённый юзер с extension открывает дашборд → его address найден в списке → данные видны

### Открытие на другом устройстве (extension установлен, но keypair нет)
1. Extension установлен, но keypair не найден в `chrome.storage`
2. Дашборд показывает blur + overlay: "Напишите в support@onout.org для восстановления доступа"

### Восстановление доступа (потеря ключа)
1. Пользователь нажимает "Восстановить доступ" → видит: "Напишите в support@onout.org"
2. Администратор верифицирует личность (переписка в support, подтверждение через историю диалогов в webchat)
3. Администратор находит private key в БД по email, отправляет пользователю через защищённый канал
4. Пользователь импортирует keypair в extension → доступ восстановлен

### Auth API недоступен
1. Fetch к Auth API возвращает ошибку (timeout, 5xx)
2. Дашборд показывает заголовок + "Сервис авторизации временно недоступен. Попробуйте позже."
3. Данные остаются заблюренными

### Expired JWT
1. JWT истёк
2. Extension автоматически пере-подписывает challenge
3. Дашборд получает новый JWT → данные остаются видимыми
4. Если keypair удалён из extension → показывает overlay

### Регенерация дашборда с auth
1. Пользователь просит Claude изменить дашборд (через webchat)
2. Claude регенерирует `index.html`, сохраняя `OWNER_ADDRESS` и auth-код
3. При открытии обновлённого дашборда auth продолжает работать

### Дашборд без auth
Claude сгенерировал дашборд без auth (не просили, данные не критичны) — дашборд полностью публичный, как сейчас. Существующие дашборды не затрагиваются.

## Критерии приёмки

### Auth API

- [ ] **AC1:** Auth API сервис запущен, отвечает на health check (`GET /api/auth/health` → 200)
- [ ] **AC2:** Register endpoint — принимает `{address, email, privateKey, dashboardId}` (server-to-server от webchat), создаёт запись владельца, сохраняет privateKey для backup, возвращает 201
- [ ] **AC3:** Login endpoint — `POST /api/auth/login` с `{signature, challenge, dashboardId}`: ecrecover(signature) совпадает с owner address в БД → 200 + JWT; ecrecover(signature) не совпадает (подпись от чужого ключа) → 401
- [ ] **AC4:** Невалидная подпись (не парсится ecrecover) → 401 Unauthorized
- [ ] **AC5:** Дублирующий email при register → 409 с сообщением "Напишите в support@onout.org" (и при переустановке extension, и при коллизии с другим юзером — в обоих случаях через support)
- [ ] **AC6:** После register private key сохранён в БД (проверка: `psql` запрос к таблице users → поле private_key не пустое)
- [ ] **AC7:** Шаринг: добавление email в список допущенных для дашборда → приглашённый юзер с этим email получает доступ

### Extension (wallet)

- [ ] **AC8:** Extension инжектит `window.ethereum` провайдер на страницы `d*.wpmix.net`
- [ ] **AC9:** Extension генерирует keypair при запросе от webchat и сохраняет в `chrome.storage`
- [ ] **AC10:** Extension подписывает challenge по запросу дашборда (через `window.ethereum`)
- [ ] **AC11:** Extension поддерживает импорт keypair (для восстановления доступа)

### Дашборд

- [ ] **AC12:** Защищённый дашборд без авторизации — заголовок виден, данные заблюрены
- [ ] **AC13:** Защищённый дашборд с валидным JWT — все данные видны
- [ ] **AC14:** Без extension — overlay с предложением установить extension и ссылкой на Chrome Web Store
- [ ] **AC15:** При недоступности Auth API — сообщение "Сервис авторизации временно недоступен"
- [ ] **AC16:** Дашборд без auth — работает как раньше (полностью публичный)
- [ ] **AC17:** Expired JWT → автоматическая пере-подпись и получение нового JWT
- [ ] **AC18:** При регенерации дашборда — owner address и auth-код сохраняются
- [ ] **AC25:** Challenge содержит timestamp, Auth API отклоняет challenge старше 5 минут (replay protection)

### Инфраструктура (предусловия — проверяются при деплое)

- [ ] **AC19:** PostgreSQL установлен и работает на pg-db (LXC 102, требует первоначальной настройки — PG сейчас не запущен)
- [ ] **AC20:** Nginx проксирует `/api/auth/*` на Auth API сервис
- [ ] **AC21:** Auth API отвечает с CORS headers для `*.wpmix.net`
- [ ] **AC22:** Backup ключей синхронизируется на изолированный LXC

### Интеграция

- [ ] **AC23:** CLAUDE.md.template содержит секцию "Auth" с инструкциями для Claude: когда добавлять auth, как вшить OWNER_ADDRESS, auth overlay код
- [ ] **AC24:** Keypair генерируется при создании дашборда в webchat (extension → webchat → Auth API)

## Ограничения

- **Extension обязателен:** без extension auth невозможна — отображается prompt на установку. Это осознанное решение для драйва установок.
- **Визуальная защита:** client-side blur, данные технически доступны в HTML source. Защита от casual access для MVP.
- **Single-file:** дашборд = один `index.html`. Auth через fetch к Auth API.
- **Один keypair на юзера:** генерируется при первом создании дашборда с auth (webchat запрашивает у extension). Один keypair используется для всех дашбордов этого юзера. Перенос на другое устройство — через импорт keypair в extension (экспорт из support по email).
- **Email для записи:** email не используется для auth — только для идентификации при восстановлении и для шаринга доступа (lookup address по email).
- **Recovery через support:** нет автоматического восстановления. Пользователь пишет на support@onout.org, админ отправляет ключ из серверного backup.
- **Auth опциональна:** Claude добавляет auth только по запросу или когда данные чувствительные. Существующие дашборды не затрагиваются.

## Риски

- **Риск 1:** Chrome Web Store review может затянуться при добавлении `window.ethereum` injection и web3 функциональности. **Митигация:** минимальный набор permissions, минимальный content script, чёткое описание в privacy policy и listing.
- **Риск 2:** Keypair утерян при удалении extension / очистке данных Chrome. **Митигация:** private key хранится на сервере в БД; восстановление через support@onout.org.
- **Риск 3:** Private key хранится на сервере — при компрометации БД все ключи утекают. **Митигация:** backup на изолированном LXC, ограниченный доступ к БД. Серверное хранение — осознанный компромисс: без SMTP и автоматического recovery, ручной процесс через support единственный способ восстановления.
- **Риск 4:** CORS misconfiguration блокирует auth. **Митигация:** E2E тест, CORS настроен на `*.wpmix.net`.
- **Риск 5:** Content script injection на `d*.wpmix.net` может конфликтовать с другими extension или CSP. **Митигация:** тестирование с различными конфигурациями, isolated world для content script.

## Технические решения

- Auth через Chrome extension (как web3-кошелёк), потому что: (a) пользователь не видит raw keys, (b) драйвит установки extension (основной канал дистрибуции), (c) стандартный `window.ethereum` интерфейс. Альтернатива (простой random token) рассмотрена и отклонена — Web3 подход выбран осознанно как продуктовая стратегия, несмотря на избыточность для визуального замка.
- Extension обязателен для auth, потому что это продуктовая стратегия — extension = основной канал дистрибуции.
- Визуальный замок (blur), потому что single-file архитектура: данные в HTML, реальная серверная защита потребует изменения архитектуры (данные через API). Для MVP достаточно.
- Auth API — отдельный сервис, потому что: ecrecover проверка, JWT выдача, хранение данных — изолированная ответственность.
- PostgreSQL на pg-db, потому что контейнер выделен под БД (LXC 102), auth данные реляционные (owner → dashboard mapping, access lists). File-based ограничение из architecture.md относится к данным дашбордов, не к auth-сервису.
- Backup на отдельном LXC, потому что при компрометации основного сервера keypair'ы восстановимы.
- JWT для сессий (stateless), потому что дашборд — статический файл, не может хранить server-side sessions.
- Дашборд частично открыт (заголовок видно, данные blur), потому что показывает что дашборд существует и мотивирует установку extension.
- Private key хранится на сервере, потому что при потере extension (переустановка, другое устройство) админ может восстановить доступ.
- Recovery через support@onout.org, потому что нет SMTP и для MVP достаточно ручного процесса.

## Тестирование

**Unit-тесты:** ecrecover verification, challenge generation/validation (timestamp ±5 min), JWT creation.

**Интеграционные тесты:** делаем — curl к Auth API: register → login → invalid sig → recovery webhook. Причина: auth критична для безопасности.

**E2E тесты:** делаем — Puppeteer с extension: открыть дашборд → увидеть blur → extension подписывает → данные видны. Также: без extension → overlay с предложением установки. Причина: полный browser flow с extension, CORS.

## Как проверить

### Агент проверяет

| Шаг | Инструмент | Ожидаемый результат |
|-----|-----------|-------------------|
| 1. PG доступен | bash: psql к pg-db | Таблицы с auth данными |
| 2. Auth API health | curl health endpoint | 200 OK |
| 3. Register | curl POST register | 201 |
| 4. Login | curl POST login с валидной подписью | 200 + JWT |
| 5. Invalid sig | curl POST login с невалидной подписью | 401 |
| 6. Duplicate email | curl POST register с тем же email | Сообщение "напишите в support" |
| 7. Key backup | curl POST register → psql запрос к таблице users | private_key не пустой |
| 8. Шаринг | curl: добавить email в allowed → login с address этого email | 200 + JWT |
| 9. Nginx proxy | curl через Host header | Auth API отвечает |
| 10. Blur без auth | Puppeteer: открыть дашборд без extension | Заголовок видно, данные blur, overlay "установите extension" |
| 11. Auth flow | Puppeteer с extension: открыть дашборд | Extension подписывает, данные видны |
| 12. Auth API down | Puppeteer: остановить Auth API, открыть дашборд | Сообщение "сервис недоступен" |
| 13. Backup | bash: проверить backup LXC | Данные синхронизированы |

### Пользователь проверяет
- Открыть дашборд с extension → данные видны (auto-login)
- Открыть дашборд без extension (другой браузер) → данные скрыты, предложение установки
- Удалить extension → данные скрыты
