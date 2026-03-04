# Code Research: skills-marketplace-publishing

**Feature:** Add Claude Skills marketplace as a new distribution channel for SimpleDashboard product.

**Scope:**
1. Rename `CLAUDE.md.template` to `SKILL.md` in both `simple_dashboard` and `simple_site`
2. Create `marketplace.json` in `products/simple_dashboard/`
3. Update `bot.ts` to read `SKILL.md` instead of `CLAUDE.md.template`
4. Update tests to match new file names
5. Document all distribution channels in README files
6. Copy showcase creation command to `aisell/.claude/skills/`

---

## 1. Entry Points

### Product Configuration Layer

**`/root/aisell/products/simple_dashboard/product.yaml`**
Central metadata file for SimpleDashboard. Defines all distribution channels, showcase slugs, SEO keywords, visual identity. Already has sections for `habab`, `chrome_store`, `telegram`. No `claude_skills` or `marketplace` section exists yet.

Key structure:
```yaml
product_id: "simple_dashboard"
name: "SimpleDashboard"
tagline: "Build analytics dashboards with AI."
habab: { ... }
chrome_store: { name, short_name, short_description, detailed_description, keywords, ... }
telegram: { bot_username, bot_token_env, webchat_url, webchat_port, welcome_message, system_prompt }
showcases: [ { slug, prompt, caption, tags }, ... ]
```

**`/root/aisell/products/simple_dashboard/CLAUDE.md`** (developer, not user-visible)
Full AI instructions for dashboard generation: interview protocol, industry templates, Chart.js patterns, SPA architecture, i18n, auth, data storage. 893 lines. This is what Claude reads when acting as SimpleDashboard inside the platform.

**`/root/aisell/products/simple_dashboard/CLAUDE.md.template`**
User-facing copy, shorter subset. Copied into the user's workspace on onboarding via `bot.ts:getClaudeMdTemplatePath()`. Contains: project idea placeholder, security rules, domain info, data sources, dashboard generation rules, auth flows, CRUD API docs, sprint report generator.

### README / Documentation Layer

**`/root/aisell/README.md`** (monorepo root)
Documents three interfaces (Webchat, Chrome Extension, Telegram Bot) in the "Интерфейсы" table. No mention of Claude Skills marketplace. Distribution channels described separately under "Web Chat" and "Chrome Extension" sections.

**`/root/aisell/products/README.md`**
Documents workflow for creating Simple* products: research, config, showcases, icons, habab.ru, SEO article, Chrome Web Store. Lists related skills/commands but no mention of Claude Skills marketplace. References `/root/.claude/skills/showcase-create.md` for showcase creation (note: the actual command is at `/root/.claude/commands/generate-product-showcase-gallery.md`).

**`/root/aisell/products/simple_dashboard/.claude/skills/project-knowledge/references/architecture.md`**
Documents distribution channels table:
```
| Telegram Bot    | @simpledashboard_bot                                          | Direct messaging |
| Webchat         | Node.js (port 8094) on 95.217.227.164                        | https://simpledashboard.wpmix.net |
| Chrome Extension| MV3 sidebar panel + web3 wallet, App ID: hhdhm...            | Chrome Web Store |
| Showcase Gallery| Static files on 95.217.227.164                               | https://simpledashboard.wpmix.net/showcases/ |
```
Claude Skills marketplace is NOT listed here.

**`/root/aisell/products/simple_dashboard/.claude/skills/project-knowledge/references/project.md`**
Distribution strategy section lists: Organic (habab.ru), Direct (Chrome Extension), Messaging (Telegram/Webchat), Word of mouth (Showcase gallery). No Claude Skills.

---

## 2. Data Layer

### Product Metadata

**`product.yaml`** is the single source of truth for product metadata. Per user-spec.md, `marketplace.json` is created as a separate public file (not inside product.yaml) because product.yaml contains internal config with env var references. No `claude_skills` section is added to product.yaml.

### CLAUDE.md Template Selection

`/root/aisell/botplatform/src/bot.ts` function `getClaudeMdTemplatePath()` -- selects which template to copy into user workspace based on `PRODUCT_TYPE` env var. This controls what the AI agent sees when running inside a user session. Relevant for SKILL.md because a Claude Skills integration would provide its own context file (SKILL.md) to the Claude agent directly via the Skills marketplace mechanism, separate from this copy mechanism.

### Showcase Configuration

Each showcase lives in `products/simple_dashboard/showcases/{slug}/` with:
- `demo.html` -- live SPA dashboard (Chart.js + Tailwind)
- `config.yaml` -- prompt, caption, pages metadata
- `screenshot-1280x800.png`, `screenshot-1280x800-ru.png` -- EN/RU gallery images
- `screenshot-640x400.png`, `screenshot-640x400-ru.png` -- EN/RU thumbnails

Current showcases (7 total):
- `construction-crm`, `sales-analytics-utm`, `funnel-analytics`, `invoice-generator`, `lead-tracker`, `project-kanban`, `client-report`

