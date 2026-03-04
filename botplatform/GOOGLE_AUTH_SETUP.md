# Google OAuth Setup для noxonbot.wpmix.net

## ✅ Что уже сделано:

1. **English interface включен:**
   - BOT_LANGUAGE=en
   - WEBCHAT_INIT_MESSAGE на английском
   - WEBCHAT_SUBTITLE="Build websites with AI"

2. **ENABLE_GOOGLE_AUTH=true** установлен в start-webchat-main.sh

3. **Telegram auth продолжит работать** - оба метода будут доступны

## 🔧 Что нужно сделать для Google OAuth:

### Шаг 1: Создать OAuth Client ID в Google Cloud Console

1. Открыть: https://console.cloud.google.com/apis/credentials
2. Выбрать проект или создать новый
3. "Create Credentials" → "OAuth client ID"
4. Application type: **Web application**
5. Name: **NoxonBot WebChat**

### Шаг 2: Настроить Authorized origins и redirects

**Authorized JavaScript origins:**
```
https://noxonbot.wpmix.net
```

**Authorized redirect URIs:**
```
https://noxonbot.wpmix.net/auth/google/callback
```

### Шаг 3: Скопировать Client ID

После создания скопируй **Client ID** (формат: `1234567890-abc123xyz.apps.googleusercontent.com`)

### Шаг 4: Добавить Client ID в .env

Открой `/root/aisell/noxonbot/.env` и замени:
```bash
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID_HERE
```

на:
```bash
GOOGLE_CLIENT_ID=1234567890-abc123xyz.apps.googleusercontent.com
```

### Шаг 5: Перезапустить webchat

```bash
pm2 restart noxonbot-webchat
```

## 🧪 Проверка

1. Открыть https://noxonbot.wpmix.net/
2. Должен быть:
   - ✅ Английский интерфейс
   - ✅ Кнопка "Sign in with Google" (после добавления Client ID)
   - ✅ Telegram login link (продолжит работать)

## 📋 Текущие настройки

**start-webchat-main.sh:**
```bash
export BOT_LANGUAGE="en"
export ENABLE_GOOGLE_AUTH="true"
export WEBCHAT_TITLE="NoxonBot - AI Website Builder"
export WEBCHAT_SUBTITLE="Build websites with AI"
export WEBCHAT_INIT_MESSAGE="👋 Hello! I will help you create an AI bot or web application.\n\n💡 Tell me in simple words what you want to build."
```

**Порт:** 8091
**Домен:** https://noxonbot.wpmix.net
**Auth методы:** Telegram + Google (когда Client ID будет добавлен)

## ⚠️ Важно

- Без валидного GOOGLE_CLIENT_ID кнопка Google Sign In **НЕ появится**
- Telegram auth продолжит работать независимо от Google Auth
- После добавления Client ID обязательно перезапустить PM2 процесс
