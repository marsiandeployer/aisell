---
created: 2026-03-04
status: approved
branch: feature/skills-marketplace-publishing
size: L
---

# Tech Spec: skills-marketplace-publishing

## Solution

Add Claude Skills Marketplace as the 4th distribution channel for SimpleDashboard by:

1. Renaming `CLAUDE.md.template` → `SKILL.md` in both `simple_dashboard` and `simple_site` products. For `simple_dashboard`: add YAML frontmatter, remove webchat-specific sections (~440 lines removed), add `## Deployment` and `## Live Examples` sections. For `simple_site`: rename only + remove `## Домен` section + add minimal frontmatter.
2. Creating `marketplace.json` in `products/simple_dashboard/` — public metadata file for SkillsMP indexing (name, description, tags, screenshots).
3. Updating `bot.ts`: `CLAUDE.md.template` → `SKILL.md` in `getClaudeMdTemplatePath()` (1 string literal + 1 comment). YAML frontmatter in SKILL.md is left as-is — Claude Code treats it as metadata context, no stripping needed.
4. Updating test files to reference `SKILL.md` and remove checks for webchat-only fields (`{{PROJECT_IDEA}}`, `{USERID}`, `Домен`) that no longer exist in SKILL.md.
5. Copying showcase gallery command to project-level skills and updating all README/project-knowledge docs with the new distribution channel.

No new packages. No database changes. No deployment required (this feature is documentation + file rename + one bot.ts change).

## Architecture

### What we're building/modifying

- **`products/simple_dashboard/SKILL.md`** — renamed from `CLAUDE.md.template`, heavily edited: remove webchat-specific sections, add YAML frontmatter + Deployment + Live Examples sections. Becomes the primary instruction source for both skill users and webchat onboarding.
- **`products/simple_site/SKILL.md`** — renamed from `CLAUDE.md.template`, minimal edit: add YAML frontmatter, remove `## Домен` section only.
- **`products/simple_dashboard/marketplace.json`** — new public metadata file for SkillsMP/GitHub marketplace indexing.
- **`botplatform/src/bot.ts`** — 2-line change: `getClaudeMdTemplatePath()` returns `SKILL.md` path.
- **`botplatform/tests/test_folder_structure.js`** — update 5 occurrences of `CLAUDE.md.template` → `SKILL.md`.
- **`botplatform/tests/test_claude_md_templates.js`** — update file path reference + remove `{{PROJECT_IDEA}}`, `{USERID}`, `Домен` from required-section checks; add YAML frontmatter checks.
- **`aisell/.claude/skills/generate-product-showcase-gallery.md`** — copy of global command for project-scope context.
- **`README.md`** (aisell root) — add Claude Skills Marketplace row to Интерфейсы table (after line 46).
- **`products/README.md`** — fix stale reference on line 157 + add Claude Skills to workflow.
- **`products/simple_dashboard/.claude/skills/project-knowledge/references/architecture.md`** — add Claude Skills row to distribution channels table.
- **`products/simple_dashboard/.claude/skills/project-knowledge/references/project.md`** — add Claude Skills to Distribution Strategy section.

### How it works

**Skill user flow (new):**
```
User copies products/simple_dashboard/ → ~/.claude/skills/simpledashboard/
    ↓
Claude Code discovers SKILL.md (YAML frontmatter: name, description, tags)
    ↓
User: "create sales dashboard for e-commerce"
    ↓
Claude reads SKILL.md → runs interview protocol (3-4 questions)
    ↓
Claude generates index.html (Chart.js + Tailwind, SPA, i18n)
    ↓
User opens index.html locally OR deploys to GitHub Pages / Netlify / Vercel
```

**Webchat onboarding flow (unchanged UX, updated path):**
```
New user starts webchat session
    ↓
bot.ts: getClaudeMdTemplatePath() → "../../products/{PRODUCT_TYPE}/SKILL.md"
    ↓
buildClaudeMdContent() reads SKILL.md, substitutes {{PROJECT_IDEA}} if present
    ↓ (NOTE: SKILL.md won't have {{PROJECT_IDEA}} — bot copies content as-is)
Content written to user workspace as CLAUDE.md
    ↓
Webchat-specific context (auto-screenshot, d{USERID}.wpmix.net) remains in
products/simple_dashboard/CLAUDE.md (loaded separately as developer context)
```

