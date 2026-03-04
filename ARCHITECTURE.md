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

### 4d. Claude Skills Marketplace (skillsmp.com)

Автоматически при публикации репозитория на GitHub с 2+ звёздами.

Требования к продукту:
- `products/{name}/SKILL.md` — AI инструкции с YAML frontmatter (`name`, `description`, `version`, `tags`)
- `products/{name}/marketplace.json` — метаданные (name, version, description, tags, screenshots)

```bash
# Проверить что SKILL.md имеет frontmatter
head -10 products/simple_dashboard/SKILL.md
```

### 4e. Moltbook AI Agents Network

Платформа для AI агентов (BNB Chain hackathon).

```bash
# Credentials: ~/.config/moltbook/credentials.json
# Agent: "noxon" (claimed, active)
# API key: moltbook_sk_...
# Profile: https://www.moltbook.com/u/noxon

# Пост через API:
curl -X POST https://api.moltbook.com/api/v1/posts \
  -H "Authorization: Bearer {API_KEY}" \
  -d '{"content": "...", "visibility": "public"}'
```

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

| Продукт | Статус | Webchat URL | Port | Тип выхода | SKILL.md | marketplace.json |
|---------|--------|-------------|------|-----------|----------|-----------------|
| SimpleSite | active | https://simplesite.wpmix.net | 8091 | Генерация HTML | ✅ | ❌ |
| SimpleDashboard | active | https://simpledashboard.wpmix.net | 8094 | Генерация HTML | ✅ | ✅ |
| SimpleCrypto | dev | TBD | 8096 | Конфигурация MCW | ✅ | ✅ |
| MVP боты | bananzabot | — | — | Системный промпт | — | — |

**SimpleCrypto** отличается от остальных:
- Не генерирует HTML — конфигурирует MCW (MultiCurrencyWallet, `/root/MultiCurrencyWallet/build-mainnet/`)
- Выход: `erc20tokens.js` + `variables.css` + `DEPLOY.md`
- Базируется на: https://github.com/swaponline/MultiCurrencyWallet

**Правило именования:** Продукты поднимаются на `{product_name}.wpmix.net`

---

## Чеклист создания нового продукта

- [ ] 1. `/demand-research "ключевые слова"`
- [ ] 2. Создать MVP в bananzabot (опционально)
- [ ] 3. Создать папку `products/simple_{name}/`
- [ ] 4. Написать `SKILL.md` с YAML frontmatter (публичный, с instr для Claude)
- [ ] 5. Написать `CLAUDE.md` (полная версия для разработчиков, gitignored)
- [ ] 6. Написать `marketplace.json` (для skillsmp.com)
- [ ] 7. Создать `product.yaml` (метаданные продукта, gitignored)
- [ ] 8. Создать `showcases/` с demo.html + config.yaml
- [ ] 9. Создать иконки 16/32/48/128px
- [ ] 10. Опубликовать на habab.ru (B2B) — `/habab-create-product-page`
- [ ] 11. Написать SEO-статьи — `/habab-seo-article-writer`
- [ ] 12. Собрать Extension и опубликовать в Chrome Web Store

**Для SimpleCrypto-типа продуктов (конфигурация внешнего app):**
- [ ] Определить базовый app (например MCW для кошелька)
- [ ] Задокументировать config API (window.buildOptions, CSS variables)
- [ ] Создать примеры конфигурации в SKILL.md
- [ ] Написать DEPLOY.md template

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
