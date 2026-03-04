# Code Research: dashboard-web3-auth

Created: 2026-02-27

## Updated: 2026-02-27

Deepened with implementation-level detail: exact extension communication patterns, nginx proxy configs on both servers, SSL certificate situation, postMessage protocol, content script injection patterns, and data flow traces.

---

## 1. Entry Points

### CLAUDE.md Template Copy Path (bot.ts)

The template system is the primary entry point for injecting auth code into generated dashboards.

**File:** `/root/aisell/botplatform/src/bot.ts`

- `getClaudeMdTemplatePath(): string` (line ~353) -- Resolves the template file based on `process.env.PRODUCT_TYPE`. For SimpleDashboard, it resolves to `/root/aisell/products/simple_dashboard/CLAUDE.md.template`. Falls back to `/root/aisell/botplatform/CLAUDE.md.example` if the product template does not exist.
- `buildClaudeMdContent(idea?: string, userId?: number): string` (line ~977) -- Reads the resolved template, replaces `{{PROJECT_IDEA}}` with the user's idea and `{USERID}` with the numeric user ID.
- `ensureUserWorkspace(userId: number, idea?: string): string` (line ~988) -- Creates `/root/aisell/botplatform/group_data/user_{userId}/` directory (mode 0o700) and writes `CLAUDE.md` from the template. Called on onboarding completion (activation code) or auto-provisioned for no-onboarding bots.

**Resolution chain:**
```
PRODUCT_TYPE env var -> products/{type}/CLAUDE.md.template -> fallback to CLAUDE.md.example
```

### Webchat Entry Points

**File:** `/root/aisell/botplatform/src/webchat.ts`

- `POST /api/auth/claim` (line ~4377) -- Main authentication endpoint. Accepts name + email, creates/finds user, creates session cookie, initializes /start dialog. No email verification by design.
- `POST /api/auth/google` (line ~4482) -- Google Sign-In endpoint. Verifies Google ID token via `google-auth-library`, creates user like claim.
- `ensureAuthed(req): WebUser | null` (line ~3403) -- Session checker. Reads `webchat_session` cookie, looks up in `sessions.json`. Falls back to localhost auto-auth (userId 999999999).
- `requireSessionApi` / `requireSessionPage` -- Express middleware wrapping `ensureAuthed`.
- `GET /api/me` (client JS, line ~2543) -- Returns current user info. Client stores `window.__WEBCHAT_USER_ID__` from response for extension postMessage communication.

### SimpleDashboard Launch Script

**File:** `/root/aisell/botplatform/start-webchat-simpledashboard.sh`

Key environment variables:
- `PRODUCT_TYPE=simple_dashboard`
- `WEBCHAT_PORT=8094`
- `ENABLE_ONBOARDING=false`
- `ENABLE_GOOGLE_AUTH=true`
- `DISABLE_PAYMENT_FLOW=true`
- `WEBCHAT_INIT_WITH_START=false`
- Sources env from `/root/aisell/noxonbot/.env`
- Runs `npm run webchat` (which is `tsx src/webchat.ts`)

### SimpleDashboard PM2 Process

Currently running as `simpledashboard-web` (PM2 id 32) on port 8094.

### Extension Entry Points

**File:** `/root/aisell/extensions/webchat-sidebar/src/background.js`

- `chrome.runtime.onInstalled` -- Sets side panel open behavior.
- `chrome.runtime.onMessage` -- Internal message handler. Handles `open_preview` (opens new tab with dashboard URL).
- `chrome.runtime.onMessageExternal` -- External message handler from web pages (via `externally_connectable`). Handles `open_webchat_prompt` (forwards prompt to panel iframe).

**File:** `/root/aisell/extensions/webchat-sidebar/src/panel.js`

- `handleMessage(event)` -- Main postMessage handler. Routes: `get_tab_info`, `read_page_content`, `capture_screenshot`, `set_developer_mode`, `get_developer_mode_state`, `clear_selected_element`, `file_created`, `open_showcases`, `open_webchat_prompt`.
- `sendToWebchat(message)` -- Sends postMessage to iframe (webchat). Posts to `iframeOrigin`.
- `initCommunication()` -- Called on iframe load. Sends `{ type: 'extension_ready', capabilities }` to webchat.

**New message types needed for Web3 auth:**
- `generate_keypair` -- Extension generates Ethereum keypair, stores in `chrome.storage`, returns address + privateKey.
- `sign_challenge` -- Extension signs a challenge string with stored private key, returns signature.
- `get_address` -- Extension returns stored Ethereum address (no private key).
- `import_keypair` -- Extension imports a keypair (for recovery), stores in `chrome.storage`.

