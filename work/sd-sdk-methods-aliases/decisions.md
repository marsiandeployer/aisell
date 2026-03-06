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