---

## 3. Similar Features

### Chrome Web Store Integration (most analogous)

`product.yaml` -> `chrome_store` section. Contains: `name`, `short_name`, `short_description`, `detailed_description` (marketing copy), `keywords`, `icons.dir`, `screenshots` (paths + captions). The section is self-contained metadata consumed by the publishing workflow.

`/root/.claude/skills/chrome-extension-publishing.md` -- global skill documenting how to publish to Chrome Web Store.

The `marketplace.json` for Claude Skills should follow the same pattern: metadata file that a publishing workflow/human can read to submit the product to the Skills marketplace.

### habab.ru B2B Portfolio Integration

`product.yaml` -> `habab` section. Contains: `product_yaml` (path to habab content), `product_url`, `promo_article`, `b2b_pitch`, `target_audience`.

### Skill Files Already in the Ecosystem

Global skills live in `/root/.claude/skills/*.md`. Project-level skills live in `/root/aisell/.claude/skills/` (currently only `crm-followup-operations.md`). Product-level project knowledge lives in `products/simple_dashboard/.claude/skills/project-knowledge/references/`.

The SKILL.md being created for Claude Skills marketplace is a different artifact from internal developer skills -- it is a user-facing description file that Claude Skills marketplace ingests, similar to how the Chrome Web Store ingests a manifest + description.

---

## 4. Integration Points

### `generate-product-showcase-gallery.md` -- Location and Status

**Current location:** `/root/.claude/commands/generate-product-showcase-gallery.md`
This is a GLOBAL command (invokable as `/generate-product-showcase-gallery`). It is 1155 lines and covers the full showcase creation workflow for both SimpleSite and SimpleDashboard products.

**Referenced in:**
- `/root/CLAUDE.md` -- listed in the Commands table as `/generate-product-showcase-gallery`
- `/root/aisell/CLAUDE.md` -- NOT listed (only `product-preview`, `make-landing-page-with-ai-background`, etc.)

**The feature task says:** Move/link from `/root/.claude/commands/` to `aisell/.claude/skills/`. This means creating a copy or symlink at `/root/aisell/.claude/skills/generate-product-showcase-gallery.md`. The `.claude/skills/` directory already exists at `/root/aisell/.claude/skills/` (contains `crm-followup-operations.md`).

**Note:** `/root/aisell/.claude/settings.json` and `settings.local.json` exist -- these control which skills are loaded for the project scope.

### Webchat Routes (Showcase serving)

`/root/aisell/botplatform/src/webchat.ts` line ~3433:
- `GET /showcases` -> `showcases/index.html` (gallery)
- `GET /showcases/:slug/demo` -> `showcases/{slug}/demo.html`
- `GET /showcases/*` -> static files
- Hostname routing: `simpledashboard.wpmix.net` -> `simple_dashboard` product

No changes needed here for the SKILL.md/marketplace.json additions.

### Pre-commit Lint Scripts (Constraints)

`/root/aisell/scripts/lint-showcase-demos.py` -- validates `demo.html` exists + `promptBar` position.
`/root/aisell/scripts/lint-cyrillic.py` -- no Cyrillic in EN blocks, no `.txt` files.
`/root/aisell/scripts/lint-product-yaml.py` -- validates required fields in `product.yaml`.

Adding `SKILL.md` and `marketplace.json` to the product folder will not trigger existing linters. The `lint-product-yaml.py` does NOT validate a `claude_skills` section -- it checks: top-level fields, habab, chrome_store, telegram, showcases, visual, seo. No changes needed to linter.

---

## 5. Existing Tests

Pre-commit test suite in `/root/aisell/botplatform/tests/`:
- `test_folder_structure.js` -- 7 checks on product folder layout
- `test_claude_md_templates.js` -- 54 checks on CLAUDE.md template content rules
- `test_ts_syntax.js` -- TypeScript brace balance
- `test_security_precommit.js` -- 10 security checks (secrets, patterns)
- `test_auth_api.js` -- 38 assertions (Auth API unit + integration)
- `test_dashboard_auth_e2e.js` -- 28 assertions (Puppeteer E2E)

Framework: Node.js, plain test scripts (no Jest/Mocha). Run with `node tests/test_*.js`.

Representative signatures:
```javascript
// test_folder_structure.js
function checkProductFolder(productId) { /* checks product.yaml, CLAUDE.md, icons/, showcases/ exist */ }

// test_claude_md_templates.js
function validateTemplate(content) { /* checks 54 required strings/patterns in CLAUDE.md.template */ }
```

New files (`SKILL.md`, `marketplace.json`) will not break existing tests. `test_folder_structure.js` may need a new check if SKILL.md becomes a required product artifact.

---

## 6. Shared Utilities

### Screenshot Generation

`/root/aisell/extensions/webchat-sidebar/scripts/screenshot_bilingual.js`
Generates 4 screenshot files from `demo.html`: EN/RU at 1280x800 and 640x400. Invoked as:
```bash
node extensions/webchat-sidebar/scripts/screenshot_bilingual.js \
  products/simple_dashboard/showcases/{slug}/demo.html \
  products/simple_dashboard/showcases/{slug}/
```

