# Code Research: Multi-User Dashboard Access (Invite System)

**Feature:** Invite system that lets a dashboard owner share access with other registered users.
**Date:** 2026-03-03

---

## 1. Entry Points

### d{userId}.wpmix.net middleware
**File:** `/root/aisell/botplatform/src/webchat.ts` lines 3499–3816

Catches all requests where the hostname matches `/^d(\d+)\.(wpmix\.net|habab\.ru)$/i`. Extracts `userId` from the subdomain, resolves `WORKSPACES_ROOT/user_{userId}` on disk, then dispatches to sub-handlers in order:

1. `POST /api/auth/login` — proxies to Auth API (port 8095)
2. `GET /api/auth/ml` — magic link token exchange
3. `GET /api/data/*` — JSON CRUD API
4. `GET /api/fetch` — SSRF-protected external proxy
5. Static file serving (HTML files get magic-link script injected)

Key signature:
```ts
app.use(async (req, res, next) => {
  const host = req.hostname || req.get('host') || '';
  const match = host.match(/^d(\d+)\.(wpmix\.net|habab\.ru)$/i);
  const userId = match[1];
  const userFolder = `${WORKSPACES_ROOT}/user_${userId}`;
  ...
})
```

### Webchat API auth endpoints (simpledashboard-web process, port 8094)
**File:** `/root/aisell/botplatform/src/webchat.ts`

| Endpoint | Lines | Purpose |
|---|---|---|
| `POST /api/auth/claim` | ~4757 | Email/name login: find-or-create WebUser, create session |
| `POST /api/auth/google` | ~4870 | Google OAuth login: verify Google JWT, find-or-create user, create session |
| `POST /api/auth/register-owner` | ~5039 | Server-to-server: relay keypair to Auth API, persist in ChatSettings |
| `POST /api/auth/magic-link` | ~5152 | Generate single-use magic link token for mobile access |
| `POST /api/delete-account` | ~5127 | Remove user folder, user record, sessions, magic link tokens |
| `GET /profile` | ~5167 | Render profile page (shows ownerAddress, QR button) |

### Auth API (dashboard-auth-api process, port 8095)
**File:** `/root/aisell/botplatform/src/auth-api.ts`

| Endpoint | Auth required | Purpose |
|---|---|---|
| `GET /api/auth/health` | None | PG ping |
| `POST /api/auth/register` | `INTERNAL_API_KEY` | Register user + dashboard + grant owner access |
| `POST /api/auth/login` | None (signature-based) | Verify Ethereum signature, check `dashboard_access`, return JWT |
| `POST /api/auth/share` | `INTERNAL_API_KEY` | Grant access to a second user by email lookup |

---

## 2. Data Layer

### WebUser (flat JSON file)
**File:** `/root/aisell/botplatform/src/webchat.ts` line 23
**Path on disk:** `/root/aisell/botplatform/data/webchat/users.json`

```ts
type WebUser = {
  userId: number;   // allocated sequentially from state.json; used as chatId in bot engine
  email: string;
  name: string;
  nickname: string; // slug derived from name/email, unique
  createdAt: string;
};
```

`readUsers(): WebUser[]` / `writeUsers(users: WebUser[]): void` — full array read/write, no partial update. Written atomically via `writeJsonAtomic`.

### WebSession (flat JSON file)
**File:** `/root/aisell/botplatform/src/webchat.ts` line 31
**Path on disk:** `/root/aisell/botplatform/data/webchat/sessions.json`

```ts
type WebSession = {
  sessionId: string; // 24-byte hex
  userId: number;
  createdAt: string;
  expiresAt: string; // TTL from WEBCHAT_SESSION_TTL_HOURS env var (default 168h = 7 days)
};
```

Session ID stored in `webchat_session` cookie (HttpOnly, SameSite=None+Secure on HTTPS, SameSite=Lax on HTTP). `cleanupExpired()` prunes at startup and on every auth operation.

### ChatSettings (per-user JSON, on disk in user folder)
**File:** `/root/aisell/botplatform/src/bot.ts` line 329
**Path on disk:** `/root/aisell/botplatform/group_data/user_{userId}/settings.json`

```ts
export interface ChatSettings {
  chatId: number;
  useBwrap?: boolean;
  ownerAddress?: string;   // Ethereum address (0x + 40 hex chars), optional
  ownerPrivateKey?: string; // Ethereum private key, optional
  lastModified: string;
}
```

Loaded via `loadChatSettings(chatId: number): ChatSettings` (in-memory cache keyed by chatId). Persisted via `saveChatSettings(settings: ChatSettings): void`. Cache is NOT invalidated on write by other processes — single-process model assumed.

`ownerAddress` is read in `buildTextCtx()` (webchat.ts ~4164) and injected as `OWNER_ADDRESS: 0x...` prefix into the Claude prompt in `bot.ts:executeAiCommand()` (~line 3972).

### PostgreSQL tables in Auth API (LXC 102)
**File:** `/root/aisell/botplatform/src/auth-api.ts`

The schema is referenced but not defined in the TypeScript code — tables are presumed to already exist:

