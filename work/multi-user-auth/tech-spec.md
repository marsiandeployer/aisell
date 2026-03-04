---
created: 2026-03-04
status: approved
branch: feature/multi-user-auth
size: L
---

# Tech Spec: Multi-User Dashboard Access (Guest Mode)

## Solution

Add guest access to `d{userId}.wpmix.net` dashboards via invite links. Guests authenticate through Google OAuth, receive a server-generated Ethereum keypair (transparent, no Extension required), and are granted `dashboard_access` in PostgreSQL. JWT delivery reuses the existing magic-link mechanism (`?ml=TOKEN`). The auth widget is injected server-side into every dashboard HTML alongside the existing magic-link script.

Three new server components:
1. **Invite system** — owner generates a persistent invite token; anyone with the link can register as guest
2. **Google OAuth callback** — `simpledashboard.wpmix.net/api/auth/google-dashboard-callback` orchestrates: keypair generation → `POST /api/auth/register` → `POST /api/auth/share` → server-side signing → `POST /api/auth/login` → ml-token → redirect to `d{userId}.wpmix.net?ml=TOKEN`
3. **Auth widget** — inline script injected alongside magic-link script; shows Google login button unless `sessionStorage.dashboard_jwt` is already set; calls `simpledashboard.wpmix.net/api/auth/invite/status` for returning-guest auto-auth (CORS with credentials)

## Architecture

### What we're building/modifying

- **`botplatform/src/webchat.ts`** — main file: invite storage infra, rate limiters, new API endpoints (invite, invite/revoke, invite/status), Google OAuth callback handler, JWT enforcement on `/api/data/`, auth widget injection, profile "Share Dashboard" UI section, extended magicLinkTokens type
- **`botplatform/src/auth-api.ts`** — new `GET /api/auth/access-list` endpoint (SQL query on `dashboard_access JOIN users`)
- **`products/simple_dashboard/CLAUDE.md.template`** — document guest auth flow for AI context
- **`botplatform/.env.auth`** — add `GOOGLE_CLIENT_SECRET` env var
- **`botplatform/data/webchat/invites.json`** — persisted invite token store (one record per dashboardUserId)
- **3 new test files** — `test_invite_flow.js`, `test_guest_auth_widget.js`, `test_server_side_keypair.js`

### How it works

**First-time guest flow:**
```
Owner: POST /api/auth/invite → inviteTokens.set(dashboardUserId, token) + invites.json
       ↓ { url: "https://d123.wpmix.net?invite=TOKEN" }
Guest opens URL → d*.wpmix.net middleware serves HTML with injected auth widget + magic-link scripts
       ↓ ?invite=TOKEN stored in sessionStorage by auth widget script
Auth widget visible (sessionStorage.dashboard_jwt not set) → Google OAuth button
       ↓ click → redirect to accounts.google.com
         (state param = base64({redirect_to:"d123.wpmix.net", invite:"TOKEN", nonce: SERVER_NONCE}))
         (nonce is generated server-side, embedded in injected widget HTML as window.__OAUTH_NONCE__,
          also stored in webchat_session entry for validation on callback)
Google → simpledashboard.wpmix.net/api/auth/google-dashboard-callback
             ?code=CODE&state=<encoded-state>
       ↓ server:
         1. Validate state.nonce against session, validate state.redirect_to against /^d\d+\.wpmix\.net$/
         2. OAuth2Client.getToken(code) → id_token → email, name
         3. find-or-create WebUser (users.json)
         4. if email not in PG users → ethers.Wallet.createRandom()
                → POST AUTH_API_URL/api/auth/register (INTERNAL_API_KEY)
                → saveChatSettings({ ownerAddress, ownerPrivateKey })
         5. check invite token from state.invite → valid?
                if valid → POST AUTH_API_URL/api/auth/share (INTERNAL_API_KEY)
                        { dashboardId: "d123", email, ownerAddress: chatSettings.ownerAddress }
                        if share fails → ?error=service_unavailable (NOT no_access)
                if not valid but already in dashboard_access → continue
                if not valid and not in dashboard_access → ?error=no_access
         6. server-side login:
                challenge = JSON.stringify({ dashboardId, timestamp: Date.now(), nonce })
                signature = await new ethers.Wallet(guestPrivateKey).signMessage(challenge)
                POST AUTH_API_URL/api/auth/login → { token: dashboardJWT }
                log: [AUDIT] guest login: email=... dashboardId=...
         7. magicLinkTokens.set(mlToken, { userId, expires: Date.now() + 5*60*1000, dashboardJwt: dashboardJWT })
       ↓ HTTP 302 → https://d123.wpmix.net?ml=ML_TOKEN
Existing magic-link script → GET /api/auth/ml?token=ML_TOKEN
       ↓ /api/auth/ml checks dashboardJwt field → returns it directly (no re-sign)
       ↓ sessionStorage.dashboard_jwt = jwt
Auth widget hidden, blur removed, dashboard visible
```

