# Webchat Changelog

## 2026-02-18

### ✅ English Interface
- **BOT_LANGUAGE=en** - английский интерфейс по умолчанию
- **WEBCHAT_TITLE="NoxonBot - AI Website Builder"**
- **WEBCHAT_SUBTITLE="Build websites with AI"**
- **WEBCHAT_INIT_MESSAGE** - приветствие на английском

### ✅ Google OAuth Setup
- **ENABLE_GOOGLE_AUTH=true** - включен Google Sign In
- Добавлен `GOOGLE_CLIENT_ID` в `.env` (требует настройки в Google Cloud Console)
- Кнопка "Sign in with Google" появится после добавления валидного Client ID
- Telegram auth продолжает работать параллельно

### ✅ UI Improvements
- **updateMenuVisibility()** - скрывает Profile/Logout для неавторизованных пользователей
- Меню (burger icon) всегда видно
- Для неавторизованных видны только: Crawl tests, Download extension
- Для авторизованных видны все пункты меню

### 📋 Files Changed
1. `/root/aisell/noxonbot/start-webchat-main.sh`
   - BOT_LANGUAGE=en
   - ENABLE_GOOGLE_AUTH=true
   - Английские тексты интерфейса

2. `/root/aisell/noxonbot/.env`
   - GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID_HERE (требует замены)

3. `/root/aisell/noxonbot/src/webchat.ts`
   - Функция updateMenuVisibility() (строки ~1874-1886)
   - Вызовы updateMenuVisibility() в loadMeAndHistory()

### 🔧 Setup Required

Для активации Google Sign In:
1. https://console.cloud.google.com/apis/credentials
2. Create OAuth Client ID → Web application
3. Authorized origins: `https://noxonbot.wpmix.net`
4. Authorized redirect: `https://noxonbot.wpmix.net/auth/google/callback`
5. Заменить в `.env`: `GOOGLE_CLIENT_ID=реальный_client_id`
6. `pm2 restart noxonbot-webchat`

См. `/root/aisell/noxonbot/GOOGLE_AUTH_SETUP.md` для деталей.

### 🧪 Testing

Проверить на https://noxonbot.wpmix.net/:
- ✅ Интерфейс на английском
- ✅ Subtitle: "Build websites with AI"
- ✅ Меню (burger) показано всегда
- ✅ Profile/Logout скрыты для неавторизованных
- ⏳ Google Sign In появится после добавления Client ID