```sql
-- Inferred from INSERT/SELECT queries:
CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  address     TEXT NOT NULL,         -- checksummed Ethereum address
  email       TEXT UNIQUE NOT NULL,
  private_key TEXT NOT NULL
);

CREATE TABLE dashboards (
  dashboard_id  TEXT PRIMARY KEY,  -- e.g. "d1871529639"
  owner_address TEXT NOT NULL
);

CREATE TABLE dashboard_access (
  dashboard_id TEXT NOT NULL,
  address      TEXT NOT NULL,
  granted_by   TEXT NOT NULL,
  PRIMARY KEY (dashboard_id, address)   -- ON CONFLICT DO NOTHING
);
```

### Magic link tokens (in-memory Map)
**File:** `/root/aisell/botplatform/src/webchat.ts` line 3922

```ts
const magicLinkTokens = new Map<string, { userId: string; expires: number }>();
```

Key: 32-byte hex token. TTL: 24h. Single-use (deleted on redemption). Swept every 60s. Lost on process restart — acceptable per comment. Scoped to a specific userId (cross-userId access returns 403).

---

## 3. Similar Features

### Existing `/api/auth/share` endpoint (Auth API)
**File:** `/root/aisell/botplatform/src/auth-api.ts` lines 421–487

Already implemented server-to-server endpoint for granting second-user access:
- Takes `{ dashboardId, email, ownerAddress }` in body
- Validates `ownerAddress` is the actual dashboard owner (PG lookup)
- Looks up target user by email in `users` table
- Inserts into `dashboard_access` — grants access silently
- Returns `{ address, email }`

This is the backend primitive for the invite system. It exists but has no webchat-facing UI or user-facing trigger yet.

### Magic link flow (mobile access)
The magic link flow (POST `/api/auth/magic-link` → GET `/api/auth/ml?token=`) is a close structural analog to an invite link:
- Server generates a signed, time-limited, single-use token
- Token is scoped to a specific userId/dashboard
- Token is delivered out-of-band (QR code in this case)
- On redemption, server returns a JWT and removes the token

An invite system could reuse this token generation and delivery pattern.

---

## 4. Integration Points

### Extension client-side keypair flow
**File:** `/root/aisell/botplatform/src/webchat.ts` lines 2586–2800 (inside `renderAppHtml`)

`triggerKeypairFlow(email, dashboardId)` sends a postMessage to the Chrome extension requesting an Ethereum keypair. On success it stores `window.__OWNER_ADDRESS__` and calls `POST /api/auth/register-owner`. This is run once after login for SimpleDashboard.

For an invite system, invited users need their own keypair registered. The extension generates one per email, so a separate call to `POST /api/auth/register-owner` for the invitee's email is needed — but the invitee must log in to webchat first (so they have a WebUser record) before their keypair can be looked up in the PG `users` table.

### `buildTextCtx` — ownerAddress injection
**File:** `/root/aisell/botplatform/src/webchat.ts` line 4143

```ts
function buildTextCtx(user: WebUser, text: string): Context
```

Reads `loadChatSettings(user.userId).ownerAddress` and attaches it to `ctx.from.ownerAddress`. Bot engine (`executeAiCommand`, bot.ts ~3971) reads it and prepends `OWNER_ADDRESS: 0x...\n\n` to the Claude prompt.

For multi-user: each invitee has their own `userId` and their own `ChatSettings`. The `ownerAddress` stored there is their own Ethereum address (used for login to the dashboard they were granted access to), not the dashboard owner's address. This distinction matters: the Claude prompt context currently always contains the messaging user's own address.

### CORS restriction in Auth API
**File:** `/root/aisell/botplatform/src/auth-api.ts` line 151

```ts
const DASHBOARD_ORIGIN_RE = /^https:\/\/d\d+\.wpmix\.net$/;
```

Only `d*.wpmix.net` origins are allowed. Webchat origin (`simpledashboard.wpmix.net`) is blocked. Calls to Auth API from the webchat server side use the `INTERNAL_API_KEY` header, not CORS.

---

## 5. Existing Tests

**Framework:** vanilla Node.js assertions, no test framework. Runner: `node tests/test_*.js`.

**Test files relevant to auth:**

`/root/aisell/botplatform/tests/test_auth_api.js` — unit + integration tests for Auth API.
- Unit: ecrecover math, challenge JSON parsing, JWT signing, rate limiter sliding window.
- Integration: HTTP to port 8095 with `INTERNAL_API_KEY`. Covers `POST /api/auth/register`, `POST /api/auth/login` (good + bad signature, expired challenge), rate limiting.
- Key signatures:
  ```js
  async function testRegister(address, email, privateKey, dashboardId) // integration
  async function testLogin(signature, challenge, dashboardId)           // integration
  ```

`/root/aisell/botplatform/tests/test_dashboard_auth_e2e.js` — Puppeteer E2E.
- Scenarios: no extension → blur overlay, correct keypair → unblur, wrong keypair → no-access, Auth API down → service-unavailable.
- Uses a local fixture server + `EXTENSION_PATH` constant pointing to built extension.

`/root/aisell/botplatform/tests/test_webchat_keypair.js` — tests `POST /api/auth/register-owner` via webchat.