---

## 2. Data Layer

### Current Data Storage (JSON files, no database)

All data is stored as flat JSON files. No PostgreSQL, no ORM anywhere in the codebase.

**Webchat user data:**
- `/root/aisell/botplatform/data/webchat/users.json` -- Array of `WebUser` objects
- `/root/aisell/botplatform/data/webchat/sessions.json` -- Array of `WebSession` objects
- `/root/aisell/botplatform/data/webchat/state.json` -- `{ nextUserId: number }` (currently at 9000000000126)
- `/root/aisell/botplatform/data/webchat/chats/{userId}.json` -- Per-user chat transcripts

**User workspace:**
- `/root/aisell/botplatform/group_data/user_{userId}/` -- Per-user directory
  - `CLAUDE.md` -- Generated from template
  - `index.html` -- Generated dashboard (served via nginx)
  - `chat_log.json` -- Conversation log
  - `settings.json` -- Per-user settings

### WebUser Type

```typescript
type WebUser = {
  userId: number;     // Starts at 9000000000000, auto-incremented
  email: string;
  name: string;
  nickname: string;
  createdAt: string;  // ISO datetime
};
```

### WebSession Type

```typescript
type WebSession = {
  sessionId: string;  // 24 random bytes hex
  userId: number;
  createdAt: string;
  expiresAt: string;  // Default TTL: 168 hours (7 days)
};
```

### PostgreSQL Status

- `pg-db` (LXC 102, IP 10.10.10.2) is **pingable** but PostgreSQL is **not running** (port 5432 connection refused).
- `psql` client v14.20 is installed on VM104.
- No PostgreSQL dependencies (`pg`, `sequelize`, `knex`, `prisma`, `typeorm`, `drizzle`) in any `package.json` in the monorepo.
- **Action required:** SSH to Proxmox host, start PostgreSQL in LXC 102, configure `pg_hba.conf` to allow connections from VM104 (10.10.10.104 or however the bridge routes), create `dashboard_auth` database.

---

## 3. Similar Features

### Webchat Auth System (closest reference)

The webchat has a complete auth flow that can serve as a reference pattern:

1. **Claim-based auth** (`/api/auth/claim`): User provides name + email, gets session cookie. No password, no email verification.
2. **Google Sign-In** (`/api/auth/google`): Verifies Google ID token via `google-auth-library`, creates user + session.
3. **Session management**: Cookie-based (`webchat_session`), sessions stored in `sessions.json`, 7-day TTL, auto-cleanup of expired sessions.
4. **Rate limiting**: `SlidingWindowRateLimiter` class with IP-based limits (20/10min, 80/1h for auth).
5. **Localhost bypass**: Auto-auth for localhost connections without login.

**Key difference from Web3 auth:** The webchat auth is for the bot chat interface (create/edit dashboards). The Web3 auth is for the generated `index.html` dashboards themselves -- completely separate systems.

### SimpleDashboard Generated Dashboard Pattern

Generated dashboards are single-file SPAs (`index.html`) with:
- Tailwind CSS CDN + Chart.js CDN
- Hash-based SPA routing (`navigateTo()`)
- i18n via `tt()` function with `_lang` variable and `_s` dictionary
- JIT data generation (random data each load)
- No server-side dependencies

Auth would need to be injected into this pattern as additional CDN (ethers.js) and JavaScript code.

**Sample generated dashboard structure** (from `/root/aisell/botplatform/group_data/user_9000000000000/index.html`):
- Single HTML file with embedded CSS and JS
- Uses inline `<script>` and `<style>` tags
- CDN dependencies loaded via `<script src="...">` in `<head>`
- SPA routing via `navigateTo()` function and `pages` object

### Extension Communication Pattern (reference for Web3 messaging)

The existing extension<->webchat communication uses a request/response pattern over postMessage:

**Webchat -> Extension (via `window.parent.postMessage`):**
```javascript
window.parent.postMessage({ type: 'set_developer_mode', enabled: true }, '*');
window.parent.postMessage({ type: 'open_showcases', url: showcasesUrl }, '*');
window.parent.postMessage({ type: 'file_created', filename: 'index.html', url: previewUrl }, '*');
```

**Extension -> Webchat (via `iframe.contentWindow.postMessage`):**
```javascript
sendToWebchat({ type: 'extension_ready', capabilities: [...] });
sendToWebchat({ type: 'response', requestId, data: {...} });
sendToWebchat({ type: 'developer_mode_changed', data: { enabled: true } });
sendToWebchat({ type: 'dev_element_selected', data: { tag, id, classes, selector, chatText } });
```