**Returning guest flow:**
```
Guest opens d123.wpmix.net (no ?invite, no ?ml)
       ↓ Auth widget script calls GET https://simpledashboard.wpmix.net/api/auth/invite/status
         ?dashboardId=d123 with credentials: 'include'
         (CORS allowed for d*.wpmix.net origins; webchat_session cookie present on simpledashboard.wpmix.net)
       ↓ Server: reads session → load guest ChatSettings → signChallenge() → POST /api/auth/login
         → generates mlToken → { mlToken }
       ↓ Widget: window.location = d123.wpmix.net?ml=ML_TOKEN
Existing magic-link script handles JWT → blur removed
```

**`/api/data/` enforcement:**
```
Client sends: Authorization: Bearer <dashboard_jwt>
d*.wpmix.net: jwt.verify(token, JWT_SECRET) → { dashboardId, address }
              verify dashboardId === "d" + userId → 200/401
              Only enforced if chatSettings.ownerAddress is set (unprotected dashboards unaffected)
```

## Decisions

### Decision 1: Server-side keypair generation and signing
**Decision:** `webchat.ts` generates an Ethereum keypair via `ethers.Wallet.createRandom()` and stores it in ChatSettings. The server signs challenges on behalf of the guest when calling `POST /api/auth/login`.
**Rationale:** Guests have no Chrome Extension and no `window.ethereum`. Server-side signing reuses all existing auth infrastructure unchanged.
**Alternatives considered:** New password-based auth in Auth API — requires schema migration, new JWT type; rejected. Guest read-only without Auth API — loses `/api/data/` write capability; rejected.

### Decision 2: OAuth callback on simpledashboard.wpmix.net + CSRF nonce + allowlist
**Decision:** Single registered redirect_uri at `simpledashboard.wpmix.net/api/auth/google-dashboard-callback`. The `state` parameter contains `{ redirect_to, invite, nonce }` where `nonce` is a server-generated value stored in the user's webchat_session (before redirect to Google). On callback, nonce is validated against the session. `redirect_to` is validated against `/^d\d+\.wpmix\.net$/` before use in `Location` header.
**Rationale:** Prevents CSRF (attacker-crafted OAuth links), prevents open redirect (pre-signed JWT delivery to attacker domain). Google does not support wildcard redirect URIs.
**Alternatives considered:** Cookie on `.wpmix.net` parent domain — affects all subdomains, broader attack surface; rejected.

### Decision 3: Returning guest via CORS call to simpledashboard.wpmix.net
**Decision:** `GET /api/auth/invite/status` is registered on `simpledashboard.wpmix.net` (main server), not inside `d*.wpmix.net` middleware. Auth widget makes a CORS request with `credentials: 'include'`. CORS allows `d*.wpmix.net` origins with credentials.
**Rationale:** `webchat_session` cookie is scoped to `simpledashboard.wpmix.net` (set by the webchat server). If the endpoint were inside `d*.wpmix.net`, the cookie would not be sent (different origin). Cross-origin CORS with credentials is the correct mechanism.
**Alternatives considered:** Cookie domain `.wpmix.net` — exposes session to all subdomains; rejected. Separate session for each dashboard — over-engineering; rejected.

