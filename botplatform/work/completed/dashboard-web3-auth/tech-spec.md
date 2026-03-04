---
created: 2026-02-27
status: approved
branch: feature/dashboard-web3-auth
size: L
---

# Tech Spec: Web3 Dashboard Auth

## Solution

Chrome extension acts as a web3 wallet: it injects a `window.ethereum` provider into `d*.wpmix.net` dashboard pages via content scripts. When a protected dashboard loads, it detects the provider and requests a signature of a timestamped challenge. The signature is sent to a standalone Auth API service which verifies it via Ethereum `ecrecover` and returns a JWT. The dashboard uses the JWT to un-blur data on the client side.

The Auth API is a separate Express/Node.js service (port 8095) backed by PostgreSQL on LXC 102 (pg-db). It handles registration (server-to-server from webchat), login (signature verification), sharing (email-to-address lookup), and health checks. Keypairs are generated in the extension, stored in `chrome.storage.local`, and backed up server-side in PG for admin-assisted recovery.

The extension's build system (`build.js`) is updated to include content scripts and the `storage` permission. Webchat integration triggers keypair generation on first dashboard creation with auth, communicates with the extension via the existing postMessage protocol, and calls Auth API server-to-server to register the owner. The `CLAUDE.md.template` is updated with auth instructions so Claude can generate dashboards with embedded auth code.

Protection level: visual lock (client-side blur). Data remains in the HTML file — this is an intentional MVP compromise preserving single-file architecture.

## Architecture

### What we're building/modifying

- **Auth API service** (`src/auth-api.ts`) — new Express service on port 8095. Endpoints: health, register, login, share. Uses ethers.js for ecrecover, pg for PostgreSQL, jsonwebtoken for JWT.
- **Extension content scripts** (`content-script-ethereum.js`, `ethereum-provider.js`) — new files. Content script in isolated world relays between page and background.js. Ethereum provider in MAIN world sets `window.ethereum`.
- **Extension background.js** (modify) — new `chrome.runtime.onMessage` handler for `eth_request` type from content scripts. Accesses `chrome.storage.local` for keypair, signs challenges with ethers.js.
- **Extension panel.js** (modify) — new handlers for `generate_keypair`, `get_address`, `sign_challenge`, `import_keypair` postMessage types from webchat iframe.
- **Extension build.js** (modify) — add `storage` permission, `content_scripts` manifest entries, copy new source files to build output.
- **CLAUDE.md.template** (modify) — add "Auth" section with instructions for Claude: when to add auth, OWNER_ADDRESS embedding, auth overlay code pattern.
- **Webchat webchat.ts** (modify) — keypair generation flow: postMessage to extension, receive address + privateKey, POST to Auth API server-to-server.
- **Nginx d-wildcard config** (modify) — add `location /api/auth/` proxy_pass to 127.0.0.1:8095.
- **PM2 ecosystem** — new process `dashboard-auth-api` running auth-api.ts via tsx.

### How it works

**Dashboard auth flow (browser):**
```
d{uid}.wpmix.net loads index.html
  → checks window.ethereum (injected by content script)
  → if absent: show blur + "install extension" overlay
  → if present:
    → request accounts via window.ethereum.request({method: 'eth_requestAccounts'})
    → generate challenge: JSON.stringify({dashboardId, timestamp, nonce})
    → request signature via window.ethereum.request({method: 'personal_sign', params: [challenge, address]})
    → POST /api/auth/login {signature, challenge, dashboardId}
    → Auth API: ethers.verifyMessage(challenge, signature) → recovered address
    → Auth API checks: address in allowed_addresses for dashboardId
    → returns JWT → store in sessionStorage → un-blur data
    → on 401 (wrong address): show "no access" overlay
    → on fetch error/5xx: show "service unavailable" message
  → if present but keypair absent in extension:
    → window.ethereum.request() returns error {code: 'NO_KEYPAIR'}
    → show blur + "contact support@onout.org for recovery" overlay
  → JWT refresh (reactive):
    → on 401 from any API call with stored JWT → JWT expired
    → re-trigger personal_sign → POST /api/auth/login → new JWT
    → replace JWT in sessionStorage → retry request
```

