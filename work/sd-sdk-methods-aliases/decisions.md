# Decisions Log: sd-sdk-methods-aliases

Отчёты агентов о выполнении задач. Каждая запись создаётся агентом, выполнившим задачу.

---

<!-- Записи добавляются агентами по мере выполнения задач.

Формат строгий — используй только эти секции, не добавляй другие.
Не включай: списки файлов, таблицы файндингов, JSON-отчёты, пошаговые логи.
Детали ревью — в JSON-файлах по ссылкам. QA-отчёт — в logs/working/.

## Task N: [название]

**Status:** Done
**Commit:** abc1234
**Agent:** [имя тиммейта или "основной агент"]
**Summary:** 1-3 предложения: что сделано, ключевые решения. Не список файлов.
**Deviations:** Нет / Отклонились от спека: [причина], сделали [что].

**Reviews:**

*Round 1:*
- code-reviewer: 2 findings → [logs/working/task-N/code-reviewer-1.json]
- security-auditor: OK → [logs/working/task-N/security-auditor-1.json]

*Round 2 (после исправлений):*
- code-reviewer: OK → [logs/working/task-N/code-reviewer-2.json]

**Verification:**
- `npm test` → 42 passed
- Manual check → OK

-->

## Task 1: Расширить webchat.ts — SDK методы + backend handler

**Status:** Done
**Commit:** 98b4bab
**Agent:** coder-webchat
**Summary:** Added 5 aliases (list/create/update/patch/delete) to SD.data, two new methods (getOne for single-item fetch, upsert for idempotent create-or-update), and two SD.admin methods (getMembers with isOwner enrichment, removeMember with owner guard + atomic del + revokeAccess). Extended backend GET handler to return single item by id or null. All changes backward-compatible; npm run build passes cleanly.
**Deviations:** Нет — реализация полностью соответствует спеку.

**Reviews:**

*Round 1:*
- code-reviewer: OK → [logs/working/task-1/code-reviewer-round1.json]
- security-auditor: OK → [logs/working/task-1/security-auditor-round1.json]
- test-reviewer: OK → [logs/working/task-1/test-reviewer-round1.json]

**Verification:**
- `npm run build` → 0 errors (TypeScript compilation clean)
- Pre-commit hooks → 67/67 checks passed (structure, templates, TS, security, linters)

## Task 2: Тест-файл tests/test_sdk_methods.js

**Status:** Done
**Commit:** 3c7ce8c
**Agent:** coder-tests
**Summary:** Created `botplatform/tests/test_sdk_methods.js` with 85 integration test assertions across 7 groups: backward compat (GET/POST/PUT/DELETE lifecycle), aliases (list/create/update/patch/delete equivalence), getOne (single object return + null for missing), upsert (client-side GET+find+PUT/POST pattern with deduplication check), getMembers (collection CRUD + real members access), removeMember (add+find+delete+verify), and status codes (201/200/400/401/404). Server restart was required after Task 1 build for getOne endpoint to work.
**Deviations:** Нет — реализация соответствует спеку. getMembers/removeMember tested at HTTP level only (isOwner enrichment and owner guard are client-side SDK logic).

**Reviews:**

*Round 1:*
- code-reviewer: OK → [logs/working/task-2/code-reviewer-round1.json]
- test-reviewer: OK → [logs/working/task-2/test-reviewer-round1.json]

**Verification:**
- `node tests/test_sdk_methods.js` → 85/85 passed, exit 0
- `node tests/test_webchat_keypair.js` → 16/16 passed (backward compat OK)
- Pre-commit hooks → all checks passed (67/67)

## Task 3: SKILL.md обновление + dashboard 281 fix + уникальность в sd:auth

**Status:** Done
**Commit:** d5062c4
**Agent:** coder-docs
**Summary:** Updated SKILL.md API reference to document new primary methods (list/create/update/patch/delete/getOne/upsert) and mark old ones (get/post/put/del) as deprecated. Replaced the sd:auth community pattern with SD.data.upsert to prevent duplicate member entries on repeated logins. Added SD.admin.getMembers() and SD.admin.removeMember(email) documentation. Fixed dashboard 281 (gitignored live file) to use upsert in sd:auth, SD.admin.getMembers() in loadMembers, and SD.admin.removeMember(email) in deleteMember.
**Deviations:** Dashboard 281 index.html is in .gitignore (user data directory) so changes are saved to disk but not committed to git. This is expected behavior.

**Reviews:**

*Round 1:*
- code-reviewer: OK → [logs/working/task-3/code-reviewer-round1.json]

**Verification:**
- Pre-commit hooks → all checks passed (security, linters, showcase validators)
- Dashboard 281: manual verification needed at https://d9000000000281.wpmix.net

## Task 4: Pre-deploy QA

**Status:** Done
**Commit:** N/A (QA-only task, no code changes)
**Agent:** qa-runner
**Summary:** Full acceptance testing of Tasks 1–3 changes. npm run build passed clean (0 TypeScript errors). All three test suites ran green after fresh service restarts: test_sdk_methods.js 85/85, test_webchat_keypair.js 16/16, test_auth_api.js 47/47. PM2 logs for simpledashboard-web show no new errors — only expected test-time 503s from Auth API rate-limit test scenario in test_webchat_keypair.js, which is correct behavior.
**Deviations:** Per project memory, test_auth_api.js was preceded by a pm2 restart dashboard-auth-api to avoid in-memory rate limiter exhaustion from prior test runs. This matches the documented gotcha in MEMORY.md and task instructions.

**Reviews:** N/A (QA task)

**Verification:**
- `npm run build` → 0 errors
- `node tests/test_sdk_methods.js` → 85/85 passed
- `node tests/test_webchat_keypair.js` → 16/16 passed
- `node tests/test_auth_api.js` → 47/47 passed (47 passed, 0 failed, 100% success rate)
- `pm2 logs simpledashboard-web` → no unexpected errors, service healthy

## Task 5: Deploy

**Status:** Done
**Commit:** (push of 9 accumulated commits from tasks 1–4)
**Agent:** deployer
**Summary:** Built botplatform TypeScript (tsc, 0 errors), restarted simpledashboard-web PM2 process (id 32, restart #109), verified startup clean — "Webchat listening on http://0.0.0.0:8094". Pushed 9 commits to origin/main. No GitHub Actions workflows present in repository, so CI check skipped.
**Deviations:** No separate "feat(sdk): add method aliases" commit was needed — all code changes were already committed by tasks 1–3. The decisions.md and task-4.md staged modifications were committed together with the push of existing branch commits.

**Reviews:** N/A (deploy task)

**Verification:**
- `npm run build` → 0 errors (TypeScript compilation clean)
- `pm2 restart simpledashboard-web` → online, uptime 0s, status online
- `pm2 logs simpledashboard-web --lines 20` → "Webchat listening on http://0.0.0.0:8094", no crash
- `git push origin main` → 9 commits pushed successfully
