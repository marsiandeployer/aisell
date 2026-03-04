# Execution Plan: Multi-User Dashboard Access (Guest Mode)

**Создан:** 2026-03-04
**Feature:** work/multi-user-auth
**Branch:** feature/multi-user-auth

---

## Уже выполнено (Waves 1–6)

| Task | Название | Статус |
|------|----------|--------|
| 2 | CLAUDE.md.template — guest auth docs | ✅ completed |
| 3 | webchat.ts foundation — invite storage + ethers + rate limiters | ✅ completed |
| 4 | auth-api.ts — GET /api/auth/access-list | ✅ completed |
| 5 | POST /api/auth/invite + revoke | ✅ completed |
| 6 | GET /api/auth/google-dashboard-callback | ✅ completed |
| 7 | JWT enforcement on /api/data/ | ✅ completed |
| 8 | GET /api/auth/invite/status | ✅ completed |

---

## Wave 7 ✅ COMPLETED

| Task | Название | Статус |
|------|----------|--------|
| 9 | Auth widget script injection в d*.wpmix.net HTML | ✅ done (34/34 tests pass) |
| 11 | test_invite_flow.js | ✅ done (35/35 tests pass) |
| 13 | test_server_side_keypair.js | ✅ done (29/0/2 pass/fail/skip + bug fix in ml-token) |

---

## Wave 8 ✅ COMPLETED

| Task | Название | Статус |
|------|----------|--------|
| 10 | Profile "Поделиться дашбордом" section | ✅ done (13/13 tests pass, private key removed) |
| 12 | test_guest_auth_widget.js | ✅ done (34/34 tests pass) |

---

## Wave 9: Pre-deploy QA (Task 14)

- **Skill:** pre-deploy-qa
- **Verify:** все тест-файлы exit 0; `npm run build` exit 0

---

## Wave 10: Deploy (Task 15)

- **Skill:** deploy-pipeline
- **Verify:** `pm2 status simpledashboard-web` online; логи чистые

---

## Проверки, требующие участия пользователя

- [ ] **Task 1 (GOOGLE_CLIENT_SECRET)**: Нужно открыть Google Cloud Console и предоставить секрет для OAuth client `531979133429-b20qi1v15bgoq724tfk808lr1u3a1ev2`. Также зарегистрировать redirect URI: `https://simpledashboard.wpmix.net/api/auth/google-dashboard-callback`. **Без этого реальный OAuth flow не будет работать (тесты работают через GOOGLE_AUTH_TEST_SECRET bypass).**
- [ ] После Wave 10: финальная проверка invite flow на production (отправить invite ссылку реальному пользователю).
