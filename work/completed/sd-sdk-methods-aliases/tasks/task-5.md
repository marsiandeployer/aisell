---
status: done
depends_on: [4]
wave: 4
skills: [deploy-pipeline]
verify: bash
reviewers: []
teammate_name: deployer
---

# Task 5: Deploy

## Description

Сборка и деплой на production.

## What to do

1. `cd /root/aisell/botplatform && npm run build`
2. `pm2 restart simpledashboard-web --update-env`
3. `timeout 10s pm2 logs simpledashboard-web --lines 30 --nostream` — нет ошибок
4. `git add -A && git commit -m "feat(sdk): add method aliases getOne upsert getMembers removeMember"`
5. `git push origin main`

## Acceptance Criteria

- [ ] PM2 процесс запущен и стабилен
- [ ] Нет ошибок в логах после рестарта
- [ ] Код закоммичен и запушен

## Verification Steps

- `pm2 status simpledashboard-web` — online
- `timeout 10s pm2 logs simpledashboard-web --lines 20 --nostream` — нет crash
