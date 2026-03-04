# Схема производства продуктов — Noxon Digital Factory

## Что такое продукт

```
Продукт = Системный промпт + Showcases + Иконки + Описания для магазинов
```

**Продукты:** SimpleSite, SimpleDashboard (+ MVP в bananzabot)

**НЕ продукты:** Telegram боты, Webchat, Chrome Extension — это **интерфейсы** для доступа к продуктам.

---

## Жизненный цикл продукта

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LIFECYCLE ПРОДУКТА                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────────┐    │
│  │   РЕСЁРЧ     │────▶│     MVP      │────▶│     FULL PRODUCT         │    │
│  │              │     │              │     │                          │    │
│  │ /demand-     │     │ bananzabot   │     │ aisell/products/         │    │
│  │  research    │     │ bots.json    │     │ simple_{name}.yaml       │    │
│  └──────────────┘     └──────────────┘     └──────────────────────────┘    │
│         │                    │                         │                    │
│         ▼                    ▼                         ▼                    │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────────┐    │
│  │ GitHub Issue │     │ Telegram Bot │     │ • Showcases (YAML)       │    │
│  │ с ключами,   │     │ интерфейс    │     │ • Иконки 16/32/48/128    │    │
│  │ промптом,    │     │ только       │     │ • Chrome Store описания  │    │
│  │ темами SEO   │     │              │     │ • B2B pitch для habab    │    │
│  └──────────────┘     └──────────────┘     └──────────────────────────┘    │
│                                                        │                    │
│                              ┌──────────────────────────┤                    │
│                              ▼                         ▼                    │
│                    ┌──────────────────┐     ┌──────────────────────┐       │
│                    │   ДИСТРИБУЦИЯ    │     │   ДИСТРИБУЦИЯ        │       │
│                    │                  │     │                      │       │
│                    │  habab.ru (B2B)  │     │  Chrome Web Store    │       │
│                    │  + SEO статьи    │     │  (B2C)               │       │
│                    └──────────────────┘     └──────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Этап 1: Ресёрч спроса

```bash
/demand-research "конструктор лендингов AI"
```

**Вход:** описание продукта или ключевое слово

**Выход:**
- Wordstat данные (частотность, тренды)
- Семантическое ядро по группам (транзакционные, информационные, проблемные)
- Системный промпт для AI-агента
- 20-40 тем для SEO-статей
- GitHub Issue в `noxonsu/space2` с результатами

---

## Этап 2: MVP в Bananzabot

**Где:** `/root/aisell/bananzabot/bots_database/bots.json`

```json
{
  "bot_id": "...",
  "api_key": "TOKEN_FROM_BOTFATHER",
  "user_id": "514510099",
  "prompt": "Системный промпт продукта...",
  "status": "active"
}
```

**Интерфейс:** только Telegram
**Цель:** быстрая проверка гипотезы

---

## Этап 3: Full Product

**Где:** `/root/aisell/products/simple_{name}.yaml`

### Структура YAML:

```yaml
product_id: "simple_site"
name: "SimpleSite"
tagline: "Create landing pages with AI chat"
status: "active"  # development → active

# Showcases (промпт + caption в YAML)
showcases:
  - slug: "hairdresser-booking-calendar"
    prompt: "Make booking form for hair salon with calendar"
    caption: "Hair Salon Booking Page"
    tags: ["booking", "salon"]

# Chrome Web Store
chrome_store:
  name: "SimpleSite - AI Website Builder"
  short_description: "..."  # до 132 символов
  detailed_description: |
    ...

# habab.ru B2B
habab:
  b2b_pitch: "Разработаю платформу-конструктор..."
  target_audience:
    - "Маркетинговые агентства"
    - "Web-студии"

# Телеграм/Webchat
telegram:
  bot_username: "@noxonbot"
  webchat_url: "https://clodeboxbot.habab.ru"
  webchat_port: 8091
  system_prompt: |
    You are SimpleSite - an AI assistant...
```

### Генерация showcases:

```bash
# Один showcase
tsx /root/aisell/scripts/render_showcase.ts --product simple_site --slug hairdresser-booking-calendar

# Все showcases продукта
tsx /root/aisell/scripts/render_showcase.ts --product simple_site --all
```