**SkillsMP indexing (passive, post-repo-publish):**
```
Repo becomes public on GitHub
    ↓
SkillsMP scraper detects SKILL.md in products/simple_dashboard/
    ↓
marketplace.json provides structured metadata for skill card
    ↓
Skill appears on skillsmp.com after scraper cycle (requires 2+ stars)
```

## Decisions

### Decision 1: YAML frontmatter stays in user workspace CLAUDE.md
**Decision:** Do not strip YAML frontmatter from SKILL.md when bot.ts copies it to user workspace.
**Rationale:** `buildClaudeMdContent()` in bot.ts does not have frontmatter stripping logic. Claude Code treats YAML frontmatter as metadata context — it doesn't break functionality. Adding stripping logic adds complexity for zero UX benefit.
**Alternatives considered:** Add 4-line stripping block in `buildClaudeMdContent()`. Rejected — unnecessary complexity.

### Decision 2: Remove {{PROJECT_IDEA}} from SKILL.md
**Decision:** SKILL.md does not contain `{{PROJECT_IDEA}}` placeholder.
**Rationale:** Standalone skill users don't have a "project idea" set up by our bot. The placeholder is webchat-platform-specific. `buildClaudeMdContent()` copies file as-is if no substitution needed — no error thrown.
**Alternatives considered:** Keep `{{PROJECT_IDEA}}` and have bot substitute it. Rejected — SKILL.md must work for skill users who don't go through our bot onboarding.

### Decision 3: marketplace.json is standalone, not in product.yaml
**Decision:** `marketplace.json` is a separate public file, not a new section in `product.yaml`.
**Rationale:** `product.yaml` contains internal config (bot tokens via env vars, internal URLs, system prompts). It must not be published. `marketplace.json` is a public-facing artifact designed for external tools to read, analogous to the existing `chrome_store` section in `product.yaml` but fully public-safe.
**Alternatives considered:** Add `claude_skills` section to `product.yaml`. Rejected — risk of accidental token exposure when reading product.yaml in public context.

### Decision 4: simple_site gets minimal SKILL.md (no marketplace.json)
**Decision:** `simple_site` is renamed for consistency but gets no `marketplace.json` — only `simple_dashboard` publishes to marketplace in this sprint.
**Rationale:** Scope control. SimpleSite marketplace listing requires separate content strategy. Rename now for architecture consistency; marketplace listing deferred.

### Decision 5: Copy showcase skill, don't move it
**Decision:** Copy `/root/.claude/commands/generate-product-showcase-gallery.md` to `aisell/.claude/skills/generate-product-showcase-gallery.md`. Keep original.
**Rationale:** Global command serves both `simple_site` and `simple_dashboard`. Global CLAUDE.md references it as `/generate-product-showcase-gallery` slash command. Project-level copy adds context for aisell-scope sessions without breaking global availability. File is audited before copying to confirm no API keys or internal paths.
**Alternatives considered:** Symlink. Rejected — symlinks don't work reliably across git clones.

### Decision 6: Gitignore internal product files before making repo public
**Decision:** Add `.gitignore` entries for `products/*/product.yaml`, `products/*/CLAUDE.md`, `products/*/.claude/`, then `git rm --cached` to untrack already-committed files.
**Rationale:** `product.yaml` contains absolute filesystem paths (`/root/aisell/...`). `CLAUDE.md` (product-level developer file) contains webchat platform details. `.claude/` project-knowledge files (`architecture.md`, `project.md`) contain server IPs (`95.217.227.164`, `62.109.14.209`), internal ports (`8094`, `8095`), LXC network addresses (`10.10.10.2`), filesystem paths, and Chrome Extension App ID. None of these should be in a public repo. The skill user needs only `SKILL.md`, `marketplace.json`, `showcases/`, and `icons/`.
**Alternatives considered:** Sanitize docs in-place (remove IPs). Rejected — ongoing maintenance burden; any future update could re-introduce sensitive data. Gitignore is a permanent structural fix.