`/root/aisell/botplatform/tests/test_google_auth.js` — 21 tests for Google OAuth flow using `GOOGLE_AUTH_TEST_SECRET` bypass.

`/root/aisell/botplatform/tests/test_auth_security.js` — rate-limit exhaustion tests; drains rate limiter budget (see gotcha in MEMORY.md).

**What is NOT covered:**
- `POST /api/auth/share` — no test for the existing share endpoint
- Invite link generation, delivery, or redemption
- Multi-user login to the same dashboard

---

## 6. Shared Utilities

**`loadChatSettings(chatId: number): ChatSettings`** — bot.ts ~547. Exported. Reads from disk with in-memory cache.

**`saveChatSettings(settings: ChatSettings): void`** — bot.ts ~583. Exported. Writes to disk. Cache not invalidated for other readers.

**`readUsers() / writeUsers()`** — webchat.ts ~514. Full-array flat JSON. Not safe for concurrent writes from multiple processes.

**`readSessions() / writeSessions()`** — webchat.ts ~523. Same pattern.

**`cleanupExpired(sessions: WebSession[]): WebSession[]`** — webchat.ts ~(inferred). Filters sessions where `expiresAt < now`.

**`allocateUserId(): number`** — webchat.ts ~164. Reads `state.json`, increments `nextUserId`, writes back. Sequential integer IDs.

**`buildNickname(name, email, used)`** — webchat.ts ~134. Generates unique slug from name/email, deduplicates against existing set.

**`requireSessionApi` / `requireSessionPage`** — webchat.ts ~4031/4041. Middleware that calls `ensureAuthed()` and attaches `req.webUser`. API variant returns 401 JSON; page variant redirects to `/`.

**`getReqUser(req)`** — webchat.ts ~4051. Unwraps `req.webUser` set by the middleware, throws if missing.

**`SlidingWindowRateLimiter`** — webchat.ts ~213-276 (and copied into auth-api.ts). In-memory sliding window, lost on restart. Keys are strings (IP, userId).

**`writeJsonAtomic(path, data)`** — webchat.ts (line ~480 area). Writes JSON to a temp file then renames to target, preventing partial writes.

---

## 7. Potential Problems

### No existing webchat surface for `/api/auth/share`
The Auth API `POST /api/auth/share` endpoint exists but is internal-only. There is no webchat route, no UI trigger, and no way for a dashboard owner to call it from the browser. The invite system must add a webchat-side proxy endpoint (like `POST /api/auth/register-owner` proxies to `/api/auth/register`).

### Invitee must register their own keypair first
`POST /api/auth/share` looks up the invitee by email in the PG `users` table. A user record in PG is only created by `POST /api/auth/register` (called from `register-owner`). The invitee must: (1) log in to webchat, (2) have the extension installed, (3) trigger `triggerKeypairFlow` — only then does their address appear in PG. If the owner invites someone who hasn't done this, the share call returns 404 "User not found".

### `magicLinkTokens` is in-memory and process-local
If `simpledashboard-web` restarts, all pending magic links (and potentially invite links if reusing this pattern) are invalidated silently. Users who haven't redeemed a link yet will get a 401 with no explanation.

### `readUsers()` / `writeUsers()` is a full-array rewrite
Concurrent writes from multiple requests could interleave. In practice the server is single-process (Node.js event loop), so sequential execution prevents true races — but the pattern is fragile if processes scale horizontally.

### `ownerAddress` in ChatSettings is per webchat user, not per dashboard
When an invitee logs into the webchat and sends messages, `buildTextCtx` injects their own `ownerAddress` into the Claude prompt. The CLAUDE.md.template currently treats `OWNER_ADDRESS` as the dashboard owner's address. If invitees can also send messages through the webchat to edit the shared dashboard, the prompt semantics become ambiguous.

### No revocation mechanism
`dashboard_access` has no expiry column and no delete route in Auth API. Once a user is granted access, there is no way to revoke it short of a direct PG query.

### Private key stored in plaintext
`ChatSettings.ownerPrivateKey` and the PG `users.private_key` column store Ethereum private keys in plaintext on disk. If the filesystem or PG backup is compromised, all keypairs are exposed.

---

## 8. Constraints and Infrastructure

### Process model
`simpledashboard-web` runs on port 8094 via `start-webchat-simpledashboard.sh` (PM2). `dashboard-auth-api` runs on port 8095 (PM2 process name: `dashboard-auth-api`). Both are on `95.217.227.164`. They communicate server-to-server via `AUTH_API_URL` env var (default `http://127.0.0.1:8095`).

### Environment variables (webchat process)
- `JWT_SECRET` — used for magic link JWT signing in d*.wpmix.net middleware
- `AUTH_API_URL` — base URL for Auth API calls (default `http://127.0.0.1:8095`)
- `INTERNAL_API_KEY` — bearer token for Auth API server-to-server calls
- `WEBCHAT_INIT_WITH_START=false` — SimpleDashboard specific: disables auto-/start on claim
- `GOOGLE_CLIENT_ID` — enables Google OAuth path
- `GOOGLE_AUTH_TEST_SECRET` — test-only bypass for Google JWT verification

