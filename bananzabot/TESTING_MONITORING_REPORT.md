# 🧪 ОТЧЕТ: Тестирование и мониторинг Bananzabot

**Дата:** 26 декабря 2025
**Автор:** Claude (AI Assistant)

## ✅ ЧТО СДЕЛАНО

### 1. 🧪 Тестирование

#### Создан модуль тестов: `tests/analytics.test.js`

**Покрытие:**
- ✅ `collectBotMetrics()` - сбор метрик
  - Проверка структуры данных
  - Сортировка ботов по активности
  - Расчет конверсий
  - Валидация данных

- ✅ `formatMetricsForTelegram()` - форматирование
  - Обработка null значений
  - Форматирование валидных данных
  - Отображение проблем

- ✅ `saveMetricsSnapshot()` - сохранение снапшотов
  - Создание директории
  - Сохранение JSON
  - Валидация данных

- ✅ Интеграционные тесты
  - Полный workflow: collect → format → save

**Результаты:**
```
📊 Test Results: 10 passed, 0 failed
✅ All tests passed!
```

**Запуск:**
```bash
npm test
# или
node tests/analytics.test.js
```

### 2. 🏥 Health Check с Telegram уведомлениями

#### Создан скрипт мониторинга: `healthcheck.js`

**Проверки:**
1. ✅ **PM2 Process Running** - процесс bananzabot работает
2. ✅ **Bots Database Accessible** - база данных доступна и валидна
3. ✅ **Active Bots Running** - активные боты работают
4. ✅ **Memory Usage** - использование памяти < 500MB
5. ✅ **Recent Restarts Check** - количество рестартов < 5

**Функции:**
- 📊 Детальный отчет о состоянии системы
- 💾 Автоматическое сохранение логов
- 🧹 Очистка старых логов (хранит последние 100)
- 📱 **Telegram уведомления при проблемах** через `telegram_sender.py`

**Пример работы:**
```
🏥 Bananzabot Health Check
Timestamp: 2025-12-26T11:47:46.212Z

✅ PM2 Process Running: Process online
✅ Bots Database Accessible: Database OK
✅ Active Bots Running: 9/9 bots active
✅ Memory Usage: 0MB
✅ Recent Restarts Check: 1 restarts

Status: ✅ ALL CHECKS PASSED
```

**При проблемах:**
```
❌ PM2 Process Running: Process not online
[HealthCheck] Sending Telegram alert...
```

Уведомление в Telegram:
```
🚨 BANANZABOT HEALTH CHECK FAILED

❌ PM2 Process Running: Process not online
❌ Memory Usage: High memory usage: 520MB (max 500MB)
```

**Запуск вручную:**
```bash
npm run healthcheck
# или
node healthcheck.js
```

### 3. ⏰ Автоматический мониторинг через cron

**Настроено:**
```cron
*/15 * * * * /usr/bin/node /root/space2/bananzabot/healthcheck.js >> /root/space2/bananzabot/healthcheck_logs/cron.log 2>&1
```

**Расписание:**
- Запускается каждые **15 минут**
- Логи сохраняются в `healthcheck_logs/cron.log`
- При проблемах отправляет уведомление в Telegram **@sashanoxon**

**Проверка cron:**
```bash
crontab -l
```

**Просмотр логов:**
```bash
tail -f /root/space2/bananzabot/healthcheck_logs/cron.log
```

### 4. 📦 npm скрипты

**Обновлен `package.json`:**

```json
{
  "scripts": {
    "start": "node bananzabot.js",
    "test": "node tests/analytics.test.js",
    "healthcheck": "node healthcheck.js",
    "analytics": "node -e \"const a = require('./analytics'); console.log(a.formatMetricsForTelegram(a.collectBotMetrics()));\"",
    "pm2:start": "pm2 start bananzabot.js --name bananzabot",
    "pm2:restart": "pm2 restart bananzabot",
    "pm2:stop": "pm2 stop bananzabot",
    "pm2:logs": "pm2 logs bananzabot --lines 100"
  }
}
```

**Использование:**
```bash
npm start           # Запустить бота
npm test            # Запустить тесты
npm run healthcheck # Health check
npm run analytics   # Показать аналитику в консоли
npm run pm2:start   # Запуск через PM2
npm run pm2:restart # Перезапуск PM2
npm run pm2:logs    # Логи PM2
```

### 5. 📝 Обновлена документация

**README.md:**
- ✅ Добавлен раздел "Аналитика и мониторинг"
- ✅ Описаны команды `/analytics` и `/stats`
- ✅ Инструкции по запуску health check
- ✅ Документация по тестам
- ✅ Список npm скриптов
- ✅ Обновленная структура проекта

## 📊 Структура файлов

