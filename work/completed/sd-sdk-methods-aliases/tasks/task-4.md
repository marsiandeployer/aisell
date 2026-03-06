---
status: done
depends_on: [1, 2, 3]
wave: 3
skills: [pre-deploy-qa]
verify: bash
reviewers: []
teammate_name: qa-runner
---

# Task 4: Pre-deploy QA

## Required Skills

Перед выполнением задачи загрузи:
- `/skill:pre-deploy-qa` — [skills/pre-deploy-qa/SKILL.md](~/.claude/skills/pre-deploy-qa/SKILL.md)

## Description

Acceptance testing перед деплоем. Запустить тесты и проверить все критерии приёмки из user-spec и tech-spec.

## What to do

1. `cd /root/aisell/botplatform && npm run build` — должно проходить без ошибок
2. Перезапустить сервисы чтобы свежий код активировался: `pm2 restart simpledashboard-web dashboard-auth-api --update-env && sleep 3`
3. Загрузить переменные: `export $(cat .env.auth | xargs)`
4. Запустить тесты:
   ```bash
   node tests/test_sdk_methods.js
   node tests/test_webchat_keypair.js
   node tests/test_auth_api.js
   ```
5. Проверить логи: `timeout 10s pm2 logs simpledashboard-web --lines 30 --nostream`
6. Верифицировать acceptance criteria из tech-spec

## Acceptance Criteria

- [ ] `npm run build` — 0 ошибок
- [ ] `node tests/test_sdk_methods.js` — все тесты зелёные
- [ ] `node tests/test_webchat_keypair.js` — нет регрессий
- [ ] `node tests/test_auth_api.js` — нет регрессий
- [ ] PM2 логи — нет ошибок

## Context Files

- [user-spec.md](../user-spec.md)
- [tech-spec.md](../tech-spec.md)

## Verification Steps

- Шаг 1: все тесты зелёные
- Шаг 2: нет ошибок в логах

## Details

**Dependencies:** Tasks 1, 2, 3 должны быть выполнены

## Post-completion

- [ ] Записать краткий отчёт в decisions.md