## Data Models

### marketplace.json schema

```json
{
  "name": "SimpleDashboard",
  "version": "1.0.0",
  "description": "Build professional business analytics dashboards as single-file index.html. Includes 7+ industry templates (e-commerce, SaaS, agency, restaurant, real estate), Chart.js charts, bilingual EN/RU support, adaptive business interview.",
  "author": "Noxon Digital Factory",
  "homepage": "https://simpledashboard.wpmix.net",
  "tags": ["dashboard", "analytics", "business", "chartjs", "tailwind", "visualization", "spa", "i18n"],
  "install": "Copy products/simple_dashboard/ to ~/.claude/skills/simpledashboard/",
  "screenshots": [
    { "path": "showcases/construction-crm/screenshot-1280x800.png", "caption": "Construction CRM Dashboard" },
    { "path": "showcases/sales-analytics-utm/screenshot-1280x800.png", "caption": "Sales Analytics + UTM" },
    { "path": "showcases/funnel-analytics/screenshot-1280x800.png", "caption": "Full Funnel Analytics" }
  ]
}
```

### SKILL.md frontmatter schema (agentskills.io standard)

```yaml
---
name: simpledashboard
description: Build professional analytics dashboards as single-file index.html. Use when user asks to create a dashboard, analytics page, business charts, KPIs, or data visualization. Includes industry templates for e-commerce, SaaS, marketing agencies, restaurants, real estate, manufacturing, and healthcare.
version: "1.0.0"
tags: [dashboard, analytics, business, chartjs, tailwind, visualization, spa, i18n]
---
```

### SKILL.md sections (simple_dashboard) — keep vs remove

| Section | Action | Reason |
|---------|--------|--------|
| YAML frontmatter | **ADD** | Required for marketplace |
| `## Your Role` / intro | **KEEP** | Core capability description |
| `## 🖼️ Контекст дашборда` (auto-screenshot) | **REMOVE** | Extension sidebar specific |
| `## CRITICAL: Chart.js + Tailwind` | **KEEP** | Core technical rule |
| `## 🎤 User Interview Protocol` | **KEEP** | Core workflow |
| `## 📊 Industry Templates` | **KEEP** | Core content |
| `## 🔌 Data Source Connectors` | **KEEP** | Useful for standalone |
| `## Dashboard Structure` | **KEEP** | Core output rules |
| `## SPA Architecture` | **KEEP** | Core technical rule |
| `## i18n` | **KEEP** | Core output rule |
| `## 🔐 Dashboard Auth Flow` | **REMOVE** | Our platform only |
| `## DashboardDB — JSON CRUD` | **REMOVE** | Our server only |
| `## Домен / d{USERID}.wpmix.net` | **REMOVE** | Our platform only |
| `## Внешние данные` (CSP section) | **REMOVE** | Our CDN/CSP specific |
| `## Безопасность` | **KEEP** | Required per user-spec — acceptable duplication |
| `## Deployment` | **ADD** | Standalone instruction |
| `## Live Examples` | **ADD** | 7 showcase links |

## Dependencies

### New packages
None.

### Using existing (from project)
- `botplatform/src/bot.ts` → `getClaudeMdTemplatePath()` — path change only, same call pattern
- `botplatform/tests/test_folder_structure.js` — update existing checks
- `botplatform/tests/test_claude_md_templates.js` — update existing checks

## Testing Strategy

**Feature size:** L

### Unit tests
- `test_folder_structure.js`: verify `SKILL.md` exists for `simple_dashboard` and `simple_site`; verify `CLAUDE.md.template` does NOT exist for both
- `test_claude_md_templates.js`: verify SKILL.md has YAML frontmatter (`name:`, `description:`, `tags:`); has `## Deployment` section; has `## Live Examples` with showcase links; has Chart.js, Tailwind, i18n, SPA markers; does NOT contain `current_dashboard_screenshot`, `WEBCHAT_INIT`, `d{USERID}.wpmix.net` as hosting instruction, internal IPs

