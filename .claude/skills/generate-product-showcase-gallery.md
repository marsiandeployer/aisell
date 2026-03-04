# Showcase Create

**Когда использовать:** "сделай шоукейс", "создай showcase", "добавь демо", "создай пример для SimpleDashboard/SimpleSite",
"добавь шоукейс для продукта", "create showcase", "add demo example", "make a showcase"

Система создания шоукейсов (showcase) для демонстрации продуктов SimpleSite и SimpleDashboard.

**Что такое шоукейс:**
- Скриншот 1280x800px с результатом работы AI
- Промпт пользователя встроен в скриншот внизу (в кавычках)
- Два формата: **только результат** (по умолчанию) или **с чатом** (если нужно показать диалог с Claude)

**Новый формат (2026-02-19):**
- ✅ Промпт встроен в page.html (внизу серая полоска с текстом в кавычках)
- ✅ Скриншот 1280x800, из них 50px под промпт, 750px под контент
- ✅ **demo.html** - полная живая демка для просмотра в браузере
- ✅ Доступ: `/showcases/{slug}/demo` (например: `/showcases/sales-analytics-utm/demo`)
- ✅ Gallery с кнопками "🚀 Live Demo" и "📸 Screenshot"

**JIT (Just-in-Time) для SimpleDashboard:**
- ✅ Данные графиков генерируются динамически через JavaScript при загрузке
- ✅ Каждый раз свежие данные (можно добавить рандомизацию)
- ✅ Меньше размер файла, легко обновлять
- ✅ Реалистичная симуляция дашборда

**i18n (ОБЯЗАТЕЛЬНО!):**
- ✅ Все demo.html и index.html ОБЯЗАТЕЛЬНО включают EN/RU поддержку
- ✅ Английский по умолчанию, русский автоматически для `navigator.language.startsWith('ru')`
- ✅ Переключалка языка видна ТОЛЬКО для русских браузеров
- ✅ См. секцию "i18n" в `products/<product>/CLAUDE.md` для паттерна реализации

**Билингвальные скриншоты (ОБЯЗАТЕЛЬНО!):**
- ✅ Для каждого showcase создаются ДВА скриншота: EN и RU
- ✅ `screenshot-1280x800.png` — английская версия (по умолчанию)
- ✅ `screenshot-1280x800-ru.png` — русская версия
- ✅ Скрипт: `node extensions/webchat-sidebar/scripts/screenshot_bilingual.js <demo.html> <output-dir>`
- ✅ В gallery index.html: `<img data-img-en="...png" data-img-ru="...-ru.png">` для переключения

**⚠️ ВАЖНО: Только 1 экран!**
- Лендинг/дашборд должен помещаться в 1 экран (без скролла)
- НЕ создавай многостраничные лендинги с секциями features/testimonials/footer
- Showcase демонстрирует конкретную фичу, а не полноценный сайт

## 📝 Типичный запрос от пользователя

Пользователь обычно просит:
> "создай шоукейс на тему 'лендинг пейдж студии йоги с кнопкой записаться'"

Это означает:
1. Сначала создай лендинг в `<user-workspace>/index.html` (используй skill `make-landing-page.md`)
2. Затем сделай скриншот через `render_promo_preview.js`
3. **Левая часть:** iframe с реальным лендингом (<WEBCHAT_URL>/preview показывает index.html)
4. **Правая часть:** чат WebChat
5. **Результат:** Скриншот 1280x800 показывающий работу продукта

## 🎯 Концепция

**Формат:** Экран разделен на 2 части:
- **Слева (67%):** iframe с <WEBCHAT_URL>/preview (показывает файлы из <user-workspace>/)
- **Справа (33%):** iframe с <WEBCHAT_URL>/app (чат WebChat)

**ВАЖНО:** Левый iframe показывает РОВНО то, что создал Claude. Никаких дополнительных CSS эффектов, затемнений или фоновых картинок в шаблоне!

**Размеры:**
- Базовый скриншот: `1280x800px`
- Chrome Web Store форматы: `1280x800`, `640x400`

## ⛔ ПРАВИЛО: Скриншоты только после апрува!

**ОБЯЗАТЕЛЬНО:** После создания demo.html и page.html:
1. Покажи пользователю что получилось (Read tool для визуальной проверки)
2. Спроси "Генерировать скриншоты?" через AskUserQuestion
3. **НЕ генерируй скриншоты автоматически** — пользователь должен сначала убедиться в результате

## ⛔ ПРАВИЛО: Никаких .txt файлов!

**ЗАПРЕЩЕНО:** `prompt.txt`, `caption.txt`, `prompt-title.txt`
**ПРАВИЛЬНО:** Всё в `config.yaml` → поля `prompt`, `prompt_title`, `caption`

## 📄 config.yaml - Конфигурация showcase для воспроизводимости

**⚠️ ОБЯЗАТЕЛЬНО создавать для каждого showcase!**

### Зачем нужен config.yaml

**Проблема:** Без документации невозможно воспроизвести showcase через месяц.

