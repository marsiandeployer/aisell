# CRM Follow-up Operations (Bananzabot)

## Назначение

Генерация и отправка персональных follow-up сообщений для коммерческих лидов в bananzabot.

## Когда использовать

- Команда `/tick` (ручная генерация follow-up)
- После квалификации новых коммерческих лидов
- Периодический re-engagement застрявших пользователей

## Архитектура

### Данные

```
/root/aisell/bananzabot/user_data/
├── crm_followups.json          # CRM состояние (квалификация, followup статус)
├── conversations.json          # История диалогов пользователей
└── conversations/[userId]/     # Детальные conversation files
    └── conversation.json
```

### Типы follow-up

| Тип | Канал | Ограничения | Риск спам-флага |
|-----|-------|-------------|-----------------|
| **Personal** (от личного аккаунта) | Telegram account + username | ✅ 1 раз на юзера навсегда! | 🔴 Высокий |
| **Bot** (от @bananza_bot) | Bot API (user_id) | ⚠️ Не спамить, daily limit 5 | 🟡 Средний |

**ВАЖНО:** Личные follow-up (от аккаунта) требуют username. Если username нет — отправляем через @bananza_bot по user_id.

## Правила Personal Follow-up

**КРИТИЧНО:**
- ✅ Отправляется **СТРОГО 1 РАЗ** на пользователя (поле `personalFollowupSentAt`)
- ✅ Только для коммерческих лидов (`verdict: "commercial"`)
- ✅ Только если `stage != "bot_created"` (бот не создан)
- ❌ НЕ отправлять если `personalFollowupSentAt` уже есть!

## Workflow: Генерация follow-up (команда /tick)

### Шаг 1: Фильтрация eligible лидов

```python
import json

with open('/root/aisell/bananzabot/user_data/crm_followups.json') as f:
    crm = json.load(f)

with open('/root/aisell/bananzabot/user_data/conversations.json') as f:
    convs = json.load(f)

eligible = []
for uid, entry in crm.items():
    q = entry.get('qualification', {})

    # Фильтры
    if q.get('verdict') != 'commercial':
        continue
    if entry.get('personalFollowupSentAt'):
        continue  # УЖЕ ОТПРАВЛЕН!
    if convs.get(uid, {}).get('stage') == 'bot_created':
        continue

    eligible.append(uid)
```

**Критерии eligible:**
- `qualification.verdict == "commercial"`
- `personalFollowupSentAt` отсутствует
- `stage != "bot_created"`

### Шаг 2: Анализ диалогов и генерация текста

Для каждого eligible лида:

1. **Прочитать историю:** `conversations.json` → messages
2. **Определить паттерн:**
   - Застрял на токене BotFather?
   - Детально описал бизнес но не завершил?
   - Задал вопросы но не вернулся?
3. **Сгенерировать персональный текст:**
   - Упомянуть детали его бизнеса
   - Напомнить где остановились
   - CTA: короткий, конкретный

**Пример good follow-up:**

```
Привет! 👋

Вижу, вы настраивали бота для раскладов и оракулов (срочный/стандартный варианты). Помню, возник вопрос с токеном от BotFather.

Если актуально — могу за пару минут помочь с получением токена и запуском бота. Все данные уже собраны, осталось только активировать 🚀

Интересно?
```

**Правила текста:**
- ✅ Персонализирован (упомянуты детали бизнеса)
- ✅ Короткий (3-5 предложений)
- ✅ Дружелюбный тон
- ✅ Конкретный CTA
- ❌ НЕ продажный/спамный

### Шаг 3: Отправка через Bot API

**Важно:** Если нет username → отправляем через **@bananza_bot**!

```javascript
// /root/aisell/bananzabot/
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function sendFollowup(userId, message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: userId,
      text: message,
      parse_mode: 'HTML'
    });
    console.log(`✅ Sent to ${userId}`);
    return { success: true };
  } catch (error) {
    const desc = error.response?.data?.description || error.message;
    console.error(`❌ Failed ${userId}: ${desc}`);
    return { success: false, error: desc };
  }
}
```

**Daily limit:** 5 сообщений в день (учитывается вместе с tips)

### Шаг 4: Обновление CRM статуса

**После успешной отправки:**

```python
import json
from datetime import datetime

with open('/root/aisell/bananzabot/user_data/crm_followups.json') as f:
    crm = json.load(f)

# ТОЛЬКО для успешно отправленных!
crm[userId]['personalFollowupSentAt'] = datetime.utcnow().isoformat() + 'Z'

with open('/root/aisell/bananzabot/user_data/crm_followups.json', 'w') as f:
    json.dump(crm, f, indent=2, ensure_ascii=False)
```

**Важно:** 
- Обновлять ТОЛЬКО для успешно отправленных!
- Если "bot was blocked" → НЕ обновлять `personalFollowupSentAt`

## Обработка ошибок

| Ошибка | Причина | Действие |
|--------|---------|----------|
| `Forbidden: bot was blocked by the user` | Юзер заблокировал бота | ❌ НЕ обновлять `personalFollowupSentAt`, пропустить |
| `Bad Request: chat not found` | User ID не существует | ❌ Пометить как `chat_not_found` |
| `Too Many Requests` | Rate limit | ⏸️ Остановить отправку, повторить через 1 час |

## Аналитика

После отправки показать:

```
=== Follow-up Sent ===
✅ Sent: 4
❌ Blocked: 1
📊 Remaining commercial leads: 48
```

## Примеры использования

### Команда /tick: Ручная генерация

```bash
# Запускается через skill tick
# 1. Проверяет eligible лидов
# 2. Генерирует персональные тексты
# 3. Показывает юзеру для подтверждения
# 4. Отправляет после подтверждения
# 5. Обновляет CRM статус
```

### Auto-followup (ОТКЛЮЧЕН по умолчанию)

```bash
# PM2 процессы crm-auto-followup и crm-auto-qualifier остановлены
# Вместо автоматики — ручной контроль через /tick
pm2 stop crm-auto-followup
pm2 stop crm-auto-qualifier
```

**Причина отключения:** Риск спама, лучше ручной контроль.

## Best Practices

1. **Приоритизируй по вовлеченности:**
   - Сначала те, у кого больше сообщений (8-12 msgs)
   - Потом средние (4-7 msgs)
   - Последние — минимальные (1-3 msgs)

2. **Контекстуальность:**
   - Расклады/оракулы → "вопрос с токеном"
   - Финансовый агрегатор → "крутая идея с кредитной кармой"
   - Шале/СПА → "навигация готова"

3. **Timing:**
   - Не отправлять ночью (22:00 - 09:00 по МСК)
   - Не отправлять в выходные (риск раздражения)
   - Лучшее время: 10:00-12:00, 15:00-18:00 будни

4. **Daily limit:**
   - Максимум 5 follow-up в день
   - Учитывать tips (общий лимит)
   - Проверять через `countTodaySentMessages()`

## См. также

- `/root/aisell/bananzabot/crmAutoFollowup.js` - автоматический followup (отключен)
- `/root/aisell/bananzabot/user_data/crm_followups.json` - CRM состояние
- `/root/aisell/TICK.md` - проектный тик с CRM аналитикой
- Skill: `tick` - операция тик (включает followup генерацию)

---

**Последнее обновление:** 2026-02-26
**Статус:** ✅ Работает, 4 follow-up отправлено сегодня
**Daily limit:** 4/5 (2026-02-26)
