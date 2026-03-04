# Chrome Extensions Architecture - Two Product Lines

## 🎯 Общая концепция

Два независимых расширения с общим чатом WebChat, но **разными целями, описаниями и showcase кейсами**.

**Общее:**
- Оба используют WebChat в sidebar (один и тот же бэкенд botplatform)
- Общий механизм работы: чат → генерация → превью → публикация
- Технически: одинаковая структура extension (build.js, manifest, icons)

**Отличия:**
- Название, описание, иконки
- Набор showcase скриншотов
- Целевая аудитория и позиционирование
- Промпты и примеры в описании

---

## 📦 Extension 1: NoxonBot - AI Website Builder

**Название:** NoxonBot - AI Website Builder
**Short Name:** NoxonBot
**URL:** https://noxonbot.wpmix.net

### Позиционирование

**Для кого:** Малый бизнес, фрилансеры, специалисты услуг
**Что делает:** Создает landing pages, формы записи, промо-сайты через AI чат

### Описание (Chrome Web Store)

```
Create landing pages, booking forms, and websites using AI chat. Publish to web instantly. No coding required.

✨ What you can build:
• Landing pages for business, products, services
• Booking forms (salon, dentist, yoga studio)
• Product catalogs and portfolios
• Contact forms and lead capture
• Promo pages and event registration

🤖 AI-powered:
• Generate HTML/CSS from chat description
• Instant preview in sidebar
• Edit in chat ("change color", "add form")
• AI-generated backgrounds
• Responsive design

🌐 Publish to web:
• Custom domain (your-site.ru)
• 24/7 hosting with HTTPS/SSL
• Analytics and tracking
• Subscription plans
```

### Showcase кейсы (скриншоты)

**Директория:** `previews/cases/`

1. **Парикмахерская: форма записи с календарем и профилем мастера** ✅
   - `previews/cases/hairdresser-booking-calendar/`
   - Промпт: "Make booking form for hair salon with calendar and stylist profile with photo"
   - Результат: форма записи, календарь слотов, профиль парикмахера с фото

2. **Кофейня: меню и бронирование столика** ✅
   - `previews/cases/coffee-shop-menu-reservation/`
   - Промпт: "Coffee shop landing page with online menu and reservation form"
   - Результат: меню напитков, форма бронирования

3. **Студия йоги: расписание и онлайн-запись**
   - `previews/cases/yoga-studio-schedule/`
   - Промпт: "Yoga studio page with class schedule and booking"
   - Результат: календарь занятий, форма записи, описание программ

4. **Фотограф: портфолио и контактная форма**
   - `previews/cases/photographer-portfolio/`
   - Промпт: "Photographer portfolio with contact form"
   - Результат: галерея работ, прайс, форма заявки

5. **Ресторан: меню доставки и заказ онлайн**
   - `previews/cases/restaurant-delivery-menu/`
   - Промпт: "Restaurant delivery menu with online ordering"
   - Результат: категории блюд, корзина, форма заказа

6. **Стоматология: услуги и запись к врачу**
   - `previews/cases/dentist-booking/`
   - Промпт: "Dentist clinic page with services and booking"
   - Результат: прайс услуг, форма записи, информация о врачах

### Целевая аудитория

- 💈 Салоны красоты, парикмахерские
- 🦷 Стоматологии, медицинские клиники
- 🧘 Студии йоги, фитнес-центры
- 🍕 Рестораны, кафе, доставка еды
- 📸 Фотографы, дизайнеры
- 🏠 Аренда жилья, недвижимость
- 💻 Фрилансеры и специалисты

### Ключевые слова (Chrome Web Store)

```
landing page builder, AI website creator, booking form generator,
no-code website, business landing page, appointment booking,
salon booking form, restaurant menu, yoga studio schedule
```

---

## 📊 Extension 2: DashboardAI - Business Dashboard Builder

**Название:** DashboardAI - Business Dashboard Builder
**Short Name:** DashboardAI
**URL:** https://dashboardai.wpmix.net (или новый домен)

### Позиционирование

**Для кого:** Предприниматели, менеджеры, аналитики
**Что делает:** Создает дашборды для аналитики, отчетов, мониторинга через AI чат

### Описание (Chrome Web Store)

