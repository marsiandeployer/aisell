# ✅ Google OAuth Setup Ready

## 🎯 Все подготовлено!

### ✅ Что уже настроено:
1. **Английский интерфейс** - включен (BOT_LANGUAGE=en)
2. **ENABLE_GOOGLE_AUTH=true** - установлен
3. **Код Google Sign In** - реализован в webchat.ts
4. **Menu visibility** - Profile/Logout скрыты для неавторизованных
5. **Service Account** - /root/mycity2_key.json найден
6. **Google Cloud Project** - mycity2-1033

### ⏳ Осталось 1 шаг: Создать OAuth Client ID

## 🚀 Быстрая настройка (5 минут)

### 1. Открой Google Cloud Console
```
https://console.cloud.google.com/apis/credentials?project=mycity2-1033
```

### 2. Создай OAuth client ID

**Шаг 2.1:** Нажми **"Create Credentials" → "OAuth client ID"**

**Шаг 2.2:** Если попросит настроить OAuth consent screen:
- User Type: **External**
- App name: **NoxonBot WebChat**
- User support email: **твой email**
- Developer contact: **твой email**
- Нажми **Save and Continue**
- Scopes: пропусти (можно оставить пустым)
- Test users: пропусти
- Нажми **Save and Continue**

**Шаг 2.3:** Вернись к созданию OAuth client ID:
- Application type: **Web application**
- Name: **noxonbot-webchat-oauth**

**Шаг 2.4:** Authorized JavaScript origins:
```
https://noxonbot.wpmix.net
```

**Шаг 2.5:** Authorized redirect URIs:
```
https://noxonbot.wpmix.net/auth/google/callback
http://localhost:8091/auth/google/callback
```

**Шаг 2.6:** Нажми **Create**

**Шаг 2.7:** Скопируй **Client ID** (формат: `123456789-abc...xyz.apps.googleusercontent.com`)

### 3. Добавь Client ID в .env

```bash
# Замени CLIENT_ID_HERE на скопированный Client ID
export GOOGLE_CLIENT_ID='CLIENT_ID_HERE'

# Обнови .env файл
sed -i "s/GOOGLE_CLIENT_ID=.*/GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID/" /root/aisell/noxonbot/.env

# Перезапусти webchat
pm2 restart noxonbot-webchat
```

### 4. Проверка

Открой https://noxonbot.wpmix.net/

**Ожидаемый результат:**
- ✅ Интерфейс на английском
- ✅ Subtitle: "Build websites with AI"
- ✅ Меню (burger) показано
- ✅ **Кнопка "Sign in with Google"** видна в модальном окне! 🎉
- ✅ Telegram login тоже работает

---

## 📋 Альтернатива: Через командную строку

Если есть `gcloud` CLI:

```bash
# 1. Аутентификация
gcloud auth login

# 2. Установка проекта
gcloud config set project mycity2-1033

# 3. Включить APIs (если еще не включены)
gcloud services enable iap.googleapis.com

# 4. Создать OAuth client (через web console - см. выше)
```

---

## 🔍 Проверка текущего состояния

```bash
# Проверить что установлено
cat /root/aisell/noxonbot/.env | grep GOOGLE

# Должно показать:
# GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID_HERE (или реальный client_id)

# Проверить что webchat работает
pm2 logs noxonbot-webchat --lines 5
```

---

## 🎨 Как будет выглядеть

### До (без Client ID):
```
┌────────────────────────┐
│  Continue              │
│                        │
│  Name: [________]      │
│  Email: [________]     │
│  [Continue]            │
│                        │
│  or sign in with       │
│  Telegram             │
└────────────────────────┘
```

### После (с Client ID):
```
┌────────────────────────┐
│  Continue              │
│                        │
│  ┌──────────────────┐  │
│  │ 🔵 Sign in with  │  │
│  │    Google        │  │ ← Новая кнопка!
│  └──────────────────┘  │
│                        │
│  or continue with      │
│  email                 │
│                        │
│  Name: [________]      │
│  Email: [________]     │
│  [Continue]            │
│                        │
│  or sign in with       │
│  Telegram             │
└────────────────────────┘
```

---

## ✅ Checklist

- [ ] Открыл https://console.cloud.google.com/apis/credentials?project=mycity2-1033
- [ ] Создал OAuth client ID (Web application)
- [ ] Добавил authorized origin: https://noxonbot.wpmix.net
- [ ] Добавил redirect URI: https://noxonbot.wpmix.net/auth/google/callback
- [ ] Скопировал Client ID
- [ ] Обновил .env: `GOOGLE_CLIENT_ID=...`
- [ ] Перезапустил: `pm2 restart noxonbot-webchat`
- [ ] Проверил https://noxonbot.wpmix.net/ - кнопка Google появилась!

---

## 🐛 Troubleshooting

### Кнопка Google не появилась
```bash
# Проверь что Client ID правильный
cat /root/aisell/noxonbot/.env | grep GOOGLE_CLIENT_ID

# Не должно быть "YOUR_GOOGLE_CLIENT_ID_HERE"
# Должно быть реальное значение: 123456789-abc.apps.googleusercontent.com
```

### Ошибка "redirect_uri_mismatch"
```
Убедись что в OAuth client настройках добавлен:
https://noxonbot.wpmix.net/auth/google/callback

Точное совпадение! Без лишних слешей в конце.
```

### Ошибка "access_denied"
```
Проверь OAuth consent screen настройки:
- User Type: External
- Publishing status: Testing (для начала)
- Test users: добавь свой email
```

---

## 📚 Документация

- `/root/aisell/noxonbot/GOOGLE_AUTH_SETUP.md` - полная документация
- `/root/aisell/noxonbot/CHANGELOG_WEBCHAT.md` - список изменений
- `/root/aisell/noxonbot/start-webchat-main.sh` - startup script с настройками

---

**Project:** mycity2-1033
**Service Account:** /root/mycity2_key.json ✅
**Webchat URL:** https://noxonbot.wpmix.net
**Port:** 8091