### Decision 4: One active invite token per dashboard, no TTL
**Decision:** `inviteTokens` Map keyed by `dashboardUserId`, one token per dashboard. New generation overwrites old. No TTL — lives until owner revokes.
**Rationale:** Per user-spec. Owner controls access by revoking. Multiple simultaneous invite links are out of scope.

### Decision 5: Invite tokens persisted to invites.json
**Decision:** `inviteTokens` Map serialized to `data/webchat/invites.json` via `writeJsonAtomic` on every write. Populated from disk at startup.
**Rationale:** `magicLinkTokens` is in-memory (24h TTL, loss acceptable). Invite tokens have no TTL — loss forces re-generation, breaking pending invite links.

### Decision 6: /api/data/ JWT enforcement only for protected dashboards
**Decision:** JWT required only when `chatSettings.ownerAddress` is set. Dashboards without `ownerAddress` remain publicly accessible.
**Rationale:** Enforcing auth on unprotected dashboards would break existing public dashboards. Auth widget is also absent on unprotected dashboards per user-spec.

### Decision 7: Guest email list via new GET /api/auth/access-list in auth-api.ts
**Decision:** Add `GET /api/auth/access-list?dashboardId=<id>` to auth-api.ts (protected by `INTERNAL_API_KEY`). SQL: `SELECT u.email FROM dashboard_access da JOIN users u ON da.address = u.address WHERE da.dashboard_id = ?`. Profile page calls this via webchat server proxy.
**Rationale:** `dashboard_access` is in PostgreSQL accessible only through auth-api. Webchat server has no direct PG connection. Local cache would be lost on restart and wouldn't include pre-existing grants.

### Decision 8: ml-token carries pre-signed dashboardJwt
**Decision:** Extend `magicLinkTokens` entry with optional `dashboardJwt?: string`. The OAuth callback stores the dashboard JWT directly in the token entry. `GET /api/auth/ml` returns `dashboardJwt` directly when present (skips re-sign).
**Rationale:** Avoids a second round-trip to Auth API during token exchange. The dashboard JWT is already signed in the OAuth callback; reusing it is more efficient and avoids potential Auth API unavailability at exchange time.

## Data Models

### InviteRecord (webchat.ts + invites.json)
```typescript
type InviteRecord = {
  dashboardUserId: string;  // String(userId) — owner's userId
  token: string;            // 32-byte hex
};

const inviteTokens = new Map<string, string>(); // dashboardUserId → token
```

### Extended magicLinkTokens entry type (planned extension)
```typescript
// Type extended from current { userId: string; expires: number }:
type MagicLinkEntry = {
  userId: string;
  expires: number;
  dashboardJwt?: string;  // pre-signed dashboard JWT from OAuth callback path
};
```

### PostgreSQL (existing, no migration needed)
```sql
-- users, dashboards, dashboard_access already exist
-- dashboard_access: ON CONFLICT DO NOTHING handles concurrent guest registration
-- New query in GET /api/auth/access-list:
-- SELECT u.email FROM dashboard_access da JOIN users u ON da.address = u.address WHERE da.dashboard_id = $1
```

## Dependencies

### New packages
_None_ — `ethers` v6 already in `package.json`. `google-auth-library` already imported in `webchat.ts`.

### Using existing (from project)
- `ethers.Wallet` (v6) — keypair generation and `signMessage`; needs `import { ethers } from 'ethers'` added to `webchat.ts` (currently only in `auth-api.ts`)
- `OAuth2Client` from `google-auth-library` — authorization code flow (`getToken(code)`), existing import in `webchat.ts`
- `magicLinkTokens` Map — reused for OAuth callback ml-token delivery (type extended)
- `SlidingWindowRateLimiter` — two new instances: `rlInviteUser1h` (20/hour/userId), `rlOAuthCallbackIp10m` (20/10min/IP)
- `writeJsonAtomic`, `readJsonFile` — for invites.json persistence
- `requireSessionApi`, `getReqUser` — for invite endpoints
- `AUTH_API_URL`, `INTERNAL_API_KEY`, `JWT_SECRET` — existing env vars

