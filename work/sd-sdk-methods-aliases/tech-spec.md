---
created: YYYY-MM-DD
status: draft | approved
branch: dev | feature/{feature-name}
size: S | M | L
---

# Tech Spec: {Feature Name}

## Solution

Technical approach. (Длина зависит от задачи — без ограничений.)

## Architecture

### What we're building/modifying

- **Component A** — purpose
- **Component B** — purpose

### How it works

Data flow, interactions, sequence.

## Decisions

### Decision 1: [topic]
**Decision:** what we chose
**Rationale:** why
**Alternatives considered:** what else, why rejected

### Decision 2: ...

## Data Models

DB schemas, interfaces, types. Skip if N/A.

## Dependencies

### New packages
- `package-name` — purpose

### Using existing (from project)
- `module-name` — how

## Testing Strategy

**Feature size:** S / M / L

### Unit tests
- Scenario 1: what we test
- Scenario 2: ...

### Integration tests
- Scenario 1 (if M/L feature, or if needed)
- "None" (if S feature and agreed with user)

### E2E tests
- Critical flow 1 (if L feature)
- "None" (if S/M and not needed)

## Agent Verification Plan

**Source:** user-spec "Как проверить" section.

### Verification approach
How agent verifies beyond automated tests.

### Per-task verification
| Task | verify: | What to check |
|------|---------|--------------|
| 1    | curl    | GET /api → 200 |
| 3    | bash    | run command, check output |

### Tools required
Playwright MCP, Telegram MCP, curl, bash — which are needed.

## Risks

| Risk | Mitigation |
|------|-----------|
| Risk 1 | What we do |

## Acceptance Criteria

Технические критерии приёмки (дополняют пользовательские из user-spec):

- [ ] API возвращает корректные коды ответов (200, 201, 400, 404, 500)
- [ ] Миграции БД применяются и откатываются без ошибок
- [ ] Все тесты проходят (unit, integration если есть)
- [ ] Нет регрессий в существующих тестах
- [ ] ...

## Implementation Tasks

<!-- Tasks are brief scope descriptions. AC, TDD, and detailed steps are created during task-decomposition. -->

### Wave 1 (независимые)

#### Task 1: [Name]
- **Description:** Создать REST-эндпоинт для регистрации пользователей. Нужен для MVP авторизации. Результат: POST /api/users возвращает 201.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** curl — POST /api/users → 201
- **Files to modify:** `src/api/users.ts`, `src/models/user.ts`
- **Files to read:** `src/api/index.ts`, `src/middleware/auth.ts`

#### Task 2: [Name]
- **Description:** Добавить форму создания пользователя (name, email, role). Связывает UI с API из Task 1. Результат: заполненная форма отправляет POST /api/users.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, test-reviewer
- **Verify:** user — пользователь проверяет UI
- **Files to modify:** `src/components/UserForm.tsx`
- **Files to read:** `src/components/BaseForm.tsx`, `src/hooks/useValidation.ts`

### Wave 2 (зависит от Wave 1)

#### Task 3: [Name]
- **Description:** Интегрировать отправку welcome-email при создании пользователя. Асинхронно, не блокирует основной flow. Результат: после POST /api/users уходит email.
- **Skill:** code-writing
- **Reviewers:** code-reviewer, security-auditor, test-reviewer
- **Verify:** bash — npm test
- **Files to modify:** `src/services/notification.ts`
- **Files to read:** `src/api/users.ts`, `src/config/services.ts`

### Final Wave

<!-- QA is always present. Deploy and Post-deploy — only if applicable for this feature. -->

#### Task N: Pre-deploy QA
- **Description:** Acceptance testing: run all tests, verify acceptance criteria from user-spec and tech-spec
- **Skill:** pre-deploy-qa
- **Reviewers:** none

#### Task N+1: Deploy (if applicable)
- **Description:** Deploy + verify logs
- **Skill:** infrastructure
- **Reviewers:** none

#### Task N+2: Post-deploy verification (if applicable)
- **Description:** Live environment verification via MCP tools from Agent Verification Plan
- **Skill:** post-deploy-qa
- **Reviewers:** none
