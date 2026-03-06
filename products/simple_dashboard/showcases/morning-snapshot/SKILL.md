# Morning Briefing Dashboard

## Что это

Утренний дашборд для руководителя бизнеса: все ключевые метрики до первого кофе. Тёмная тема, компактный single-screen layout. 2 страницы.

**Live demo:** https://simpledashboard.wpmix.net/showcases/morning-snapshot/demo

## Как воспроизвести

Промпт для генерации:

> Build a morning briefing dashboard for a business owner: key metrics at a glance — yesterday's revenue vs plan, new leads, conversion rate, today's top 5 tasks, cash flow balance, and a 7-day revenue sparkline. Dark theme, compact single-screen layout. 2 pages: Morning Snapshot (the main briefing), Weekly Trends (7-day charts).

## Ключевые особенности

- **Компактный single-screen:** все данные без скролла на одном экране
- **4 KPI карточки:** вчерашняя выручка, новые лиды, конверсия, баланс кэша
- **Sparkline:** 7-дневный тренд без осей — только форма кривой
- **Топ-5 задач:** чеклист с первыми двумя выполненными
- **3 алерта:** success (зелёный), warning (жёлтый), info (синий)
- **Тёмная тема:** body `#0f172a`, карточки `rgba(30,41,59,0.8)`

## Страницы (2)

| Страница | Содержимое |
|----------|-----------|
| Morning Snapshot | 4 KPI + sparkline (50%) + task checklist (50%) + 3 alert cards |
| Weekly Trends | 3 KPI, 7-day revenue line chart, 7-day leads bar chart |

## Бизнес-контекст

Целевая аудитория: руководители малого бизнеса которые утром открывают 5-8 вкладок чтобы понять состояние бизнеса. Этот дашборд заменяет все вкладки одним экраном.

## Как адаптировать

- Заменить 4 KPI на свои (выручка, расходы, клиенты, заявки)
- Настроить список задач через Google Sheets
- Изменить алерты на реальные уведомления (просроченные счета, новые лиды)
- Добавить 3-ю страницу с деталями по конкретному направлению
