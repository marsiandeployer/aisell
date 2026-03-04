# Chrome Web Store Auto-Publishing Setup

## 🎯 Что это

Автоматическая публикация обновлений NoxonBot экстеншена в Chrome Web Store через API.

## 📋 Требования

1. **Google Cloud Project** с включенным Chrome Web Store API
2. **OAuth 2.0 credentials** (Client ID, Client Secret)
3. **Refresh Token** для авторизации

## 🚀 Быстрый старт

### Шаг 1: Получить OAuth credentials

**У нас уже есть Google Cloud проект:** `mycity2-1033` (credentials в `/root/mycity2_key.json`)

**Быстрая настройка через скрипт:**
```bash
./scripts/setup_oauth_from_existing_project.sh
```

**Или вручную:**

1. Включи **Chrome Web Store API** для проекта mycity2-1033:
   - https://console.cloud.google.com/apis/library/chromewebstore.googleapis.com?project=mycity2-1033
2. Создай **OAuth 2.0 Client ID**:
   - https://console.cloud.google.com/apis/credentials?project=mycity2-1033
   - Application type: **Desktop app** или **Web application**
   - Authorized redirect URIs: `http://localhost:9515`
3. Скачай JSON с credentials или скопируй Client ID и Client Secret

### Шаг 2: Получить Refresh Token

Используй скрипт:

```bash
cd /root/aisell/extensions/webchat-sidebar/scripts

# Установи зависимости если нужно
npm install -g chrome-webstore-upload-cli

# Или используй curl для manual OAuth flow:
CLIENT_ID="your_client_id"
CLIENT_SECRET="your_client_secret"

# 1. Получить auth code (открой в браузере):
echo "https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=$CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob"

# 2. После авторизации скопируй AUTH_CODE из браузера

# 3. Обменяй code на refresh_token:
AUTH_CODE="paste_code_here"
curl -X POST https://oauth2.googleapis.com/token \
  -d "code=$AUTH_CODE" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob" \
  -d "grant_type=authorization_code"

# Сохрани REFRESH_TOKEN из ответа!
```

### Шаг 3: Сохранить credentials

Создай `.env` файл:

```bash
cat > /root/aisell/extensions/webchat-sidebar/.env << 'EOF'
# Chrome Web Store API credentials
CHROME_STORE_CLIENT_ID="your_client_id.apps.googleusercontent.com"
CHROME_STORE_CLIENT_SECRET="your_client_secret"
CHROME_STORE_REFRESH_TOKEN="your_refresh_token"
EOF

chmod 600 .env
```

### Шаг 4: Публикация

```bash
cd /root/aisell/extensions/webchat-sidebar

# 1. Пересобрать экстеншен (если нужно)
node build.js \
  --name "NoxonBot - AI Website Builder" \
  --short-name "NoxonBot" \
  --url "https://noxonbot.wpmix.net" \
  --description "Create landing pages, booking forms, and websites using AI chat. Publish to web instantly. No coding required." \
  --version "1.0.2"

# 2. Загрузить .env credentials
source .env

# 3. Опубликовать
./scripts/publish-to-chrome-store.sh
```

## 🔄 Workflow автообновления

### Вариант 1: Manual (когда нужно)

```bash
cd /root/aisell/extensions/webchat-sidebar
source .env
./scripts/publish-to-chrome-store.sh
```

### Вариант 2: Cron (автоматически каждый день)

```bash
# Через pm2 (лучше чем cron)
pm2 start /root/aisell/extensions/webchat-sidebar/scripts/publish-to-chrome-store.sh \
  --name "chrome-store-publisher" \
  --cron "0 3 * * *" \
  --no-autorestart

# Или системный cron
echo "0 3 * * * cd /root/aisell/extensions/webchat-sidebar && source .env && ./scripts/publish-to-chrome-store.sh >> /var/log/chrome-store-publish.log 2>&1" | crontab -
```

### Вариант 3: GitHub Actions (при git push)

Создай `.github/workflows/publish-extension.yml`:

```yaml
name: Publish to Chrome Web Store
on:
  push:
    tags:
      - 'v*'
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build extension
        run: |
          cd extensions/webchat-sidebar
          node build.js --name "NoxonBot - AI Website Builder" --version "${{ github.ref_name }}"
      - name: Publish to Chrome Web Store
        env:
          CHROME_STORE_CLIENT_ID: ${{ secrets.CHROME_STORE_CLIENT_ID }}
          CHROME_STORE_CLIENT_SECRET: ${{ secrets.CHROME_STORE_CLIENT_SECRET }}
          CHROME_STORE_REFRESH_TOKEN: ${{ secrets.CHROME_STORE_REFRESH_TOKEN }}
        run: ./extensions/webchat-sidebar/scripts/publish-to-chrome-store.sh
```

## 📊 App Info

| Параметр | Значение |
|----------|----------|
| **App ID** | `hhdhmbcogahhehapnagdibghiedpnckn` |
| **Developer Console** | https://chrome.google.com/webstore/devconsole/5d3a8851-b66a-4fc1-abb0-a0e347a2e923/hhdhmbcogahhehapnagdibghiedpnckn/edit |
| **Public URL** | https://chrome.google.com/webstore/detail/hhdhmbcogahhehapnagdibghiedpnckn |

## 🔍 Troubleshooting

### Error: "Invalid refresh token"

```bash
# Получи новый refresh token (см. Шаг 2)
```

### Error: "Item not found"

```bash
# Проверь APP_ID в скрипте publish-to-chrome-store.sh
```

### Error: "Insufficient permissions"

```bash
# Убедись что Chrome Web Store API включен в Google Cloud Console
# https://console.cloud.google.com/apis/library/chromewebstore.googleapis.com
```

## 📚 References

- [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using_webstore_api/)
- [OAuth 2.0 for Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [chrome-webstore-upload](https://github.com/fregante/chrome-webstore-upload) - альтернативный npm пакет

## 🎯 Quick Commands

```bash
# Build + Publish одной командой
cd /root/aisell/extensions/webchat-sidebar && \
  node build.js --version "1.0.$(date +%s)" && \
  source .env && \
  ./scripts/publish-to-chrome-store.sh

# Проверить текущую версию в сторе
curl -s "https://chrome.google.com/webstore/detail/hhdhmbcogahhehapnagdibghiedpnckn" | \
  grep -oP 'Version.*?<' | head -1

# Логи последней публикации
tail -100 /var/log/chrome-store-publish.log
```
