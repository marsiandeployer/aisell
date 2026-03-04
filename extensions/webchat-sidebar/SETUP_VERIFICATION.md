# Setup Verification Report
**Дата:** 2026-02-18
**Версия extension:** v1.0.1
**Webchat:** noxonbot-webchat на порту 8091

## ✅ Проверка Setup

### 1. Домен wpmix.net
```bash
✅ Все ссылки изменены с habab.ru на wpmix.net
✅ Preview URL формат: https://d{userId}.wpmix.net/
✅ DNS wildcard запись: *.wpmix.net → 109.172.101.40
✅ Реверс-прокси настроен на 109.172.101.40
```

**Найдено в webchat.ts:**
- Line 354: Приветственное сообщение упоминает wpmix.net
- Line 582: clodeboxbot.wpmix.net
- Line 680: aisell.wpmix.net
- Line 1821: https://d{userId}.wpmix.net/ в notifyExtensionOnFileCreated
- Line 1848: botSubtitleEl показывает d{userId}.wpmix.net

**Проверка отсутствия habab.ru:**
```bash
$ grep -n "habab.ru" src/webchat.ts
(пусто - не найдено)
```

### 2. Extension - Auto Preview Feature

#### background.js (строки 35-40)
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'open_preview' && message.url) {
    chrome.tabs.create({ url: message.url, active: true });
  }
});
```
✅ Слушает сообщения с типом 'open_preview'
✅ Открывает новую вкладку с preview URL
✅ Вкладка активна (active: true)

#### panel.js (строки 72-97)
```javascript
case 'file_created':
  handleFileCreated(message);
  break;

function handleFileCreated(message) {
  const filename = message.filename || message.data?.filename || '';
  const previewUrl = message.url || message.data?.url || '';

  if (filename === 'index.html' && previewUrl) {
    chrome.runtime.sendMessage({
      type: 'open_preview',
      url: previewUrl
    });
  }
}
```
✅ Обрабатывает сообщение 'file_created'
✅ Проверяет что filename === 'index.html'
✅ Отправляет сообщение в background.js
✅ Поддерживает оба формата: message.filename и message.data.filename

### 3. Webchat - File Detection & Notification

#### notifyExtensionOnFileCreated (строки 1811-1824)
```typescript
function notifyExtensionOnFileCreated(messages) {
  try {
    if (!window.parent || window.parent === window) return;
    const lastMsg = messages && messages.length > 0 ? messages[messages.length - 1] : null;
    if (!lastMsg || lastMsg.role !== "assistant") return;
    const text = String(lastMsg.text || "").toLowerCase();
    if (!text.includes("index.html")) return;
    if (!text.includes("создан") && !text.includes("created") && !text.includes("сохран") && !text.includes("saved")) return;
    const userId = (window.__WEBCHAT_USER_ID__ || "").replace(/^user_/, "");
    if (!userId) return;
    const previewUrl = "https://d" + userId + ".wpmix.net/";
    window.parent.postMessage({ type: "file_created", filename: "index.html", url: previewUrl }, "*");
  } catch (_e) {}
}
```

**Триггеры (trigger words):**
- ✅ `создан` - русский
- ✅ `created` - английский
- ✅ `сохран` - русский (сохранен/сохранён)
- ✅ `saved` - английский

**Валидация:**
- ✅ Проверяет наличие window.parent (работа в iframe)
- ✅ Берет последнее сообщение
- ✅ Проверяет что role === "assistant"
- ✅ Case-insensitive поиск (toLowerCase)
- ✅ Убирает префикс "user_" из userId
- ✅ Формирует правильный URL

#### userId Storage (строки 1842-1848)
```typescript
// Store userId for extension postMessage
if (me && me.user && me.user.userId) {
  window.__WEBCHAT_USER_ID__ = String(me.user.userId);
}
const botSubtitleEl = document.getElementById('botSubtitle');
if (botSubtitleEl && me && me.user && me.user.userId) {
  botSubtitleEl.textContent = 'd' + me.user.userId + '.wpmix.net';
}
```
✅ Сохраняет userId в глобальную переменную window
✅ Показывает домен пользователя в интерфейсе

### 4. Автотест (test-auto-preview.js)

```bash
$ node test-auto-preview.js
==================================================
✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!
==================================================

