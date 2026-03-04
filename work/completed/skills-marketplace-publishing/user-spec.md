---
# Creation date (YYYY-MM-DD)
created: 2026-03-04

# Status: draft | approved
status: approved

# Work type: feature | bug | refactoring
type: feature

# Feature size: S (1-3 files, local fix) | M (several components) | L (new architecture)
size: L
---

# User Spec: skills-marketplace-publishing

## Что делаем

Добавляем **Claude Skills Marketplace** как 4-й канал дистрибуции SimpleDashboard рядом с Webchat, Chrome Extension и Telegram.

Архитектурно: переименовываем `CLAUDE.md.template` → `SKILL.md` во **всех продуктах** (`simple_dashboard`, `simple_site`) для консистентности. SKILL.md становится первичным источником правды для инструкций каждого продукта. Добавляем `marketplace.json` и `SKILL.md` с frontmatter для `simple_dashboard` (основной фокус), обновляем `bot.ts` и всю документацию. Skill самодостаточен — Claude пользователя генерирует `index.html` напрямую, без нашего сервера.

## Зачем

Пользователи Claude Code могут найти наш skill на [SkillsMP](https://skillsmp.com) или GitHub и использовать возможности SimpleDashboard через **свой** Claude, не заходя на `simpledashboard.wpmix.net`. Это новый канал acquisition без нашей инфраструктуры: скопировал папку в `~/.claude/skills/simpledashboard/` — и Claude умеет строить дашборды по нашим стандартам (SPA, Chart.js, Tailwind, i18n, industry templates).

**Бизнес-успех:** skill установлен, работает автономно, генерирует корректный `index.html`, repo публично индексируется на SkillsMP.

## Как должно работать

**Сценарий 1 — пользователь устанавливает skill:**
1. Пользователь клонирует/скачивает `products/simple_dashboard/` в `~/.claude/skills/simpledashboard/`
2. Claude Code автоматически обнаруживает skill по `SKILL.md`
3. Пользователь пишет: "create sales dashboard for my e-commerce store"
4. Claude проводит 3-4 вопроса по бизнес-контексту (interview protocol из SKILL.md)
5. Claude генерирует `index.html` с Chart.js + Tailwind, SPA навигацией, i18n (EN/RU)
6. Пользователь открывает `index.html` локально или деплоит на GitHub Pages / Netlify

**Сценарий 2 — наш webchat (без изменений в UX):**
1. `bot.ts` при онбординге читает `SKILL.md` вместо `CLAUDE.md.template`
2. Копирует в workspace юзера как `CLAUDE.md` (как раньше)
3. Webchat-специфика (extension sidebar, `d{USERID}.wpmix.net`, auto-screenshot) остаётся в `CLAUDE.md` продукта — перезаписывает при конфликте

**Сценарий 3 — маркетплейс:**
1. `aisell` repo публичный → SkillsMP индексирует автоматически
2. `marketplace.json` содержит название, описание, теги для красивой карточки на SkillsMP

## Критерии приёмки

### SKILL.md — simple_dashboard (основной продукт)
- [ ] `products/simple_dashboard/SKILL.md` существует с корректным YAML frontmatter (`name`, `description`, `version`, `tags`)
- [ ] `ls products/simple_dashboard/CLAUDE.md.template` — exit code 1 (удалён)
- [ ] `grep -c "current_dashboard_screenshot\|WEBCHAT_INIT\|Extension sidebar" products/simple_dashboard/SKILL.md` — `0`
- [ ] `grep -c "localhost:\|95\.217\.\|62\.109\.\|:8094\|:8091\|:8095" products/simple_dashboard/SKILL.md` — `0`
- [ ] SKILL.md содержит секцию `## Deployment`: сохранить как `index.html`, открыть локально или задеплоить на GitHub Pages / Netlify / Vercel
- [ ] SKILL.md содержит секцию `## Live Examples` со ссылками на все 7 шоукейсов на `simpledashboard.wpmix.net`
- [ ] `grep -c "industry\|Chart.js\|i18n\|interview\|SPA\|data source" products/simple_dashboard/SKILL.md` — не менее 6

### SKILL.md — simple_site (консистентность)
- [ ] `products/simple_site/SKILL.md` существует (переименован из `CLAUDE.md.template`)
- [ ] `ls products/simple_site/CLAUDE.md.template` — exit code 1 (удалён)
- [ ] `grep -c "localhost:\|95\.217\.\|62\.109\." products/simple_site/SKILL.md` — `0`

### marketplace.json
- [ ] `products/simple_dashboard/marketplace.json` существует
- [ ] Содержит поля: `name`, `version`, `description`, `tags`, `author`, `homepage`, `screenshots`
- [ ] Теги включают: `dashboard`, `analytics`, `business`, `chartjs`, `tailwind`, `visualization`, `spa`

### bot.ts
- [ ] `grep "SKILL.md" botplatform/src/bot.ts` находит обновлённый путь в функции выбора шаблона
- [ ] `grep "CLAUDE.md.template" botplatform/src/bot.ts` — нет совпадений (старый путь удалён)
- [ ] При копировании шаблона в user workspace: YAML frontmatter из SKILL.md стрипается или игнорируется Claude Code (не влияет на работу дашборда)

### Тесты
- [ ] `test_folder_structure.js` обновлён: проверяет наличие `SKILL.md` для `simple_dashboard` и `simple_site` (не `CLAUDE.md.template`)
- [ ] `test_claude_md_templates.js` обновлён: читает `SKILL.md` для `simple_dashboard` и `simple_site`
- [ ] `cd botplatform && npm test` — все тесты green, 0 failed

### Showcase skill
- [ ] `aisell/.claude/skills/generate-product-showcase-gallery.md` существует (копия глобальной команды)
- [ ] Оригинал `/root/.claude/commands/generate-product-showcase-gallery.md` НЕ удалён

### Документация — README и project knowledge
- [ ] `README.md` (корень aisell) содержит таблицу 4 каналов дистрибуции: Webchat, Telegram, Chrome Extension, **Claude Skills Marketplace**
- [ ] `products/README.md` — обновлён: добавлен Claude Skills в workflow продукта, исправлена битая ссылка (строка 154: `showcase-create.md` → `generate-product-showcase-gallery.md`)
- [ ] `products/simple_dashboard/.claude/skills/project-knowledge/references/architecture.md` — добавлена строка Claude Skills в таблицу дистрибуции
- [ ] `products/simple_dashboard/.claude/skills/project-knowledge/references/project.md` — добавлен Claude Skills в Distribution Strategy
- [ ] Все ссылки на showcase-skill в документах указывают на корректный путь

## Ограничения

- Repo `marsiandeployer/aisell` сейчас приватный — нужно сделать публичным для SkillsMP-индексации (ручной шаг владельца после этой фичи)
- SkillsMP требует минимум 2 звезды на GitHub для индексации — первые звёзды нужны вручную
- SKILL.md должен быть полностью публичным: никаких токенов, API ключей, env vars, внутренних IP/портов нашей инфраструктуры
- Extension ZIPs в `showcases/extension-assets/` — это артефакты Chrome Extension канала дистрибуции, остаются как есть, документируются в README
- `## Безопасность` секция остаётся в SKILL.md (12 строк дублирования между продуктами — допустимо)
- **`simple_dashboard` и `simple_site`** — оба переименовываются. `simple_crypto` — нет `CLAUDE.md.template`, без изменений
- **Существующие пользователи webchat** с уже скопированным `CLAUDE.md` в workspace — не затронуты. Новый SKILL.md применяется только к новым onboarding-сессиям
- **SKILL.md формат** следует открытому стандарту [agentskills.io](https://agentskills.io) (YAML frontmatter + markdown). `marketplace.json` — наш внутренний метаданных-файл аналогичный `chrome_store` секции в `product.yaml`

## Риски

- **Риск: bot.ts сломается после переименования шаблона.** `getClaudeMdTemplatePath()` вернёт путь к несуществующему файлу. **Митигация:** обновить функцию и запустить `npm test` — `test_claude_md_templates.js` это поймает.
- **Риск: SKILL.md содержит webchat-специфику, которую не заметили.** Skill-пользователи получат инструкции про Extension sidebar и `d{USERID}.wpmix.net`. **Митигация:** acceptance criterion явно проверяет отсутствие этих строк в SKILL.md.
- **Риск: `test_claude_md_templates.js` проверяет контент который мы изменили.** Тест упадёт если удалим из SKILL.md что-то что он ищет. **Митигация:** обновить тест под новую структуру SKILL.md как часть этой фичи.

## Технические решения

- **SKILL.md как primary, CLAUDE.md (продуктовый) как extension.** SKILL.md — источник правды для dashboard-capabilities. CLAUDE.md в папке продукта добавляет webchat-специфику (Extension sidebar, auto-screenshot) поверх. Апдейт инструкций = только SKILL.md.
- **bot.ts копирует SKILL.md в user workspace как `CLAUDE.md`.** Без конкатенации с продуктовым CLAUDE.md — пользователь видит только SKILL.md контент. Продуктовый CLAUDE.md — для разработчиков и webchat system prompt.
- **Переименование, не создание нового файла.** `CLAUDE.md.template` → `SKILL.md` в обоих продуктах (`simple_dashboard`, `simple_site`). Тесты обновляем для обоих. `simple_crypto` — пропускаем (нет шаблона).
- **marketplace.json отдельно, не в product.yaml.** product.yaml — внутренний конфиг с токенами и env. marketplace.json — публичный файл для внешних инструментов, аналог `chrome_store` секции но изолированный.
- **Копируем showcase-skill, не перемещаем.** Глобальная команда `/generate-product-showcase-gallery` используется для `simple_site` тоже — удалять нельзя. Копия в `aisell/.claude/skills/` даёт проект-уровневый контекст.
- **Не рефакторим `## Безопасность` в shared файл.** 12 строк дублирования, shared `products/CLAUDE.md` не работает в user workspace.
- **Extension ZIPs остаются.** Артефакты Chrome Extension дистрибуции — документируем, не удаляем.

## Тестирование

**Unit-тесты:** обновляем `test_folder_structure.js` и `test_claude_md_templates.js` под новые имена файлов.

**Интеграционные тесты:** не делаем — фича чисто документационная, существующих тестов достаточно.

**E2E тесты:** не делаем — нет смысла для markdown/json файлов.

## Как проверить

### Агент проверяет

| Шаг | Инструмент | Ожидаемый результат |
|-----|-----------|-------------------|
| 1. SKILL.md существует с frontmatter | `head -10 products/simple_dashboard/SKILL.md` | содержит `name:`, `description:`, `tags:` |
| 2. CLAUDE.md.template удалены | `ls products/simple_dashboard/CLAUDE.md.template products/simple_site/CLAUDE.md.template` | exit code 1 для обоих |
| 3. Нет webchat-специфики | `grep -c "current_dashboard_screenshot\|WEBCHAT_INIT\|Extension sidebar" products/simple_dashboard/SKILL.md` | `0` |
| 4. Нет внутренних адресов | `grep -c "localhost:\|95\.217\.\|62\.109\.\|:8094\|:8091" products/simple_dashboard/SKILL.md` | `0` |
| 5. Deployment-секция есть | `grep -c "GitHub Pages\|Netlify\|Vercel\|index.html" products/simple_dashboard/SKILL.md` | не менее 2 |
| 6. Live Examples есть | `grep -c "simpledashboard.wpmix.net/showcases" products/simple_dashboard/SKILL.md` | не менее 7 |
| 7. marketplace.json валиден | `node -e "const m=require('./products/simple_dashboard/marketplace.json'); console.log(m.name,m.tags.length)"` | название + кол-во тегов без ошибок |
| 8. bot.ts обновлён | `grep -c "SKILL.md" botplatform/src/bot.ts && grep -c "CLAUDE.md.template" botplatform/src/bot.ts` | первое ≥1, второе = 0 |
| 9. Тесты проходят | `cd botplatform && npm test` | 0 failed |
| 10. Showcase skill скопирован | `ls .claude/skills/generate-product-showcase-gallery.md` | файл найден |
| 11. Битая ссылка исправлена | `grep -c "showcase-create.md" products/README.md` | `0` |
| 12. Все 4 канала в README | `grep -c "Claude Skills" README.md` | ≥1 |
| 13. architecture.md обновлён | `grep -c "Claude Skills" products/simple_dashboard/.claude/skills/project-knowledge/references/architecture.md` | ≥1 |

### Пользователь проверяет
- Скопировать `products/simple_dashboard/` в `~/.claude/skills/simpledashboard/`, написать в Claude Code "create a sales dashboard for e-commerce" → Claude задаёт вопросы → генерирует `index.html` → файл открывается в браузере без ошибок
- Сделать repo публичным на GitHub — убедиться что SKILL.md и marketplace.json видны без авторизации (нет утечки секретов)
