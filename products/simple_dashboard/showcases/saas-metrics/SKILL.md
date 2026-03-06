# SaaS Metrics Dashboard

## Что это

Дашборд SaaS-метрик: MRR, ARR, churn, LTV/CAC, когортный анализ. Замена Baremetrics/ChartMogul. 4 страницы.

**Live demo:** https://simpledashboard.wpmix.net/showcases/saas-metrics/demo

## Как воспроизвести

Промпт для генерации:

> Build a SaaS metrics dashboard: MRR/ARR trend, churn rate, LTV and CAC comparison, trial-to-paid conversion funnel, cohort retention heatmap. 4 pages: Overview (MRR + customers), Growth (waterfall + cohorts), Acquisition (CAC/LTV + funnel), Health (DAU/MAU + plan distribution).

## Ключевые особенности

- **MRR waterfall** — new/expansion/churned/net new MRR за месяц
- **Когортная таблица** — 6 когорт × 6 месяцев, цвет от зелёного к красному
- **LTV/CAC сравнение** — bar chart с ratios
- **Цветовая схема:** emerald/green

## Страницы (4)

| Страница | Содержимое |
|----------|-----------|
| Overview | MRR, ARR, customers, churn KPIs + MRR trend + customer growth |
| Growth | New/expansion/churned MRR KPIs + MRR waterfall + cohort retention |
| Acquisition | CAC, LTV, LTV:CAC, trial→paid KPIs + comparison bar + funnel |
| Health | DAU, MAU, DAU/MAU, NPS KPIs + DAU line + plan distribution doughnut |

## Бизнес-контекст

Целевая аудитория: micro-SaaS основатели которые платят $100+/мес за Baremetrics или ChartMogul при 10-50 клиентах.

## Как адаптировать

- Подключить Stripe webhook → Google Sheets → дашборд
- Настроить cohort по реальным датам подписок
- Добавить страницу Customers с drill-down по аккаунтам