📊 Результаты:
  - Webchat logic: ✅ 7 тестов
  - Extension panel: ✅ 4 теста
  - URL validation: ✅ 2 теста
  - Integration flow: ✅ 3 теста
  - Edge cases: ✅ 3 теста
  - ИТОГО: ✅ 19 тестов
```

**Покрытие тестами:**
1. Webchat notification logic (7 тестов)
   - Valid messages с разными trigger words
   - Invalid cases (нет index.html, нет userId, user message, нет trigger word)
2. Extension panel handling (4 теста)
   - Valid file_created message
   - Data wrapper support
   - Wrong filename rejection
   - Missing URL rejection
3. URL format validation (2 теста)
   - Valid format: https://d{number}.wpmix.net/
   - Invalid formats
4. End-to-end integration (3 теста)
   - Полный flow на русском
   - Полный flow на английском
   - Негативный сценарий
5. Edge cases (3 теста)
   - Множественные сообщения
   - Case insensitive
   - userId prefix stripping

## 🔄 Integration Flow

```
┌─────────────┐
│   User      │
│ creates     │ "Создай landing page"
│ index.html  │
└──────┬──────┘
       │
       v
┌─────────────────────────────────────┐
│  Claude Assistant Response          │
│  "Файл index.html создан успешно!" │
└──────┬──────────────────────────────┘
       │
       v
┌──────────────────────────────────────┐
│  webchat.ts                          │
│  notifyExtensionOnFileCreated()      │
│  - Детектирует "index.html" + "создан" │
│  - Берет userId из window.__WEBCHAT_USER_ID__ │
│  - Формирует URL: https://d{userId}.wpmix.net/ │
│  - Отправляет postMessage к parent   │
└──────┬───────────────────────────────┘
       │ postMessage({ type: "file_created", filename: "index.html", url: "..." })
       v
┌──────────────────────────────────────┐
│  panel.js (Chrome Extension)         │
│  handleMessage() → handleFileCreated() │
│  - Получает postMessage              │
│  - Проверяет filename === "index.html" │
│  - Отправляет в background.js        │
└──────┬───────────────────────────────┘
       │ chrome.runtime.sendMessage({ type: "open_preview", url: "..." })
       v
┌──────────────────────────────────────┐
│  background.js (Service Worker)      │
│  chrome.runtime.onMessage            │
│  - Проверяет type === "open_preview" │
│  - Вызывает chrome.tabs.create()     │
└──────┬───────────────────────────────┘
       │ chrome.tabs.create({ url: "https://d123456.wpmix.net/", active: true })
       v
┌──────────────────────────────────────┐
│  Новая вкладка Chrome                │
│  https://d123456.wpmix.net/          │
│  - Открывается автоматически         │
│  - Показывает index.html пользователя │
└──────────────────────────────────────┘
```

## 🧪 Как протестировать вручную

### Шаг 1: Установить Extension
```bash
1. Открыть Chrome
2. Перейти в chrome://extensions
3. Включить "Developer mode"
4. "Load unpacked" → /root/aisell/extensions/webchat-sidebar/out/webchat-sidebar
```

### Шаг 2: Открыть Webchat через Extension
```bash
1. Кликнуть на иконку extension в toolbar
2. Откроется side panel с webchat
3. Авторизоваться (i448539@gmail.com / 123123)
4. В subtitle должно показаться: d{userId}.wpmix.net
```

### Шаг 3: Создать index.html
Попросить Claude в чате:
```
Создай простую landing page в index.html
```

### Шаг 4: Проверить auto-preview
**Ожидаемое поведение:**
- ✅ Claude ответит что-то типа "Файл index.html создан"
- ✅ Автоматически откроется новая вкладка
- ✅ URL вкладки: https://d{userId}.wpmix.net/
- ✅ Показывается созданная landing page

### Шаг 5: Проверить в DevTools Console
```javascript
// Webchat iframe
window.__WEBCHAT_USER_ID__  // должно показать userId