**Request/response protocol:**
1. Webchat sends `{ type, requestId, ...params }` to `window.parent`
2. Extension panel.js `handleMessage()` switches on `type`
3. Extension responds with `{ type: 'response', requestId, data }` or `{ type: 'response', requestId, error }`

This same pattern will be used for Web3 auth messages (generate_keypair, sign_challenge, get_address).

---

## 4. Integration Points

### Where Web3 Auth Touches Existing Code

1. **CLAUDE.md.template** (`/root/aisell/products/simple_dashboard/CLAUDE.md.template`) -- Must be updated to instruct the AI to include Web3 auth flow in generated `index.html` dashboards. Currently 216 lines covering: security, domain info, data sources, dashboard generation rules (CDN, SPA routing, i18n, Chart.js patterns). New auth section to add after "Правила" section.

2. **Nginx wildcard vhost on VM104** (`/etc/nginx/sites-enabled/d-wildcard.wpmix.net`) -- Currently serves only static files. Needs a new `location /api/auth/` block with `proxy_pass` to the auth API service. Current config has no CORS headers, no proxy_pass rules.

3. **Nginx wildcard vhost on reverse proxy** (`/etc/nginx/sites-available/user-dashboards.wpmix.net` on 62.109.14.209) -- Proxies everything to 95.217.227.164:80. **No changes needed** -- all traffic passes through, and CORS headers will be set by the auth API service itself (or by VM104 nginx).

4. **Extension build.js** (`/root/aisell/extensions/webchat-sidebar/build.js`) -- Must add `content_scripts` entry in generated manifest for `d*.wpmix.net` URL pattern. Currently generates manifest with: `permissions: ['sidePanel', 'activeTab', 'scripting', 'tabs']`. Needs to add `storage` permission for `chrome.storage`. Must add new source files: `content-script-ethereum.js` (injected into dashboard pages), `ethereum-provider.js` (injected into page world).

5. **Extension panel.js** (`/root/aisell/extensions/webchat-sidebar/src/panel.js`) -- Must handle new message types from webchat: `generate_keypair`, `get_address`, `sign_challenge`. These use `chrome.storage.local` to persist the keypair.

6. **Extension background.js** (`/root/aisell/extensions/webchat-sidebar/src/background.js`) -- Must relay messages between content scripts (on dashboard pages) and `chrome.storage`. Content scripts on `d*.wpmix.net` pages cannot access `chrome.storage` directly; they communicate via `chrome.runtime.sendMessage` to background.

7. **ecosystem.config.js** (`/root/aisell/botplatform/ecosystem.config.js`) -- New PM2 process for the auth API service. Pattern: see bananzabot ecosystem config for reference structure.

8. **New auth API service** -- Separate Node.js process (not part of webchat.ts). Dashboards call it via fetch() from the browser.

### Data Flow: Dashboard Auth

```
Browser (d{uid}.wpmix.net/index.html)
  -> checks window.ethereum (injected by content script)
  -> if not found: show blur overlay + "install extension" CTA
  -> if found:
    -> calls window.ethereum.request({ method: 'eth_requestAccounts' })
    -> content script relays to background.js -> chrome.storage.local.get('keypair')
    -> returns [address]
    -> dashboard compares address with embedded OWNER_ADDRESS
    -> dashboard generates challenge = JSON.stringify({ dashboardId, timestamp, nonce })
    -> calls window.ethereum.request({ method: 'personal_sign', params: [challenge, address] })
    -> content script relays to background.js -> signs with stored private key
    -> returns signature
    -> dashboard fetch('https://auth.wpmix.net/api/auth/login', { signature, challenge, dashboardId })
    -> Auth API: ethers.verifyMessage(challenge, signature) -> recovered address
    -> Auth API checks: recovered address in allowed list for dashboardId
    -> Auth API returns JWT
    -> Dashboard: set JWT in sessionStorage, un-blur data
```

### Data Flow: Keypair Generation (during webchat dashboard creation)

```
Webchat (simpledashboard.wpmix.net, in extension iframe)
  -> postMessage to extension panel: { type: 'generate_keypair', requestId }
  -> panel.js: check chrome.storage.local for existing keypair
  -> if exists: return { address, privateKey }
  -> if not: generate ethers.Wallet.createRandom(), store in chrome.storage.local
  -> postMessage back: { type: 'response', requestId, data: { address, privateKey } }
  -> webchat server-side: POST to Auth API /api/auth/register { address, email, privateKey, dashboardId }
  -> Auth API stores in PostgreSQL
  -> webchat tells Claude: "OWNER_ADDRESS is 0x..."
  -> Claude generates index.html with OWNER_ADDRESS embedded
```