### Integration tests
None — feature is file rename + content editing + one bot.ts path change. Existing test suite covers regression.

### E2E tests
None automated — manual verification: install skill to `~/.claude/skills/simpledashboard/`, prompt Claude Code, verify `index.html` generated.

## Agent Verification Plan

**Source:** user-spec "Как проверить" section.

### Verification approach

All checks are bash-based (file existence, grep, node JSON parse, npm test). No live server needed — feature is purely file/documentation.

### Per-task verification

| Task | Verify | What to check |
|------|--------|--------------|
| 1 — SKILL.md simple_dashboard | bash | `head -10 products/simple_dashboard/SKILL.md` contains `name:`, `description:`, `tags:`; `grep -c "simpledashboard.wpmix.net/showcases" products/simple_dashboard/SKILL.md` ≥ 7; grep checks for removed webchat sections return 0 |
| 2 — marketplace.json | bash | required fields check (name, version, description, tags, author, homepage, screenshots) exits 0; `m.tags.length` ≥ 7 |
| 3 — SKILL.md simple_site | bash | `ls products/simple_site/SKILL.md` exits 0; `ls products/simple_site/CLAUDE.md.template` exits 1; `grep -c "u{USERID}" products/simple_site/SKILL.md` = 0 |
| 4 — bot.ts | bash | `grep -c "SKILL.md" botplatform/src/bot.ts` ≥ 1; `grep -c "CLAUDE.md.template" botplatform/src/bot.ts` = 0 |
| 5 — Tests | bash | `cd botplatform && npm test` exits 0, 0 failed |
| 6 — Showcase skill | bash | `ls .claude/skills/generate-product-showcase-gallery.md` exits 0; `grep -c "localhost:\|/root/\|HYDRA_API_KEY" .claude/skills/generate-product-showcase-gallery.md` = 0 |
| 7 — Docs | bash | `grep -c "Claude Skills" README.md` ≥ 1; `grep -c "showcase-create.md" products/README.md` = 0 |
| 8 — architecture.md | bash | `grep -c "Claude Skills" products/simple_dashboard/.claude/skills/project-knowledge/references/architecture.md` ≥ 1 |
| 9 — gitignore | bash | `git ls-files products/simple_dashboard/product.yaml products/simple_site/product.yaml products/simple_crypto/product.yaml bananzabot/.env` returns empty; `git ls-files products/simple_dashboard/.claude/ \| wc -l` = 0 |

### Tools required
bash only — no Playwright MCP, no Telegram MCP, no curl.

## Risks

| Risk | Mitigation |
|------|-----------|
| `buildClaudeMdContent()` breaks because `{{PROJECT_IDEA}}` missing in SKILL.md | `buildClaudeMdContent()` (bot.ts:982) does string replace only if marker present — no error if absent. Confirmed by reading function body. |
| `test_claude_md_templates.js` fails on removed sections | Test update is part of Task 5 — update before running npm test. TDD order: update test first, then verify SKILL.md content passes. |
| YAML frontmatter leaks confusing context into user CLAUDE.md | Acceptable — Claude Code treats frontmatter as metadata. No UX impact. Verified by reading bot.ts copy logic. |
| simple_site bot.ts path breaks (different product) | `getClaudeMdTemplatePath()` uses PRODUCT_TYPE env — same function for all products. Both get `SKILL.md`, both files exist after rename. No breakage. |
| showcase gallery copy gets out of sync with global original | Known limitation, documented. Maintainer must sync manually when global command updates. |
| `getClaudeMdTemplatePath()` called in live webchat when SKILL.md doesn't exist | Function resolves path and reads file — will throw ENOENT. Task 4 must complete before any webchat restart. Deploy order: rename first (Task 1/3), update bot.ts second (Task 4), run tests third (Task 5). No partial deploy. |
| Internal server details in `.claude/` project-knowledge files published to public repo | Mitigated by Decision 6 + Task 9: gitignore `.claude/` dirs and `git rm --cached` before repo goes public. |
| **`bananzabot/.env` with live credentials is currently tracked in git** | **Critical pre-condition:** Task 9 adds `**/.env` to `.gitignore` and `git rm --cached bananzabot/.env`. Credentials (Telegram token, OpenAI key, Hydra key) must be rotated AND git history cleaned by repo owner before making repo public. These are manual steps outside this feature scope. |
| `generate-product-showcase-gallery.md` copy contains internal paths/API key refs | Task 6 sanitizes the copy before placing in public repo scope. Acceptance criterion verifies `grep` returns 0 for `localhost:`, `/root/`, `HYDRA_API_KEY`. |

