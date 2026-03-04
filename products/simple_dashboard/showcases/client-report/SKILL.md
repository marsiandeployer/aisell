# Client Work Report Dashboard

## Что это

Отчёт о ходе работ для клиента — ТЗ с нумерацией разделов, завершённые задачи, спринт-репорт и PDF-экспорт. 4 страницы.

**Live demo:** https://simpledashboard.wpmix.net/showcases/client-report/demo

## Как воспроизвести

Промпт для генерации:

> Create a work progress report for client — spec (TZ) with numbered sections, completed tasks, sprint report and PDF export

## Ключевые особенности

- **ТЗ (Specification):** 5 разделов, 18 пунктов с прогресс-баром и фильтрами
- **Спринт-репорт:** текущий спринт 3/5, чеклист выполненных + в работе + запланированных задач
- **PDF-экспорт:** print preview с шапкой, таблицами задач и кнопкой печати
- **Бюджет:** allocated vs spent трекинг
- **Данные из GitHub Issues** или Google Sheets

## Страницы (4)

| Страница | Содержимое |
|----------|-----------|
| overview | KPI, donut chart, bar chart, activity feed, budget tracker |
| spec | Progress bar, filter buttons, дерево разделов ТЗ |
| report | Sprint header, completed/in-progress/planned lists |
| export | Print preview, letterhead, summary + task tables, print button |

## Бизнес-контекст

Фриланс / агентство / проектный менеджмент. Заказчик хочет видеть прогресс по ТЗ, статусы задач по спринтам, бюджет. Пример: редизайн корпоративного сайта (5 разделов ТЗ, 18 пунктов, 5 спринтов).

## Как адаптировать

- Заменить разделы ТЗ на свои
- Подключить GitHub Issues для автоматического сбора статусов
- Изменить количество спринтов и бюджет
- Кастомизировать PDF-шапку (логотип, реквизиты)
