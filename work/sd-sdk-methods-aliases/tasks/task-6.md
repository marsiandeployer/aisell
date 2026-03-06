---
status: planned
depends_on: [5]
wave: 5
skills: [post-deploy-qa]
verify: user
reviewers: []
teammate_name: qa-post
---

# Task 6: Post-deploy verification

## Description

Верификация на живом окружении после деплоя.

## What to do

1. Проверить `GET /api/data/members/{id}` → объект, не массив:
   ```bash
   # Получить ID из коллекции
   curl -s https://d9000000000281.wpmix.net/api/data/members | head -c 200
   ```
2. Проверить что `simpledashboard-web` отдаёт обновлённый SDK:
   ```bash
   curl -s https://simpledashboard.wpmix.net/sdk/auth.js | grep -c "upsert"
   ```
3. Открыть `https://d9000000000281.wpmix.net` — список участников загружается
4. Проверить удаление участника без ошибки

## Acceptance Criteria

- [ ] `/sdk/auth.js` содержит `upsert` (новые методы задеплоены)
- [ ] Dashboard 281 работает: список виден, удаление без ошибки
- [ ] Нет 500 ошибок в логах

## Verification Steps

- `curl -s https://simpledashboard.wpmix.net/sdk/auth.js | grep "upsert"` → должно найти
- Ручная проверка dashboard 281
