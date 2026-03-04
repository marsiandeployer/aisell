# User Spec: SimpleDashboard - Улучшение пользовательского опыта

**Дата:** 2026-02-25
**Статус:** Draft
**Владелец:** Noxon Digital Factory

---

## 🎯 Проблема

Текущий SimpleDashboard работает, но:

1. **Нет структурированного интервью** - Claude спрашивает минимум, пользователь не понимает что можно
2. **Слабая адаптация под бизнес** - не выясняем контекст: отрасль, роль, цели
3. **Отсутствие онбординга** - новый пользователь не знает с чего начать
4. **Нет персонализации** - все дашборды generic, не учитывают специфику бизнеса
5. **Пропускаем возможности** - не предлагаем интеграции, alerts, automation

## 👤 Целевая аудитория

**Нетехнические пользователи:**
- Владельцы бизнеса (малый/средний)
- Менеджеры продаж / маркетинга
- Руководители отделов
- Предприниматели без технической команды

**Характеристики:**
- Не знают что такое API, SQL, Chart.js
- Нужен результат быстро (за 5-10 минут)
- Хотят готовое решение под их задачу
- Ценят когда их ведут за руку

## 💡 Решение

### 1. Адаптивное интервью в начале работы

**Что спрашивать:**

#### Блок 1: Контекст бизнеса (ОБЯЗАТЕЛЬНО)
```
1. Какой у вас бизнес? (отрасль)
   - Ритейл / E-commerce
   - B2B услуги
   - SaaS / IT продукт
   - Производство
   - Агентство (маркетинг, реклама)
   - Образование
   - Другое: ___

2. Какую роль вы выполняете?
   - Владелец бизнеса
   - Руководитель отдела (продажи/маркетинг/операции)
   - Аналитик / Data specialist
   - Проект-менеджер
   - Другое: ___

3. Сколько человек в команде?
   - Только я
   - 2-10 человек
   - 11-50 человек
   - 50+ человек
```

#### Блок 2: Цель дашборда (ОБЯЗАТЕЛЬНО)
```
4. Что вы хотите отслеживать?
   [ ] Продажи и выручку
   [ ] Маркетинг и лиды
   [ ] Операции и производство
   [ ] Финансы и P&L
   [ ] Клиентский сервис
   [ ] HR и команду
   [ ] Проекты и задачи
   [ ] Другое: ___

5. Какие конкретные вопросы должен решать дашборд?
   Примеры:
   - "Сколько продаж мы сделали за месяц?"
   - "Какие каналы маркетинга приносят больше лидов?"
   - "Где узкое место в воронке продаж?"

   Ваши вопросы:
   - ___
   - ___
   - ___
```

#### Блок 3: Источники данных (АДАПТИВНО)
```
6. Где сейчас хранятся ваши данные?
   - Excel / Google Sheets
   - CRM система (какая: ___)
   - Рекламные кабинеты (Google Ads, Яндекс.Директ)
   - Google Analytics / Metrica
   - ERP / Учетная система (какая: ___)
   - База данных (PostgreSQL, MySQL)
   - Нет, данных еще нет (сгенерируем демо)

7. Как часто нужно обновлять данные?
   - Один раз (статический дашборд)
   - Раз в неделю (ручное обновление)
   - Каждый день (автоматически)
   - В реальном времени (live)
```

#### Блок 4: Предпочтения по визуализации (ОПЦИОНАЛЬНО)
```
8. Есть ли примеры дашбордов, которые вам нравятся?
   - Ссылка на скриншот
   - Описание: ___
   - Нет, доверяю вашей экспертизе

9. Цветовая схема:
   - Как в нашем бренде (укажите цвета: ___)
   - Нейтральная (синий, серый)
   - Яркая (зеленый, оранжевый)
   - Любая подходящая
```

### 2. Улучшенный CLAUDE.md

**Добавить секции:**

#### Секция: User Interview Protocol
```markdown
## 🎤 User Interview (ОБЯЗАТЕЛЬНО в начале сессии)

Перед созданием дашборда ВСЕГДА проводи структурированное интервью:

### Минимальный набор вопросов (4 обязательных):

1. **Бизнес-контекст** (отрасль + роль)
2. **Цель дашборда** (что отслеживать)
3. **Ключевые вопросы** (3-5 бизнес-вопросов)
4. **Источник данных** (откуда брать данные)

### Формат вопросов:
- Используй multiple choice где возможно
- Давай примеры для каждого варианта
- Позволяй уточнить в свободной форме

### Адаптация:
- Если пользователь загрузил файл → пропусти вопрос про источник данных
- Если пользователь дал конкретный запрос → сократи интервью до 2-3 вопросов
- Если пользователь впервые → полное интервью
```