### Data Flow: Content Script Injection

```
Chrome loads d{uid}.wpmix.net
  -> manifest content_scripts match: "https://d*.wpmix.net/*"
  -> injects content-script-ethereum.js (ISOLATED world)
  -> content script injects ethereum-provider.js into page world via <script> tag
  -> ethereum-provider.js sets window.ethereum = { request, isSimpleDashboard: true }
  -> dashboard JS detects window.ethereum, starts auth flow
  -> window.ethereum.request() dispatches CustomEvent to content script
  -> content script sends chrome.runtime.sendMessage to background
  -> background accesses chrome.storage, signs, returns
  -> content script dispatches CustomEvent response back to page world
```

### Shared State

- `noxonbot` symlink: `/root/aisell/noxonbot` -> `/root/aisell/botplatform`
- Webchat userId scheme: starts at 9000000000000, auto-incremented
- Dashboard subdomain: `d{userId}.wpmix.net` where userId comes from webchat user registration
- `window.__WEBCHAT_USER_ID__` -- set in webchat client JS after /api/me response, used for postMessage and preview URL construction

---

## 5. Existing Tests

### Test Framework

No formal test runner (`npm test` just echoes an error). Tests are standalone scripts:

- **Python E2E tests** using `requests` library (no pytest framework)
- **Node.js unit tests** as standalone scripts with manual assert functions

### Representative Tests

**Template test:** `/root/aisell/botplatform/tests/test_claude_md_templates.js`
- Tests that all products have `CLAUDE.md.template`
- Verifies required sections (`{{PROJECT_IDEA}}`, `{USERID}`, security section)
- Checks that client templates do not leak internal content
- Tests template substitution logic
- Signature: standalone script, `assert(condition, description)` pattern, runs via `node tests/test_claude_md_templates.js`

**Webchat flow test:** `/root/aisell/botplatform/tests/test_webchat_flow.py`
- Tests `/api/auth/claim` endpoint (name + email -> session)
- Tests history persistence and `/start` initialization
- Uses `requests.Session` for cookie management
- Signature: `def assert_true(cond, msg)`, runs via `python3 tests/test_webchat_flow.py`

### What Is Not Covered

- No tests for generated dashboard content
- No tests for nginx serving behavior
- No auth-related security tests (CSRF, token expiration, etc.)
- No tests for extension functionality (no Puppeteer with extension loading)

---

## 6. Shared Utilities

### Rate Limiting

**Class:** `SlidingWindowRateLimiter` in `/root/aisell/botplatform/src/webchat.ts` (line 220)
- Sliding window algorithm with configurable window and max hits
- Methods: `check(key, nowMs)`, `consume(key, nowMs)`, `sweep(nowMs)`
- Used for auth endpoints, message endpoints, downloads
- Can be extracted and reused in the auth API service, or reimplemented (it is a single class, ~56 lines)

### JSON File I/O

**Functions in webchat.ts:**
- `readJsonFile<T>(path, fallback): T` -- Safe JSON file reader with fallback
- `writeJsonAtomic(path, data)` -- Atomic write (write to temp file, rename)
- Pattern used throughout for users.json, sessions.json, state.json

### Session Cookie Handling

- `buildSessionCookie(req, sessionId)` -- Creates `webchat_session` Set-Cookie header
- `parseCookieHeader(header)` -- Manual cookie parser (no `cookie` npm dependency)
- `cleanupExpired<T>()` -- Generic expired item cleanup

### Extension Shared Library

**File:** `/root/aisell/extensions/webchat-sidebar/src/panel_shared.js`
- `WebchatSidebarShared.buildPreviewUrl(rawUserId)` -- Constructs `https://d{userId}.wpmix.net/` from userId
- `WebchatSidebarShared.hasIndexHtmlCreatedSignal(rawText)` -- Detects "index.html created/saved" in assistant messages
- `WebchatSidebarShared.buildFileCreatedMessageFromHistory(messages, rawUserId)` -- Builds `file_created` event payload from chat history
- `WebchatSidebarShared.toOpenPreviewAction(message)` -- Converts `file_created` event to `open_preview` action

### Extension Build Shared Scripts

**File:** `/root/aisell/extensions/webchat-sidebar/scripts/shared/cli_args.js` -- CLI argument parser for build.js
**File:** `/root/aisell/extensions/webchat-sidebar/scripts/shared/html_escape.js` -- HTML escape utilities for build.js

### Symlink Structure

- `/root/aisell/noxonbot` -> `/root/aisell/botplatform` (symlink)
- All scripts reference `noxonbot/` paths but the actual code lives in `botplatform/`