**Выход:** `products/simple_site/showcases/{slug}.png` (1280x800)

---

## Этап 4: Дистрибуция

### 4a. habab.ru (B2B портфолио)

```bash
# Skill: create-product-habab.md
```

Создает:
- `/root/space2/hababru/content/products/{product_id}.yaml`
- `/root/space2/hababru/content/products/{product_id}_promo.md`

### 4b. SEO-статьи

```bash
/habab-seo-article {issue_number} "тема статьи"
```

Создает:
- `source.md` (RU) — ОБЯЗАТЕЛЕН
- `source.en.md` (EN) — перевод
- Скриншот диалога с ботом
- IndexNow для индексации

### 4c. Chrome Web Store (B2C)

```bash
cd /root/aisell/extensions/webchat-sidebar
node build.js --name "SimpleSite" --url "https://clodeboxbot.habab.ru"
```

**Важно:** Extension — это интерфейс, не продукт. Один код, разные URL для разных продуктов.

---

## Интерфейсы vs Продукты

```
┌─────────────────────────────────────────────────────────────┐
│                      ИНТЕРФЕЙСЫ                             │
│  (способы доступа к продукту — НЕ являются продуктами)      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Telegram   │  │   Webchat   │  │  Chrome Extension   │  │
│  │    Bot      │  │             │  │                     │  │
│  │             │  │ localhost:  │  │  webchat-sidebar/   │  │
│  │ @noxonbot   │  │ 8091/8092   │  │  build.js --url     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│        │                │                    │              │
│        └────────────────┼────────────────────┘              │
│                         ▼                                   │
│              ┌─────────────────────┐                        │
│              │      ПРОДУКТ        │                        │
│              │   (system prompt)   │                        │
│              │                     │                        │
│              │  SimpleSite      │                        │
│              │  SimpleDashboard    │                        │
│              └─────────────────────┘                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Текущие продукты

| Продукт | Статус | Webchat URL | Port | Telegram |
|---------|--------|-------------|------|----------|
| SimpleSite | active | https://simplesite.wpmix.net | 8091 | @noxonbot |
| SimpleDashboard | dev | https://simpledashboard.wpmix.net | 8092 | @coderboxbot |
| MVP боты | bananzabot | — | — | разные |

**Правило именования:** Продукты поднимаются на `{product_name}.wpmix.net`

---

## Чеклист создания нового продукта

- [ ] 1. `/demand-research "ключевые слова"`
- [ ] 2. Создать MVP в bananzabot (опционально)
- [ ] 3. Создать `products/simple_{name}.yaml`
- [ ] 4. Заполнить showcases в YAML
- [ ] 5. `tsx render_showcase.ts --product {name} --all`
- [ ] 6. Создать иконки 16/32/48/128px
- [ ] 7. Опубликовать на habab.ru (B2B)
- [ ] 8. Написать SEO-статьи
- [ ] 9. Собрать Extension и опубликовать в Chrome Web Store

---

## Скилы и команды

### Commands (вызываются через `/command-name`)

| Command | Назначение |
|---------|------------|
| `/demand-research` | Ресёрч спроса через Wordstat API |
| `/habab-seo-article` | Создание SEO-статьи для habab.ru |
| `/product-preview` | Создание промо-скриншота (ручной режим) |

### Skills (справочники)

| Skill | Назначение |
|-------|------------|
| `create-product-habab.md` | Публикация продукта на habab.ru (B2B) |
| `chrome-extension-publishing.md` | Публикация в Chrome Web Store |
| `showcase-create.md` | Ручное создание showcase |

---

## Ключевые файлы

| Файл | Назначение |
|------|------------|
| `products/*.yaml` | Конфиги Full Products (showcases, chrome_store, habab) |
| `bananzabot/bots_database/bots.json` | MVP боты |
| `scripts/render_showcase.ts` | Автогенерация скриншотов из YAML |
| `extensions/webchat-sidebar/build.js` | Сборка Extension |

---

**Обновлено:** 2026-02-19
