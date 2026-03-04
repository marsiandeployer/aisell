# SimpleDashboard Showcases — Internal Developer Docs

## PromptBar (MANDATORY on every demo)

Every `demo.html` MUST have a fixed bottom CTA bar linking to SimpleDashboard:

```html
<div id="promptBar" style="position:fixed;bottom:0;left:0;right:0;z-index:1000;display:flex;align-items:center;justify-content:center;gap:16px;padding:10px 24px;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;font-size:18px;font-weight:600;text-shadow:0 1px 4px rgba(0,0,0,0.4);transition:transform 0.3s ease">
  <span id="promptText"></span>
  <a id="ctaBtn" style="flex-shrink:0;padding:8px 20px;background:#3B82F6;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;white-space:nowrap" href="https://simpledashboard.wpmix.net"></a>
</div>
```

- **Position:** `bottom:0` (NOT top) — enforced by pre-commit lint
- **Scroll behavior:** hides on scroll down (`translateY(100%)`), shows on scroll up
- **i18n:** `promptText` and `ctaLabel` keys in `_s.en` / `_s.ru`

## Showcases Architecture

### Directory structure
```
products/simple_dashboard/showcases/
├── index.html                          <- gallery page (2-column grid, i18n)
├── {slug}/
│   ├── demo.html                       <- SPA dashboard (Chart.js + Tailwind)
│   ├── config.yaml                     <- prompt + business context (reproducible)
│   ├── page.html                       <- screenshot wrapper
│   ├── sidebar-bg.jpg                  <- optional sidebar background (Hydra AI)
│   ├── screenshot-1280x800.png         <- EN screenshot
│   ├── screenshot-1280x800-ru.png      <- RU screenshot
│   ├── screenshot-640x400.png          <- EN thumbnail
│   └── screenshot-640x400-ru.png       <- RU thumbnail
```

### Current showcases
| Slug | Pages | Description |
|------|-------|-------------|
| `construction-crm` | 7 | 8 statuses, 15 roles, 7 departments, 17 auto-tasks, heatmap |
| `sales-analytics-utm` | 4 | UTM tracking, sales analytics, conversions |
| `funnel-analytics` | 4 | Sales funnel, financial analytics, UTM sources |

### Serving (Express routes in `botplatform/src/webchat.ts:3433`)
- `GET /showcases` -> `showcases/index.html` (gallery)
- `GET /showcases/:slug/demo` -> `showcases/{slug}/demo.html` (live demo)
- `GET /showcases/*` -> static files (screenshots, sidebar-bg.jpg, etc.)
- Hostname routing: `simpledashboard.wpmix.net` -> `simple_dashboard` product

### Gallery (`index.html`)
- Each card: `<img data-img-en="..." data-img-ru="...">` for language-aware screenshots
- Links to `/showcases/{slug}/demo` (opens in new tab)
- Fixed bottom promptBar with CTA to `simpledashboard.wpmix.net`
- Language toggle visible only for `navigator.language.startsWith('ru')`

### config.yaml per showcase
Every showcase MUST have `config.yaml` with full prompt and business context so the dashboard can be reproduced:
```yaml
showcase:
  slug: my-dashboard       # must match directory name
  product: simple_dashboard
  prompt: >-               # full generation prompt
    ...
  prompt_title: "..."      # short version for display
  caption: "..."           # English caption for gallery
demo:
  pages:                   # list of all SPA pages
    - id: overview
      title: "Overview"
      components: [...]
  business_context:        # domain-specific data model
    ...
```

### Screenshots
Generate bilingual screenshots after creating/updating demo.html:
```bash
node extensions/webchat-sidebar/scripts/screenshot_bilingual.js \
  products/simple_dashboard/showcases/{slug}/demo.html \
  products/simple_dashboard/showcases/{slug}/
# Output: screenshot-{1280x800,640x400}{,-ru}.png (4 files)
```

### Bilingual screenshots for gallery

After creating demo.html, take both EN and RU screenshots:
```bash
node extensions/webchat-sidebar/scripts/screenshot_bilingual.js demo.html ./
# Result: screenshot-1280x800.png (EN), screenshot-1280x800-ru.png (RU)
```

In the gallery `showcases/index.html`, use `data-img-en`/`data-img-ru` on `<img>` tags and `data-href-en`/`data-href-ru` on screenshot `<a>` links, so the `apply()` function can swap them when language changes.

## Pre-commit Linters

| Script | What it checks |
|--------|---------------|
| `scripts/lint-showcase-demos.py` | `demo.html` exists + `promptBar` has `position:fixed;bottom:0` |
| `scripts/lint-cyrillic.py` | No Cyrillic leaks in EN blocks, no stray `.txt` files |
| `scripts/lint-product-yaml.py` | Required fields in `product.yaml` |

## Potential tests to add
1. **Puppeteer smoke-test** — open each demo, verify Chart.js loaded, click all nav links, check no JS console errors, verify `tt()` returns no raw keys
2. **Screenshot lint** — all 4 screenshot files present per showcase, each > 10KB
3. **config.yaml lint** — required fields (`slug`, `prompt`, `pages`), slug matches directory name
4. **Gallery lint** — every showcase directory has a card in `index.html`, valid `data-img-en`/`data-img-ru`
5. **i18n Puppeteer test** — load with `navigator.language='ru'`, verify Russian strings, toggle to EN, verify English
6. **Express route test** — `GET /showcases` -> 200, `GET /showcases/{slug}/demo` -> 200, nonexistent -> 404