---

## 7. Potential Problems

### Security Concerns

1. **Current webchat auth has no password/verification** -- "No auth, by design" (comment in code, line 4419). Claim endpoint accepts any name+email. The Web3 auth system will be a significant security upgrade for dashboard access.

2. **chrome.storage vs localStorage** -- Per user-spec, keypair stored in `chrome.storage.local`, not `localStorage`. This is more secure: only the extension can access `chrome.storage`, while `localStorage` is accessible to all page scripts. But chrome.storage is lost when extension is uninstalled/data cleared.

3. **Content script page world injection** -- Injecting `window.ethereum` into the page's main world requires either `world: 'MAIN'` in manifest content_scripts (MV3 supported) or injecting a `<script>` tag from isolated world. The page world code cannot access Chrome APIs. Communication between page world and isolated world must use `CustomEvent` or `window.postMessage`.

4. **Dashboard nginx serves any file in user dir** -- Currently no auth on static file serving. Web3 auth on the client side means the HTML/JS is always downloadable; only API-backed data should be gated. This is an intentional compromise per user-spec ("visual lock").

5. **Private key transmission** -- Per user-spec, webchat receives private key from extension via postMessage, then sends it server-to-server to Auth API. This means the private key traverses: extension chrome.storage -> postMessage -> webchat frontend -> fetch to webchat backend -> server-to-server POST to Auth API. The webchat frontend handling of the private key is a brief exposure window.

6. **SSL certificate for d*.wpmix.net** -- The reverse proxy uses `simpledashboard.wpmix.net` certificate for the wildcard pattern `d*.wpmix.net`. This is NOT a wildcard cert. Browser will show SSL warning for `d9000000000000.wpmix.net` unless a wildcard cert is obtained or individual certs per subdomain are created. **Verify:** check if this is already working by testing `curl -v https://d9000000000001.wpmix.net` from outside.

### Technical Debt

1. **All data in JSON files** -- Moving to PostgreSQL for auth is a good step, but the rest of the system (users, sessions, chat history) remains file-based. Two data systems will need to coexist.

2. **No formal test framework** -- Adding auth requires security testing (signature verification, replay attacks, etc.) but there is no test runner infrastructure.

3. **Large monolithic webchat.ts** -- The file is 4600+ lines. The auth API being a separate service is architecturally correct.

4. **No existing content_scripts in extension** -- The extension currently has no content scripts. All interaction is through the side panel iframe<->postMessage. Adding content scripts for `d*.wpmix.net` is a new pattern that needs careful Chrome Web Store review consideration.

### Race Conditions

- `allocateUserId()` reads/increments/writes `state.json` -- not atomic under concurrent requests (currently single-process so OK, but worth noting).
- JSON file writes use atomic rename pattern (`writeJsonAtomic`) which is good.

---

## 8. Constraints & Infrastructure

### Proxmox LXC Containers (host: 95.217.227.164)

| VMID | Name | IP | Status |
|------|------|-----|--------|
| 100 | ubuntu-server | -- | Ports 80,443,2222 |
| 101 | CT101 (Alpine) | 10.10.10.101 | SSH via port 22101 |
| 102 | pg-db (Debian) | 10.10.10.2 | **Pingable, PostgreSQL NOT running (port 5432 connection refused)** |
| 103 | dash.drillz.ru | -- | SSH via port 2233 |
| 104 | ubuntu-pm2-migration | -- | **Current server** (ports 80,443,2222) |

**SSH to Proxmox host:** `ssh -i ~/.ssh/github_deploy_key root@95.217.227.164 -p 22`

### Reverse Proxy (62.109.14.209)

- SSL termination for all domains
- Dashboard wildcard config: `/etc/nginx/sites-available/user-dashboards.wpmix.net` (enabled in sites-enabled)
- Uses `simpledashboard.wpmix.net` certificate for `d*.wpmix.net` pattern -- **not a wildcard cert**
- Proxies to `95.217.227.164:80` with WebSocket upgrade support
- No CORS headers added at this level (passthrough)
- SSH: `ssh -i ~/.ssh/github_deploy_key root@62.109.14.209`