### Build Script (Extension)

`/root/aisell/extensions/webchat-sidebar/build.js` -- compiles Chrome Extension per product. Takes `--name`, `--short-name`, `--url` args. Not directly relevant to SKILL.md but is part of distribution channel management.

### Product YAML Template

`/root/aisell/products/_template.yaml` -- template for creating new products. The checklist at the bottom (lines 170-188) currently has 9 steps ending with "Add to README.md". A step 10 for SKILL.md/marketplace.json should be appended.

---

## 7. Potential Problems

### SKILL.md Content: What to Include

The CLAUDE.md.template (user-facing) is the closest analog to what SKILL.md should contain. However, SKILL.md for Claude Skills marketplace is likely a shorter, curated description that:
- Describes the skill's purpose and capabilities
- Lists input/output expectations
- Provides usage examples

The full CLAUDE.md.template (1100+ lines including auth flows, Chart.js patterns, DashboardDB API) is too detailed for a marketplace listing. SKILL.md should be a curated subset, probably covering: what SimpleDashboard does, what users can build, key capabilities (interview protocol, industry templates, data sources), and the dashboard output format.

### File Naming Ambiguity

The feature mentions "Claude Skills marketplace" but Anthropic's Skills marketplace format is not yet standardized at time of writing (knowledge cutoff August 2025). The SKILL.md + marketplace.json format may need to be defined by the team. Analogous to how `chrome_store` section in `product.yaml` mirrors the Chrome Web Store submission format, `marketplace.json` should mirror whatever the Claude Skills marketplace submission format requires.

### Command vs Skill Location

`generate-product-showcase-gallery.md` is currently a `/command` (invokable as a slash command). The feature asks to "move/link" it to `aisell/.claude/skills/`. In Claude Code, commands and skills have different invocation mechanisms:
- Commands (`/root/.claude/commands/`): invoked with `/command-name`
- Skills (`/path/.claude/skills/`): loaded as context, not directly invoked

Moving it to skills would change how it's invoked. The safer approach is to create a copy at `aisell/.claude/skills/generate-product-showcase-gallery.md` while keeping the original command at the global location (since it serves both SimpleSite and SimpleDashboard).

### products/README.md Has Stale Reference

Line 157: References `/root/.claude/skills/showcase-create.md` -- this file does NOT exist. The actual file is `/root/.claude/commands/generate-product-showcase-gallery.md`. This stale reference needs fixing as part of this feature's documentation work.

### Repo is Private

`marsiandeployer/aisell` is a PRIVATE GitHub repository. This has no direct impact on the feature implementation but means the SKILL.md published to Claude Skills marketplace cannot link to the source repository.

---

## 8. Constraints and Infrastructure

### File Organization Rules (from CLAUDE.md)

Global rule: "Skills/commands создавать ГЛОБАЛЬНО (не в проектных папках)." This means the showcase gallery command should remain global (`/root/.claude/commands/`) and only be linked or referenced from the project-level skills directory, not duplicated.

### Pre-commit Hooks

`.husky` or similar -- scripts in `/root/aisell/scripts/lint-*.py` run on commit. Adding `SKILL.md` and `marketplace.json` will not be blocked by existing linters. Any Cyrillic content in `marketplace.json` (if it is the EN-facing marketplace listing) should be avoided.

### No `.txt` Files Allowed in Showcases

`scripts/lint-cyrillic.py` blocks `.txt` files in showcases. This constraint does not apply to the product root folder where SKILL.md and marketplace.json would live.

### Environment Variables

No new environment variables required for this feature. It is purely documentation/metadata.

---

## 9. External Libraries

No external libraries are involved in creating SKILL.md, marketplace.json, or linking the showcase command. The implementation is purely file/documentation creation.

---

## Updated: 2026-03-04 -- Implementation-Level Detail

### Q1. bot.ts -- Exact Function for Template Selection

**File:** `/root/aisell/botplatform/src/bot.ts`

**Constants (lines 352-353):**
```typescript
const CLAUDE_MD_TEMPLATE_PATH = path.join(__dirname, '../CLAUDE.md.example');
const CLAUDE_MD_TEMPLATE_FALLBACK = '# Проект\n\n## Идея\n\n{{PROJECT_IDEA}}\n';
```

**Template resolution function (lines 358-365):**
```typescript
// REF: Templates live in products/{product_type}/CLAUDE.md.template
function getClaudeMdTemplatePath(): string {
  const productType = (process.env.PRODUCT_TYPE || '').toLowerCase();
  if (productType) {
    const productPath = path.join(__dirname, `../../products/${productType}/CLAUDE.md.template`);
    if (fs.existsSync(productPath)) return productPath;
  }
  return CLAUDE_MD_TEMPLATE_PATH;
}
```