**Content script relay (extension ↔ page):**
```
ethereum-provider.js (MAIN world):
  → sets window.ethereum = SimpleDashboardProvider
  → provider.request() dispatches CustomEvent('sd-eth-request', {detail})
  → listens for CustomEvent('sd-eth-response')

content-script-ethereum.js (ISOLATED world):
  → listens for CustomEvent('sd-eth-request') on window
  → relays via chrome.runtime.sendMessage({type: 'eth_request', ...})
  → receives response, dispatches CustomEvent('sd-eth-response')

background.js:
  → chrome.runtime.onMessage for 'eth_request'
  → accesses chrome.storage.local for keypair
  → signs with ethers.Wallet, returns result
```

**Keypair generation (webchat ↔ extension):**
```
Webchat detects auth needed for dashboard
  → postMessage to extension panel: {type: 'generate_keypair', requestId}
  → panel.js: check chrome.storage.local for existing keypair
  → if exists: return {address, privateKey}
  → if not: ethers.Wallet.createRandom(), store in chrome.storage.local
  → postMessage response: {type: 'response', requestId, data: {address, privateKey}}
  → webchat backend: POST Auth API /api/auth/register {address, email, privateKey, dashboardId}
  → Auth API stores in PostgreSQL
  → webchat passes OWNER_ADDRESS to Claude for index.html generation
```

## Decisions

### Decision 1: Ethereum ecrecover for auth (not random tokens)
**Decision:** Use Ethereum keypair + ecrecover signature verification via ethers.js.
**Rationale:** (a) Standard `window.ethereum` interface familiar to web3 ecosystem, (b) drives extension installs (main distribution channel), (c) user never sees raw keys — extension manages them. This is a conscious product strategy choice.
**Alternatives considered:** Simple random token stored in extension — simpler to implement, but doesn't leverage web3 ecosystem, doesn't provide a standard interface, and doesn't align with product positioning.

### Decision 2: Separate Auth API service (not embedded in webchat.ts)
**Decision:** Auth API is a standalone Express service (`src/auth-api.ts`) on port 8095.
**Rationale:** Isolated responsibility (ecrecover, JWT, PG access). Webchat.ts is already 4600+ lines. Dashboard pages call Auth API directly via fetch — no webchat involvement at runtime. Different lifecycle from webchat.
**Alternatives considered:** Adding endpoints to webchat.ts — rejected due to monolith size, different domain (dashboard auth vs webchat auth), and different callers (browser fetch vs webchat UI).

### Decision 3: PostgreSQL on LXC 102 (not JSON files)
**Decision:** Auth data stored in PostgreSQL on pg-db (LXC 102, 10.10.10.2).
**Rationale:** Auth data is relational (users → dashboards → access lists). pg-db LXC exists and is dedicated to database workloads. The file-based constraint in architecture.md applies to dashboard content, not to auth infrastructure.
**Alternatives considered:** JSON files like existing webchat data — rejected because relational queries (email lookup, access list checks, multi-dashboard ownership) are complex with flat files.

### Decision 4: Content script with two-world relay (MAIN + ISOLATED)
**Decision:** Two content scripts: `ethereum-provider.js` in MAIN world (sets `window.ethereum`), `content-script-ethereum.js` in ISOLATED world (relays to background via `chrome.runtime.sendMessage`). Communication via CustomEvent.
**Rationale:** MAIN world script can set `window.ethereum` visible to page JS but cannot access Chrome APIs. ISOLATED world can access `chrome.runtime` but not page JS globals. CustomEvent bridge is the standard MV3 pattern.
**Alternatives considered:** Single script with `world: "MAIN"` only — can't access `chrome.runtime.sendMessage`. Programmatic injection via `chrome.scripting.executeScript` — requires active user gesture, not suitable for automatic injection.

### Decision 5: JWT for dashboard sessions (stateless)
**Decision:** Auth API issues JWT tokens. Dashboard stores JWT in `sessionStorage`.
**Rationale:** Dashboards are static HTML files served by nginx — no server-side session capability. JWT is self-contained and verifiable. `sessionStorage` clears on tab close (more secure than `localStorage` for tokens).
**Alternatives considered:** Cookie-based sessions — requires Auth API to be on same domain or complex CORS cookie setup. Server-side sessions — dashboard is a static file, can't maintain server session.