### Environment variables (Auth API process)
- `JWT_SECRET`, `INTERNAL_API_KEY`, `PG_HOST`, `PG_DB`, `PG_USER`, `PG_PASSWORD` — all required, fail-fast on startup
- `AUTH_API_PORT` — defaults to 8095

### CORS restriction
Auth API only allows CORS from `^https://d\d+\.wpmix\.net$`. The webchat origin `simpledashboard.wpmix.net` is blocked — all calls from webchat to Auth API must be server-to-server with `INTERNAL_API_KEY`.

### Rate limiters (in-memory, lost on restart)
| Limiter | Scope | Limit |
|---|---|---|
| `rlAuthClaimIp10m` | claim/google, per IP | — |
| `rlAuthClaimIp1h` | claim/google, per IP | — |
| `rlMagicLinkUser1h` | magic-link generation, per userId | 10/hour |
| `rlRegisterIp1h` | Auth API register, per IP | 10/hour |
| `rlLoginIp1h` | Auth API login, per IP | 30/hour |

### TypeScript build
Source is in `/root/aisell/botplatform/src/`. Compiled to `/root/aisell/botplatform/dist/`. Build via `npm run build` in the `botplatform/` directory. Tests run against the live HTTP service, not compiled output.

### Pre-commit hooks / lint
`/root/aisell/botplatform/tests/test_ts_syntax.js` and `test_security_precommit.js` check for TypeScript syntax issues and security patterns. Run before committing.

---

## 9. External Libraries

### ethers.js (v6) — server-side in Auth API
**File:** `/root/aisell/botplatform/src/auth-api.ts`

Key APIs used:
- `ethers.verifyMessage(challenge: string, signature: string): string` — ecrecover, returns signer address
- `ethers.getAddress(address: string): string` — checksummed address normalization

For the invite system: no new ethers.js server-side usage needed. The existing `verifyMessage` path in `POST /api/auth/login` already validates any invitee's signature once their address is in `dashboard_access`.

### jsonwebtoken (jwt)
Used in both webchat.ts (magic link JWTs, payload `{ type: 'magic', userId, dashboardId }`) and auth-api.ts (login JWTs, payload `{ address, dashboardId }`). Magic link JWTs expire in 24h, login JWTs expire in 1h.

### @google-cloud/local-auth / google-auth-library (OAuth2Client)
Used for `POST /api/auth/google`. `client.verifyIdToken({ idToken, audience })` validates the Google JWT. No changes needed for invite system.

### PostgreSQL (pg Pool)
Connection pool (max 10) to PG on LXC 102. The three key tables (`users`, `dashboards`, `dashboard_access`) are the data model backbone for the invite system. The `dashboard_access` table already supports multi-user access via `ON CONFLICT DO NOTHING` upserts.

---

## Summary: Key Touch Points for Invite System

The backend primitive (`POST /api/auth/share`) already exists in the Auth API. The missing pieces are:

1. **A webchat-side proxy route** (e.g. `POST /api/auth/invite`) with `requireSessionApi` that validates the caller is the dashboard owner (`chatSettings.ownerAddress === ownerAddress`) and relays to `POST /api/auth/share`.

2. **Invitee registration prerequisite** — the invitee must exist in the PG `users` table (requires prior keypair flow). The invite endpoint should return a meaningful error if the invitee has not registered yet.

3. **UI surface** — a form on the `/profile` page where the owner enters an email and submits the invite.

4. **CLAUDE.md.template update** — document that dashboard access can be shared and that invited users will see overlays if not yet registered.

5. **Revocation** — not implemented in Auth API; would require a new `DELETE /api/auth/access` endpoint and a corresponding PG `dashboard_access` delete.

**Files to change:**
- `/root/aisell/botplatform/src/webchat.ts` — add proxy route, add profile UI section
- `/root/aisell/botplatform/src/auth-api.ts` — optionally add revocation endpoint
- `/root/aisell/products/simple_dashboard/CLAUDE.md.template` — document invite flow for AI context
- `/root/aisell/botplatform/tests/test_auth_api.js` — add tests for share endpoint

---

## Updated: 2026-03-04

## 10. Implementation-Level Details

This section answers 11 concrete questions required to implement the multi-user auth feature.

---

### 10.1 Magic Link Script Injection — Exact Code Block

**File:** `/root/aisell/botplatform/src/webchat.ts` lines 3778–3816

The CSP header is set at lines 3778–3788 for any `.html` / `.htm` file:

```ts
// lines 3778–3789
res.set('Content-Security-Policy',
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' cdn.tailwindcss.com cdn.jsdelivr.net; " +
  "connect-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https:; " +
  "font-src 'self' data:"
);
```

The magic link script injection is at lines 3791–3813:

```ts
// lines 3791–3813
if (filepath.endsWith('.html') || filepath.endsWith('.htm')) {
  const html = fs.readFileSync(filepath, 'utf8');
  const script = `<script>