#### Секция: Industry Templates
```markdown
## 📊 Отраслевые шаблоны

Используй готовые шаблоны под отрасль пользователя:

### E-commerce / Ритейл
**KPIs:**
- GMV (Gross Merchandise Value)
- AOV (Average Order Value)
- Conversion Rate
- Cart Abandonment Rate
- Customer LTV

**Charts:**
- Revenue timeline (line)
- Top products (bar)
- Traffic sources (pie)
- Sales funnel (funnel)

### B2B SaaS
**KPIs:**
- MRR/ARR
- Churn Rate
- CAC (Customer Acquisition Cost)
- LTV:CAC ratio
- Active Users

**Charts:**
- MRR growth (line)
- Cohort retention (heatmap)
- Customer segments (pie)
- Pipeline stages (funnel)

### Marketing Agency
**KPIs:**
- Client Count
- Campaign ROI
- Cost per Lead
- Conversion Rate by Channel
- Budget Utilization

**Charts:**
- Campaign performance (bar)
- Channel comparison (grouped bar)
- Budget vs Spend (gauge)
- Lead sources (pie)

[Добавить шаблоны для 5-7 отраслей]
```

#### Секция: Data Source Connectors
```markdown
## 🔌 Интеграция источников данных

### Google Sheets
```javascript
// Пример подключения Google Sheets API
async function fetchGoogleSheet(sheetId, range) {
  const API_KEY = 'YOUR_API_KEY';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${API_KEY}`;
  const response = await fetch(url);
  return await response.json();
}
```

### CRM APIs (примеры)
- AmoCRM: REST API + webhook
- Bitrix24: REST API
- HubSpot: REST API
- Salesforce: SOAP/REST API

### Analytics
- Google Analytics 4: Measurement Protocol
- Yandex.Metrica: Logs API

[Конкретные инструкции для каждого источника]
```

### 3. Новый Skill: dashboard-interview.md

**Создать в `.claude/skills/dashboard-interview.md`:**

```markdown
# Dashboard Interview Skill

## Purpose
Conduct structured interview to understand user's business context and dashboard requirements.

## When to Use
- User says: "создай дашборд", "нужна аналитика", "хочу визуализировать данные"
- User visits SimpleDashboard for the first time
- User uploads data without context

## Interview Flow

### Phase 1: Business Context (Required)
Ask in conversational tone:

"Давайте начнем! Расскажите немного о вашем бизнесе:
- Чем вы занимаетесь? (например: интернет-магазин, B2B услуги, производство)
- Какая ваша роль? (владелец, менеджер, аналитик)"

### Phase 2: Dashboard Goal (Required)
"Отлично! Теперь о дашборде:
- Что именно нужно отслеживать? (продажи, маркетинг, операции, финансы)
- Какие 3 главных вопроса должен решать дашборд?"

### Phase 3: Data Source (Adaptive)
If no file uploaded:
"Где сейчас хранятся данные?
- В Excel или Google Таблицах
- В CRM (AmoCRM, Bitrix24, другая)
- В Google Analytics / Яндекс.Метрике
- Данных пока нет (создадим демо)"

If file uploaded:
"Вижу, вы загрузили файл. Как часто нужно обновлять дашборд?
- Один раз (статический)
- Раз в неделю (я буду загружать новые данные)
- Автоматически (нужна интеграция)"

### Phase 4: Visual Preferences (Optional)
"Последний вопрос - есть ли примеры дашбордов, которые вам нравятся?
Или доверите мне подобрать подходящий дизайн под вашу задачу?"

## Output Format
After interview, save to session context:
```json
{
  "business": {
    "industry": "e-commerce",
    "role": "owner",
    "team_size": "2-10"
  },
  "dashboard": {
    "goals": ["track sales", "analyze marketing channels", "monitor inventory"],
    "questions": [
      "How many sales did we make this month?",
      "Which marketing channel brings most customers?",
      "What products are selling best?"
    ],
    "update_frequency": "daily"
  },
  "data": {
    "source": "google_sheets",
    "url": "https://docs.google.com/spreadsheets/d/...",
    "integration_needed": true
  },
  "preferences": {
    "template": "e-commerce",
    "colors": "brand"
  }
}
```

## Adaptation Rules
- First-time user → Full interview (all 4 phases)
- Returning user → Skip Phase 1-2, ask only new questions
- User with clear request ("Sales dashboard for my shop") → Short interview (Phase 2-3 only)
- User uploaded file → Skip source question, ask only update frequency
```

### 4. Обновить product.yaml

Добавить секцию с вопросами:

```yaml
interview_flow:
  required_questions:
    - business_context
    - dashboard_goal
    - key_questions
    - data_source

  optional_questions:
    - visual_preferences
    - update_frequency
    - integration_requirements

  adaptation_rules:
    first_time: "full_interview"
    returning: "short_interview"
    file_uploaded: "skip_data_source"
    clear_request: "minimal_interview"
```

## ✅ Acceptance Criteria

### Must Have:
1. ✅ Новый пользователь получает структурированное интервью (4 обязательных вопроса)
2. ✅ Интервью адаптируется под контекст (файл загружен / четкий запрос / первый раз)
3. ✅ CLAUDE.md содержит секцию "User Interview Protocol" с четкими инструкциями
4. ✅ CLAUDE.md содержит 5+ отраслевых шаблонов (E-commerce, B2B SaaS, Agency, etc.)
5. ✅ Создан skill `dashboard-interview.md` в `.claude/skills/`
6. ✅ Дашборд учитывает отрасль пользователя (отраслевые KPI + визуализации)

### Nice to Have:
1. 🎯 Примеры интеграций для 5+ популярных источников (Google Sheets, AmoCRM, Google Analytics, etc.)
2. 🎯 Сохранение контекста пользователя между сессиями
3. 🎯 Автоматическое предложение шаблонов на основе ответов
4. 🎯 Валидация данных (проверка доступности Google Sheets, API ключей)

## 🎨 User Experience

### Before (текущее):
```
User: "Нужен дашборд для продаж"
Claude: "Окей, какие данные у вас есть?"
User: [загружает Excel]
Claude: [создает generic дашборд с Revenue, Orders, Products]
```

### After (улучшенное):
```
User: "Нужен дашборд для продаж"

Claude: "Отлично! Давайте я задам несколько вопросов, чтобы создать дашборд именно под вашу задачу:

1. Расскажите о вашем бизнесе:
   - Чем занимаетесь? (например: интернет-магазин, B2B, производство)
   - Какая ваша роль?"

User: "Интернет-магазин одежды, я владелец"

Claude: "Понял! Для e-commerce обычно важны такие вещи:
- GMV (общая сумма заказов)
- Средний чек
- Конверсия корзины
- Топ товары

Что из этого для вас важнее всего? Или есть другие метрики?"

User: "Да, это все важно. Еще хочу видеть откуда приходят клиенты"

Claude: "Отлично! Добавлю анализ источников трафика.

Где сейчас ваши данные?
- Excel / Google Таблицы
- CRM (какая?)
- Google Analytics
- Нет данных (создадим демо)"

User: "Google Analytics и таблица в Excel"

Claude: "Супер! Могу создать:

1. Демо-дашборд с примерами данных (быстро, 2 минуты)
2. Дашборд с вашими реальными данными из Excel + инструкция как подключить Google Analytics

Что выберете?"

User: "Давай сначала демо, посмотрю как выглядит"

Claude: [создает E-commerce Dashboard с отраслевыми KPI]

"Вот ваш дашборд!
- GMV и средний чек
- Топ 10 товаров
- Источники трафика (демо данные)
- Воронка продаж

Нравится? Тогда покажу как загрузить ваши данные из Excel."
```

## 🚀 Implementation Plan

### Phase 1: Core Interview (1-2 hours)
1. Создать `/root/aisell/products/simple_dashboard/.specs/` directory
2. Написать `dashboard-interview.md` skill
3. Обновить `CLAUDE.md` - добавить секцию "User Interview Protocol"
4. Тестировать на 3-5 примерах разных индустрий

### Phase 2: Industry Templates (2-3 hours)
1. Собрать 7 отраслевых шаблонов:
   - E-commerce
   - B2B SaaS
   - Marketing Agency
   - Retail / Restaurant
   - Manufacturing
   - Real Estate
   - Healthcare
2. Добавить в CLAUDE.md секцию "Industry Templates"
3. Тестировать каждый шаблон

### Phase 3: Data Source Integration (3-4 hours)
1. Документировать интеграции:
   - Google Sheets (прямое подключение)
   - CSV upload workflow
   - CRM APIs (инструкции)
2. Создать код-сниппеты для частых интеграций
3. Добавить в CLAUDE.md секцию "Data Source Connectors"

### Phase 4: Testing & Refinement (1-2 hours)
1. E2E тест: новый пользователь → интервью → дашборд
2. Проверить адаптацию под разные сценарии
3. Собрать feedback, итерировать

## 📝 Notes

- Интервью должно быть **разговорным**, не как форма
- Multiple choice > Free text (но всегда давать "Другое: ___")
- Примеры в каждом вопросе обязательны
- Не спрашивать про технические детали (API keys, SQL) - это Claude берет на себя

## 🔗 References

- [Текущий CLAUDE.md](/root/aisell/products/simple_dashboard/CLAUDE.md)
- [product.yaml](/root/aisell/products/simple_dashboard/product.yaml)
- [Showcases examples](/root/aisell/products/simple_dashboard/showcases/)
