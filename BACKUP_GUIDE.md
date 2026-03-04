# Backup Guide - Критичные данные для бэкапа

## Основной сервер (78.47.125.10)

### Критичные директории:

| Директория | Размер | Описание | Приоритет |
|-----------|--------|----------|-----------|
| `/root/aisell/botplatform/group_data/` | 555MB | Пользовательские данные, проекты, CLAUDE.md | 🔴 CRITICAL |
| `/root/aisell/noxonbot/data/` | 2.8GB | AI sandbox homes (Claude/Codex рабочие директории) | 🟡 HIGH |
| `/root/.claude/` | 559MB | Claude credentials, история, кэш | 🟢 MEDIUM |
| `/root/.codex/` | 699MB | Codex auth, история | 🟢 MEDIUM |

### Команды для бэкапа (основной сервер):

```bash
# Полный бэкап критичных данных
tar -czf /tmp/aisell-backup-$(date +%Y%m%d-%H%M).tar.gz \
  /root/aisell/botplatform/group_data/ \
  /root/aisell/noxonbot/data/ \
  /root/.claude/ \
  /root/.codex/

# Только пользовательские данные (быстрый бэкап)
tar -czf /tmp/aisellusers-backup-$(date +%Y%m%d-%H%M).tar.gz \
  /root/aisell/botplatform/group_data/

# Размер архива: ~1.5-2GB (с компрессией)
```

---

## Prod сервер (62.109.14.209)

### Критичные директории:

| Директория | Размер | Описание | Приоритет |
|-----------|--------|----------|-----------|
| `/root/aisell/botplatform/group_data/` | 26MB | Пользовательские данные prod бота | 🔴 CRITICAL |
| `/root/aisell/noxonbot/data/` | 19MB | AI sandbox homes (prod) | 🟡 HIGH |
| `/root/.claude/` | 136KB | Claude credentials | 🟢 MEDIUM |
| `/root/.codex/` | 16KB | Codex auth | 🟢 MEDIUM |

### Команды для бэкапа (prod сервер):

```bash
# SSH к prod серверу
ssh root@62.109.14.209

# Полный бэкап
tar -czf /tmp/aisell-prod-backup-$(date +%Y%m%d-%H%M).tar.gz \
  /root/aisell/botplatform/group_data/ \
  /root/aisell/noxonbot/data/ \
  /root/.claude/ \
  /root/.codex/

# Размер архива: ~30-40MB (с компрессией)
```

---

## Автоматический бэкап (рекомендуется)

### Создание cron задачи:

```bash
# Ежедневный бэкап в 3:00 AM (основной сервер)
0 3 * * * tar -czf /backup/aisell-$(date +\%Y\%m\%d).tar.gz /root/aisell/botplatform/group_data/ /root/aisell/noxonbot/data/ && find /backup -name "aisell-*.tar.gz" -mtime +7 -delete

# Ежедневный бэкап в 3:30 AM (prod сервер)
ssh root@62.109.14.209 << 'EOF'
echo "30 3 * * * tar -czf /backup/aisell-prod-\$(date +\%Y\%m\%d).tar.gz /root/aisell/botplatform/group_data/ /root/aisell/noxonbot/data/ && find /backup -name 'aisell-prod-*.tar.gz' -mtime +7 -delete" | crontab -
EOF
```

---

## Восстановление из бэкапа

### Основной сервер:

```bash
# Остановить процессы
pm2 stop noxonbot noxonbot-web noxonbot-admin

# Восстановить данные
tar -xzf /backup/aisell-20260210.tar.gz -C /

# Проверить права доступа
chmod 700 /root/aisell/botplatform/group_data/*
chmod 700 /root/.claude/ /root/.codex/

# Запустить процессы
pm2 start noxonbot noxonbot-web noxonbot-admin
```

### Prod сервер:

```bash
ssh root@62.109.14.209 << 'EOF'
pm2 stop clodeboxbot coderboxbot noxonbot-web
tar -xzf /backup/aisell-prod-20260210.tar.gz -C /
chmod 700 /root/aisell/botplatform/group_data/*
pm2 start clodeboxbot coderboxbot noxonbot-web
EOF
```

---

## Что НЕ нужно бэкапить

❌ `/root/aisell/noxonbot/node_modules/` - восстанавливается через npm install
❌ `/root/aisell/.git/` - клонируется из GitHub
❌ `/root/.npm/` - кэш npm
❌ `/root/.cache/` - временные файлы
❌ PM2 логи старше 7 дней - ротируются автоматически

---

## Размеры и рост данных

### Основной сервер:
- **Текущий размер**: ~4.7GB
- **Рост**: ~100-200MB/день (в зависимости от активности)
- **Рекомендуемый retention**: 7 дней ежедневных бэкапов + 1 месячный

### Prod сервер:
- **Текущий размер**: ~45MB
- **Рост**: ~5-10MB/день
- **Рекомендуемый retention**: 7 дней ежедневных бэкапов

---

## Проверка целостности бэкапа

```bash
# Проверить архив
tar -tzf /backup/aisell-20260210.tar.gz | head -20

# Проверить размер
ls -lh /backup/aisell-*.tar.gz

# Тест восстановления в /tmp
mkdir /tmp/backup-test
tar -xzf /backup/aisell-20260210.tar.gz -C /tmp/backup-test
ls -la /tmp/backup-test/root/aisell/botplatform/group_data/
rm -rf /tmp/backup-test
```

---

**Последнее обновление**: 2026-02-10
**Статус**: ✅ Актуально
**Следующая проверка**: 2026-03-10
