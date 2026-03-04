# Simple* Products - AI Builder Suite

Серия продуктов Simple* — AI-конструкторы для создания веб-контента через чат.

## 📦 Продукты

| Product | Status | Description |
|---------|--------|-------------|
| [SimpleSite](./simple_site.yaml) | ✅ Active | AI конструктор лендингов |
| [SimpleDashboard](./simple_dashboard.yaml) | 🚧 Dev | AI конструктор дашбордов |

## 🏗️ Структура продукта

```
products/
├── _template.yaml          # Шаблон для нового продукта
├── README.md               # Этот файл
├── simple_site.yaml     # SimpleSite конфиг
├── simple_site/
│   ├── icons/              # Иконки 16/32/48/128px
│   └── showcases/          # Демо-примеры
│       ├── hairdresser-booking-calendar/
│       │   ├── prompt.txt      # Промпт пользователя
│       │   ├── caption.txt     # Краткое описание
│       │   ├── screenshot.png  # Скриншот 1280x800
│       │   └── page.html       # Результат генерации
│       └── coffee-shop-menu/
│           └── ...
├── simple_dashboard.yaml   # SimpleDashboard конфиг
└── simple_dashboard/
    ├── icons/
    └── showcases/
```

## 🔄 Workflow создания продукта

### 1. Ресёрч спроса
```bash
# Анализ ключевых слов через Wordstat
/demand-research "конструктор лендингов AI"
```

### 2. Создание конфига
```bash
cp /root/aisell/products/_template.yaml /root/aisell/products/simple_newproduct.yaml
mkdir -p /root/aisell/products/simple_newproduct/{icons,showcases}
```

### 3. Создание showcases

Showcases определяются в YAML продукта (prompt + caption), скриншоты генерируются автоматически:

```bash
# Установить зависимости (один раз)
cd /root/aisell/scripts && npm install

# Рендер одного showcase
tsx /root/aisell/scripts/render_showcase.ts --product simple_site --slug hairdresser-booking-calendar

# Рендер всех showcases продукта
tsx /root/aisell/scripts/render_showcase.ts --product simple_site --all
```

**Требования:**
- Webchat должен быть запущен на `localhost:8091`
- Скриншоты сохраняются в `products/{product}/showcases/{slug}.png`

**Экспорт для Chrome Web Store:**
```bash
python3 /root/aisell/extensions/webchat-sidebar/scripts/export_cws_screenshots.py \
  products/simple_site/showcases/hairdresser-booking-calendar.png
```

### 4. Создание иконок

**Требования для Chrome Web Store:**
- Размеры: 16x16, 32x32, 48x48, 128x128 PNG
- Прозрачный фон
- Простой узнаваемый символ
- Основной цвет продукта

**Стиль:**
- Минималистичный
- Без мелких деталей (должно читаться на 16x16)
- Один основной цвет + оттенки

### 5. Публикация на habab.ru (B2B)
```bash
# Использовать skill create-product-habab.md
# Создает:
# - /root/space2/hababru/content/products/{product_id}.yaml
# - /root/space2/hababru/content/products/{product_id}_promo.md
```

### 6. SEO-статья
```bash
/habab-seo-article "SimpleSite конструктор лендингов"
```

### 7. Публикация в Chrome Web Store
Использовать skill `chrome-extension-publishing.md`

### 8. Публикация в Claude Skills Marketplace
Опубликовать `SKILL.md` продукта в Claude Skills Marketplace — канал дистрибуции для пользователей Claude Code.
- `SKILL.md` создаётся на шаге 2 (при создании конфига продукта) из шаблона
- Showcases из шага 3 используются как скриншоты в marketplace-листинге
- См. skill `generate-product-showcase-gallery.md` для генерации галереи

## 📝 Описания для Chrome Web Store

### Short Description (до 132 символов)
```
Create [тип контента] with AI chat. Describe what you need, get results instantly. No coding.
```

### Detailed Description (до 16000 символов)
```
[Что делает продукт - 1 предложение]

✨ What you can build:
• [Feature 1]
• [Feature 2]
• [Feature 3]

🤖 AI-powered:
• [Capability 1]
• [Capability 2]

🌐 Publish to web:
• [Benefit 1]
• [Benefit 2]
```

## 🎨 Showcases Guidelines

### Что должно быть на скриншоте
- **Формат:** 1280x800px
- **Слева (67%):** Результат генерации (лендинг/дашборд)
- **Справа (33%):** WebChat с промптом и ответом
- **Browser chrome:** Рамка браузера с точками и URL

### Промпты для showcases

**ВАЖНО:** Showcases должны быть КРЕАТИВНЫМИ, а не для галочки! Промпты пишем от первого лица, как реальный клиент.

**Хорошие промпты (креативные, от первого лица):**
- "Я стилист премиум-класса, хочу элегантную визитку с телефоном"
- "У меня уютная кофейня, покажи наше меню с ценами"
- "Открываю студию йоги! Первое занятие бесплатно, нужна красивая страничка"
- "Я свадебный фотограф, хочу стильную страницу с инстаграмом"
- "Пиццерия Тони - лучшая пицца в городе! Меню с кнопкой заказа"

**Плохие промпты (сухие, технические):**
- "Create HTML: Coffee menu" - слишком техническое
- "Make a website" - слишком общее
- "Landing page with flexbox" - никто так не говорит
- "Hair salon booking with calendar" - без души, для галочки

## 🔗 Связанные файлы

| Файл | Описание |
|------|----------|
| `/root/.claude/commands/generate-product-showcase-gallery.md` | Создание showcases |
| `/root/.claude/skills/create-product-habab.md` | Публикация на habab.ru |
| `/root/.claude/skills/chrome-extension-publishing.md` | Chrome Web Store |
| `/root/.claude/commands/demand-research.md` | Ресёрч спроса |
| `/root/.claude/commands/habab-seo-article.md` | SEO статьи |

---

**Обновлено:** 2026-02-19