**Consumer function (lines 982-991):**
```typescript
private buildClaudeMdContent(idea?: string, userId?: number): string {
  const projectIdea = (idea && idea.trim()) ? idea.trim() : 'Нет описания';
  const templatePath = getClaudeMdTemplatePath();
  const template = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf8')
    : CLAUDE_MD_TEMPLATE_FALLBACK;
  return template
    .replace(/\{\{PROJECT_IDEA\}\}/g, projectIdea)
    .replace(/\{USERID\}/g, userId != null ? String(userId) : 'UNKNOWN');
}
```

**Workspace creation (lines 993-1018):**
`ensureUserWorkspace(userId, idea)` calls `buildClaudeMdContent(idea, userId)` and writes the result to `${WORKSPACES_ROOT}/user_${userId}/CLAUDE.md` with mode `0o600`.

**What must change:**
1. Line 357 comment: `products/{product_type}/CLAUDE.md.template` -> `products/{product_type}/SKILL.md`
2. Line 361 string literal: `../../products/${productType}/CLAUDE.md.template` -> `../../products/${productType}/SKILL.md`
3. Total: 2 occurrences of the string `CLAUDE.md.template` in the function. One more on line 3969 (comment referencing "CLAUDE.md.template instructs Claude") should also be updated.

### Q2. Test Files -- Exact Checks That Reference CLAUDE.md.template

#### test_folder_structure.js (`/root/aisell/botplatform/tests/test_folder_structure.js`)

**Lines 106-131 (Test 5):**
```javascript
// Test 5: Проверка CLAUDE.md.template для продуктов
const productsDir = '/root/aisell/products';
const expectedProducts = ['simple_dashboard', 'simple_site'];

expectedProducts.forEach(product => {
  const templatePath = path.join(productsDir, product, 'CLAUDE.md.template');  // LINE 112
  if (fs.existsSync(templatePath)) {
    const content = fs.readFileSync(templatePath, 'utf8');
    if (content.includes('{{PROJECT_IDEA}}') && content.includes('Безопасность')) {
      // ...
    }
  }
});
```

**Changes required:**
- Line 106: Test description string `'CLAUDE.md.template'` -> `'SKILL.md'`
- Line 112: `path.join(productsDir, product, 'CLAUDE.md.template')` -> `path.join(productsDir, product, 'SKILL.md')`
- Line 116: Log message containing `CLAUDE.md.template` -> `SKILL.md`
- Line 119: Error message containing `CLAUDE.md.template` -> `SKILL.md`
- Line 123: Error message containing `CLAUDE.md.template` -> `SKILL.md`
- Total: 5 string occurrences of `CLAUDE.md.template` in this file.

#### test_claude_md_templates.js (`/root/aisell/botplatform/tests/test_claude_md_templates.js`)

This is the more extensive test -- 210 lines, 10 test groups, ~54 assertions. Key references:

**Lines 46-49 -- product spec markers:**
```javascript
const PRODUCTS = {
  simple_dashboard: {
    requiredInTemplate: ['Chart.js', 'Tailwind', 'SPA', 'tt(', 'i18n', 'CAC'],
    forbiddenInTemplate: ['PromptBar', 'Showcases Architecture', 'Pre-commit Linters', 'config.yaml per showcase'],
    requiredInClaudeMd: ['Chart.js', 'SPA Architecture'],
  },
  simple_site: {
    requiredInTemplate: ['Tailwind', 'Hydra AI', 'data-i18n', 'Hero'],
    forbiddenInTemplate: ['PromptBar', 'Showcases Architecture', 'Pre-commit Linters', 'Chart.js'],
    requiredInClaudeMd: ['Tailwind', 'Landing Page'],
  },
};
```

**Lines 60-65 -- required sections (applies to all products):**
```javascript
const REQUIRED_SECTIONS = [
  '{{PROJECT_IDEA}}',
  '{USERID}',
  'Безопасность',
  'Домен',
];
```

**Lines that reference `CLAUDE.md.template` (exact occurrences):**
- Line 72: `path.join(PRODUCTS_DIR, product, 'CLAUDE.md.template')` (Test 1)
- Line 73: `assert(fs.existsSync(templatePath), \`${product}/CLAUDE.md.template exists\`)` (Test 1)
- Line 86: `path.join(PRODUCTS_DIR, product, 'CLAUDE.md.template')` (Test 3)
- Line 97: `path.join(PRODUCTS_DIR, product, 'CLAUDE.md.template')` (Test 4)
- Line 108: `path.join(PRODUCTS_DIR, product, 'CLAUDE.md.template')` (Test 5)
- Line 129: `path.join(PRODUCTS_DIR, product, 'CLAUDE.md.template')` (Test 7)
- Line 146: `path.join(distDir, \`../../products/${productType}/CLAUDE.md.template\`)` (Test 8 -- mirrors bot.ts logic)
- Line 153: `getClaudeMdTemplatePath('simple_dashboard').includes('simple_dashboard/CLAUDE.md.template')` (Test 8)
- Line 157: `getClaudeMdTemplatePath('simple_site').includes('simple_site/CLAUDE.md.template')` (Test 8)
- Line 173: `path.join(PRODUCTS_DIR, product, 'CLAUDE.md.template')` (Test 9)
- Line 182: `${product}/CLAUDE.md.template: has {{PROJECT_IDEA}}` (Test 9)