**Reverse proxy nginx config for d*.wpmix.net:**
```nginx
server {
    listen 443 ssl http2;
    server_name ~^d(?<userid>\d+)\.wpmix\.net$;
    ssl_certificate /etc/letsencrypt/live/simpledashboard.wpmix.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/simpledashboard.wpmix.net/privkey.pem;
    location / {
        proxy_pass http://95.217.227.164;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

### Nginx on VM104 (current server)

**Dashboard wildcard vhost:** `/etc/nginx/sites-enabled/d-wildcard.wpmix.net`
```nginx
server {
    listen 80;
    server_name ~^d(?<userid>\d+)\.wpmix\.net$;
    root /root/aisell/botplatform/group_data/user_$userid;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location ~* \.(js|css|png|...)$ { expires 7d; add_header Cache-Control "public"; }
    location ~ /\. { deny all; }
    location = /CLAUDE.md { deny all; }
}
```

**Changes needed for auth:** Add `location /api/auth/` block with `proxy_pass http://127.0.0.1:8095;` and CORS headers. Alternatively, create a separate vhost for `auth.wpmix.net` (cleaner).

**SimpleDashboard webchat vhost:** `/etc/nginx/sites-enabled/simpledashboard.wpmix.net`
- Proxies to `127.0.0.1:8094` for webchat
- Static `/showcases/` from `/var/www/simpledashboard.wpmix.net-root/showcases/`

**All nginx vhosts on VM104:**
```
1c.wpmix.net, aitu.wpmix.net, amo2gt.wpmix.net, artix.wpmix.net,
balka.wpmix.net, bananzabot.wpmix.net, coach.wpmix.net, coachapi.wpmix.net,
d-wildcard.wpmix.net, dex.onout.org, dex2.wpmix.net, golova.wpmix.net,
habab.ru, i.wpmix.net, mcw2.wpmix.net, onout.org, pr5261.mcw.wpmix.net,
pr5263.mcw2.wpmix.net, puppeteer.wpmix.net, retailcrm.wpmix.net,
salvio2.wpmix.net, simpledashboard.wpmix.net, simplesite.wpmix.net,
speach.wpmix.net, sqladmin.wpmix.net, sqlagent.wpmix.net, telewin.wpmix.net,
vm101.wpmix.net
```

### Node.js / Dependencies

- Node.js v22.21.1 (via nvm)
- TypeScript via `tsx` (no build step in dev)
- Express 4.21.2 for webchat server
- google-auth-library 10.5.0 (reference for external auth verification)
- puppeteer 24.32.1 (devDependency, available for E2E tests)
- No PostgreSQL driver (`pg`) in any package.json
- No web3/ethereum libraries anywhere in the monorepo
- New dependencies needed: `ethers` (for ecrecover), `pg` (for PostgreSQL), `jsonwebtoken` (for JWT)

### PM2 Process Structure

Current botplatform processes (from ecosystem.config.js on 95.217.227.164):
- `noxonbot` -- Telegram bot (port N/A, uses BOT_TOKEN)
- `noxonbot-admin` -- Admin panel (port 8889)
- `noxonbot-webchat` -- Main webchat (port 8091, bash launcher)
- `simpledashboard-web` -- SimpleDashboard webchat (PM2 id 32, port 8094, **not in ecosystem.config.js**, started via pm2 start manually)
- `cred-sync` -- Credential sync cron

**Note:** `simpledashboard-web` is NOT defined in `/root/aisell/botplatform/ecosystem.config.js`. It was started manually with `pm2 start start-webchat-simpledashboard.sh --name simpledashboard-web`. The botplatform ecosystem.config.js is for the main server (78.47.125.10), not this server.

New process will be added for the auth API service. Reference pattern from bananzabot ecosystem (`/root/aisell/bananzabot/ecosystem.config.js`):
```javascript
{
  name: 'dashboard-auth-api',
  script: '/root/aisell/botplatform/node_modules/.bin/tsx',
  args: 'src/auth-api.ts',
  interpreter: 'none',
  cwd: '/root/aisell/botplatform',
  watch: false,
  env: {
    NODE_ENV: 'production',
    AUTH_API_PORT: '8095',
    PG_HOST: '10.10.10.2',
    PG_DATABASE: 'dashboard_auth',
  },
  max_restarts: 10,
  min_uptime: '10s',
  error_file: '/root/.pm2/logs/dashboard-auth-api-error.log',
  out_file: '/root/.pm2/logs/dashboard-auth-api-out.log',
  merge_logs: true,
  log_date_format: 'YYYY-MM-DD HH:mm:ss'
}
```

### Chrome Extension Current Structure

**Manifest permissions:** `['sidePanel', 'activeTab', 'scripting', 'tabs']`
**Host permissions:** `['<all_urls>']`
**No content_scripts** currently defined.
**No `storage` permission** currently.

**New permissions needed:** `storage` (for chrome.storage.local keypair).
**New manifest entries needed:** `content_scripts` with matches `["https://d*.wpmix.net/*"]` and `world: "MAIN"` for the ethereum provider script.