### Decision 6: CORS restricted to dashboard subdomains only
**Decision:** Auth API CORS allows origins matching regex `^https://d\d+\.wpmix\.net$` only (not all `*.wpmix.net`).
**Rationale:** 25+ vhosts on wpmix.net — XSS on any of them could attack Auth API if CORS is `*.wpmix.net`. Restricting to `d{digits}.wpmix.net` pattern limits blast radius.
**Alternatives considered:** `*.wpmix.net` wildcard — rejected as overly permissive.

### Decision 7: Keypair in chrome.storage.local (not localStorage)
**Decision:** Extension stores keypair in `chrome.storage.local`.
**Rationale:** Only the extension can access `chrome.storage` — page scripts and XSS cannot reach it. More secure than `localStorage`. Persists across browser restarts. Syncs if Chrome sync is enabled.
**Alternatives considered:** `localStorage` — accessible to any script on the page, XSS vulnerability.

### Decision 8: Private key backup on server
**Decision:** Private key sent to Auth API during registration, stored in PG.
**Rationale:** Recovery path requires admin to retrieve key from server. No SMTP for automated recovery. Without server backup, key loss = permanent lockout. This is a conscious security tradeoff for MVP.
**Alternatives considered:** No server backup — key loss is permanent. Automated email recovery — requires SMTP setup, complexity for MVP.

### Decision 9: Reactive JWT refresh (on 401 response)
**Decision:** Dashboard detects JWT expiry reactively: when a fetch to Auth API returns 401, dashboard re-triggers `personal_sign` via `window.ethereum`, obtains a new JWT, stores in `sessionStorage`, and retries the failed request. No background interval polling.
**Rationale:** Simpler implementation, no timers needed. Dashboard only calls Auth API on initial load and on JWT expiry. The 1-hour TTL means most sessions won't expire during a single page visit. Extension auto-signs without user interaction.
**Alternatives considered:** Proactive refresh (check `exp` claim, refresh before expiry) — adds complexity with `setInterval` and local clock skew handling. Not needed for MVP where page visits are short.

### Decision 10: Internal API key for server-to-server endpoints
**Decision:** Register and share endpoints require `Authorization: Bearer <INTERNAL_API_KEY>` header. Nginx restricts `/api/auth/register` and `/api/auth/share` to localhost only (`allow 127.0.0.1; deny all`). Login and health remain public.
**Rationale:** Register and share are server-to-server from webchat — browsers should never call them directly. Without protection, any visitor could register fake users or grant themselves dashboard access.
**Alternatives considered:** IP-only restriction without API key — rejected because defense in depth is needed for auth endpoints.

### Decision 11: Auth API proxied via nginx location (not separate domain)
**Decision:** Nginx on VM104 proxies `/api/auth/*` from `d*.wpmix.net` to `127.0.0.1:8095`.
**Rationale:** Reuses existing wildcard vhost. No DNS/SSL changes needed on reverse proxy. Dashboard fetch calls go to same origin, avoiding CORS complexity.
**Alternatives considered:** Separate `auth.wpmix.net` domain — cleaner separation but requires new DNS record, SSL cert on reverse proxy, and CORS configuration.

## Data Models