**Total: 18 occurrences of string `CLAUDE.md.template` in this file.** All must be updated to `SKILL.md`.

**Critical consideration for SKILL.md with YAML frontmatter:** Tests 3 and 7 directly `fs.readFileSync` the template and check for `{{PROJECT_IDEA}}` and `{USERID}`. If SKILL.md has YAML frontmatter at the top, these markers will still be found in the body, so tests will pass. However, the `REQUIRED_SECTIONS` check on line 60 looks for exact strings (`'{{PROJECT_IDEA}}'`, `'{USERID}'`, `'Безопасность'`, `'Домен'`). These must remain in SKILL.md body.

**For simple_site:** Per user-spec.md, `simple_site/CLAUDE.md.template` is also renamed to `SKILL.md`. The `requiredInTemplate` markers for simple_site are: `['Tailwind', 'Hydra AI', 'data-i18n', 'Hero']`. These must remain in the renamed SKILL.md.

### Q3. CLAUDE.md.template Diff Analysis -- Webchat-Specific Blocks

**`/root/aisell/products/simple_dashboard/CLAUDE.md.template`** -- 893 lines, 12 top-level sections:

| Line | Section Heading | Keep/Remove for SKILL.md |
|------|----------------|--------------------------|
| 1 | `# SimpleDashboard Project` | KEEP (rename to skill-appropriate title) |
| 3 | `## Идея` + `{{PROJECT_IDEA}}` | REMOVE (webchat onboarding only; replace with skill description) |
| 7 | `## Безопасность` | KEEP (per user-spec: 12 lines, acceptable duplication) |
| 20 | `## Домен` | **REMOVE** -- references `d{USERID}.wpmix.net`, our hosting infrastructure |
| 28 | `## Внешние данные (коннекторы)` | **REMOVE** -- references `/api/fetch` proxy on our server, CSP rules for `d*.wpmix.net` |
| 48 | `## Источники данных / Data Sources` | KEEP (core skill: what data sources are supported) |
| 81 | `## Контекст дашборда (авто-скриншот)` | **REMOVE** -- Extension sidebar auto-screenshot, `current_dashboard_screenshot.png` |
| 97 | `## Генерация дашбордов` | KEEP (core skill: Chart.js, Tailwind, SPA, i18n patterns) |
| 241 | `## Auth (защита дашборда)` | **REMOVE** -- Extension keypair, `d{USERID}.wpmix.net` auth endpoints, magic link, web3 |
| 548 | `## Data Storage (CRUD API)` | **REMOVE** -- `/api/data/{collection}` on our server, DashboardDB helper |
| 640 | `## Первые шаги` | KEEP but adapt (interview questions are core skill, remove "загрузи CSV в чат") |
| 654 | `## Sprint Report (GitHub)` | KEEP (standalone capability, no server dependency) |

**Webchat-specific strings to remove (per acceptance criteria):**
- `current_dashboard_screenshot` -- 4 occurrences (lines 85, 88, 93, 94)
- `WEBCHAT_INIT` -- 0 occurrences in template (only in bot.ts)
- `Extension sidebar` -- referenced at line 83 ("extension-сайдбара")
- `d{USERID}.wpmix.net` -- 8 occurrences (lines 22, 26, 83, 84, 562, 656, 878, 880)
- `localhost:` -- 0 occurrences
- `95.217.` / `62.109.` -- 0 occurrences
- `:8094` / `:8091` / `:8095` -- 0 occurrences

**What must be REPLACED (not just removed):**
- `## Домен` section (lines 20-26): Replace with `## Deployment` section. New content: "Save as `index.html`, open locally, or deploy to GitHub Pages / Netlify / Vercel."
- `## Внешние данные` section (lines 28-46): Remove entirely. External data instructions are server-proxy-specific.
- `## Data Storage` section (lines 548-638): Remove entirely. Replace with note: "For persistent data, use the filesystem or a backend of your choice."
- `## Auth` section (lines 241-546): Remove entirely. This is 305 lines of Extension/web3 auth -- not relevant outside our platform.

**What must be ADDED:**
- YAML frontmatter (`name`, `description`, `version`, `tags`) per agentskills.io standard
- `## Live Examples` section with 7 showcase links to `simpledashboard.wpmix.net/showcases/{slug}/demo`
- `## Deployment` section replacing `## Домен`

**`/root/aisell/products/simple_site/CLAUDE.md.template`** -- 138 lines, 5 sections:

| Line | Section Heading | Keep/Remove for SKILL.md |
|------|----------------|--------------------------|
| 1 | `# SimpleSite Project` | KEEP |
| 3 | `## Идея` + `{{PROJECT_IDEA}}` | REMOVE (webchat only) |
| 7 | `## Безопасность` | KEEP |
| 20 | `## Домен` | **REMOVE** -- `u{USERID}.habab.ru` hosting, `.port` file, proxy instructions |
| 37 | `## Генерация сайтов` | KEEP (core) |
| 131 | `## Первые шаги` | KEEP but adapt |

No webchat-specific strings (`current_dashboard_screenshot`, `localhost:`, `95.217`, `62.109`) found. Only `u{USERID}.habab.ru` references in the Домен section.

### Q4. product.yaml chrome_store Section as Model for marketplace.json

The `chrome_store` section in `/root/aisell/products/simple_dashboard/product.yaml` (lines 40-96):

```yaml
chrome_store:
  name: "SimpleDashboard - AI Analytics Builder"
  short_name: "SimpleDashboard"
  short_description: "Build business dashboards with AI. Upload CSV, connect API, get real-time analytics."
  detailed_description: |
    Create professional analytics dashboards through conversation with AI.
    Upload your data or connect APIs - get actionable insights in minutes.
    [... 24 lines of feature lists ...]
  keywords:
    - "business dashboard"
    - "analytics dashboard builder"
    - "KPI dashboard"
    - "sales dashboard"
    - "data visualization"
    - "no-code analytics"
    - "CSV to dashboard"
  icons:
    dir: "/root/aisell/products/simple_dashboard/icons/"
  screenshots:
    - path: "showcases/sales-kpi/screenshot-1280x800.png"
      caption: "Sales KPI Dashboard"
    - path: "showcases/website-analytics/screenshot-1280x800.png"
      caption: "Website Analytics"
    - path: "showcases/order-management/screenshot-1280x800.png"
      caption: "Order Management Panel"
```

**Mapping to marketplace.json:**

```json
{
  "name": "SimpleDashboard",
  "version": "1.0.0",
  "description": "AI-powered business dashboard builder. Describe what metrics matter, get professional analytics dashboards with Chart.js charts, KPIs, and SPA navigation.",
  "tags": ["dashboard", "analytics", "business", "chartjs", "tailwind", "visualization", "spa"],
  "author": "Noxon Digital Factory",
  "homepage": "https://simpledashboard.wpmix.net",
  "screenshots": [
    { "url": "https://simpledashboard.wpmix.net/showcases/sales-analytics-utm/screenshot-1280x800.png", "caption": "Sales Analytics Dashboard" },
    ...
  ]
}
```

**SEO keywords from `seo.keywords` (lines 220-231):**
```yaml
seo:
  keywords:
    primary:
      - "бизнес дашборд"
      - "аналитика продаж"
      - "KPI дашборд"
      - "dashboard builder"
    secondary:
      - "визуализация данных"
      - "отчеты для руководителя"
      - "мониторинг показателей"
      - "CSV to dashboard"
```

For marketplace.json tags, use English equivalents from chrome_store.keywords: `"business dashboard"`, `"analytics dashboard builder"`, `"KPI dashboard"`, `"sales dashboard"`, `"data visualization"`, `"no-code analytics"`, `"CSV to dashboard"`. Per user-spec acceptance criteria, tags must include: `dashboard`, `analytics`, `business`, `chartjs`, `tailwind`, `visualization`, `spa`.

### Q5. README.md -- Interfaces Table (Exact Lines to Update)

**`/root/aisell/README.md` lines 39-46:**
```markdown
## Интерфейсы

| Интерфейс | Реализация | Описание |
|-----------|------------|----------|
| **Webchat** | `botplatform/` | Web UI в браузере |
| **Chrome Extension** | `extensions/webchat-sidebar/` | Sidebar в браузере |
| **Telegram Bot** | `botplatform/` | Чат в Telegram |
```

**Add a 4th row after line 46:**
```markdown
| **Claude Skills** | `products/simple_dashboard/SKILL.md` | Standalone skill для Claude Code |
```

**No separate "distribution channels" section exists** -- distribution info is embedded in the Web Chat table (lines 160-168) and Chrome Extension section (lines 180-199). The Интерфейсы table is the primary place to add Claude Skills as a new channel.

### Q6. products/README.md -- Stale Reference (Exact Line)

**`/root/aisell/products/README.md` line 157:**
```markdown
| `/root/.claude/skills/showcase-create.md` | Создание showcases |
```

This file **does NOT exist** at `/root/.claude/skills/showcase-create.md`. Confirmed by grep: no file named `showcase-create.md` exists anywhere in `/root/.claude/skills/`.

The correct reference is `/root/.claude/commands/generate-product-showcase-gallery.md`.

**Fix:** Change line 157 to:
```markdown
| `/root/.claude/commands/generate-product-showcase-gallery.md` | Создание showcases |
```

Additionally, the entire table at lines 153-161 should be updated to add the new project-level skill copy at `aisell/.claude/skills/generate-product-showcase-gallery.md`.

### Q7. YAML Frontmatter Handling in bot.ts