**Build system:** `node build.js --name "..." --url "..."` generates `out/webchat-sidebar/` directory + zip. Templates read from `src/`, placeholders `__WEBCHAT_URL__` and `__TITLE__` replaced. Icons copied from `src/icons/`. New files to add to build: `content-script-ethereum.js`, `ethereum-provider.js`.

**externally_connectable matches (currently):** Generated from the webchat URL origin + `*.wpmix.net` wildcard + localhost patterns. This allows web pages on wpmix.net to send `chrome.runtime.sendMessage` to the extension.

---

## 9. External Libraries

### ethers.js (needed)

- Purpose: Ethereum wallet operations in browser (keypair generation, signing) and server (ecrecover/signature verification)
- CDN for browser (dashboard index.html): `https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.min.js`
- CDN for content script: Cannot use CDN in content scripts per MV3 CSP. Must bundle or use crypto APIs directly.
- npm for server: `ethers` package
- npm for extension: Can bundle ethers.min.js into extension package, or use Web Crypto API for signing (lighter weight)
- Key APIs:
  - `ethers.Wallet.createRandom()` -- Generate new keypair
  - `wallet.signMessage(message)` -- Sign a challenge message (EIP-191 prefix)
  - `ethers.verifyMessage(message, signature)` -- Recover address from signature (ecrecover)
  - `new ethers.Wallet(privateKey)` -- Reconstruct wallet from private key
- No existing usage in the codebase.

### pg (needed)

- Purpose: PostgreSQL client for Node.js auth API service
- npm: `pg` package
- Key APIs:
  - `new Pool({ host, database, user, password })` -- Connection pool
  - `pool.query(sql, params)` -- Parameterized queries
  - `pool.connect()` -- Get client from pool
- No existing PostgreSQL usage in the codebase.

### jsonwebtoken (needed)

- Purpose: JWT creation and verification for auth API
- npm: `jsonwebtoken` package
- Key APIs:
  - `jwt.sign(payload, secret, { expiresIn })` -- Create JWT
  - `jwt.verify(token, secret)` -- Verify JWT
- No existing JWT usage in the codebase.

### Existing CDN Libraries in Generated Dashboards

Generated `index.html` files already include:
- `https://cdn.tailwindcss.com` -- CSS framework
- `https://cdn.jsdelivr.net/npm/chart.js` -- Charting library

The Web3 auth will add:
- `https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.min.js` -- Ethereum library (for verifyMessage in dashboard, and as fallback if needed)

---

## 10. Extension Content Script Architecture (new section)

### Current Extension Architecture

```
panel.html (side panel)
  -> loads panel_shared.js + panel.js
  -> contains iframe pointing to webchat URL
  -> panel.js communicates with iframe via postMessage
  -> panel.js communicates with background.js via chrome.runtime.sendMessage
  -> panel.js uses chrome.scripting.executeScript to run code in active tab
```

No content scripts. All tab interaction is on-demand via `chrome.scripting.executeScript`.

### Required Content Script Architecture for Web3 Auth

```
d*.wpmix.net page loads
  -> content-script-ethereum.js injected automatically (manifest content_scripts)
  -> content script injects <script src="ethereum-provider.js"> into page (MAIN world)
  -> OR: content_scripts with world: "MAIN" directly (Chrome 111+, MV3)

Page world (ethereum-provider.js):
  -> sets window.ethereum = SimpleDashboardProvider
  -> provider.request() dispatches CustomEvent('simpledashboard-request', { detail })
  -> listens for CustomEvent('simpledashboard-response')

Isolated world (content-script-ethereum.js):
  -> listens for CustomEvent('simpledashboard-request')
  -> relays to background.js via chrome.runtime.sendMessage
  -> receives response, dispatches CustomEvent('simpledashboard-response')

Background.js:
  -> chrome.runtime.onMessage listener for 'eth_request' type
  -> accesses chrome.storage.local for keypair
  -> uses bundled ethers.js (or Web Crypto) for signing
  -> returns result to content script
```

### Alternative: world: "MAIN" in manifest

Chrome MV3 supports `"world": "MAIN"` in content_scripts since Chrome 111. This injects the script directly into the page's JavaScript context. Simpler than the CustomEvent relay pattern:

```json
"content_scripts": [{
  "matches": ["https://d*.wpmix.net/*"],
  "js": ["ethereum-provider.js"],
  "world": "MAIN",
  "run_at": "document_start"
}, {
  "matches": ["https://d*.wpmix.net/*"],
  "js": ["content-script-ethereum.js"],
  "run_at": "document_start"
}]
```