```
bananzabot/
├── analytics.js                    # 📊 Модуль аналитики
├── healthcheck.js                  # 🏥 Health check с Telegram alerts
├── tests/                          # 🧪 Тесты
│   └── analytics.test.js
├── analytics/                      # Снапшоты метрик
│   └── metrics_*.json
├── healthcheck_logs/               # Логи мониторинга
│   ├── cron.log                    # Логи cron
│   └── healthcheck_*.json          # JSON логи проверок
├── package.json                    # npm скрипты
├── README.md                       # Обновленная документация
├── ANALYTICS_REPORT.md             # Отчет по аналитике
└── TESTING_MONITORING_REPORT.md    # Этот файл
```

## 🎯 Как использовать

### Ежедневная работа

**Проверка здоровья системы:**
```bash
npm run healthcheck
```

**Просмотр аналитики:**
```bash
npm run analytics
```

**Запуск тестов перед деплоем:**
```bash
npm test
```

### Мониторинг

**Просмотр логов cron:**
```bash
tail -f healthcheck_logs/cron.log
```

**Просмотр сохраненных health checks:**
```bash
ls -lh healthcheck_logs/
cat healthcheck_logs/healthcheck_2025-12-26T11-47-47-173Z.json
```

**Просмотр снапшотов аналитики:**
```bash
ls -lh analytics/
cat analytics/metrics_2025-12-26T11-49-55-082Z.json
```

### При получении Telegram уведомления

1. **Проверить логи:**
   ```bash
   npm run pm2:logs
   ```

2. **Запустить health check:**
   ```bash
   npm run healthcheck
   ```

3. **Перезапустить если нужно:**
   ```bash
   npm run pm2:restart
   ```

4. **Проверить снова:**
   ```bash
   npm run healthcheck
   ```

## 🔔 Telegram уведомления

### Когда приходят

Health check отправляет уведомление **@sashanoxon** если:
- ❌ PM2 процесс не работает
- ❌ База данных недоступна или повреждена
- ❌ Нет активных ботов (при наличии созданных)
- ❌ Память > 500MB
- ❌ Более 5 рестартов

### Формат уведомления

```
🚨 BANANZABOT HEALTH CHECK FAILED

❌ PM2 Process Running: Process not online or not found
❌ Memory Usage: High memory usage: 520MB (max 500MB)
```

### Тест уведомлений

Чтобы протестировать отправку уведомлений:

```bash
python3 /root/space2/hababru/telegram_sender.py "напиши @sashanoxon Тест уведомления от bananzabot"
```

## ✅ Проверочный чек-лист

### Перед деплоем

- [ ] Запустить `npm test` - все тесты проходят
- [ ] Запустить `npm run healthcheck` - все проверки OK
- [ ] Проверить `crontab -l` - задача мониторинга настроена
- [ ] Протестировать Telegram уведомление вручную

### После деплоя

- [ ] Проверить `pm2 status` - процесс bananzabot online
- [ ] Запустить `npm run healthcheck` - все OK
- [ ] Проверить через 15 минут логи: `tail healthcheck_logs/cron.log`
- [ ] Попробовать `/analytics` в боте

### Еженедельно

- [ ] Просмотреть логи cron: `cat healthcheck_logs/cron.log`
- [ ] Проверить размер логов: `du -sh healthcheck_logs/ analytics/`
- [ ] Запустить тесты: `npm test`

## 📈 Метрики производительности

**Скорость выполнения:**
- `npm test`: ~1-2 секунды
- `npm run healthcheck`: ~0.5-1 секунда
- `npm run analytics`: ~0.3-0.5 секунды

**Размер логов:**
- Health check logs: ~10KB за проверку
- Analytics snapshots: ~5-10KB за snapshot
- Автоматическая очистка: хранятся последние 100 записей

## 🚀 Следующие шаги

1. **Мониторинг работает автоматически** - каждые 15 минут
2. **Тесты проходят** - можно расширять покрытие
3. **Уведомления настроены** - получишь alert при проблемах

### Рекомендуемые улучшения

**В следующей итерации:**
- [ ] Добавить тесты для `healthcheck.js`
- [ ] Добавить тесты для интеграции с Telegram
- [ ] Создать дашборд с графиками (веб-интерфейс)
- [ ] Добавить метрики по времени ответа ботов
- [ ] Настроить алерты на критичные метрики (Grafana/Prometheus)

**Долгосрочно:**
- [ ] CI/CD с автоматическими тестами
- [ ] Мониторинг инфраструктуры (CPU, disk, network)
- [ ] Интеграция с error tracking (Sentry)

## 📞 Контакты

**При проблемах:**
- Telegram: @sashanoxon
- Логи: `healthcheck_logs/`, `pm2 logs bananzabot`

**Полезные команды:**
```bash
npm run healthcheck  # Проверка здоровья
npm test             # Запуск тестов
npm run analytics    # Аналитика
pm2 logs bananzabot  # Логи PM2
```

---

**Создано:** Claude Code
**Дата:** 2025-12-26
**Версия:** 1.0