**No frontmatter stripping logic exists.** The `buildClaudeMdContent()` function (lines 982-991) reads the template file with `fs.readFileSync(templatePath, 'utf8')` and performs only two replacements:
1. `{{PROJECT_IDEA}}` -> user's idea string
2. `{USERID}` -> user's numeric ID

The raw content (including any YAML frontmatter) is written directly to the user's `CLAUDE.md` file. There is no `---` detection, no YAML parsing, no frontmatter stripping.

**Impact:** If SKILL.md has YAML frontmatter like:
```yaml
---
name: SimpleDashboard
description: AI dashboard builder
version: 1.0.0
tags: [dashboard, analytics]
---
```

This frontmatter will be copied verbatim into the user's `CLAUDE.md`. Claude Code treats `CLAUDE.md` as a markdown file and will read the frontmatter as text context. This is **acceptable** -- Claude will understand the frontmatter as metadata and not be confused by it. The frontmatter does not contain any executable instructions.

**Decision from user-spec.md:** "При копировании шаблона в user workspace: YAML frontmatter из SKILL.md стрипается или игнорируется Claude Code (не влияет на работу дашборда)." The spec says to strip OR let Claude ignore it. Since no stripping logic exists and adding it would be a code change to bot.ts, the simplest approach is to NOT add stripping logic -- Claude Code naturally handles frontmatter in markdown files.

If stripping is desired, the change in `buildClaudeMdContent()` would be:
```typescript
let content = template;
// Strip YAML frontmatter if present
if (content.startsWith('---\n')) {
  const endIdx = content.indexOf('\n---\n', 4);
  if (endIdx !== -1) content = content.slice(endIdx + 5);
}
return content
  .replace(/\{\{PROJECT_IDEA\}\}/g, projectIdea)
  .replace(/\{USERID\}/g, userId != null ? String(userId) : 'UNKNOWN');
```

### Q8. marketplace.json -- Similar Files in Codebase

**No `marketplace.json` file exists anywhere in the codebase.** Grep for `marketplace.json` returns only hits in the work feature folder (user-spec.md and code-research.md).

**Closest analogs:**
1. `product.yaml` -> `chrome_store` section (see Q4 above) -- structured metadata for external marketplace
2. `extensions/webchat-sidebar/manifest.json` -- Chrome Extension manifest (different purpose: browser extension config, not marketplace listing)
3. `package.json` files -- npm package metadata (name, version, description, keywords)

**The chrome_store section is the best model** for marketplace.json because it contains the same types of fields: name, description, keywords/tags, screenshots with captions. The mapping is straightforward (see Q4).

---

## Summary: Files to Create or Modify (Updated)

| Action | File | Notes |
|--------|------|-------|
| RENAME | `/root/aisell/products/simple_dashboard/CLAUDE.md.template` -> `SKILL.md` | Add YAML frontmatter, remove webchat sections, add Deployment + Live Examples |
| RENAME | `/root/aisell/products/simple_site/CLAUDE.md.template` -> `SKILL.md` | Add YAML frontmatter, remove Домен section, add Deployment |
| CREATE | `/root/aisell/products/simple_dashboard/marketplace.json` | Public metadata for marketplace submission |
| MODIFY | `/root/aisell/botplatform/src/bot.ts` | Lines 357, 361: `CLAUDE.md.template` -> `SKILL.md` (2 changes + 1 comment on line 3969) |
| MODIFY | `/root/aisell/botplatform/tests/test_folder_structure.js` | 5 occurrences of `CLAUDE.md.template` -> `SKILL.md` |
| MODIFY | `/root/aisell/botplatform/tests/test_claude_md_templates.js` | 18 occurrences of `CLAUDE.md.template` -> `SKILL.md` |
| COPY | `/root/.claude/commands/generate-product-showcase-gallery.md` -> `/root/aisell/.claude/skills/generate-product-showcase-gallery.md` | Project-level skill copy |
| MODIFY | `/root/aisell/README.md` | Line 46: add Claude Skills row to Интерфейсы table |
| MODIFY | `/root/aisell/products/README.md` | Line 157: fix stale showcase-create.md reference; add Claude Skills to workflow |
| MODIFY | `/root/aisell/products/simple_dashboard/.claude/skills/project-knowledge/references/architecture.md` | Add Claude Skills to distribution channels table |
| MODIFY | `/root/aisell/products/simple_dashboard/.claude/skills/project-knowledge/references/project.md` | Add Claude Skills to distribution strategy |
| MODIFY | `/root/aisell/products/_template.yaml` | Add step 10 to checklist for SKILL.md/marketplace.json |

## Key Content Sources for SKILL.md

From `product.yaml` -> `description` and `chrome_store.detailed_description`: the capabilities list (CSV upload, Google Sheets, REST API, etc.) and chart types.

From `CLAUDE.md.template`: the "Первые шаги" section (onboarding questions), data sources list, and the dashboard structure rules define what the skill does in practice.

From `product.yaml` -> `telegram.welcome_message`: the user-facing pitch already written for Telegram onboarding -- a strong starting point for SKILL.md's "What you can build" section.