**Решение:** Сохранять ВСЕ параметры в config.yaml:
- Полный промпт пользователя
- Промпт для Hydra AI (если использовался)
- Структуру demo (sections/pages)
- Параметры JIT генерации данных
- Дизайн (цвета, шрифты)
- Шаги для воспроизведения

### Структура config.yaml

```yaml
# Showcase Configuration
showcase:
  slug: showcase-slug-name
  product: simple_site | simple_dashboard
  type: spa | landing
  prompt: "Полный промпт пользователя"
  prompt_title: "Краткий промпт-заголовок"
  caption: "English caption for gallery"

demo:
  format: single_page_application | multi_section_landing
  navigation: hash_based | smooth_scroll

  # Для SimpleDashboard
  pages:
    - id: overview
      title: "Overview"
      components: [...]

  # Для SimpleSite
  sections:
    - id: home
      title: "Hero"
      type: hero_with_background

  design:
    colors:
      primary: "blue-600"
    fonts:
      heading: "font-extralight"

# Для SimpleDashboard
jit_data_generation:
  approach: "JIT with random realistic data"
  volatility: 0.3

  generators:
    revenue:
      base_value: 20
      algorithm: |
        JavaScript code snippet

# Для SimpleSite с AI фоном
background:
  type: ai_generated
  generator: hydra_ai
  model: flux-schnell-uncensored
  prompt: |
    Full Hydra AI prompt here
  overlay: "bg-gradient-to-b from-black/45..."

screenshot:
  resolution: 1280x800
  caption_height: 50px

reproduction_steps:
  - "1. Step one"
  - "2. Step two"
  - "..."
```

### Примеры

**SimpleDashboard (SPA с JIT):**
```yaml
showcase:
  slug: sales-analytics-utm
  product: simple_dashboard
  type: spa
  prompt: "Сделай аналитику продаж моего курса с учетом источников трафика (utm меток)"

demo:
  format: single_page_application
  navigation: hash_based
  data_generation: jit

  pages:
    - id: overview
      components: [kpi_cards, line_chart, bar_chart]
    - id: utm
      components: [doughnut_chart, table]

jit_data_generation:
  volatility: 0.3
  trend: 0.15

  generators:
    revenue:
      base_value: 20
      algorithm: |
        const baseValue = 20;
        return Array.from({ length: 7 }, (_, i) => {
          const trendValue = baseValue * (1 + 0.15 * (i / 6));
          return Math.round(trendValue + (Math.random() - 0.5) * 0.3 * trendValue);
        });
```

**SimpleSite (Landing с AI фоном):**
```yaml
showcase:
  slug: yoga-promo
  product: simple_site
  type: landing
  prompt: "Zen yoga studio minimalist hero landing page with serene nature photo background"

demo:
  format: multi_section_landing
  navigation: smooth_scroll

  sections:
    - id: home
      type: hero_with_background
    - id: classes
      type: grid_cards
    - id: pricing
      type: pricing_cards

background:
  type: ai_generated
  generator: hydra_ai
  model: flux-schnell-uncensored
  prompt: |
    Beautiful serene zen yoga studio interior, large windows with natural sunlight,
    wooden floor, green bamboo plants, peaceful meditation space, professional photography
  overlay: "bg-gradient-to-b from-black/45 via-black/35 to-black/50"
```

### Где хранить

```
<project-root>/products/<product>/showcases/<slug>/
├── demo.html                  # Живая демка
├── page.html                  # Обертка для скриншота
├── config.yaml                # ← prompt, prompt_title, caption + конфиг
├── screenshot-1280x800.png    # EN скриншот
├── screenshot-1280x800-ru.png # RU скриншот
├── screenshot-640x400.png     # EN thumbnail
├── screenshot-640x400-ru.png  # RU thumbnail
└── bg.jpg                     # Если использовался AI фон
```

**⚠️ НЕ СОЗДАВАЙ:** `prompt.txt`, `caption.txt`, `prompt-title.txt` — линтер заблокирует!

## 📁 Структура проекта

```
<project-root>/extensions/webchat-sidebar/
├── previews/
│   ├── cases/
│   │   ├── <case-slug>/
│   │   │   ├── config.yaml          # prompt, prompt_title, caption + конфиг
│   │   │   ├── page.html           # HTML результата (левая часть)
│   │   │   ├── screenshot.png      # Итоговый скриншот 1280x800
│   │   │   ├── screenshot-1280x800.png  # CWS формат
│   │   │   ├── screenshot-640x400.png   # CWS формат
│   │   │   └── README.md           # Описание кейса (опционально)
│   │   └── ...
│   └── promo-yoga-with-calendar.html  # Пример шаблона
├── scripts/
│   ├── render_promo_preview.js     # Puppeteer рендер
│   └── export_cws_screenshots.py   # Экспорт в CWS форматы
└── store_assets/
    └── previews/
        └── nanabanana-yoga-bg.png  # Фоны из Hydra AI

```

## 🎨 Новый формат showcase (2026-02-19)