### External services
- **Google Cloud Console** — add `https://simpledashboard.wpmix.net/api/auth/google-dashboard-callback` to authorized redirect URIs
- **Auth API (port 8095)** — `POST /api/auth/register`, `POST /api/auth/share`, `POST /api/auth/login` — all existing, no changes; new `GET /api/auth/access-list` added

## Testing Strategy

**Feature size:** L

### Unit tests
- `ethers.Wallet.createRandom()` produces valid address/privateKey format
- `signChallenge(privateKey, dashboardId)` — `ethers.verifyMessage(challenge, sig) === address`
- Invite token CRUD: generate → persist → load on restart → revoke → old token invalid
- Rate limit: 20 invites/hour on 20th → ok; 21st → 429

### Integration tests
- `test_invite_flow.js`: POST /api/auth/invite → token in invites.json; restart server → token survives; POST /api/auth/invite/revoke → new URL returned, old token used in actual OAuth callback → `?error=no_access`; rate limit 429
- `test_guest_auth_widget.js`: HTML injection present on protected dashboard; absent on unprotected; no webchat links in dashboard HTML; `/api/data/` without JWT → 401; with valid JWT → 200; `?error=no_access` param → no-access overlay element present; `?error=service_unavailable` → service overlay present
- `test_server_side_keypair.js` (uses `GOOGLE_AUTH_TEST_SECRET` bypass): new email → keypair in ChatSettings → ml redirect → JWT redeemable; same email again → no duplicate keypair, JWT still issued; invalid invite in state → `?error=no_access`; valid invite + Auth API down (mock 503 server on test port) → `?error=service_unavailable`; valid invite + `/api/auth/share` returns error → `?error=service_unavailable` (not no_access); GET /api/auth/invite/status with valid session + dashboard_access → mlToken returned; GET /api/auth/invite/status without valid session → 401

### E2E tests
_None for MVP_ — OAuth flow requires real Google credentials. Smoke test in user-spec "Ручная проверка".

## Agent Verification Plan

**Source:** user-spec "Как проверить" section.

### Verification approach
Agent verifies via curl/bash against `localhost:8094`. Google OAuth callback tested via `GOOGLE_AUTH_TEST_SECRET` bypass (same pattern as `test_google_auth.js`). Auth API down simulated via mock HTTP server.

### Per-task verification
| Task | verify: | What to check |
|------|---------|---------------|
| 3 | bash | `data/webchat/invites.json` created after first invite; inviteTokens Map populated on restart |
| 5 | curl | POST /api/auth/invite → 200 + url; POST revoke → new url; 429 on 21st |
| 6 | bash | `GOOGLE_AUTH_TEST_SECRET=xxx node tests/test_server_side_keypair.js` |
| 7 | curl | GET simpledashboard.wpmix.net/api/auth/invite/status with valid session → 200 mlToken |
| 8 | curl | GET d*.wpmix.net/api/data/test without JWT → 401 |
| 9 | curl | GET d*.wpmix.net/ \| grep auth-widget-loader |
| 10 | curl | GET /profile \| grep "Поделиться дашбордом" |
| 11–13 | bash | node tests/test_invite_flow.js; test_guest_auth_widget.js; test_server_side_keypair.js |

### Tools required
- `curl` — API verification
- `bash` — test runner, mock server
- No Playwright MCP (no browser E2E in spec)

## Risks

| Risk | Mitigation |
|------|-----------|
| `GOOGLE_CLIENT_SECRET` not in env | Handler logs error and returns 500 with message "GOOGLE_CLIENT_SECRET not configured" |
| `JWT_SECRET` fallback to 'magic-secret' (existing code at webchat.ts:3749) | Document as known security risk; fail-fast check added in startup; pre-existing, not introduced by this feature |
| `INTERNAL_API_KEY` fallback to empty string (existing code at webchat.ts:5036) | Same — pre-existing known risk; new Auth API calls also affected |
| Server-side private key in memory during signing | Key loaded from ChatSettings on-demand, not cached globally; same pattern as existing owner flow |
| `POST /api/auth/share` requires owner in PG `dashboards` table | Owner must have completed keypair flow; profile page shows Share section only if `ownerAddress` set |
| Race condition: two guests register simultaneously | `dashboard_access` has `ON CONFLICT DO NOTHING`; both succeed |
| Auth API down during guest registration | Catch 502/timeout → redirect `?error=service_unavailable` |
| CSRF via crafted OAuth state | Mitigated by nonce validation + `redirect_to` allowlist (Decision 2) |
| ml-token in URL logged by reverse proxy | Short TTL for ml-token (5 min instead of 24h for OAuth-generated tokens) |

