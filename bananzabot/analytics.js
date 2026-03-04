// CHANGE: Add analytics module for tracking real bot activity
// WHY: Need to understand how many users actually interact with created bots vs just creating them
// QUOTE(ТЗ): "люди начинают создавать бота но метрики не показаны сколько из них реально что то делают"
// REF: User request - need metrics for real activity
const fs = require('fs');
const path = require('path');

/**
 * Собирает статистику активности всех ботов
 * @returns {Object} Объект с метриками активности
 */
function collectBotMetrics() {
    const botsDbPath = path.join(__dirname, 'bots_database', 'bots.json');
    const userDataDir = path.join(__dirname, 'user_data');

    // Читаем базу ботов
    let bots = [];
    try {
        const data = fs.readFileSync(botsDbPath, 'utf8');
        bots = JSON.parse(data);
    } catch (error) {
        console.error('[Analytics] Error reading bots database:', error);
        return null;
    }

    const metrics = {
        totalBots: bots.length,
        activeBots: bots.filter(b => b.status === 'active').length,
        totalCreators: new Set(bots.map(b => b.user_id)).size,
        botsWithActivity: 0,
        totalUsers: 0,
        activeUsers: 0, // Users who sent at least 1 message
        totalMessages: 0,
        botDetails: []
    };

    // Анализируем каждого бота
    for (const bot of bots) {
        const nameprompt = bot.nameprompt;
        const botDataPath = path.join(userDataDir, nameprompt);

        const botMetrics = {
            botId: bot.bot_id,
            nameprompt: nameprompt,
            creator: bot.user_id,
            createdAt: bot.created_at,
            status: bot.status,
            users: 0,
            activeUsers: 0,
            messages: 0,
            lastActivity: null
        };

        // Проверяем наличие папки с данными
        if (!fs.existsSync(botDataPath)) {
            metrics.botDetails.push(botMetrics);
            continue;
        }

        // Читаем файлы пользователей
        try {
            const files = fs.readdirSync(botDataPath);
            const chatFiles = files.filter(f => f.startsWith('chat_') && f.endsWith('.json'));

            for (const file of chatFiles) {
                const filePath = path.join(botDataPath, file);
                try {
                    const data = fs.readFileSync(filePath, 'utf8');
                    const conversation = JSON.parse(data);

                    if (Array.isArray(conversation)) {
                        botMetrics.users++;
                        const messageCount = conversation.length;
                        botMetrics.messages += messageCount;

                        if (messageCount > 0) {
                            botMetrics.activeUsers++;

                            // Находим последнюю активность
                            const lastMsg = conversation[conversation.length - 1];
                            if (lastMsg && lastMsg.timestamp) {
                                const msgDate = new Date(lastMsg.timestamp);
                                if (!botMetrics.lastActivity || msgDate > new Date(botMetrics.lastActivity)) {
                                    botMetrics.lastActivity = lastMsg.timestamp;
                                }
                            }
                        }
                    }
                } catch (err) {
                    // Пропускаем поврежденные файлы
                }
            }

            // Обновляем общую статистику
            metrics.totalUsers += botMetrics.users;
            metrics.activeUsers += botMetrics.activeUsers;
            metrics.totalMessages += botMetrics.messages;

            if (botMetrics.messages > 0) {
                metrics.botsWithActivity++;
            }

        } catch (error) {
            console.error(`[Analytics] Error reading bot data for ${nameprompt}:`, error);
        }

        metrics.botDetails.push(botMetrics);
    }

    // Сортируем ботов по активности
    metrics.botDetails.sort((a, b) => b.messages - a.messages);

    // Добавляем конверсии
    metrics.conversionRate = metrics.totalUsers > 0
        ? (metrics.activeUsers / metrics.totalUsers * 100).toFixed(1)
        : '0.0';

    metrics.botActivityRate = metrics.totalBots > 0
        ? (metrics.botsWithActivity / metrics.totalBots * 100).toFixed(1)
        : '0.0';

    return metrics;
}

/**
 * Форматирует метрики в читаемый текст для отправки в Telegram
 * @param {Object} metrics Объект метрик
 * @returns {string} Форматированный текст
 */
function formatMetricsForTelegram(metrics) {
    if (!metrics) {
        return '❌ Ошибка при сборе метрик';
    }

    let text = '📊 АНАЛИТИКА BANANZABOT\n\n';
    text += '=== ОБЩАЯ СТАТИСТИКА ===\n';
    text += `Всего создано ботов: ${metrics.totalBots}\n`;
    text += `Активных ботов: ${metrics.activeBots}\n`;
    text += `Ботов с активностью: ${metrics.botsWithActivity} (${metrics.botActivityRate}%)\n`;
    text += `Уникальных создателей: ${metrics.totalCreators}\n\n`;

    text += '=== ПОЛЬЗОВАТЕЛЬСКАЯ АКТИВНОСТЬ ===\n';
    text += `Всего пользователей: ${metrics.totalUsers}\n`;
    text += `Активных пользователей: ${metrics.activeUsers} (${metrics.conversionRate}%)\n`;
    text += `Всего сообщений: ${metrics.totalMessages}\n`;
    text += `Среднее сообщений/пользователь: ${metrics.totalUsers > 0 ? (metrics.totalMessages / metrics.totalUsers).toFixed(1) : '0.0'}\n\n`;

    text += '=== ТОП-5 БОТОВ ПО АКТИВНОСТИ ===\n';
    const top5 = metrics.botDetails.slice(0, 5);
    for (let i = 0; i < top5.length; i++) {
        const bot = top5[i];
        text += `${i + 1}. ${bot.nameprompt}\n`;
        text += `   Пользователей: ${bot.users}, Активных: ${bot.activeUsers}\n`;
        text += `   Сообщений: ${bot.messages}\n`;
        if (bot.lastActivity) {
            const date = new Date(bot.lastActivity);
            text += `   Последняя активность: ${date.toLocaleString('ru-RU')}\n`;
        }
        text += '\n';
    }

    // Проблемы и инсайты
    const inactiveBots = metrics.botDetails.filter(b => b.users === 0);
    const lowActivity = metrics.botDetails.filter(b => b.users > 0 && b.messages < 5);

    if (inactiveBots.length > 0 || lowActivity.length > 0) {
        text += '⚠️ ПРОБЛЕМЫ\n';
        if (inactiveBots.length > 0) {
            text += `Ботов без пользователей: ${inactiveBots.length}\n`;
        }
        if (lowActivity.length > 0) {
            text += `Ботов с низкой активностью (<5 сообщений): ${lowActivity.length}\n`;
        }
    }

    return text;
}

/**
 * Сохраняет метрики в JSON файл для истории
 * @param {Object} metrics Объект метрик
 */
function saveMetricsSnapshot(metrics) {
    const snapshotsDir = path.join(__dirname, 'analytics');
    if (!fs.existsSync(snapshotsDir)) {
        fs.mkdirSync(snapshotsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `metrics_${timestamp}.json`;
    const filepath = path.join(snapshotsDir, filename);

    try {
        fs.writeFileSync(filepath, JSON.stringify({
            timestamp: new Date().toISOString(),
            metrics: metrics
        }, null, 2));
        console.log(`[Analytics] Metrics snapshot saved: ${filename}`);
    } catch (error) {
        console.error('[Analytics] Error saving metrics snapshot:', error);
    }
}

module.exports = {
    collectBotMetrics,
    formatMetricsForTelegram,
    saveMetricsSnapshot
};