// Extension panel
// Открыть DevTools для extension panel (inspect panel.html)
// При создании index.html должно появиться сообщение в console
```

## 📁 Файлы Setup

| Файл | Статус | Назначение |
|------|--------|-----------|
| `/root/aisell/extensions/webchat-sidebar/src/background.js` | ✅ | Service worker, открывает preview tabs |
| `/root/aisell/extensions/webchat-sidebar/src/panel.js` | ✅ | Panel script, обрабатывает postMessage |
| `/root/aisell/extensions/webchat-sidebar/src/panel.html` | ✅ | Panel UI с iframe |
| `/root/aisell/noxonbot/src/webchat.ts` | ✅ | Webchat logic, детектирует index.html |
| `/root/aisell/extensions/webchat-sidebar/test-auto-preview.js` | ✅ | Автотест (19 тестов) |
| `/root/aisell/extensions/webchat-sidebar/build.js` | ✅ | Build script для extension |

## 🚀 PM2 Services

```bash
$ pm2 list | grep webchat
│ noxonbot-webchat  │ 0   │ online │
```

**Порт:** 8091
**URL:** http://localhost:8091
**Через extension:** https://noxonbot.wpmix.net (в iframe)

## 🌐 DNS & Nginx

**Wildcard DNS:**
```
*.wpmix.net → 109.172.101.40
```

**Реверс-прокси (109.172.101.40):**
```nginx
server {
  server_name *.wpmix.net;
  location / {
    proxy_pass http://95.217.227.164:8091;
  }
}
```

**Динамические поддомены:**
- d123456.wpmix.net → user с userId=123456
- d999999.wpmix.net → user с userId=999999
- noxonbot.wpmix.net → главный webchat

## 📦 Extension Files (в out/webchat-sidebar.zip)

```
manifest.json      - Manifest V3 config
background.js      - Service worker (auto-preview)
panel.html         - Side panel UI
panel.js           - Panel logic (postMessage handling)
icons/             - Extension icons
```

**Размер:** 12KB (без store assets)

## ⚠️ Важные Notes

1. **Trigger words точные:** "создан", "created", "сохран", "saved"
   - Не сработает на "сделан", "написан", "готов"
   - Case-insensitive (СОЗДАН = создан)

2. **Только index.html:**
   - Не сработает на main.html, home.html, index.htm
   - Точное совпадение filename

3. **Только assistant messages:**
   - User messages игнорируются
   - Берется последнее сообщение в массиве

4. **userId обязателен:**
   - Без userId preview не откроется
   - Префикс "user_" автоматически убирается

5. **Работает только в iframe:**
   - Проверяет window.parent !== window
   - Standalone webchat не отправит postMessage

## 🔍 Debugging

### Webchat (DevTools Console)
```javascript
// Проверить userId
window.__WEBCHAT_USER_ID__

// Проверить что postMessage отправлен
// (добавить временно console.log в notifyExtensionOnFileCreated)
```

### Extension Panel (Inspect panel.html)
```javascript
// Проверить что сообщение получено
// (добавить console.log в handleMessage)
```

### Background Service Worker (Inspect service worker)
```javascript
// Проверить что chrome.tabs.create вызван
// (добавить console.log в onMessage listener)
```

### Network (Chrome DevTools)
```bash
# Проверить что домен резолвится
$ ping d123456.wpmix.net
PING d123456.wpmix.net (109.172.101.40)

# Проверить через curl
$ curl -I https://d123456.wpmix.net/
```

## ✅ Чеклист финального тестирования

- [ ] Extension установлен в Chrome
- [ ] Side panel открывается по клику на иконку
- [ ] Webchat загружается в iframe
- [ ] Авторизация работает (i448539@gmail.com)
- [ ] botSubtitle показывает d{userId}.wpmix.net
- [ ] При создании index.html через Claude:
  - [ ] Новая вкладка открывается автоматически
  - [ ] URL правильный: https://d{userId}.wpmix.net/
  - [ ] Landing page отображается
- [ ] Автотест проходит: `node test-auto-preview.js`
- [ ] PM2 service работает: `pm2 list | grep webchat`

## 📝 Changelog

**v1.0.1 (2026-02-18)**
- ✅ Добавлен auto-preview для index.html
- ✅ Домен изменен с *.habab.ru на *.wpmix.net
- ✅ Динамические URL: https://d{userId}.wpmix.net/
- ✅ Добавлен автотест (19 тестов)
- ✅ Trigger words: создан, created, сохран, saved
- ✅ Хранение userId в window.__WEBCHAT_USER_ID__

**v1.0.0 (Initial)**
- ✅ Chrome Extension Manifest V3
- ✅ Side Panel API
- ✅ Tab info, page reading, screenshots
- ✅ Developer mode с element selection