## Acceptance Criteria

Technical criteria (supplement user-spec AC):

- [ ] `import { ethers } from 'ethers'` in `webchat.ts` compiles without error
- [ ] `invites.json` created in `data/webchat/` on first invite generation
- [ ] `inviteTokens` Map populated from `invites.json` on process restart
- [ ] `rlInviteUser1h` and `rlOAuthCallbackIp10m` in `allLimiters` array (sweep participation)
- [ ] OAuth `state` nonce validated on callback; `redirect_to` validated against `/^d\d+\.wpmix\.net$/`
- [ ] `GET /api/auth/google-dashboard-callback` registered before `d*.wpmix.net` middleware
- [ ] `GET /api/auth/invite/status` on `simpledashboard.wpmix.net` with CORS `Access-Control-Allow-Origin: d*.wpmix.net` and `Access-Control-Allow-Credentials: true`
- [ ] Auth widget script injected in same `html.replace('</body>', ...)` call as magic-link script
- [ ] Auth widget absent when `chatSettings.ownerAddress` is falsy
- [ ] `/api/data/` returns 401 without JWT on protected dashboard; 200 with valid JWT
- [ ] `GET /api/auth/ml` returns `dashboardJwt` directly when `dashboardJwt` field present in token entry
- [ ] OAuth-generated ml-token expires in 5 minutes (not 24h)
- [ ] `JWT_SECRET` startup assertion: process exits with error if `JWT_SECRET` not set
- [ ] `INTERNAL_API_KEY` startup assertion: process exits with error if `INTERNAL_API_KEY` not set
- [ ] `ownerPrivateKey` NOT rendered in profile page HTML (removed display)
- [ ] `GET /api/auth/access-list` in auth-api.ts returns guest email list for dashboard
- [ ] All existing tests pass: `test_google_auth.js`, `test_auth_api.js`, `test_webchat_keypair.js`
- [ ] TypeScript compiles: `npm run build` in `botplatform/` exits 0

## Implementation Tasks

<!-- Tasks are brief scope descriptions. AC, TDD, and detailed steps are created during task-decomposition. -->
<!-- Note: tasks within the same wave that modify webchat.ts must be executed sequentially. -->

### Wave 1 (независимые, разные файлы)

#### Task 1: GOOGLE_CLIENT_SECRET env setup
- **Description:** Add `GOOGLE_CLIENT_SECRET=<value>` to `botplatform/.env.auth` (value from Google Cloud Console). Register `https://simpledashboard.wpmix.net/api/auth/google-dashboard-callback` as authorized redirect URI in Google Cloud Console for OAuth client `531979133429-b20qi1v15bgoq724tfk808lr1u3a1ev2`. This is a prerequisite for the OAuth callback handler.
- **Skill:** code-writing
- **Reviewers:** security-auditor
- **Verify:** bash — confirm `GOOGLE_CLIENT_SECRET` non-empty in simpledashboard-web process env
- **Files to modify:** `botplatform/.env.auth`
- **Files to read:** `botplatform/src/webchat.ts`

#### Task 2: CLAUDE.md.template — guest auth documentation
- **Description:** Add documentation of three auth paths (owner Extension, owner mobile magic-link, guest Google OAuth) to `CLAUDE.md.template`. Document overlay IDs (`authOverlay`, `authDataContainer`), `sessionStorage.dashboard_jwt` semantics, that auth widget is server-injected, and that `OWNER_ADDRESS` in Claude prompt is the guest's own registered address. Ensures AI-generated dashboard code handles auth state correctly.
- **Skill:** documentation-writing
- **Reviewers:** code-reviewer
- **Verify:** user — read template section
- **Files to modify:** `products/simple_dashboard/CLAUDE.md.template`
- **Files to read:** `products/simple_dashboard/CLAUDE.md.template`, `work/multi-user-auth/user-spec.md`