## Acceptance Criteria

Technical acceptance criteria (supplements user-spec criteria):

- [ ] `products/simple_dashboard/SKILL.md` has valid YAML frontmatter parseable by standard YAML parser
- [ ] `marketplace.json` required fields: `node -e "const m=require('./products/simple_dashboard/marketplace.json'); ['name','version','description','tags','author','homepage','screenshots'].forEach(f=>{if(!m[f])throw new Error('missing: '+f)});console.log('ok')"` exits 0
- [ ] `marketplace.json` tags include all required: dashboard, analytics, business, chartjs, tailwind, visualization, spa
- [ ] `grep -c "CLAUDE.md.template" botplatform/src/bot.ts` returns 0
- [ ] `cd botplatform && npm test` exits 0 with 0 failed tests
- [ ] `ls products/simple_dashboard/CLAUDE.md.template products/simple_site/CLAUDE.md.template` both exit 1 (files deleted)
- [ ] `grep -c "current_dashboard_screenshot\|WEBCHAT_INIT\|Extension sidebar\|/api/fetch\|WEBCHAT_RATE_LIMIT" products/simple_dashboard/SKILL.md` returns 0
- [ ] `grep -c "localhost:\|95\.217\.\|62\.109\.\|10\.10\.10\|:8094\|:8091\|:8095\|/root/" products/simple_dashboard/SKILL.md` returns 0
- [ ] `grep -c "localhost:\|95\.217\.\|62\.109\.\|u{USERID}" products/simple_site/SKILL.md` returns 0
- [ ] `grep -c "simpledashboard.wpmix.net/showcases" products/simple_dashboard/SKILL.md` ≥ 7
- [ ] `grep -c "localhost:\|/root/\|HYDRA_API_KEY" .claude/skills/generate-product-showcase-gallery.md` returns 0
- [ ] `git ls-files products/simple_dashboard/product.yaml products/simple_site/product.yaml bananzabot/.env` returns empty (files untracked)
- [ ] `git ls-files products/simple_dashboard/.claude/` returns empty (directory untracked)
- [ ] No regressions in existing test suite

## Implementation Tasks

### Wave 1 — SKILL.md simple_dashboard + marketplace.json (независимые)

#### Task 1: Create SKILL.md for simple_dashboard
- **Description:** Rename `products/simple_dashboard/CLAUDE.md.template` to `SKILL.md`. Add YAML frontmatter at top. Remove webchat-specific sections: auto-screenshot context, Dashboard Auth Flow, DashboardDB CRUD, Домен/d{USERID} hosting, CSP/Внешние данные. Add `## Deployment` section (index.html → GitHub Pages/Netlify/Vercel) and `## Live Examples` section with links to all 7 showcases on simpledashboard.wpmix.net. Result: self-contained skill file with no internal infrastructure references.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor
- **Verify:** bash — `grep` checks for removed/added sections; `head -10` shows frontmatter
- **Files to modify:** `products/simple_dashboard/SKILL.md` (renamed from CLAUDE.md.template)
- **Files to read:** `products/simple_dashboard/CLAUDE.md.template`, `products/simple_dashboard/product.yaml` (for showcase slugs and SEO keywords)