(function(){var p=new URLSearchParams(location.search),ml=p.get('ml');if(!ml)return;
fetch('/api/auth/ml?token='+encodeURIComponent(ml)).then(function(r){return r.ok?r.json():Promise.reject();})
.then(function(d){sessionStorage.setItem('dashboard_jwt',d.jwt);
var c=document.getElementById('authDataContainer');
if(c){c.style.filter='';c.style.pointerEvents='auto';c.style.userSelect='auto';}
var o=document.getElementById('authOverlay');if(o)o.style.display='none';
history.replaceState({},'',location.pathname);}).catch(function(){});})();
</script>`;
  const injected = html.includes('</body>')
    ? html.replace('</body>', script + '</body>')
    : html + script;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(injected);
  return;
}
```

The auth-widget script injection must be added to the **same `if` block** (lines 3791–3813), alongside the magic link script, inside the same `html.replace('</body>', ...)`. The CSP header at line 3783 (`script-src`) already allows `'unsafe-inline'`, so an inline `<script id="auth-widget-loader">` will be allowed.

The `GET /api/auth/ml` handler that the injected script calls is at lines 3733–3750:

```ts
// lines 3733–3750
app.get('/api/auth/ml', (req, res) => {
  const token = typeof req.query['token'] === 'string' ? req.query['token'] : '';
  const userId = typeof req.query['userId'] === 'string' ? req.query['userId'] : '';
  const entry = magicLinkTokens.get(token);
  if (!entry || entry.expires < Date.now()) {
    res.status(401).json({ error: 'Invalid or expired magic link' });
    return;
  }
  if (userId && entry.userId !== userId) {
    res.status(403).json({ error: 'Token does not match user' });
    return;
  }
  magicLinkTokens.delete(token);
  const jwtToken = jwt.sign({ userId: entry.userId, type: 'magic' }, JWT_SECRET!, { expiresIn: '24h' });
  res.json({ jwt: jwtToken });
});
```

**Key insight:** the auth-widget script on the dashboard only needs to check `sessionStorage.getItem('dashboard_jwt')` — if present, it hides itself. If not, it shows the Google login button. Calling `/api/auth/ml` with `?ml=TOKEN` is already handled by the existing injected magic link script at lines 3797–3803, which stores `dashboard_jwt` in `sessionStorage` and hides `#authOverlay`. The auth-widget can reuse `#authOverlay` and `#authDataContainer` ids.

---

### 10.2 `POST /api/auth/google` — Exact Signature

**File:** `/root/aisell/botplatform/src/webchat.ts` lines 4867–5025

```ts
app.post('/api/auth/google', async (req, res) => {
  // rate-limited by rlAuthClaimIp10m, rlAuthClaimIp1h (keyed by IP)
  // reads: req.body.credential (Google ID Token JWT), req.body.startParam
  // uses: process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_AUTH_TEST_SECRET
  // verifies token via: new OAuth2Client(googleClientId).verifyIdToken(...)
  // then: find-or-create WebUser, create session, optionally run /start
  // response: { ok: true, user: { userId, email, name, nickname } }
```

The new handler `GET /api/auth/google-dashboard-callback` must be registered **on the same Express `app`** (port 8094, `simpledashboard.wpmix.net`) **before** the d*.wpmix.net middleware (which is registered with `app.use` at line 3503). The callback is reached via `simpledashboard.wpmix.net/api/auth/google-dashboard-callback`, not via `d*.wpmix.net`.

This new handler uses the **authorization code flow** (Google OAuth redirect), not the One Tap token flow that `POST /api/auth/google` uses. The existing handler receives a Google ID Token via a POST body (Google One Tap). The new callback handler will receive `?code=` and `?state=` query params from Google's redirect.

The existing `OAuth2Client` from `google-auth-library` already imported at line 18:
```ts
import { OAuth2Client } from 'google-auth-library';
```

The authorization code exchange requires `GOOGLE_CLIENT_SECRET` env var (not currently in `start-webchat-simpledashboard.sh` — see 10.11). For the code exchange:

```ts
const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);
const { tokens } = await client.getToken(code);
client.setCredentials(tokens);
const ticket = await client.verifyIdToken({ idToken: tokens.id_token!, audience: GOOGLE_CLIENT_ID });
const payload = ticket.getPayload();
// payload.email, payload.name, payload.email_verified
```

---

### 10.3 Google OAuth Environment Variables

**Currently set in `/root/aisell/noxonbot/.env` (sourced by `start-webchat-simpledashboard.sh`):**

- `GOOGLE_CLIENT_ID=531979133429-b20qi1v15bgoq724tfk808lr1u3a1ev2.apps.googleusercontent.com` — present, line 104 of `.env`
- `GOOGLE_AUTH_TEST_SECRET=ce6ad9...` — present in `/root/aisell/botplatform/.env.auth`

**Missing — must be added:**

- `GOOGLE_CLIENT_SECRET` — not present anywhere. Required for authorization code → token exchange in `GET /api/auth/google-dashboard-callback`. Must be retrieved from Google Cloud Console and added to `/root/aisell/noxonbot/.env` or `.env.auth`, then exported in `start-webchat-simpledashboard.sh`.