### Wave 2 (разные файлы, параллельно)

#### Task 3: webchat.ts foundation — invite storage + ethers + rate limiters + fail-fast
- **Description:** Add to `webchat.ts`: `import { ethers }`, `InviteRecord` type, `INVITES_PATH`, `readInvites`/`writeInvites`, `inviteTokens` Map (populated from disk at startup), `rlInviteUser1h` (20/hour/userId) and `rlOAuthCallbackIp10m` (20/10min/IP) rate limiters added to `allLimiters`, `signChallenge(privateKey, dashboardId)` helper (builds challenge JSON, signs via ethers.Wallet, returns `{challenge, signature}`), and extended `MagicLinkEntry` type with optional `dashboardJwt` field. Also: remove `|| 'magic-secret'` fallback at line 3749 and `|| ''` fallback for `INTERNAL_API_KEY` at line 5036; add startup assertions (`if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET required')`; same for `INTERNAL_API_KEY`).
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor
- **Verify:** bash — `npm run build` exits 0; `data/webchat/invites.json` created after first invite
- **Files to modify:** `botplatform/src/webchat.ts`
- **Files to read:** `botplatform/src/webchat.ts`, `botplatform/src/auth-api.ts`

#### Task 4: auth-api.ts — GET /api/auth/access-list
- **Description:** Add `GET /api/auth/access-list?dashboardId=<id>` to auth-api.ts, protected by `INTERNAL_API_KEY` bearer token. SQL: `SELECT u.email FROM dashboard_access da JOIN users u ON da.address = u.address WHERE da.dashboard_id = $1`. Returns `{ emails: string[] }`. Used by profile page to show the list of guests who have dashboard access.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor
- **Verify:** curl — GET /api/auth/access-list?dashboardId=d999 with INTERNAL_API_KEY → 200 emails array
- **Files to modify:** `botplatform/src/auth-api.ts`
- **Files to read:** `botplatform/src/auth-api.ts`

### Wave 3 (webchat.ts: invite endpoints, depends on Wave 2)

#### Task 5: POST /api/auth/invite + POST /api/auth/invite/revoke
- **Description:** Add two endpoints on `simpledashboard.wpmix.net` before d*.wpmix.net middleware: `POST /api/auth/invite` (requireSessionApi, rlInviteUser1h, token via `crypto.randomBytes(32).toString('hex')`, overwrites old token in Map + disk, returns `{ url }`) and `POST /api/auth/invite/revoke` (requireSessionApi, regenerates token, returns new `{ url }`). Both return 403 if `chatSettings.ownerAddress` is not set.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** curl — POST invite → 200 url; POST revoke → new url; 429 on 21st request/hour
- **Files to modify:** `botplatform/src/webchat.ts`
- **Files to read:** `botplatform/src/webchat.ts`

### Wave 4 (webchat.ts: OAuth callback, depends on Wave 3)

#### Task 6: GET /api/auth/google-dashboard-callback
- **Description:** Add OAuth authorization-code callback handler on `simpledashboard.wpmix.net`. Sequence: validate state nonce against session (CSRF) and `redirect_to` against `/^d\d+\.wpmix\.net$/` allowlist → `OAuth2Client.getToken(code)` → find-or-create WebUser → generate keypair if new → `POST /api/auth/register` → validate invite → `POST /api/auth/share` (if share fails → `?error=service_unavailable`, NOT `no_access`) → `signChallenge()` → `POST /api/auth/login` → store ml-token with `dashboardJwt` field, expires `Date.now() + 5*60*1000` → HTTP 302. Error paths: invalid invite + no existing access → `?error=no_access`; Auth API down → `?error=service_unavailable`; bad code → `?error=auth_failed`. Log on keypair failure: `[ERROR] guest keypair generation failed for email=<email>`. Log on success: `[AUDIT] guest registered: email=<email> dashboardId=<id>`. Also modifies `GET /api/auth/ml` to return `entry.dashboardJwt` directly when present (no re-sign). Server embeds `window.__OAUTH_NONCE__` and nonce in session before redirect to Google.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** bash — `GOOGLE_AUTH_TEST_SECRET=xxx node tests/test_server_side_keypair.js`
- **Files to modify:** `botplatform/src/webchat.ts`
- **Files to read:** `botplatform/src/webchat.ts`, `botplatform/src/auth-api.ts`