### PostgreSQL schema (database: `dashboard_auth`)

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  address VARCHAR(42) NOT NULL UNIQUE,     -- Ethereum address (0x...)
  email VARCHAR(255) NOT NULL UNIQUE,
  private_key TEXT NOT NULL,                -- Plaintext hex private key (MVP; encrypt at-rest in future)
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE dashboards (
  id SERIAL PRIMARY KEY,
  dashboard_id VARCHAR(50) NOT NULL UNIQUE, -- e.g., "9000000000126"
  owner_address VARCHAR(42) NOT NULL REFERENCES users(address),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE dashboard_access (
  id SERIAL PRIMARY KEY,
  dashboard_id VARCHAR(50) NOT NULL REFERENCES dashboards(dashboard_id),
  address VARCHAR(42) NOT NULL REFERENCES users(address),
  granted_by VARCHAR(42) NOT NULL,          -- owner who granted access
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(dashboard_id, address)
);
```

### Auth API request/response types

```typescript
// POST /api/auth/register (server-to-server from webchat)
interface RegisterRequest {
  address: string;      // 0x... Ethereum address
  email: string;
  privateKey: string;   // for server backup
  dashboardId: string;  // e.g., "9000000000126"
}
// → 201 { address, dashboardId }
// → 409 { error: "Email already registered", message: "Напишите в support@onout.org" }

// POST /api/auth/login (from dashboard browser)
interface LoginRequest {
  signature: string;    // EIP-191 signature
  challenge: string;    // JSON string with dashboardId, timestamp, nonce
  dashboardId: string;
}
// → 200 { token: "jwt..." }
// → 401 { error: "Unauthorized" }

// POST /api/auth/share (server-to-server from webchat)
interface ShareRequest {
  dashboardId: string;
  email: string;        // email of user to grant access
  ownerAddress: string; // address of dashboard owner (for authorization)
}
// → 200 { address, email }
// → 404 { error: "User not found", message: "Пользователь не зарегистрирован" }

// GET /api/auth/health
// → 200 { status: "ok", pg: "connected" }
```

### Challenge format

```typescript
interface Challenge {
  dashboardId: string;
  timestamp: number;    // Date.now()
  nonce: string;        // crypto.randomUUID()
}
// Challenge is JSON.stringify'd, signed via personal_sign (EIP-191)
// Auth API rejects challenges where timestamp > 5 minutes old
```

## Dependencies

### New packages
- `ethers` (v6) — Ethereum keypair generation, message signing, ecrecover verification. Used in Auth API (server), extension background.js (bundled), and dashboard CDN.
- `pg` — PostgreSQL client for Auth API. Connection pool to pg-db (10.10.10.2).
- `jsonwebtoken` — JWT creation and verification in Auth API.

### Using existing (from project)
- `express` (4.21.2) — HTTP framework for Auth API, same as webchat.ts.
- `tsx` — TypeScript runner for Auth API process, same as webchat.
- `puppeteer` (24.32.1, devDependency) — E2E tests with extension loading.
- Extension postMessage protocol (`panel.js` request/response pattern) — reused for `generate_keypair`, `get_address`, `sign_challenge`, `import_keypair`. PostMessage uses explicit `targetOrigin` (webchat URL), not wildcard `'*'`.
- `SlidingWindowRateLimiter` pattern from webchat.ts — can be reimplemented in Auth API (~56 lines).

## Testing Strategy

**Feature size:** L

### Unit tests
- ecrecover verification: valid signature → correct address, invalid signature → throws
- Challenge validation: valid timestamp → pass, expired (>5 min) → reject, malformed JSON → reject
- JWT creation: contains correct claims (address, dashboardId, exp)
- JWT verification: valid token → decoded payload, expired → error, tampered → error
- Rate limiter: exceeding limit → reject, within limit → allow, window reset → allow again

### Integration tests
- Auth API register: POST with valid data → 201, verify PG row
- Auth API login: generate keypair, sign challenge, POST → 200 + JWT
- Auth API login invalid: wrong keypair signature → 401
- Auth API duplicate email: register twice with same email → 409
- Auth API share: register two users, share dashboard, second user login → 200
- Auth API replay protection: sign challenge with old timestamp → 401
- Auth API health: GET /health → 200 with pg status
- Nginx proxy: curl with Host header d{id}.wpmix.net /api/auth/health → 200
- CORS headers: request from d*.wpmix.net origin → correct Access-Control-Allow-Origin; request from foreign origin → no CORS headers
- Rate limiting: 11th register request within 1 hour from same IP → 429
- Share authorization: non-owner attempts to share → 403

### E2E tests
- Dashboard without extension: open d{id}.wpmix.net → title visible, data blurred, install overlay shown
- Dashboard with extension: open → extension signs → data un-blurred
- Dashboard with wrong keypair: open other's dashboard → data stays blurred, "no access" overlay
- Auth API down: stop PM2 process, open dashboard → "service unavailable" message shown
- Content script isolation: navigate to non-matching URL (e.g., simpledashboard.wpmix.net) → `window.ethereum` is undefined (content script not injected)
- JWT expiration + re-auth: set short JWT TTL, wait for expiry → extension auto-re-signs → data stays visible

**E2E infrastructure:** Puppeteer with `headless: 'new'` (Chrome headless mode with extension support). Extension loaded via `--load-extension` and `--disable-extensions-except` launch args. Test keypair pre-seeded in chrome.storage via `chrome.scripting.executeScript` before navigation. Explicit `waitForFunction(() => window.ethereum)` for content script injection timing.

## Agent Verification Plan

**Source:** user-spec "Как проверить" section.

### Verification approach
Agent uses curl for API verification (register, login, invalid sig, share, health, nginx proxy) and Puppeteer for browser flows (blur without extension, auth with extension, API down scenario). PG verification via psql. Backup verification via bash on remote LXC.

### Per-task verification
| Task | verify: | What to check |
|------|---------|--------------|
| 1 | bash | `psql -h 10.10.10.2 -U dashboard_auth -d dashboard_auth -c '\dt'` → tables exist |
| 2 | curl | `GET /api/auth/health` → 200; `POST /api/auth/register` → 201; `POST /api/auth/login` → 200+JWT; invalid sig → 401 |
| 3 | bash | Build extension, load in Chrome, check `window.ethereum` exists on d*.wpmix.net test page |
| 4 | bash | `curl -H "Host: d9000000000000.wpmix.net" http://localhost/api/auth/health` → proxied to 8095 |
| 5 | bash | Generate test dashboard with auth code, verify OWNER_ADDRESS embedded in HTML |
| 6 | bash | Verify webchat postMessage triggers extension keypair generation (manual or via test) |
| 7 | bash | `psql` query: `SELECT * FROM users WHERE private_key IS NOT NULL` → rows exist |
| 8 | bash | `npm test` or `node tests/test_auth_api.js` → all pass |
| 9 | bash | `python3 tests/test_dashboard_auth_e2e.py` → all pass |

### Tools required
curl, bash, psql, Puppeteer (with extension loading).

## Risks

| Risk | Mitigation |
|------|-----------|
| Chrome Web Store review delay for content script + `window.ethereum` injection | Minimal permissions, minimal content script, clear privacy policy description |
| Keypair lost on extension uninstall / Chrome data clear | Private key backed up in PG; recovery via support@onout.org |
| PG compromise exposes all private keys | Backup on isolated LXC, restricted DB access. Conscious MVP tradeoff |
| CORS misconfiguration blocks dashboard auth | Using same-origin proxy (`/api/auth/*` on d*.wpmix.net), E2E test validates |
| Content script conflicts with other extensions or CSP | Isolated world for relay script, MAIN world only sets window.ethereum |
| PG on LXC 102 not running (needs first-time setup) | Task 1 explicitly handles PG installation and configuration |
| ethers.js bundle size in extension | Use ethers.min.js (~120KB) or extract only needed functions (Wallet, verifyMessage) |
| SSL certificate for d*.wpmix.net uses simpledashboard.wpmix.net cert (not wildcard) | Verify existing setup works; if not, obtain wildcard cert via certbot |
| Register/share endpoints exposed to browsers if nginx misconfigured | Defense in depth: nginx localhost restriction + INTERNAL_API_KEY header |
| JWT secret compromise allows forging tokens | Secret via env var, not in code; rotate by restarting Auth API with new secret |

## Acceptance Criteria

Technical acceptance criteria (supplement user-spec ACs):

- [ ] Auth API responds to all endpoints with correct HTTP status codes (200, 201, 401, 404, 409)
- [ ] PG schema applied: tables `users`, `dashboards`, `dashboard_access` exist with correct columns
- [ ] JWT contains: address, dashboardId, iat, exp (1 hour TTL)
- [ ] Challenge replay protection: timestamps older than 5 minutes rejected
- [ ] CORS headers set for `d*.wpmix.net` origin on Auth API responses (needed when dashboards share users cross-origin; same-origin calls via nginx proxy don't require CORS but headers are set defensively)
- [ ] Extension content scripts only inject on `https://d*.wpmix.net/*` URL pattern
- [ ] Auth API rate limited (register: 10/hour per IP, login: 30/hour per IP)
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] No regressions in existing pre-commit tests (test_folder_structure, test_claude_md_templates, test_security_precommit, test_ts_syntax)
- [ ] PM2 process `dashboard-auth-api` runs stable (no restart loops)
- [ ] JWT_SECRET configured via environment variable (not hardcoded)
- [ ] INTERNAL_API_KEY configured via environment variable for register/share endpoints
- [ ] Nginx restricts /api/auth/register and /api/auth/share to localhost
- [ ] All PG queries use parameterized statements (no string interpolation)
- [ ] Auth API CORS restricted to `d{digits}.wpmix.net` origin pattern

## Implementation Tasks

<!-- Tasks are brief scope descriptions. AC, TDD, and detailed steps are created during task-decomposition. -->

### Wave 1 (independent)

#### Task 1: Setup PostgreSQL on LXC 102
- **Description:** Install and configure PostgreSQL on pg-db (LXC 102, 10.10.10.2). Create `dashboard_auth` database, apply schema (users, dashboards, dashboard_access tables), configure `pg_hba.conf` for connections from VM104. Needed as data store for Auth API.
- **Skill:** infrastructure-setup
- **Reviewers:** code-reviewer, security-auditor, infrastructure-reviewer
- **Verify:** bash — `psql -h 10.10.10.2 -U dashboard_auth -d dashboard_auth -c '\dt'` → tables listed
- **Files to modify:** (remote: LXC 102 PG config files)
- **Files to read:** code-research.md (section 8: Constraints & Infrastructure)

#### Task 2: Auth API service
- **Description:** Create Express service with register, login, share, and health endpoints. Uses ethers.js for ecrecover, pg for PostgreSQL, jsonwebtoken for JWT. Input validation on all endpoints (address format, email format, challenge JSON structure) — malformed input returns 400 before reaching business logic. PG connection errors return 503. Result: running API on port 8095 passing curl tests.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** curl — `POST /api/auth/register` → 201; `POST /api/auth/login` with valid sig → 200+JWT; invalid sig → 401; `GET /api/auth/health` → 200
- **Files to modify:** `botplatform/src/auth-api.ts` (new), `botplatform/package.json`
- **Files to read:** `botplatform/src/webchat.ts` (rate limiter pattern), code-research.md (sections 1, 6, 9)

#### Task 3: Extension wallet and content scripts
- **Description:** Add web3 wallet capability to the Chrome extension: content scripts that inject `window.ethereum` provider on `d*.wpmix.net`, background.js handler for keypair operations and signing (including keypair-absent error response), panel.js handlers for webchat postMessage protocol (generate_keypair, get_address, sign_challenge, import_keypair). Update build.js to include new files and permissions. Result: extension injects provider, signs challenges, and supports keypair import for recovery.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** bash — build extension, load unpacked in Chrome, navigate to d*.wpmix.net test page, verify `window.ethereum` exists in console
- **Files to modify:** `extensions/webchat-sidebar/src/background.js`, `extensions/webchat-sidebar/src/panel.js`, `extensions/webchat-sidebar/build.js`, `extensions/webchat-sidebar/src/content-script-ethereum.js` (new), `extensions/webchat-sidebar/src/ethereum-provider.js` (new)
- **Files to read:** `extensions/webchat-sidebar/src/panel_shared.js`, code-research.md (sections 3, 4, 10)

### Wave 2 (depends on Wave 1)

#### Task 4: Nginx proxy for Auth API
- **Description:** Add `location /api/auth/` block to d-wildcard.wpmix.net nginx config on VM104, proxying to 127.0.0.1:8095. Restrict /api/auth/register and /api/auth/share to localhost only (allow 127.0.0.1; deny all). Login and health remain public. Result: curl with dashboard Host header reaches Auth API, register/share blocked from outside.
- **Skill:** infrastructure-setup
- **Reviewers:** code-reviewer, security-auditor, infrastructure-reviewer
- **Verify:** curl — `curl -H "Host: d9000000000000.wpmix.net" http://localhost/api/auth/health` → 200
- **Files to modify:** `/etc/nginx/sites-enabled/d-wildcard.wpmix.net`
- **Files to read:** code-research.md (section 8: Nginx on VM104)

#### Task 5: CLAUDE.md.template auth section
- **Description:** Add auth instructions to SimpleDashboard CLAUDE.md.template. Claude should know: when to add auth, how to embed OWNER_ADDRESS, auth overlay code patterns for all states: blur+install overlay (no extension), blur+"no access" overlay (wrong address, 401), blur+"service unavailable" (API down), blur+"contact support" (no keypair), and JWT refresh on 401. Result: Claude can generate index.html with complete auth code.
- **Skill:** prompt-master
- **Reviewers:** prompt-reviewer
- **Verify:** bash — read template, verify auth section exists with OWNER_ADDRESS placeholder and auth overlay code
- **Files to modify:** `products/simple_dashboard/CLAUDE.md.template`
- **Files to read:** `products/simple_dashboard/CLAUDE.md.template`, code-research.md (section 4), user-spec.md (dashboard flows)

#### Task 6: Webchat keypair generation integration
- **Description:** Add keypair generation flow to webchat: detect when auth is needed for dashboard, send postMessage to extension (generate_keypair) with 10s timeout, receive address + privateKey, POST to Auth API /api/auth/register server-to-server, pass OWNER_ADDRESS to Claude. On timeout/error — notify user "Extension не отвечает, проверьте что SimpleDashboard установлен" and generate dashboard without auth. Result: dashboard creation with auth triggers full keypair registration flow with error handling.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** bash — create dashboard via webchat with extension, verify Auth API register called and PG row exists
- **Files to modify:** `botplatform/src/webchat.ts`
- **Files to read:** `botplatform/src/webchat.ts` (postMessage pattern), `extensions/webchat-sidebar/src/panel.js` (message types), code-research.md (section 4: Data Flow)

### Wave 3 (depends on Wave 2)

#### Task 7: Auth API unit and integration tests
- **Description:** Write tests for Auth API: unit tests for ecrecover, challenge validation, JWT; integration tests via curl for register, login, invalid sig, duplicate email, share, replay protection. Ensures auth security correctness. Result: test script passes all scenarios.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** bash — `node tests/test_auth_api.js` → all pass
- **Files to modify:** `botplatform/tests/test_auth_api.js` (new)
- **Files to read:** `botplatform/tests/test_webchat_flow.py` (reference pattern), `botplatform/src/auth-api.ts`

#### Task 8: E2E tests with Puppeteer
- **Description:** Write E2E tests using Puppeteer with extension loaded: dashboard without extension shows blur + install overlay, dashboard with extension performs auth and shows data, wrong keypair shows "no access". Validates full browser flow including CORS and content script injection. Result: E2E test script passes.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** bash — `node tests/test_dashboard_auth_e2e.js` → all pass
- **Files to modify:** `botplatform/tests/test_dashboard_auth_e2e.js` (new)
- **Files to read:** `botplatform/tests/test_webchat_flow.py` (reference), code-research.md (section 5: Existing Tests)

#### Task 9: Key backup to isolated LXC
- **Description:** Setup periodic sync of user keys from pg-db (LXC 102) to an isolated LXC via pg_dump or rsync. Provides recovery capability if primary PG is compromised. Result: backup LXC contains copy of auth data.
- **Skill:** infrastructure-setup
- **Reviewers:** code-reviewer, security-auditor, infrastructure-reviewer
- **Verify:** bash — check backup LXC has recent dump file
- **Files to modify:** (remote: cron job on LXC 102 or VM104)
- **Files to read:** code-research.md (section 8: Proxmox LXC Containers)

### Final Wave

#### Task 10: Pre-deploy QA
- **Description:** Acceptance testing: run all tests (unit, integration, E2E), verify acceptance criteria from user-spec (AC1-AC25) and tech-spec. Verify no regressions in pre-commit tests.
- **Skill:** pre-deploy-qa
- **Reviewers:** none

#### Task 11: Deploy
- **Description:** Deploy Auth API as PM2 process (`dashboard-auth-api`), reload nginx, rebuild and publish extension to Chrome Web Store. Verify PM2 stability and logs.
- **Skill:** deploy-pipeline
- **Reviewers:** code-reviewer, security-auditor, deploy-reviewer

#### Task 12: Post-deploy verification
- **Description:** Live environment verification: curl Auth API health through nginx proxy, test register/login flow on live, verify PG data, open dashboard in browser with and without extension, check backup sync.
- **Skill:** post-deploy-qa
- **Reviewers:** none