The MAIN world script sets `window.ethereum`. The isolated world script handles `chrome.runtime.sendMessage` relay. Communication between them still requires CustomEvent or window.postMessage.

### Build.js Changes Required

**File:** `/root/aisell/extensions/webchat-sidebar/build.js`

Current build copies: `background.js`, `panel.html`, `panel.js`, `panel_shared.js`, icons, onboarding-screenshots.

New files to copy:
- `src/content-script-ethereum.js` -- Isolated world content script (relay between page and background)
- `src/ethereum-provider.js` -- MAIN world script (sets window.ethereum)
- Bundled ethers.min.js (or crypto utilities) for background.js signing

Manifest changes in `main()` function:
- Add `'storage'` to `permissions` array (line 152)
- Add `content_scripts` array with two entries
- Add `ethereum-provider.js` to `web_accessible_resources` if using script injection (not needed if using `world: "MAIN"`)

---

## Key Files Summary

| File | Purpose |
|------|---------|
| `/root/aisell/botplatform/src/bot.ts` | Template resolution (`getClaudeMdTemplatePath`), workspace creation (`ensureUserWorkspace`) |
| `/root/aisell/botplatform/src/webchat.ts` | Webchat auth system (claim, google, sessions), postMessage to extension, reference patterns. 4600+ lines. |
| `/root/aisell/products/simple_dashboard/CLAUDE.md.template` | Client template (216 lines) -- **must be updated** to include Web3 auth instructions |
| `/root/aisell/products/simple_dashboard/CLAUDE.md` | Developer reference (not copied to users) |
| `/root/aisell/botplatform/start-webchat-simpledashboard.sh` | Launch script with PRODUCT_TYPE=simple_dashboard, port 8094 |
| `/root/aisell/botplatform/ecosystem.config.js` | PM2 config for main server (78.47.125.10). Auth API process should be in its own ecosystem file or started via pm2 start directly on this server. |
| `/root/aisell/extensions/webchat-sidebar/build.js` | Extension build script (273 lines). **Must add** content_scripts, storage permission, new source files. |
| `/root/aisell/extensions/webchat-sidebar/src/background.js` | Extension service worker (75 lines). **Must add** chrome.runtime.onMessage handler for eth_request from content scripts, chrome.storage access, ethers signing. |
| `/root/aisell/extensions/webchat-sidebar/src/panel.js` | Extension panel script (519 lines). **Must add** handlers for generate_keypair, get_address, sign_challenge postMessage types. |
| `/root/aisell/extensions/webchat-sidebar/src/panel.html` | Extension panel HTML. No changes needed. |
| `/root/aisell/extensions/webchat-sidebar/src/panel_shared.js` | Shared utilities (83 lines). No changes needed. |
| `/root/aisell/extensions/webchat-sidebar/EXTENSION_API.md` | Extension API docs. **Must update** with Web3 auth message types. |
| `/etc/nginx/sites-enabled/d-wildcard.wpmix.net` | Nginx wildcard for dashboard subdomains on VM104. **Must add** /api/auth/ proxy_pass. |
| `/etc/nginx/sites-available/user-dashboards.wpmix.net` (on 62.109.14.209) | Reverse proxy for d*.wpmix.net. Passthrough, no changes likely needed. |
| `/root/aisell/botplatform/data/webchat/users.json` | Current user store (JSON file, not DB) |
| `/root/aisell/botplatform/package.json` | Dependencies. **Must add** `ethers`, `pg`, `jsonwebtoken`. |
| `/root/aisell/botplatform/tests/test_claude_md_templates.js` | Template validation tests -- **update for new auth sections** |
| `/root/aisell/botplatform/tests/test_webchat_flow.py` | Webchat E2E test -- reference for auth API tests |
| `/root/aisell/bananzabot/ecosystem.config.js` | Reference PM2 config pattern (tsx + interpreter: none) |
| `/root/aisell/extensions/webchat-sidebar/scripts/publish-to-chrome-store.sh` | Chrome Web Store publishing script. Will be needed after adding content scripts. |

### New Files to Create

| File | Purpose |
|------|---------|
| `/root/aisell/botplatform/src/auth-api.ts` | Auth API Express service (register, login, health, share endpoints) |
| `/root/aisell/extensions/webchat-sidebar/src/content-script-ethereum.js` | Isolated world content script for d*.wpmix.net (relay between page and background) |
| `/root/aisell/extensions/webchat-sidebar/src/ethereum-provider.js` | MAIN world script that sets window.ethereum provider |
| `/root/aisell/botplatform/tests/test_auth_api.py` or `.js` | Auth API integration tests (register, login, invalid sig, replay protection) |
