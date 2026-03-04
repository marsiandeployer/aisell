# Universal Google OAuth Setup для NoxonBot

## 🎯 Архитектура

```
┌─────────────────────────────────────────┐
│ Вариант 1: Прямое открытие в браузере   │
│ https://noxonbot.wpmix.net/             │
│ ↓                                       │
│ Google OAuth (Web application) ✅       │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ Вариант 2: Chrome Extension Side Panel  │
│ chrome-extension://xyz/panel.html       │
│   ↓ (содержит iframe)                   │
│   <iframe src="https://noxonbot.wpmix.net/"> │
│   ↓                                     │
│   Google OAuth (тот же Web application) ✅│
└─────────────────────────────────────────┘
```

**Вывод:** Iframe загружает веб-контент (https://), поэтому работает с "Web application" OAuth client.

---

## ✅ Единая настройка OAuth Client

### Шаг 1: Создать Web Application OAuth Client

1. **Открой:** https://console.cloud.google.com/apis/credentials?project=mycity2-1033

2. **Create Credentials → OAuth client ID**

3. **Application type:** Web application ⚠️

4. **Name:** noxonbot-webchat-universal

5. **Authorized JavaScript origins:**
   ```
   https://noxonbot.wpmix.net
   http://localhost:8091
   ```

6. **Authorized redirect URIs:**
   ```
   https://noxonbot.wpmix.net/auth/google/callback
   http://localhost:8091/auth/google/callback
   ```

7. **CREATE** → Скопируй Client ID

---

## 🔐 Почему не нужен Chrome App OAuth?

**Chrome App OAuth client** нужен ТОЛЬКО если:
- OAuth делается напрямую из extension кода (background.js)
- Используется chrome.identity API

**В нашем случае:**
- OAuth делается из iframe
- Iframe загружает https://noxonbot.wpmix.net/
- Это обычный веб-контент → нужен Web application OAuth

---

## 📋 CSP для iframe в Extension

Уже настроено в manifest v1.0.2:

```json
{
  "content_security_policy": {
    "extension_pages": "frame-src 'self' https://noxonbot.wpmix.net https://*.wpmix.net https://accounts.google.com;"
  }
}
```

**Добавим Google accounts для OAuth popup:**

```json
"frame-src 'self' https://noxonbot.wpmix.net https://*.wpmix.net https://accounts.google.com https://*.google.com;"
```

---

## 🧪 Тестирование

### Вариант 1: Прямое открытие
```bash
# Открой в браузере:
https://noxonbot.wpmix.net/

# Ожидаемое поведение:
1. Модальное окно логина
2. Кнопка "Sign in with Google"
3. Клик → OAuth popup → авторизация → успех ✅
```

### Вариант 2: Chrome Extension
```bash
# 1. Установи extension
# 2. Открой side panel
# 3. Увидишь iframe с webchat
# 4. Кнопка "Sign in with Google" там же
# 5. Клик → OAuth popup → авторизация → успех ✅
```

**Оба варианта используют ОДИН И ТОТ ЖЕ OAuth Client!**

---

## ⚠️ Важные детали

### 1. Cookie SameSite
Webchat устанавливает session cookie. Для работы в iframe нужно:

```javascript
// В webchat.ts уже настроено:
res.cookie('sessionId', sessionId, {
  httpOnly: true,
  secure: true,
  sameSite: 'none',  // ✅ Разрешает cookie в iframe
  maxAge: 30 * 24 * 60 * 60 * 1000
});
```

### 2. OAuth popup в iframe
Google OAuth popup открывается в новом окне, не в iframe, поэтому работает без проблем.

### 3. Redirect после OAuth
```javascript
// После успешной авторизации Google редиректит на:
https://noxonbot.wpmix.net/auth/google/callback

// Backend обрабатывает и редиректит на:
https://noxonbot.wpmix.net/

// Если в iframe - обновится iframe
// Если прямое открытие - обновится страница
```

---

## 🔧 Установка Client ID

```bash
# 1. Скопируй Client ID из Google Console
export GOOGLE_CLIENT_ID='531979133429-xxxxxxx.apps.googleusercontent.com'

# 2. Обнови .env
sed -i "s/GOOGLE_CLIENT_ID=.*/GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID/" /root/aisell/noxonbot/.env

# 3. Перезапусти webchat
pm2 restart noxonbot-webchat

# 4. Проверь
curl -s http://localhost:8091 | grep -o "g_id_signin"
# Должно показать: g_id_signin (если Client ID установлен)
```

---

## 📊 Сравнение OAuth типов

| Параметр | Web Application (нужен нам) | Chrome App (НЕ нужен) |
|----------|------------------------------|------------------------|
| Где работает | Веб-сайты (включая в iframe) | Только Chrome Extension код |
| Redirect URI | https://example.com/callback | urn:ietf:wg:oauth:2.0:oob |
| JavaScript origins | Требуется | Не требуется |
| JSON формат | `{"web": {...}}` | `{"installed": {...}}` |
| Использование | Google Sign-In button | chrome.identity.launchWebAuthFlow |

---

## 🎯 Checklist

Для работы в обоих вариантах (браузер + extension):

- [ ] ✅ Создан "Web application" OAuth client (НЕ Chrome app!)
- [ ] ✅ Authorized origins: https://noxonbot.wpmix.net
- [ ] ✅ Redirect URIs: https://noxonbot.wpmix.net/auth/google/callback
- [ ] ✅ Client ID добавлен в .env
- [ ] ✅ CSP разрешает accounts.google.com (уже есть в коде)
- [ ] ✅ SameSite=none для cookies (уже есть в коде)
- [ ] ✅ pm2 restart noxonbot-webchat

**Готово! Работает везде с ОДНИМ OAuth client.** 🎉

---

## 🐛 Troubleshooting

### Проблема: "redirect_uri_mismatch" в extension
**Причина:** OAuth popup редиректит на https://noxonbot.wpmix.net/auth/google/callback
**Решение:** Это нормально! Iframe находится на этом домене, поэтому всё работает.

### Проблема: Cookie не сохраняется в iframe
**Проверь:**
```bash
# В webchat.ts должно быть sameSite: 'none'
grep "sameSite.*none" /root/aisell/noxonbot/src/webchat.ts
```

### Проблема: Кнопка Google не появляется
**Проверь:**
```bash
cat /root/aisell/noxonbot/.env | grep GOOGLE_CLIENT_ID
# НЕ должно быть "YOUR_GOOGLE_CLIENT_ID_HERE"
```

---

## 📚 Дополнительно

Если в будущем захочешь делать OAuth НАПРЯМУЮ из Chrome Extension (без iframe):
1. Создашь отдельный "Chrome App" OAuth client
2. Используешь chrome.identity.launchWebAuthFlow()
3. Настроишь redirect_uri: chrome-extension://ID/oauth-callback.html

Но для текущей архитектуры (iframe) это НЕ нужно.
