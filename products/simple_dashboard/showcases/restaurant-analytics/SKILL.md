# Restaurant Analytics Dashboard

## Что это

Дашборд аналитики для ресторана или кафе. 4 страницы: выручка, топ блюд, тепловая карта часов пик, финансовые показатели.

**Live demo:** https://simpledashboard.wpmix.net/showcases/restaurant-analytics/demo

## Как воспроизвести

Промпт для генерации:

> Build a restaurant analytics dashboard: daily revenue trend (30 days), top menu items by orders (horizontal bar chart), hourly traffic heatmap (6am-11pm), food cost % by category, average check trend, revenue by category (doughnut). 4 navigation pages: Overview, Menu, Peak Hours, Finance.

## Ключевые особенности

- **30-дневный тренд выручки** с реалистичными недельными паттернами (weekend boost)
- **Топ-15 блюд** с количеством заказов, выручкой и маржой
- **Тепловая карта часов пик** (18 часов × 7 дней), цвет от белого до красного
- **Food Cost %** по категориям (еда, кофе, десерты, алкоголь)
- **Цветовая схема:** amber/orange (тёплая ресторанная гамма)

## Страницы (4)

| Страница | Содержимое |
|----------|-----------|
| Overview | KPI (4 карточки), 30-дневный revenue trend, топ блюд (horizontal bar), revenue by category (doughnut) |
| Menu | KPI (4), orders by category bar chart, таблица 15 блюд с маржой |
| Peak Hours | KPI (3), heatmap часов × дней недели, hourly orders bar chart |
| Finance | KPI (4), monthly revenue vs costs line chart, cost breakdown by category |

## Бизнес-контекст

Целевая аудитория: рестораторы, владельцы кафе и баров которые хотят видеть: какие блюда приносят прибыль, в какие часы максимальный трафик, и как соотносятся выручка и себестоимость.

## Как адаптировать

- Заменить меню на своё (изменить массив MENU_ITEMS_EN/RU)
- Настроить часы работы в heatmap (массив HOURS)
- Добавить реальные данные через Google Sheets API
- Изменить цветовую схему для брендинга