#### Task 2: Create marketplace.json for simple_dashboard
- **Description:** Create `products/simple_dashboard/marketplace.json` as a public metadata file for SkillsMP and GitHub marketplace indexing. Structure based on `chrome_store` section in `product.yaml`. Include: name, version, description, author, homepage, tags (dashboard/analytics/business/chartjs/tailwind/visualization/spa/i18n), install instructions, and 3 screenshot entries. Result: valid JSON file readable by external marketplace tools.
- **Skill:** code-writing
- **Reviewers:** code-reviewer
- **Verify:** bash — `node -e "require('./products/simple_dashboard/marketplace.json')"` exits 0
- **Files to modify:** `products/simple_dashboard/marketplace.json` (new file)
- **Files to read:** `products/simple_dashboard/product.yaml` (chrome_store section as model, seo.keywords for tags)

### Wave 2 — simple_site + bot.ts (независимые)

#### Task 3: Create SKILL.md for simple_site
- **Description:** Rename `products/simple_site/CLAUDE.md.template` to `SKILL.md`. Add minimal YAML frontmatter using schema: `name: simplesite`, `description: <non-empty string>`, `version: "1.0.0"`, `tags: [site, landing, html, tailwind, spa]`. Remove `## Домен` section (u{USERID}.habab.ru hosting references) as it is platform-specific. No marketplace.json needed for simple_site in this sprint. Result: consistent SKILL.md naming across all products with template files.
- **Skill:** code-writing
- **Reviewers:** code-reviewer
- **Verify:** bash — `ls products/simple_site/SKILL.md` exits 0; `ls products/simple_site/CLAUDE.md.template` exits 1; `grep -c "u{USERID}\|localhost:\|95\.217\.\|62\.109\." products/simple_site/SKILL.md` = 0
- **Files to modify:** `products/simple_site/SKILL.md` (renamed from CLAUDE.md.template)
- **Files to read:** `products/simple_site/CLAUDE.md.template`

#### Task 4: Update bot.ts template path
- **Description:** In `botplatform/src/bot.ts`, update `getClaudeMdTemplatePath()` to reference `SKILL.md` instead of `CLAUDE.md.template`. Change 1 string literal in the function body (the path.join template string) and update the REF comment above the function. `buildClaudeMdContent()` requires no changes — it works with any file path.
- **Skill:** code-writing
- **Reviewers:** code-reviewer
- **Verify:** bash — `grep -c "CLAUDE.md.template" botplatform/src/bot.ts` = 0
- **Files to modify:** `botplatform/src/bot.ts`
- **Files to read:** `botplatform/src/bot.ts` (functions `getClaudeMdTemplatePath` and `buildClaudeMdContent`)

### Wave 3 — Tests + showcase skill (зависит от Wave 1+2)

#### Task 5: Update test files for SKILL.md
- **Description:** Update `test_folder_structure.js` and `test_claude_md_templates.js`: (a) replace all `CLAUDE.md.template` path references with `SKILL.md` — including any local `getClaudeMdTemplatePath()` helper functions defined inside the test file; (b) remove required-section checks for `{{PROJECT_IDEA}}`, `{USERID}`, `Домен`; (c) add negative assertion that `{{PROJECT_IDEA}}` is absent; (d) retain `Безопасность` section check (explicitly kept in SKILL.md per user-spec); (e) add YAML frontmatter checks by parsing the frontmatter block (extract key=value pairs, assert `name` is non-empty string, `tags` is non-empty array with ≥7 items, `description.length > 20`); (f) add assertion that `simpledashboard.wpmix.net/showcases` appears ≥7 times; (g) add test for `buildClaudeMdContent` "no placeholder" path: read SKILL.md, confirm no `{{PROJECT_IDEA}}`, run substitution, assert result equals original and is non-empty. Verify `npm test` passes with 0 failures.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** bash — `cd botplatform && npm test` exits 0
- **Files to modify:** `botplatform/tests/test_folder_structure.js`, `botplatform/tests/test_claude_md_templates.js`
- **Files to read:** `botplatform/tests/test_folder_structure.js`, `botplatform/tests/test_claude_md_templates.js`, `products/simple_dashboard/SKILL.md`

