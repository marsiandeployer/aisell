# Chrome Extension API для WebChat

Расширение предоставляет WebChat приложению доступ к:
- Информации о текущей вкладке
- Содержимому страницы
- Скриншотам
- Режиму разработчика (интерактивный выбор DOM-элемента по клику)

## Архитектура

```
WebChat (iframe) <--postMessage--> Panel Script <--Chrome API--> Browser Tabs
```

## Использование в WebChat

### 1. Проверка готовности расширения

```javascript
// Слушаем сигнал готовности от расширения
window.addEventListener('message', (event) => {
  if (event.data.type === 'extension_ready') {
    console.log('Extension capabilities:', event.data.capabilities);
    // ['tab_info', 'read_page', 'screenshot']
  }
});
```

В `capabilities` также приходят:
- `developer_mode`
- `element_selection`

### 2. Получение информации о текущей вкладке

```javascript
// Отправить запрос
const requestId = generateUniqueId();
window.parent.postMessage({
  type: 'get_tab_info',
  requestId
}, '*');

// Получить ответ
window.addEventListener('message', (event) => {
  if (event.data.type === 'response' && event.data.requestId === requestId) {
    const { title, url, favIconUrl, id } = event.data.data;
    console.log('Current tab:', title, url);
  }
});
```

### 3. Чтение содержимого страницы

```javascript
const requestId = generateUniqueId();
window.parent.postMessage({
  type: 'read_page_content',
  requestId
}, '*');

// Ответ содержит:
// {
//   title: "Page title",
//   url: "https://example.com",
//   content: {
//     text: "Full text content...",
//     html: "<html>...</html>",
//     meta: { description, keywords, ogTitle, ogDescription },
//     headings: [{ tag: "H1", text: "Heading" }, ...],
//     links: [{ href: "...", text: "..." }, ...]
//   }
// }
```

### 4. Создание скриншота

```javascript
const requestId = generateUniqueId();
window.parent.postMessage({
  type: 'capture_screenshot',
  requestId
}, '*');

// Ответ содержит:
// {
//   title: "Page title",
//   url: "https://example.com",
//   screenshot: "data:image/png;base64,iVBORw0KGgoAAAANS..." // Data URL
// }
```

### 5. Включение режима разработчика (выбор элемента)

```javascript
const requestId = generateUniqueId();
window.parent.postMessage({
  type: 'set_developer_mode',
  requestId,
  enabled: true
}, '*');
```

Ответ:
```javascript
// type: "response"
// data: { enabled: true }
```

### 6. Получение выбранного элемента

Когда режим разработчика включен и пользователь кликает на элемент в активной вкладке,
расширение отправляет событие:

```javascript
window.addEventListener('message', (event) => {
  if (event.data.type === 'dev_element_selected') {
    const { tag, id, classes, selector, chatText } = event.data.data;
    console.log(tag, id, classes, selector);
    console.log(chatText); // Готовый текст для вставки в чат
  }
});
```

### 7. Очистка выделения

```javascript
const requestId = generateUniqueId();
window.parent.postMessage({
  type: 'clear_selected_element',
  requestId
}, '*');
```

Либо пользователь может нажать `Esc` на странице.

## Полный пример WebChat интеграции

```javascript
class ExtensionBridge {
  constructor() {
    this.ready = false;
    this.pendingRequests = new Map();
    this.requestCounter = 0;

    window.addEventListener('message', this.handleMessage.bind(this));
  }

  handleMessage(event) {
    const { type, requestId, data, error, capabilities } = event.data;

    if (type === 'extension_ready') {
      this.ready = true;
      this.capabilities = capabilities || [];
      console.log('Extension ready:', this.capabilities);
      return;
    }

    if (type === 'response' && requestId) {
      const resolve = this.pendingRequests.get(requestId);
      if (resolve) {
        this.pendingRequests.delete(requestId);
        if (error) {
          resolve.reject(new Error(error));
        } else {
          resolve.resolve(data);
        }
      }
    }
  }

  sendRequest(type, data = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `req_${++this.requestCounter}_${Date.now()}`;
      this.pendingRequests.set(requestId, { resolve, reject });

      window.parent.postMessage({
        type,
        requestId,
        ...data
      }, '*');

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 10000);
    });
  }

  async getTabInfo() {
    return this.sendRequest('get_tab_info');
  }

  async readPageContent() {
    return this.sendRequest('read_page_content');
  }

  async captureScreenshot() {
    return this.sendRequest('capture_screenshot');
  }

  async setDeveloperMode(enabled) {
    return this.sendRequest('set_developer_mode', { enabled });
  }

  async clearSelectedElement() {
    return this.sendRequest('clear_selected_element');
  }

  hasCapability(cap) {
    return this.capabilities.includes(cap);
  }
}

// Использование
const bridge = new ExtensionBridge();

// Дождаться готовности
setTimeout(async () => {
  if (!bridge.ready) {
    console.log('Extension not available');
    return;
  }

  // Получить инфо о вкладке
  const tabInfo = await bridge.getTabInfo();
  console.log('Tab:', tabInfo);

  // Прочитать страницу
  const content = await bridge.readPageContent();
  console.log('Page text:', content.content.text.substring(0, 100));

  // Скриншот
  const screenshot = await bridge.captureScreenshot();
  const img = document.createElement('img');
  img.src = screenshot.screenshot;
  document.body.appendChild(img);
}, 1000);
```

## Безопасность

1. **Origin Validation**: Panel script проверяет origin iframe перед отправкой данных
2. **Permissions**: Расширение запрашивает минимальные необходимые permissions
3. **Content Limits**: Текст ограничен 50KB, HTML - 100KB

## Permissions в Manifest

```json
{
  "permissions": ["sidePanel", "activeTab", "scripting", "tabs"],
  "host_permissions": ["<all_urls>"]
}
```

- `activeTab` - доступ к активной вкладке
- `scripting` - выполнение скриптов для чтения контента
- `tabs` - информация о вкладках
- `<all_urls>` - доступ ко всем сайтам для чтения

## Обработка ошибок

```javascript
try {
  const content = await bridge.readPageContent();
} catch (error) {
  if (error.message === 'No active tab found') {
    console.log('Нет активной вкладки');
  } else if (error.message === 'Request timeout') {
    console.log('Превышено время ожидания');
  } else {
    console.error('Ошибка:', error);
  }
}
```

## Типичные сценарии использования

### 1. Анализ страницы AI-ботом
```javascript
const content = await bridge.readPageContent();
sendToBot(`Проанализируй эту страницу: ${content.content.text}`);
```

### 2. Отладка с контекстом страницы
```javascript
const [tab, screenshot] = await Promise.all([
  bridge.getTabInfo(),
  bridge.captureScreenshot()
]);
console.log(`Помощь по ${tab.url}`, screenshot.screenshot);
```

### 3. Автоматическое извлечение данных
```javascript
const content = await bridge.readPageContent();
const emails = content.content.text.match(/[\w.-]+@[\w.-]+\.\w+/g);
console.log('Найдены email:', emails);
```

## Ограничения

1. Расширение работает только в Chrome (Manifest V3 + Side Panel API)
2. Некоторые страницы могут блокировать content scripts (CSP)
3. Скриншоты работают только для видимой области вкладки
4. chrome:// и edge:// страницы недоступны для чтения
5. В режиме выбора элементов клик перехватывается (чтобы не триггерить действия на странице)

## Отладка

```javascript
// Включить логирование в panel.js
localStorage.setItem('debug_extension', 'true');

// В консоли DevTools расширения
chrome.tabs.query({ active: true }, (tabs) => console.log(tabs));
```
