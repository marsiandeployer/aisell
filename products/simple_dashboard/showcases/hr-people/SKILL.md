# HR People Analytics Dashboard

## Что это

Дашборд HR-аналитики: численность, воронка найма, текучесть и метрики команд. 4 страницы.

**Live demo:** https://simpledashboard.wpmix.net/showcases/hr-people/demo

## Как воспроизвести

Промпт для генерации:

> Build an HR people analytics dashboard: headcount trend by department, hiring funnel (applied→hired), turnover rate by month, exit reasons breakdown, team health metrics. 4 pages: Overview (headcount + departments), Hiring (funnel + time-to-hire), Retention (turnover + exit reasons), Teams (size + status breakdown).

## Ключевые особенности

- **Воронка найма** — applied → screened → interviewed → offered → hired
- **Текучесть** — динамика по месяцам + причины увольнений
- **Численность по отделам** — bar chart с 6 отделами
- **Цветовая схема:** purple

## Страницы (4)

| Страница | Содержимое |
|----------|-----------|
| Overview | Headcount, turnover, open positions, tenure KPIs + trend + dept bar |
| Hiring | Time-to-hire, cost-per-hire, offer acceptance KPIs + funnel + TTH bar |
| Retention | Monthly attrition, exits KPIs + turnover bar + exit reasons pie |
| Teams | Departments, avg size, sick days KPIs + team bar + status doughnut |

## Бизнес-контекст

Целевая аудитория: HR-менеджеры и CHRO компаний 50-500 человек которые строят аналитику в Excel.

## Как адаптировать

- Импортировать данные из HRIS (1C:ЗУП, BambooHR, Workday)
- Настроить отделы под структуру компании
- Добавить страницу Performance (оценки, KPI)
