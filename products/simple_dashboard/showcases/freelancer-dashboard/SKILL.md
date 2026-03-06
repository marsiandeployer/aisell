# Freelancer Business Dashboard

## Что это

Дашборд для управления фриланс-бизнесом: доходы, проекты, учёт времени и счета на одном экране. 4 страницы с JIT-данными.

**Live demo:** https://simpledashboard.wpmix.net/showcases/freelancer-dashboard/demo

## Как воспроизвести

Промпт для генерации:

> Build a freelancer business dashboard: monthly income trend, active projects by status, time tracker (hours by project), unpaid invoices list, pipeline of incoming deals. 4 pages: Overview (income + KPIs), Projects (status board + workload), Time (hours logged by project/week), Invoices (list with status + totals).

## Ключевые особенности

- **12-месячный тренд дохода** с реалистичным ростом
- **6-7 проектов** с бюджетами $2k–$15k, статусами, дедлайнами
- **30 дней лог часов** с разбивкой billable/non-billable
- **10 счетов** с цветными статусами: Paid (зелёный), Unpaid (жёлтый), Overdue (красный)
- **Цветовая схема:** violet/purple

## Страницы (4)

| Страница | Содержимое |
|----------|-----------|
| Overview | KPI (4), monthly income line chart, income by client doughnut, projects by status bar |
| Projects | KPI (4), таблица проектов с баджами статусов, revenue by client horizontal bar |
| Time | KPI (3), hours by project bar chart, daily hours 30 days line chart, time log table |
| Invoices | KPI (4), invoice status doughnut, таблица счетов с цветными статусами |

## Бизнес-контекст

Целевая аудитория: фрилансеры которые платят $100+/мес за стек из CRM + invoicing + time tracking. SimpleDashboard заменяет 3 инструмента за 5 000 ₽/мес.

## Как адаптировать

- Добавить реальные клиенты вместо демо-данных
- Подключить Google Sheets для автообновления часов
- Настроить currency (USD → EUR, RUB, и т.д.)
- Добавить страницу Tax (подсчёт налогов по выплатам)