### Wave 5 (webchat.ts: middleware, зависит от Wave 4; sequential внутри волны)

#### Task 7: JWT enforcement on /api/data/ in d*.wpmix.net
- **Description:** Add `Authorization: Bearer <jwt>` check at the start of the `/api/data/` handler block in `d*.wpmix.net` middleware. Use `jwt.verify(token, JWT_SECRET)` and verify `payload.dashboardId === "d" + userId`. Skip enforcement when `chatSettings.ownerAddress` is falsy. Return `{ error: "Unauthorized" }` HTTP 401 on failure.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor
- **Verify:** curl — GET d*.wpmix.net/api/data/test without JWT → 401; with valid JWT → 200
- **Files to modify:** `botplatform/src/webchat.ts`
- **Files to read:** `botplatform/src/webchat.ts`

#### Task 8: GET /api/auth/invite/status (returning guest auto-auth)
- **Description:** Add `GET /api/auth/invite/status?dashboardId=<id>` on `simpledashboard.wpmix.net` (NOT inside d*.wpmix.net middleware) with CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials: true`) for d*.wpmix.net origins. Handler: read `webchat_session` cookie → look up session → load guest ChatSettings → `signChallenge()` → `POST /api/auth/login` server-side → generate ml-token → return `{ mlToken }`. Returns 401 if no valid session or no dashboard_access for this guest.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor
- **Verify:** curl — GET /api/auth/invite/status with valid session → 200 mlToken; no session → 401
- **Files to modify:** `botplatform/src/webchat.ts`
- **Files to read:** `botplatform/src/webchat.ts`

### Wave 6 (webchat.ts: UI, зависит от Wave 5; sequential внутри волны)

#### Task 9: Auth widget script injection into d*.wpmix.net HTML
- **Description:** Inject `<script id="auth-widget-loader">` alongside the existing magic-link script in `html.replace('</body>', ...)`. Server also embeds `window.__OAUTH_NONCE__` (crypto.randomBytes(16).toString('hex')) as an inline variable; nonce stored in the WebSession entry so callback can validate it. Widget logic: (1) if `sessionStorage.dashboard_jwt` set → exit; (2) call `GET https://simpledashboard.wpmix.net/api/auth/invite/status` with `credentials:'include'` — if mlToken returned → reload `?ml=TOKEN`; if 401 → fall through to step 4; (3) save `?invite=TOKEN` from URL to sessionStorage; (4) if ownerAddress set → show Google OAuth button (constructs redirect URL with state={redirect_to, invite, nonce: window.__OAUTH_NONCE__}; removes invite token from sessionStorage before redirect); handle `?error=no_access` → no-access overlay; `?error=service_unavailable` → service overlay. Widget absent when ownerAddress is falsy. OAuth button disabled while request pending (re-enables on popup cancel/timeout).
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** curl — GET d*.wpmix.net/ \| grep auth-widget-loader; unprotected dashboard → count 0
- **Files to modify:** `botplatform/src/webchat.ts`
- **Files to read:** `botplatform/src/webchat.ts`, `products/simple_dashboard/CLAUDE.md.template`

#### Task 10: Profile page "Share Dashboard" section
- **Description:** Add "Поделиться дашбордом" section to `/profile` page between `#mobile-section` and "Back to chat" row. Visible only when `ownerAddress` set. Contains: "Создать invite-ссылку" button (POST /api/auth/invite → copyable URL), "Отозвать ссылку" button (POST /api/auth/invite/revoke → new URL), and guest list loaded from `GET /api/auth/access-list` (server-side fetch at page render time, fallback to empty list on error). Also: remove the current `ownerPrivateKey` display from the profile page HTML (the private key must not be rendered to the browser).
- **Skill:** code-writing
- **Reviewers:** code-reviewer
- **Verify:** curl — GET /profile \| grep "Поделиться дашбордом"
- **Files to modify:** `botplatform/src/webchat.ts`
- **Files to read:** `botplatform/src/webchat.ts`