**Also needed at Google Cloud Console:** add `https://simpledashboard.wpmix.net/api/auth/google-dashboard-callback` to the authorized redirect URIs for the OAuth client `531979133429-...`.

---

### 10.4 `POST /api/auth/register-owner` — Exact Lines and Auth API Call

**File:** `/root/aisell/botplatform/src/webchat.ts` lines 5032–5114

Handler signature:
```ts
app.post('/api/auth/register-owner', requireSessionApi, async (req, res) => {
  // reads: req.body.address, req.body.privateKey, req.body.email, req.body.dashboardId
  // validates: ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/ for address
  // calls: AUTH_API_URL/api/auth/register via fetch (POST, Bearer INTERNAL_API_KEY)
  // on 201: persists chatSettings.ownerAddress + chatSettings.ownerPrivateKey via saveChatSettings
  // response: { address: ... }
```

Server-to-server call to Auth API (lines 5068–5083):
```ts
const authResp = await fetch(`${AUTH_API_URL}/api/auth/register`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${INTERNAL_API_KEY}`,
  },
  body: JSON.stringify({ address, privateKey, email, dashboardId }),
  signal: AbortSignal.timeout(10000),
});
```

Constants declared at lines 5035–5037 (module-level within the `startWebchat` function):
```ts
const AUTH_API_URL = (process.env.AUTH_API_URL || 'http://127.0.0.1:8095').replace(/\/+$/, '');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
```

For guest keypair registration in `GET /api/auth/google-dashboard-callback`, the same pattern applies: call `AUTH_API_URL/api/auth/register` with the generated keypair. The 409 response from Auth API means the email is already registered — the handler must handle this case by fetching the existing address from ChatSettings instead.

---

### 10.5 Server-Side Challenge Signing — No Existing Code in webchat.ts

**There is NO existing server-side challenge signing in `webchat.ts`.** The entire owner keypair flow today is:
1. Client-side: Chrome Extension generates keypair and calls `POST /api/auth/register-owner`
2. Dashboard JS calls `POST /api/auth/login` directly to `d*.wpmix.net` which proxies to Auth API
3. Dashboard JS signs the challenge using `window.ethereum` or the Extension

`ethers.js` is **not imported in `webchat.ts`**. The imports are:
```ts
// webchat.ts line 18
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
// no ethers import
```

`ethers.js` is only in `auth-api.ts` (line 15: `import { ethers } from 'ethers';`) for `ethers.verifyMessage` and `ethers.getAddress`.

For server-side signing in the guest flow, `webchat.ts` needs to:
1. Add `import { ethers } from 'ethers';` at the top
2. Use `ethers.Wallet.createRandom()` to generate a keypair
3. Use `wallet.signMessage(challengeString)` to sign the challenge before calling Auth API `/api/auth/login`

The challenge format expected by Auth API (from `POST /api/auth/login` handler, lines 354–380):
```ts
// challenge must be a JSON string with:
{ dashboardId: string, timestamp: number, nonce: string }
// timestamp must be within 5 minutes of now
```

So server-side signing sequence for guest:
```ts
const wallet = new ethers.Wallet(guestPrivateKey);
const challenge = JSON.stringify({ dashboardId, timestamp: Date.now(), nonce: crypto.randomBytes(16).toString('hex') });
const signature = await wallet.signMessage(challenge);
// POST to d{userId}.wpmix.net/api/auth/login (or directly to AUTH_API_URL/api/auth/login)
const loginResp = await fetch(`${AUTH_API_URL}/api/auth/login`, { ... body: { signature, challenge, dashboardId } });
const { token } = await loginResp.json();
```

The `guestPrivateKey` for the guest comes from `ChatSettings.ownerPrivateKey` of the **guest's own ChatSettings** (keyed by guest's `userId`), not from the dashboard owner's ChatSettings.

**Note:** `dashboard_auth-api` process at port 8095 handles `POST /api/auth/login`. The `d*.wpmix.net` middleware proxies it to 8095 (line 3524–3538). The `GET /api/auth/google-dashboard-callback` handler in webchat at port 8094 can call `AUTH_API_URL/api/auth/login` directly server-to-server, bypassing the proxy.

---

### 10.6 `GET /profile` — Exact Lines

**File:** `/root/aisell/botplatform/src/webchat.ts` lines 5167–5284

```ts
app.get('/profile', requireSessionPage, (req, res) => {
  const user = getReqUser(req);
  const chatSettings = loadChatSettings(user.userId);
  const ownerAddress = chatSettings.ownerAddress || '';
  const ownerPrivateKey = chatSettings.ownerPrivateKey || '';
  // ...
  res.end(`<!doctype html>...`);
});
```

The profile page HTML ends at line 5284 with `</html>\``). The "Share Dashboard" section must be added inside the `<div class="card">` block.

Current sections inside the card (lines 5210–5240):
- User info rows (userId, name, email, nickname, domain, wallet address, private key) — lines 5210–5218
- `#mobile-section` div (QR code for magic link) — lines 5220–5234
- "Back to chat / Logout" link row — line 5236
- `.danger-zone` (Delete account button) — lines 5237–5239