### Структура page.html

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Showcase</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Для SimpleDashboard добавить Chart.js -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    html, body {
      width: 1280px;
      height: 800px;
      overflow: hidden;
      margin: 0;
      padding: 0;
    }
    .showcase-container {
      height: calc(100% - 50px); /* 750px для контента */
    }
    .prompt-caption {
      height: 50px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f9fafb;
      border-top: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 14px;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="showcase-container">
    <!-- ВСТАВИТЬ СЮДА ПОЛНОСТЬЮ index.html (без html/head/body тегов) -->
  </div>

  <div class="prompt-caption">
    "ПРОМПТ ПОЛЬЗОВАТЕЛЯ В КАВЫЧКАХ"
  </div>
</body>
</html>
```

**Ключевые моменты:**
- ✅ Контент встроен НАПРЯМУЮ (не через iframe!)
- ✅ Промпт внизу на серой полоске (50px)
- ✅ Контент занимает 750px (800 - 50)
- ✅ БЕЗ сайдбара с чатом (по умолчанию)

### Опциональный формат С чатом

Если нужно показать диалог с Claude, добавь скрываемый сайдбар:

```html
<style>
  .content { flex: 1; }
  .content.with-sidebar { width: 67%; flex: none; }
  .sidebar { width: 33%; display: none; border-left: 1px solid #e5e7eb; }
  .sidebar.visible { display: block; }
</style>

<div class="showcase-container flex">
  <div class="content with-sidebar">
    <!-- Контент -->
  </div>
  <div class="sidebar visible">
    <iframe src="<WEBCHAT_URL>/app"></iframe>
  </div>
</div>
```

**Когда использовать с чатом:**
- Важно показать КАК Claude ответил на промпт
- Демонстрация диалога (несколько сообщений)
- Showcase бота, а не результата

## 🔧 Создание нового showcase

**ВАЖНО:** Есть два подхода - автоматический (через бота) и ручной (рекомендуется).

### ⚠️ Проблемы автоматического подхода

1. **Webchat конфликтует с Telegram** - ошибка 409 при запуске в обычном режиме
2. **Статусные сообщения** - бот показывает "⏳ Launching Claude" во время работы
3. **Timing issues** - нужно точно поймать момент когда бот закончил (не раньше, не позже)

### ✅ Рекомендуемый подход (Manual Showcase)

Создавать showcase вручную с готовым HTML и финальным диалогом:

### Шаг 1: Подготовка окружения

```bash
PRODUCT="simple_site"  # simple_site | simple_dashboard
SLUG="my-showcase-slug"  # Например: coffee-shop-menu
PROMPT="Your prompt here"  # Например: "Coffee shop landing with menu"
CASE_DIR="<project-root>/products/$PRODUCT/showcases/$SLUG"

# Очистить окружение
rm -rf "$CASE_DIR"
rm -f <user-workspace>/*.html
rm -f <user-workspace>/.history.json

# ⚠️ ВАЖНО: Скопировать CLAUDE.md продукта!
cp <project-root>/products/$PRODUCT/CLAUDE.md <user-workspace>/CLAUDE.md
echo "✅ Copied $PRODUCT CLAUDE.md"

# Создать структуру
mkdir -p "$CASE_DIR"
# ⚠️ НЕ создавай .txt файлы! Промпт и caption хранятся в config.yaml
cp <project-root>/extensions/webchat-sidebar/previews/templates/chat-frame-base.html "$CASE_DIR/page.html"
```

**Источники CLAUDE.md:**
| Продукт | Путь |
|---------|------|
| SimpleSite | `<project-root>/products/simple_site/CLAUDE.md` |
| SimpleDashboard | `<project-root>/products/simple_dashboard/CLAUDE.md` |

### Шаг 2: Создать HTML лендинг

Создай лендинг в `<user-workspace>/index.html`:

```bash
# Используй skill make-landing-page.md или создай вручную
# ВАЖНО: Только градиентный фон, БЕЗ SVG/images!
# Пример см. выше в разделе "Лендинг Bean & Brew"
```

**Требования к лендингу:**
- ✅ ТОЛЬКО `index.html` (не другие имена!)
- ✅ Чистый CSS gradient фон (БЕЗ url(), БЕЗ data:image/svg)
- ✅ Адаптивная верстка
- ✅ CTA кнопка хорошо видна

### Шаг 3: Создать историю чата

Создай `<user-workspace>/.history.json` с финальным диалогом (БЕЗ статусных сообщений!):

```json
[
  {
    "from": "admin",
    "date": "2026-02-18T18:49:00.000Z",
    "text": "Coffee shop landing page with online menu and reservation form"
  },
  {
    "from": "Bot",
    "date": "2026-02-18T18:49:35.000Z",
    "text": "Coffee shop landing created! ☕\n\nPage includes:\n• Menu with 6 specialty drinks\n• Reservation form (name, email, phone, date, time, guests)\n• Warm brown gradient background\n• \"Book Your Table\" CTA button\n\nSaved to /work/index.html"
  }
]
```

**⚠️ ВАЖНО:**
- НЕ включай "⏳ Launching Claude" или "still working" - только финальный ответ!
- Используй реальные timestamps
- Формат от бота должен быть информативным но кратким

### Шаг 4: Сгенерировать скриншот

```bash
cd <project-root>/extensions/webchat-sidebar

rm -f "$CASE_DIR/screenshot"*.png

# ВАЖНО: БЕЗ --chat-zoom-steps или с --chat-zoom-steps 0!
node scripts/render_promo_preview.js \
  --html "$CASE_DIR/page.html" \
  --out "$CASE_DIR/screenshot.png"

ls -lh "$CASE_DIR/screenshot.png"
```

**Результат:** Скриншот 1280x800 с лендингом слева и чатом справа.

---

## 📖 Старый workflow (для справки)

### Создать page.html (НЕ ИСПОЛЬЗУЕТСЯ в manual подходе)

Используй шаблон из `previews/promo-yoga-with-calendar.html`:

**Обязательные элементы:**
- `<html>`, `<body>` с фиксированными размерами 1280x800
- `.browser` контейнер с topbar
- `.body` grid с left (67%) и right (33%)
- `.left` с фоном из NanaBanana
- `.right` с iframe чата
- `.chat-frame` - класс для iframe

**CSS размеры:**
```css
html, body {
  margin: 0;
  width: 1280px;
  height: 800px;
  overflow: hidden;
}
.browser {
  width: 1240px;
  height: 760px;
  margin: 20px auto;
}
.body {
  grid-template-columns: 67% 33%;
}
```

### Шаг 3: Сгенерировать фон (опционально)

Если нужен новый фон:
```bash
# См. skill image-generation.md
# Промпт: "close-up yoga studio mat and props, detailed texture"
# Сохранить в store_assets/previews/nanabanana-<theme>-bg.png
```

Затем в page.html:
```css
.left {
  background-image: url("../store_assets/previews/nanabanana-<theme>-bg.png");
}
```

### Шаг 4: Проверка /preview перед скриншотом

**КРИТИЧЕСКИ ВАЖНО:** Перед созданием скриншота ВСЕГДА проверяй что показывает `/preview`:

```bash
# Проверь что показывается правильный контент
curl -s <WEBCHAT_URL>/preview | head -30

# Или открой в браузере
# https://d999999999.habab.ru/
```

**Проблема:** Бот может создать файл с другим именем (например `dental-appointment-form.html`), но `/preview` показывает `index.html`. Если нужно, скопируй созданный файл в `index.html`:

```bash
# Найди последний созданный HTML файл
ls -lth <user-workspace>/*.html | head -5

# Скопируй нужный файл в index.html
cp <user-workspace>/нужный-файл.html <user-workspace>/index.html
```

### Шаг 5: Рендер скриншота

```bash
cd <project-root>/extensions/webchat-sidebar

# ВАЖНО: Удалить старые скриншоты перед рендером
rm -f previews/cases/my-new-case/screenshot*.png

# Базовый рендер (с отправкой промпта в чат)
node scripts/render_promo_preview.js \
  --html previews/cases/my-new-case/page.html \
  --out previews/cases/my-new-case/screenshot.png \
  --prompt-file previews/cases/my-new-case/prompt.txt \
  --wait-bot-response true \
  --bot-response-timeout-ms 180000 \
  --chat-zoom-steps 1

# Быстрый рендер (без отправки промпта)
node scripts/render_promo_preview.js \
  --html previews/cases/my-new-case/page.html \
  --out previews/cases/my-new-case/screenshot.png
```

⚠️ **Важно:**
- Всегда удаляй старые скриншоты перед созданием новых
- Timeout 180000ms (3 мин) чтобы дождаться полного ответа Claude
- Скрипт ждет НЕ песочных часов, а финального ответа бота

**Параметры render_promo_preview.js:**

| Параметр | Описание | Дефолт |
|----------|----------|--------|
| `--html` | Путь к HTML файлу | `previews/promo-yoga-with-calendar.html` |
| `--out` | Путь для скриншота | `store_assets/previews/promo-yoga-nanabanana.png` |
| `--prompt-file` | Файл с промптом для отправки в чат | - |
| `--wait-bot-response` | Ждать ответа бота | `true` |
| `--chat-zoom-steps` | Количество Ctrl++ для увеличения чата | `1` (рекомендуется `2` для лучшей читаемости) |
| `--bot-response-timeout-ms` | Таймаут ожидания ответа | `90000` (рекомендуется `180000` для Claude) |
| `--user-name` | Имя пользователя для логина | `admin` |
| `--user-email` | Email для логина | `admin@example.com` |
| `--post-send-wait-ms` | Пауза после отправки | `2500` |
| `--frame-selector` | Селектор iframe чата | `iframe.chat-frame` |
| `--webchat-session-id` | ID сессии для cookie | - |
| `--webchat-session-url` | URL для cookie | - |

### Шаг 6: Экспорт в форматы Chrome Web Store

```bash
cd <project-root>/extensions/webchat-sidebar

python3 scripts/export_cws_screenshots.py \
  previews/cases/my-new-case/screenshot.png
```

**Результат:**
- `screenshot-1280x800.png`
- `screenshot-640x400.png`

### Шаг 7: Создать README.md (опционально)

**⚠️ Подпись хранится в config.yaml → поле `caption`, НЕ в .txt файле!**

```markdown
# Preview Case: My New Case

## Goal
Промо-превью для [описание]

## Inputs
- User prompt: `prompt.txt`
- HTML page: `page.html`
- Caption: `caption.txt` - подпись к скриншоту

## Output
- Screenshot: `screenshot.png` (1280x800)
- CWS formats: `screenshot-1280x800.png`, `screenshot-640x400.png`

## Render Command
```bash
cd <project-root>/extensions/webchat-sidebar

# Очистка перед новым промптом
rm -f <user-workspace>/*.html
curl -s -X POST <WEBCHAT_URL>/api/history/clear \
  -H "Content-Type: application/json" \
  -b "webchat-session-id=999999999; webchat-session-url=https://d999999999.habab.ru/"

# Удалить старые скриншоты
rm -f previews/cases/my-new-case/screenshot*.png

# Создать превью
node scripts/render_promo_preview.js \
  --html previews/cases/my-new-case/page.html \
  --out previews/cases/my-new-case/screenshot.png \
  --prompt-file previews/cases/my-new-case/prompt.txt \
  --wait-bot-response true \
  --bot-response-timeout-ms 180000 \
  --chat-zoom-steps 0

# Проверка и пересоздание если нужно
curl -s <WEBCHAT_URL>/preview | head -30
# Если нужно, обнови index.html и пересоздай без промпта
```
```

## 📋 Примеры промптов

### SimpleSite (Лендинги)

| Промпт | Результат |
|--------|-----------|
| `"Zen yoga studio minimalist hero landing page with serene nature photo background"` | Yoga лендинг с AI фоном, CTA кнопка |
| `"Coffee shop landing page with online menu and reservation form"` | Кофейня с меню и формой бронирования |
| `"Fitness gym promo page with membership plans and trial signup"` | Фитнес зал с тарифами |
| `"Real estate agency landing with property search"` | Агентство недвижимости с поиском |

### SimpleDashboard (Дашборды)

| Промпт | Результат |
|--------|-----------|
| `"Сделай аналитику продаж моего курса с учетом источников трафика (utm меток)"` | Dashboard с KPI, графиками, таблицей UTM |
| `"Dashboard финансов малого бизнеса с доходами и расходами"` | Финансовый dashboard |
| `"Аналитика email-рассылок с открываемостью и кликами"` | Email marketing dashboard |
| `"Мониторинг заказов интернет-магазина по статусам"` | E-commerce dashboard |

## 🎬 Как работает render_promo_preview.js

1. **Запуск Puppeteer** (headless Chrome)
   - Viewport: 1280x800
   - Флаги: `--no-sandbox`, `--disable-setuid-sandbox`

2. **Загрузка HTML**
   - Открывает `file://` или URL
   - Ждет `networkidle2`

3. **Отправка промпта** (если `--prompt-file`)
   - Находит iframe по селектору `--frame-selector`
   - Заполняет `#input` текстом из prompt.txt
   - Нажимает `#sendBtn` или submit формы
   - Обрабатывает login modal если появился
   - **ВАЖНО:** После логина:
     - Создает `<user-workspace>/` с `CLAUDE.md` (пропускает onboarding)
     - Очищает историю сообщений через `/api/history/clear` (убирает старые сообщения)
   - Теперь чат готов для чистого превью без onboarding промптов

4. **Ожидание ответа** (если `--wait-bot-response`)
   - Ждет появления `.bubble.assistant[data-kind="assistant"]`
   - Фильтрует "progress" сообщения (⏳, "launching claude", etc)
   - Таймаут: `--bot-response-timeout-ms` (рекомендуется 180 сек)

5. **Zoom чата** (если `--chat-zoom-steps > 0`)
   - Эмулирует Ctrl++ N раз
   - Применяет CSS zoom к iframe

6. **Скриншот**
   - `page.screenshot({ fullPage: false })`
   - Сохраняет в `--out`

## 🔍 /preview Route в WebChat

**URL варианты:**
- `https://noxonbot.wpmix.net/preview` - основной
- `https://d{userId}.habab.ru/` - персональный поддомен (userId подставляется автоматически)

**Функционал:**
- Показывает `index.html` из папки пользователя `<user-workspace>/`
- Если нет index.html → показывает листинг HTML файлов
- Поддержка `/preview/:filename` для конкретных файлов

**Пример:**
```javascript
// botplatform/src/webchat.ts:2753
app.get('/preview', requireSessionPage, (req, res) => {
  const user = getReqUser(req);
  const userFolder = `<user-workspace>`;

  // Serve index.html if exists
  const indexPath = path.join(userFolder, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  // Show directory listing
  // ...
});
```

**Использование:**
- Бот создает файлы в папке пользователя
- Пользователь открывает `/preview` для просмотра
- Удобно для демо и тестирования

## 🎨 Чек-лист качества превью

✅ **Левый iframe (лендинг):**
- [ ] Показывает РОВНО созданный лендинг без искажений
- [ ] Нет затемнений, нет фоновых картинок в шаблоне
- [ ] Лендинг создан по skill `make-landing-page.md` (~50-70 строк, 1 экран)

✅ **Правый iframe (чат):**
- [ ] Реальный WebChat UI
- [ ] Signed in as admin admin@example.com
- [ ] НЕТ onboarding сообщений

✅ **Browser chrome:**
- [ ] Dots (red, yellow, green)
- [ ] URL bar с https://d999999999.habab.ru/

## 🚀 Quick Start - Новый формат (2026-02-19)

**Подход:** Создавать showcase БЕЗ iframe - встраивать контент напрямую в page.html с промптом внизу.

### ⚠️ ВАЖНО: Временный webchat для showcase

**Проблема:** Основной webchat (`noxonbot-webchat`) конфликтует с Telegram ботом (ошибка 409), из-за чего iframe-ы в puppeteer не загружаются.

**Решение:** Запускать временный webchat ТОЛЬКО для генерации showcase:

```bash
# 1. Остановить основной webchat
pm2 stop noxonbot-webchat

# 2. Запустить временный webchat в webchat-only режиме (без Telegram)
cd <project-root>/botplatform
SKIP_GLOBAL_MESSAGE_HISTORY=true \
WEBCHAT_PORT=8091 \
BOT_LANGUAGE=en \
IS_SANDBOX=1 \
USE_BWRAP=1 \
WEBCHAT_TITLE="Showcase Generator" \
npm run webchat &

# Дождаться запуска (3-5 секунд)
sleep 5

# Проверить что webchat работает
curl -s -o /dev/null -w "HTTP %{http_code}\n" <WEBCHAT_URL>/

# 3. Создать showcase (см. ниже)

# 4. После создания - остановить временный и вернуть основной
kill %1  # Остановить фоновый процесс
pm2 restart noxonbot-webchat
```

**Короткая версия (для копипасты):**

```bash
pm2 stop noxonbot-webchat && \
(cd <project-root>/botplatform && SKIP_GLOBAL_MESSAGE_HISTORY=true WEBCHAT_PORT=8091 npm run webchat &) && \
sleep 5 && \
echo "✅ Временный webchat запущен, создавай showcase..."

# После создания showcase:
# killall -9 node && pm2 restart noxonbot-webchat
```

### Полный workflow:

```bash
# === НАСТРОЙКИ ===
PRODUCT="simple_dashboard"  # simple_site | simple_dashboard
SLUG="sales-analytics-utm"
PROMPT="Сделай аналитику продаж моего курса с учетом источников трафика (utm меток)"
CASE_DIR="<project-root>/products/$PRODUCT/showcases/$SLUG"

# === ШАГ 1: СТРУКТУРА ===
rm -rf "$CASE_DIR"
mkdir -p "$CASE_DIR"
# НЕ создавай .txt файлы! Всё хранится в config.yaml

# Скопировать CLAUDE.md продукта
cp <project-root>/products/$PRODUCT/CLAUDE.md <user-workspace>/CLAUDE.md

# === ШАГ 2: СОЗДАТЬ КОНТЕНТ ===
# Создай index.html в <user-workspace>/
# Для SimpleSite: лендинг с Tailwind CSS
# Для SimpleDashboard: dashboard с Tailwind + Chart.js

# === ШАГ 3: СОЗДАТЬ demo.html ===
# ОБЯЗАТЕЛЬНО: Включить i18n! См. products/<product>/CLAUDE.md секцию "i18n"
# - Для SimpleDashboard: tt() функция + _s объект с en/ru строками
# - Для SimpleSite: data-i18n атрибуты + strings объект
# - Переключалка языка только для русских браузеров
# - localStorage для сохранения выбора
#
# Для SimpleDashboard: используй JIT (Just-in-Time) подход
# - Данные генерируются динамически через JavaScript
# - Функции generateSalesData(), distributeSales()
# - Chart.js рендерит графики при загрузке страницы
# Для SimpleSite: статичный HTML с контентом
# Скопируй в $CASE_DIR/demo.html

# === ШАГ 4: СОЗДАТЬ page.html ===
# Скопируй содержимое index.html в page.html
# Оберни в showcase-container
# Добавь prompt-caption внизу

cat > "$CASE_DIR/page.html" << 'EOF'
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Showcase</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Для dashboard добавить Chart.js -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    html, body { width: 1280px; height: 800px; overflow: hidden; margin: 0; padding: 0; }
    .showcase-container { height: calc(100% - 50px); }
    .prompt-caption {
      height: 50px; display: flex; align-items: center; justify-content: center;
      background: #f9fafb; border-top: 1px solid #e5e7eb;
      color: #6b7280; font-size: 14px; font-style: italic;
    }
  </style>
</head>
<body>
  <div class="showcase-container">
    <!-- ВСТАВИТЬ КОНТЕНТ ИЗ index.html -->
  </div>
  <div class="prompt-caption">"ПРОМПТ В КАВЫЧКАХ"</div>
</body>
</html>
EOF

# === ШАГ 4: ПРЕВЬЮ И АПРУВ ПЕРЕД СКРИНШОТАМИ ===
# ⚠️ ОБЯЗАТЕЛЬНО: Покажи пользователю что получилось ПЕРЕД генерацией скриншотов!
# 1. Открой demo.html через Read tool для визуальной проверки
# 2. Сообщи пользователю URL для просмотра в браузере
# 3. Спроси "Генерировать скриншоты?" (AskUserQuestion)
# 4. ТОЛЬКО после апрува — генерируй скриншоты

# После апрува:
cd <project-root>
node extensions/webchat-sidebar/scripts/screenshot_bilingual.js \
  "$CASE_DIR/demo.html" "$CASE_DIR/"

ls -lh "$CASE_DIR"/screenshot-1280x800*.png
```

# === ШАГ 6: СОЗДАТЬ config.yaml (ОБЯЗАТЕЛЬНО!) ===
# ⚠️ НЕ создавай .txt файлы! Всё хранится в config.yaml
# Сохраняем полный промпт и параметры для воспроизводимости
cat > "$CASE_DIR/config.yaml" << 'YAML'
# Showcase Configuration
# Product: simple_site | simple_dashboard
# Created: $(date +%Y-%m-%d)

showcase:
  slug: SLUG_NAME
  product: simple_site | simple_dashboard
  type: spa | landing  # SPA для dashboard, landing для лендингов

  prompt: "Полный промпт пользователя здесь"

  prompt_title: "Краткий промпт-заголовок (то что в кавычках на демо)"

  caption: "English caption for gallery"

demo:
  format: single_page_application | multi_section_landing
  navigation: hash_based | smooth_scroll

  # Для SimpleDashboard (SPA)
  pages:
    - id: overview
      title: "Overview"
      components:
        - type: kpi_cards
        - type: line_chart
        - type: bar_chart

  # Для SimpleSite (Landing)
  sections:
    - id: home
      title: "Hero Section"
      type: hero_with_background

  design:
    colors:
      primary: "blue-600"
      accent: "amber-500"
    fonts:
      heading: "font-extralight"

# Для SimpleDashboard - JIT параметры
jit_data_generation:
  approach: "Generate random but realistic data on each page load"
  volatility: 0.3
  trend: 0.15

# Для SimpleSite с AI фоном
background:
  type: ai_generated
  generator: hydra_ai
  model: flux-schnell-uncensored
  prompt: |
    Полный промпт для Hydra AI
  overlay: "bg-gradient-to-b from-black/45 via-black/35 to-black/50"

screenshot:
  resolution: 1280x800
  caption_height: 50px
  content_height: 750px

reproduction_steps:
  - "1. Generate AI background (если нужно)"
  - "2. Create demo.html with sections/pages"
  - "3. Create page.html wrapper with prompt caption"
  - "4. Take screenshot using Puppeteer"
  - "5. Resize to multiple formats"
YAML

echo "✅ config.yaml создан"
```

### Финальный чеклист после создания showcase:

```bash
# 1. Создать config.yaml для воспроизводимости (ОБЯЗАТЕЛЬНО!)
# См. секцию "ШАГ 6: Создать config.yaml" ниже

# 2. Проверить что скриншот не битый
file "$CASE_DIR/screenshot.png"  # Должно быть: PNG image data, 1280 x 800

# 3. Проверить размер (должен быть больше 50KB)
ls -lh "$CASE_DIR/screenshot.png"

# 4. Остановить временный webchat и вернуть основной
killall -9 node && pm2 restart noxonbot-webchat

# 5. Проверить что showcase доступен
curl -I https://noxonbot.wpmix.net/showcases/$SLUG/screenshot.png
```

### Шаг 3: Проверка и пересоздание (если нужно)

```bash
# Проверь что показывает /preview
curl -s <WEBCHAT_URL>/preview | head -30

# Если бот создал файл с другим именем, обнови index.html
ls -lth <user-workspace>/*.html | head -3
cp <user-workspace>/нужный-файл.html <user-workspace>/index.html

# Пересоздай скриншот (без промпта, чтобы не дублировать)
rm -f previews/cases/my-new-case/screenshot*.png
node scripts/render_promo_preview.js \
  --html previews/cases/my-new-case/page.html \
  --out previews/cases/my-new-case/screenshot.png \
  --chat-zoom-steps 0
```

### Шаг 4: Подпись хранится в config.yaml

**⚠️ НЕ СОЗДАВАЙ caption.txt!** Подпись хранится в `config.yaml` → поле `caption`.

### Шаг 5: Экспорт в CWS форматы

```bash
cd <project-root>/extensions/webchat-sidebar
python3 scripts/export_cws_screenshots.py \
  previews/cases/my-new-case/screenshot.png
```

### Шаг 6: Отправь пользователю

```bash
# Прочитай подпись
CAPTION=$(cat previews/cases/my-new-case/caption.txt | head -1)

# Отправь в Telegram с подписью
python3 <project-root>/hababru/telegram_file_sender.py \
  отправь @onoutnoxon \
  <project-root>/extensions/webchat-sidebar/previews/cases/my-new-case/screenshot.png \
  "$CAPTION"
```

И покажи превью пользователю через Read tool.

### Шаг 7: Проверь баланс Hydra AI

После генерации картинок проверь остаток баланса:

```bash
cd <project-root>/bananzabot && source .env && \
curl -s "https://api.hydraai.ru/v1/users/profile" -H "Authorization: Bearer $YOUR_IMAGE_API_KEY" | \
python3 -c "import sys,json; d=json.load(sys.stdin); print(f'💰 Hydra AI баланс: {d[\"balance\"]:.2f} руб.')"
```

**ОБЯЗАТЕЛЬНО** сообщи пользователю остаток баланса в конце работы!

## ✅ ОБЯЗАТЕЛЬНАЯ ВАЛИДАЦИЯ page.html

**КРИТИЧЕСКИ ВАЖНО:** После создания скриншота ОБЯЗАТЕЛЬНО проверь что на нём видны ВСЕ три элемента:

1. **Лендинг/страница** (левая часть) - результат работы бота
2. **Чат с промптом пользователя** (правая часть) - что пользователь написал
3. **Ответ бота** (правая часть) - что бот ответил

### Проблема с iframe чатом

Если чат показывается через iframe (`<iframe src="<WEBCHAT_URL>/">`), история сообщений НЕ ОТОБРАЖАЕТСЯ из-за проблем с cookies между `file://` и `http://localhost`.

### Решение: Статический чат

Используй **статический HTML чат** вместо iframe. Пример page.html со статическим чатом:

```html
<aside class="right">
  <div class="chat-container">
    <div class="chat-header">NoxonBot</div>
    <div class="chat-messages">
      <div class="bubble user">Промпт пользователя здесь</div>
      <div class="bubble assistant">Ответ бота здесь

• Пункт 1
• Пункт 2
• Пункт 3

Saved to /work/index.html</div>
    </div>
    <div class="chat-input">
      <input type="text" placeholder="Type a message...">
      <button>Send</button>
    </div>
  </div>
</aside>
```

CSS для статического чата:
```css
.chat-container {
  width: 100%;
  height: 100%;
  border: 1px solid #c1cfe2;
  border-radius: 12px;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.chat-header {
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  font-weight: 600;
  color: #374151;
  font-size: 14px;
}
.chat-messages {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bubble {
  max-width: 90%;
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.4;
  white-space: pre-line;
}
.bubble.user {
  align-self: flex-end;
  background: #3b82f6;
  color: white;
  border-bottom-right-radius: 4px;
}
.bubble.assistant {
  align-self: flex-start;
  background: #f3f4f6;
  color: #1f2937;
  border-bottom-left-radius: 4px;
}
.chat-input {
  padding: 12px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  gap: 8px;
}
.chat-input input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #d1d5db;
  border-radius: 20px;
  font-size: 14px;
}
.chat-input button {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 20px;
  font-size: 14px;
}
```

### Чеклист валидации (ОБЯЗАТЕЛЬНО!)

**⚠️ КРИТИЧЕСКИ ВАЖНО: После создания скриншота ОБЯЗАТЕЛЬНО:**

1. **Открой скриншот через Read tool** - `Read(screenshot.png)`
2. **Посмотри на картинку СВОИМИ ГЛАЗАМИ** и проверь:
   - [ ] **Лендинг виден** - слева показывается созданная страница
   - [ ] **Промпт виден** - справа в чате видно сообщение пользователя (синий bubble)
   - [ ] **Ответ бота виден** - справа в чате видно ответ (серый bubble)
   - [ ] **Текст читается** - шрифт достаточно крупный, не обрезан
3. **Покажи скриншот пользователю** - он тоже должен увидеть результат

```bash
# Проверка размера (должен быть > 50KB)
ls -lh screenshot.png
file screenshot.png  # Должно быть: PNG image data, 1280 x 800
```

**НЕ ПРОПУСКАЙ ЭТОТ ШАГ!** Без визуальной проверки нельзя гарантировать качество showcase.

Если чат пустой или не показывает историю - используй статический чат!

## 📚 Related Skills

- `image-generation.md` - Генерация фонов через Hydra AI (NanaBanana)
- `make-landing-page.md` - Создание лендингов с AI-фоном
- `server-config.md` - Конфиг серверов и API ключи

## 🔗 References

- `<project-root>/extensions/webchat-sidebar/README.md` - Основная документация расширения
- `<project-root>/extensions/webchat-sidebar/EXTENSION_API.md` - API расширения
- `<project-root>/botplatform/src/webchat.ts:2750` - Код /preview route