```
Build business dashboards, analytics panels, and admin interfaces using AI chat. Real-time data, charts, KPIs.

📊 What you can build:
• Sales dashboards with KPIs and charts
• Analytics panels (Google Analytics style)
• Admin interfaces for data management
• Monitoring dashboards (server, API status)
• CRM-style lead boards
• Inventory and stock dashboards

🤖 AI-powered:
• Generate dashboard from chat description
• Real-time charts (bar, line, pie, gauge)
• Connect to data sources (API, JSON, CSV)
• Edit layout in chat ("add pie chart", "change colors")
• Responsive grid layout

🔌 Data integration:
• REST API connection
• Google Sheets integration
• CSV/JSON import
• Webhook receivers
• Real-time updates

🌐 Publish & share:
• Custom domain
• 24/7 hosting with HTTPS
• Role-based access (admin/viewer)
• Embed dashboards in websites
```

### Showcase кейсы (скриншоты)

**Директория:** `previews/dashboards/`

1. **Дашборд продаж: графики, KPI, таблица лидов**
   - `previews/dashboards/sales-kpi-leads/`
   - Промпт: "Sales dashboard with KPIs, charts and leads table"
   - Результат: KPI cards (revenue, deals, conversion), line charts, lead list

2. **Аналитика сайта: трафик, источники, география**
   - `previews/dashboards/website-analytics/`
   - Промпт: "Website analytics dashboard like Google Analytics"
   - Результат: visitors chart, traffic sources pie, geo map, top pages

3. **Админка заказов: статусы, поиск, фильтры**
   - `previews/dashboards/order-admin-panel/`
   - Промпт: "Order management admin panel with filters"
   - Результат: orders table, status filters, search, order details

4. **Мониторинг серверов: uptime, CPU, память, алерты**
   - `previews/dashboards/server-monitoring/`
   - Промпт: "Server monitoring dashboard with uptime and resource usage"
   - Результат: server status cards, CPU/RAM gauges, uptime chart, alerts

5. **CRM дашборд: воронка продаж, активности, таски**
   - `previews/dashboards/crm-sales-funnel/`
   - Промпт: "CRM dashboard with sales funnel and activities"
   - Результат: funnel chart, activity feed, tasks list, deal cards

6. **Складской учет: остатки, движение, категории**
   - `previews/dashboards/inventory-stock/`
   - Промпт: "Inventory dashboard with stock levels and movements"
   - Результат: low stock alerts, stock by category, movement history

### Целевая аудитория

- 📈 Руководители и менеджеры (sales, operations)
- 💼 Предприниматели (e-commerce, SaaS)
- 📊 Аналитики (marketing, product)
- 🖥️ DevOps и системные администраторы
- 🏢 Небольшие компании (нужен простой BI)
- 🚀 Стартапы (MVP dashboard для инвесторов)

### Ключевые слова (Chrome Web Store)

```
business dashboard, analytics dashboard, admin panel builder,
KPI dashboard, sales dashboard, monitoring dashboard,
real-time charts, data visualization, no-code dashboard
```

---

## 🏗️ Техническая структура

### Общая кодовая база

```
/root/aisell/extensions/
├── webchat-sidebar/           # Базовый код extension
│   ├── build.js               # Билдер (параметры --name, --url)
│   ├── src/                   # Исходники (общие для всех)
│   │   ├── background.js
│   │   ├── panel.html
│   │   ├── panel.js
│   │   └── icons/             # Иконки (разные для каждого extension)
│   ├── previews/
│   │   ├── landing-pages/     # Showcase для NoxonBot
│   │   └── dashboards/        # Showcase для DashboardAI
│   └── out/                   # Build output
│       └── webchat-sidebar/   # Unpacked extension
└── ARCHITECTURE.md            # Этот файл
```

### Build команды

#### NoxonBot (Landing Pages)
```bash
cd /root/aisell/extensions/webchat-sidebar

node build.js \
  --name "NoxonBot - AI Website Builder" \
  --short-name "NoxonBot" \
  --url "https://noxonbot.wpmix.net" \
  --description "Create landing pages, booking forms, and websites using AI chat. Publish to web instantly. No coding required." \
  --version "1.0.0"
```