The "Share Dashboard" section should be added **between** `#mobile-section` (ends line 5234) and the "Back to chat" row (line 5236). It needs:
- A CSS class (e.g., `.share-section`) following the same pattern as `.mobile-section` (line 5194–5206)
- A `POST /api/auth/invite` fetch call
- A revoke button calling `POST /api/auth/invite/revoke`
- The section should only render if `ownerAddress` is set (dashboard is auth-protected)

---

### 10.7 `sweepTimer` and `allLimiters` — Where to Add Invite Rate Limiter

**File:** `/root/aisell/botplatform/src/webchat.ts` lines 3924–3955

The `allLimiters` array is at lines 3924–3943:
```ts
const allLimiters = [
  rlGlobalIp1m,
  rlDownloadIp1m,
  rlAuthClaimIp10m,
  rlAuthClaimIp1h,
  rlMessageUser1m,
  rlMessageUser10s,
  rlMessageIp10s,
  rlMessageIp10m,
  rlCallbackUser10s,
  rlCallbackUser10m,
  rlCallbackIp10s,
  rlCallbackIp10m,
  rlFeedbackUser10s,
  rlFeedbackUser1h,
  rlFeedbackIp10s,
  rlFeedbackIp1h,
  rlFetchUser1m,
  rlMagicLinkUser1h,
];
```

The `sweepTimer` at lines 3946–3954:
```ts
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const limiter of allLimiters) {
    limiter.sweep(now);
  }
  for (const [k, v] of magicLinkTokens) {
    if (v.expires < now) magicLinkTokens.delete(k);
  }
}, 60 * 1000);
sweepTimer.unref?.();
```

To add the invite rate limiter (20 invites/hour/userId per spec):
1. Declare before `allLimiters`: `const rlInviteUser1h = new SlidingWindowRateLimiter('invite:user:1h', 60 * 60 * 1000, 20);`
2. Add `rlInviteUser1h` to the `allLimiters` array

The `inviteTokens` Map (analogous to `magicLinkTokens`) does not need TTL sweeping since it has no expiry — it is keyed by `dashboardUserId` with one token per dashboard, revoked explicitly. The `invites.json` persistence means the Map can be rehydrated on restart.

---

### 10.8 `/api/data/` Handler — Exact Lines for JWT Auth Enforcement

**File:** `/root/aisell/botplatform/src/webchat.ts` lines 3541–3611

The handler starts at line 3542:
```ts
if (req.path.startsWith('/api/data/')) {
  const parts = req.path.slice('/api/data/'.length).split('/');
  const collection = parts[0];
  const itemId = parts[1];
  // validates collection name, builds filePath
  // readCollection(): fs.readFileSync(...) → JSON.parse
  // writeCollection(data): fs.mkdirSync + fs.writeFileSync (NOT writeJsonAtomic)
  // GET, POST, PUT, DELETE, DELETE (clear) handlers
```

Currently **no auth check** exists in this block. Auth enforcement must be added immediately after line 3550 (after the `collection` name validation), checking for `Authorization: Bearer <dashboard_jwt>` or `sessionStorage` is browser-side so must use the `Authorization` header:

```ts
// Insert after collection name validation (after line 3550):
const authHeader = req.headers['authorization'] || '';
const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
if (!bearerToken) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}
// Verify JWT: jwt.verify(bearerToken, JWT_SECRET) → { dashboardId, address }
// Verify dashboardId matches `d${userId}` pattern
```

The `JWT_SECRET` used for signing magic link JWTs is available within the d*.wpmix.net middleware scope — it was used at line 3799 area. However `JWT_SECRET` is referenced via `process.env.JWT_SECRET` in the middleware setup. The dashboard JWT (issued by Auth API at line 407 of `auth-api.ts`) uses the same `JWT_SECRET`.

The `writeCollection` function at line 3566 uses `fs.writeFileSync` directly (not `writeJsonAtomic`). This is intentional — collection data is in the user folder, not in the shared `data/webchat/` directory.

---

### 10.9 `invites.json` Read/Write Pattern — Reference from Existing Files

**Existing files in `/root/aisell/botplatform/data/webchat/`:**
- `sessions.json` — array of `WebSession` objects
- `users.json` — array of `WebUser` objects
- `state.json` — object `{ nextUserId: number }`
- `pending_logins.json` — (exists on disk)

**Pattern from `readSessions` / `writeSessions` (lines 523–530):**
```ts
const SESSIONS_PATH = path.join(WEBCHAT_DATA_DIR, 'sessions.json');

function readSessions(): WebSession[] {
  const sessions = readJsonFile<unknown>(SESSIONS_PATH, []);
  return Array.isArray(sessions) ? (sessions as WebSession[]) : [];
}

function writeSessions(sessions: WebSession[]): void {
  writeJsonAtomic(SESSIONS_PATH, sessions);
}
```

For `invites.json`, the pattern to follow:
```ts
const INVITES_PATH = path.join(WEBCHAT_DATA_DIR, 'invites.json');

type InviteRecord = { dashboardUserId: string; token: string };

function readInvites(): InviteRecord[] {
  const invites = readJsonFile<unknown>(INVITES_PATH, []);
  return Array.isArray(invites) ? (invites as InviteRecord[]) : [];
}

function writeInvites(invites: InviteRecord[]): void {
  writeJsonAtomic(INVITES_PATH, invites);
}
```