From `product.yaml` -> `seo.keywords`: the primary and secondary keywords define the marketplace search terms.

## CLAUDE.md.template Section-by-Section Transformation Map (simple_dashboard)

| Template Section (line) | Lines | SKILL.md Action | Reason |
|-------------------------|-------|-----------------|--------|
| `# SimpleDashboard Project` (1) | 1 | Rename to `# SimpleDashboard` | Skill title |
| `## Идея` + `{{PROJECT_IDEA}}` (3-5) | 3 | **REMOVE** | Webchat onboarding placeholder |
| `## Безопасность` (7-18) | 12 | **KEEP** | Security rules are universal |
| `## Домен` (20-26) | 7 | **REPLACE** with `## Deployment` | `d{USERID}.wpmix.net` -> GitHub Pages/Netlify/local |
| `## Внешние данные (коннекторы)` (28-46) | 19 | **REMOVE** | Server-proxy specific (`/api/fetch`) |
| `## Источники данных` (48-79) | 32 | **KEEP** | Core skill capability |
| `## Контекст дашборда` (81-96) | 16 | **REMOVE** | Extension sidebar auto-screenshot |
| `## Генерация дашбордов` (97-239) | 143 | **KEEP** (core: CDN, structure, Chart.js, SPA, i18n, rules) | Core dashboard generation instructions |
| `## Auth` (241-546) | 306 | **REMOVE** | Web3 Extension keypair auth, magic links -- platform-specific |
| `## Data Storage` (548-638) | 91 | **REMOVE** | Server CRUD API `/api/data/` -- platform-specific |
| `## Первые шаги` (640-652) | 13 | **ADAPT** | Keep interview questions, remove "загрузи CSV в чат" |
| `## Sprint Report` (654-893) | 240 | **KEEP** | Standalone capability, no server dependency |

**Estimated SKILL.md size:** ~450 lines (from 893). Removed: Auth (306) + Data Storage (91) + Внешние данные (19) + Контекст дашборда (16) + Домен (7) + Идея (3) = 442 lines removed, ~10 lines added for new sections.

## Test Update Details

### test_folder_structure.js -- Exact Changes

The file is 149 lines. Test 5 (lines 106-131) is the only section that references `CLAUDE.md.template`. All changes are string literal replacements within this test block.

The `REQUIRED_SECTIONS` validation (line 115: checks for `{{PROJECT_IDEA}}` and `Безопасность`) must be updated. Per user-spec, `{{PROJECT_IDEA}}` is removed from SKILL.md. The test must check for different required content -- likely `Безопасность` and product-specific markers only.

However, per user-spec: "bot.ts copies SKILL.md to user workspace as CLAUDE.md." The `buildClaudeMdContent()` still does `{{PROJECT_IDEA}}` replacement. If `{{PROJECT_IDEA}}` is not in SKILL.md, the replacement is a no-op (regex finds nothing). This means the user-spec intends SKILL.md to NOT have `{{PROJECT_IDEA}}`. The test must remove this check.

**BUT:** the `REQUIRED_SECTIONS` in `test_claude_md_templates.js` (line 61) checks for `{{PROJECT_IDEA}}` across ALL products. Removing it requires either:
1. Removing `{{PROJECT_IDEA}}` from `REQUIRED_SECTIONS` globally (but it is still used in `buildClaudeMdContent`)
2. Making the check product-specific

The cleanest approach: keep `{{PROJECT_IDEA}}` in SKILL.md body as a placeholder that gets replaced for webchat users and is ignored by standalone skill users. This preserves backward compatibility with tests and bot.ts. Per user-spec: "bot.ts copies SKILL.md to user workspace as CLAUDE.md" -- so the placeholder is still needed for the copy flow.

**Resolution:** Keep `{{PROJECT_IDEA}}` in SKILL.md (possibly in a minimal `## Project` section at the top). This means `## Идея` section is kept but renamed/simplified, not fully removed. The test continues to pass.

### lint-product-yaml.py -- No Changes Needed

The linter (`/root/aisell/scripts/lint-product-yaml.py`, 210 lines) validates these required fields:
- Top-level: `product_id`, `name`, `tagline`, `description`, `version`, `status`, `category`
- `habab.product_url`, `habab.b2b_pitch`, `habab.target_audience`
- `chrome_store.name`, `chrome_store.short_name`, `chrome_store.short_description`, `chrome_store.detailed_description`, `chrome_store.keywords`
- `telegram.bot_username`, `telegram.webchat_url`, `telegram.webchat_port`, `telegram.welcome_message`, `telegram.system_prompt`
- `showcases` (list with slug, prompt, caption, tags per item)
- `visual.primary_color`, `visual.icon_symbol`
- `seo.keywords.primary`, `seo.article_ideas`

There is NO validation for a `claude_skills` or `marketplace` section. Since user-spec says marketplace.json is a separate file (not in product.yaml), no changes to the linter are needed.