#### DashboardAI (Dashboards)
```bash
cd /root/aisell/extensions/webchat-sidebar

node build.js \
  --name "DashboardAI - Business Dashboard Builder" \
  --short-name "DashboardAI" \
  --url "https://dashboardai.wpmix.net" \
  --description "Build business dashboards, analytics panels, and admin interfaces using AI chat. Real-time data, charts, KPIs." \
  --version "1.0.0"
```

### Иконки

**Структура:**
```
src/icons/
├── noxonbot/              # Иконки для NoxonBot
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── dashboardai/           # Иконки для DashboardAI
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

**Build процесс:**
- Добавить параметр `--icons-dir` в build.js
- Или: копировать нужные иконки в `src/icons/` перед билдом

---

## 🎨 WebChat Backend (botplatform)

### Разделение по доменам

**Один бэкенд (`botplatform`), но разные домены:**

| Extension | Domain | Backend Port | Language | Features |
|-----------|--------|--------------|----------|----------|
| NoxonBot | noxonbot.wpmix.net | 8091 | RU | Landing pages, forms |
| DashboardAI | dashboardai.wpmix.net | 8093 (новый) | EN | Dashboards, charts |

**Или:**
- Оба на одном порту (8091), но с разными `/dashboard` и `/landing` endpoints
- Бэкенд определяет "режим" по Origin header или query параметру

### Конфигурация WebChat

**В `botplatform/`:**

```javascript
// webServer.js - добавить режим dashboard
const isDashboardMode = req.headers.origin?.includes('dashboardai') || req.query.mode === 'dashboard';

const systemPrompt = isDashboardMode
  ? 'You are DashboardAI - expert in building business dashboards...'
  : 'You are NoxonBot - expert in creating landing pages...';
```

**Или:** Создать отдельный файл `dashboardWebServer.js` для DashboardAI (копия webServer.js с другим промптом)

---

## 📝 Roadmap

### Phase 1: Создать showcase кейсы (Landing Pages)
- [x] Coffee shop menu + reservation
- [x] Hairdresser booking with calendar
- [ ] Yoga studio schedule
- [ ] Photographer portfolio
- [ ] Restaurant delivery menu
- [ ] Dentist clinic booking

### Phase 2: Подготовить NoxonBot к публикации
- [ ] Финальные иконки (16/32/48/128)
- [ ] Экспорт всех showcase в CWS формат (1280x800, 640x400)
- [ ] Написать полное описание для Chrome Web Store
- [ ] Создать promotional tiles (440x280, 920x680, 1400x560)
- [ ] Подготовить privacy policy

### Phase 3: Создать showcase кейсы (Dashboards)
- [ ] Sales KPI dashboard
- [ ] Website analytics
- [ ] Order admin panel
- [ ] Server monitoring
- [ ] CRM sales funnel
- [ ] Inventory stock

### Phase 4: Разработать DashboardAI extension
- [ ] Настроить отдельный домен (dashboardai.wpmix.net)
- [ ] Создать иконки для DashboardAI
- [ ] Адаптировать WebChat для dashboard режима
- [ ] Подготовить к публикации в CWS

---

## 🔑 Ключевые отличия расширений

| Параметр | NoxonBot (Landing Pages) | DashboardAI (Dashboards) |
|----------|--------------------------|--------------------------|
| **Название** | NoxonBot - AI Website Builder | DashboardAI - Business Dashboard Builder |
| **Иконка** | 🌐 Планета/сайт (синяя) | 📊 График/чарт (зеленая) |
| **Цель** | Создание landing pages | Построение дашбордов |
| **Аудитория** | Малый бизнес, услуги | Менеджеры, аналитики |
| **Результат** | Публичный сайт/форма | Приватный дашборд/админка |
| **Showcase** | Салон, кофейня, йога | Sales KPI, аналитика, CRM |
| **Промпты** | "booking form", "menu" | "sales dashboard", "analytics" |
| **Данные** | Статичный контент + формы | Графики, таблицы, real-time |
| **Интеграции** | Google OAuth, forms | API, Google Sheets, webhooks |

---

**Дата создания:** 2026-02-18
**Версия:** 1.0
**Автор:** Claude Sonnet 4.5