At startup (line 3474 area, `ensureDir(WEBCHAT_DATA_DIR)` is already called), the in-memory `inviteTokens = new Map<string, string>()` (dashboardUserId → token) should be populated from `readInvites()`:
```ts
const inviteTokens = new Map<string, string>();
for (const r of readInvites()) inviteTokens.set(r.dashboardUserId, r.token);
```

`writeJsonAtomic` already handles atomic rename (temp file → target), so `writeInvites` is safe against partial writes.

---

### 10.10 ethers.js in webchat.ts — Not Present, Must Be Added

`ethers.js` is **not imported in `/root/aisell/botplatform/src/webchat.ts`**. The file imports are (lines 1–21):
```ts
import express from 'express';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dns from 'dns';
import * as dotenv from 'dotenv';
import * as Sentry from '@sentry/node';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import type { Context } from 'telegraf';
import { NoxonBot, loadConfig, loadChatSettings, saveChatSettings } from './bot';
```

The `ethers` package is already in `package.json` (`"ethers": "^6.16.0"`), so no `npm install` is needed.

To add server-side keypair generation and signing, insert at the top imports:
```ts
import { ethers } from 'ethers';
```

ethers v6 API for keypair generation:
```ts
const wallet = ethers.Wallet.createRandom();
// wallet.address → "0x..." (checksummed)
// wallet.privateKey → "0x..." (32-byte hex)
const signature = await wallet.signMessage(challengeString);
```

For signing with an existing private key from ChatSettings:
```ts
const wallet = new ethers.Wallet(guestPrivateKey);
const signature = await wallet.signMessage(challengeString);
```

---

### 10.11 `GOOGLE_CLIENT_SECRET` Env Var — Not Yet in start-webchat-simpledashboard.sh

**File:** `/root/aisell/botplatform/start-webchat-simpledashboard.sh`

The script sources `/root/aisell/noxonbot/.env` (which has `GOOGLE_CLIENT_ID`) and `/root/aisell/botplatform/.env.auth` (which has `INTERNAL_API_KEY`, `JWT_SECRET`, `GOOGLE_AUTH_TEST_SECRET`).

`GOOGLE_CLIENT_SECRET` is **not present** in either file. It is required for the authorization code flow in `GET /api/auth/google-dashboard-callback` (`OAuth2Client.getToken(code)` call).

`GOOGLE_CLIENT_ID` is already available at process startup via the sourced `.env`. The new `google-dashboard-callback` handler can read it as `process.env.GOOGLE_CLIENT_ID` — same as the existing `POST /api/auth/google` handler at line 4879.

**Steps to enable:**
1. Retrieve the client secret from Google Cloud Console for client `531979133429-b20qi1v15bgoq724tfk808lr1u3a1ev2.apps.googleusercontent.com`
2. Add `GOOGLE_CLIENT_SECRET=<value>` to `/root/aisell/noxonbot/.env` or `/root/aisell/botplatform/.env.auth`
3. Add the redirect URI `https://simpledashboard.wpmix.net/api/auth/google-dashboard-callback` to the OAuth client's authorized redirect URIs in Google Cloud Console
4. No changes needed to `start-webchat-simpledashboard.sh` since `.env` is already sourced with `set -a`

---

### 10.12 Summary Table: What Must Change and Where

| Item | File | Lines | Change |
|------|------|-------|--------|
| Add `import { ethers }` | `webchat.ts` | line 18 area | New import |
| Add `INVITES_PATH` constant | `webchat.ts` | line 68 area | After `SESSIONS_PATH` |
| Add `InviteRecord` type + `readInvites`/`writeInvites` | `webchat.ts` | line 530 area | After `writeSessions` |
| Populate `inviteTokens` Map from disk at startup | `webchat.ts` | line 3474 area | After `ensureDir(WEBCHAT_DATA_DIR)` |
| Add `rlInviteUser1h` limiter | `webchat.ts` | line 3916 area | After `rlMagicLinkUser1h` |
| Add `rlInviteUser1h` to `allLimiters` | `webchat.ts` | line 3942 | Append to array |
| Auth widget script injection | `webchat.ts` | line 3805 area | Inside the `html.replace('</body>', ...)` call |
| Add `GET /api/auth/google-dashboard-callback` | `webchat.ts` | before line 3503 | New route, before d*.wpmix.net middleware |
| Add JWT auth check in `/api/data/` | `webchat.ts` | line 3550 area | After collection name validation |
| Add `POST /api/auth/invite` | `webchat.ts` | after line 5165 | After magic-link endpoint |
| Add `POST /api/auth/invite/revoke` | `webchat.ts` | after invite endpoint | Adjacent |
| Add "Share Dashboard" section to `/profile` | `webchat.ts` | line 5234 area | After `#mobile-section` |
| Add `GOOGLE_CLIENT_SECRET` to env | `.env.auth` or `noxonbot/.env` | — | New env var |
| Add redirect URI | Google Cloud Console | — | Config change |