### Wave 7 (тесты, разные файлы, параллельно)

#### Task 11: test_invite_flow.js
- **Description:** Integration tests: generate invite → token in `invites.json`; verify persistence by reading `invites.json` directly (do not restart live PM2 process); POST invite twice → second token differs, old token used in GET /api/auth/invite/status → 401; POST revoke → new URL, old token invalid (behavioral: use old token → assert 401 or no_access); rate limit 429. Also verifies `rlInviteUser1h` is keyed by userId (not IP): same userId from two IPs → single budget; two different userIds → independent budgets.
- **Skill:** code-writing
- **Reviewers:** test-reviewer
- **Verify:** bash — `node tests/test_invite_flow.js` exits 0
- **Files to modify:** `botplatform/tests/test_invite_flow.js` (new file)
- **Files to read:** `botplatform/tests/test_google_auth.js`, `botplatform/src/webchat.ts`

#### Task 12: test_guest_auth_widget.js
- **Description:** Integration tests: auth-widget-loader script present in protected dashboard HTML; absent on unprotected (no ownerAddress); no "Back to chat" / "Profile" / "Logout" links in dashboard HTML; `/api/data/` without JWT → 401; `/api/data/` with valid JWT (obtained via `GOOGLE_AUTH_TEST_SECRET` callback bypass) → 200; `/api/data/` with valid JWT but wrong dashboardId in payload → 401; `?error=no_access` → no-access overlay element present; `?error=service_unavailable` → service overlay present. Verify `/api/auth/invite/status` CORS response includes `Access-Control-Allow-Origin` header for d*.wpmix.net origin.
- **Skill:** code-writing
- **Reviewers:** test-reviewer
- **Verify:** bash — `node tests/test_guest_auth_widget.js` exits 0
- **Files to modify:** `botplatform/tests/test_guest_auth_widget.js` (new file)
- **Files to read:** `botplatform/tests/test_google_auth.js`, `botplatform/src/webchat.ts`

#### Task 13: test_server_side_keypair.js
- **Description:** Integration tests using `GOOGLE_AUTH_TEST_SECRET` bypass: new email → keypair in ChatSettings → ml-redirect → JWT redeemable; same email again → no duplicate keypair, valid JWT still issued; invalid invite → `?error=no_access`; valid invite + mock Auth API returning 503 → `?error=service_unavailable`; valid invite + `/api/auth/share` returning error → `?error=service_unavailable` (not `no_access`); GET /api/auth/invite/status with valid session + dashboard_access → redeemable mlToken; same without session → 401. Unit: `signChallenge` ecrecover check.
- **Skill:** code-writing
- **Reviewers:** test-reviewer, security-auditor
- **Verify:** bash — `GOOGLE_AUTH_TEST_SECRET=xxx node tests/test_server_side_keypair.js` exits 0
- **Files to modify:** `botplatform/tests/test_server_side_keypair.js` (new file)
- **Files to read:** `botplatform/tests/test_google_auth.js`, `botplatform/tests/test_auth_api.js`, `botplatform/src/webchat.ts`

### Final Wave

#### Task 14: Pre-deploy QA
- **Description:** Acceptance testing: run all tests (`test_invite_flow.js`, `test_guest_auth_widget.js`, `test_server_side_keypair.js`, `test_google_auth.js`, `test_auth_api.js`, `test_webchat_keypair.js`), verify all acceptance criteria from user-spec and tech-spec, confirm `npm run build` passes.
- **Skill:** pre-deploy-qa
- **Reviewers:** none
- **Verify:** bash — all test files exit 0; `npm run build` exits 0

#### Task 15: Deploy
- **Description:** Build TypeScript (`npm run build` in `botplatform/`), reload PM2 (`pm2 reload simpledashboard-web`), verify clean logs, run manual smoke test from user-spec "Ручная проверка" checklist.
- **Skill:** deploy-pipeline
- **Reviewers:** none
- **Verify:** bash — `pm2 status simpledashboard-web` shows online; logs clean