#### Task 6: Copy showcase gallery skill to project scope
- **Description:** Copy `/root/.claude/commands/generate-product-showcase-gallery.md` to `aisell/.claude/skills/generate-product-showcase-gallery.md`. Before copying, audit the source file and replace/remove any internal references: `localhost:` URLs, `/root/` filesystem paths, `HYDRA_API_KEY` variable name — replace with generic placeholders (`<WEBCHAT_URL>`, `<user-workspace>`, `YOUR_IMAGE_API_KEY`). Do not remove the original global command.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor
- **Verify:** bash — `ls .claude/skills/generate-product-showcase-gallery.md` exits 0; `grep -c "localhost:\|/root/\|HYDRA_API_KEY" .claude/skills/generate-product-showcase-gallery.md` = 0
- **Files to modify:** `.claude/skills/generate-product-showcase-gallery.md` (new file — copy)
- **Files to read:** `/root/.claude/commands/generate-product-showcase-gallery.md`

### Wave 4 — Documentation (зависит от Wave 1)

#### Task 7: Update root README.md and products/README.md
- **Description:** In `README.md` (aisell root), add Claude Skills Marketplace as 4th row to the Интерфейсы table. In `products/README.md`, fix stale `showcase-create.md` reference (→ `generate-product-showcase-gallery.md`) and add Claude Skills Marketplace step to the product publication workflow. Result: both READMEs document all 4 distribution channels consistently.
- **Skill:** documentation-writing
- **Reviewers:** code-reviewer
- **Verify:** bash — `grep -c "Claude Skills" README.md` ≥ 1; `grep -c "showcase-create.md" products/README.md` = 0
- **Files to modify:** `README.md`, `products/README.md`
- **Files to read:** `README.md` (Интерфейсы section), `products/README.md` (publication workflow and showcase link sections)

#### Task 8: Update project-knowledge docs
- **Description:** In `products/simple_dashboard/.claude/skills/project-knowledge/references/architecture.md`, add Claude Skills Marketplace row to the Distribution Channels table. In `references/project.md`, add Claude Skills to the Distribution Strategy section. Result: project knowledge is consistent with actual 4-channel distribution reality.
- **Skill:** documentation-writing
- **Reviewers:** code-reviewer
- **Verify:** bash — `grep -c "Claude Skills" products/simple_dashboard/.claude/skills/project-knowledge/references/architecture.md` ≥ 1
- **Files to modify:** `products/simple_dashboard/.claude/skills/project-knowledge/references/architecture.md`, `products/simple_dashboard/.claude/skills/project-knowledge/references/project.md`
- **Files to read:** both files above

#### Task 9: Add .gitignore entries for internal product files
- **Description:** Add `.gitignore` entries to protect ALL internal files before the repo can be made public: `products/*/product.yaml` (filesystem paths), `products/*/CLAUDE.md` (webchat platform details), `products/*/.claude/` (server IPs and credential variable names), and `**/.env` (bananzabot/.env contains live credentials and is currently tracked in git). Run `git rm --cached` for all currently-tracked sensitive files. Note: git history cleaning before making the repo public is a manual step for the repo owner (outside task scope, but documented in the post-task comment). This task covers making the files untracked going forward.
- **Skill:** infrastructure-setup
- **Reviewers:** code-reviewer, security-auditor, infrastructure-reviewer
- **Verify:** bash — `git ls-files products/simple_dashboard/product.yaml products/simple_site/product.yaml products/simple_crypto/product.yaml bananzabot/.env` must return empty; `git ls-files products/simple_dashboard/.claude/ | wc -l` must return 0
- **Files to modify:** `.gitignore`
- **Files to read:** `.gitignore`, `bananzabot/.env` (confirm it needs protecting), `products/simple_dashboard/product.yaml`

### Final Wave

#### Task 10: Pre-deploy QA
- **Description:** Run full test suite. Verify all acceptance criteria from user-spec and tech-spec. Check all bash verification commands from Agent Verification Plan. Confirm no webchat-specific content in SKILL.md. Confirm npm test passes. Confirm marketplace.json is valid JSON. Confirm all 4 distribution channels documented in README.
- **Skill:** pre-deploy-qa
- **Reviewers:** none
