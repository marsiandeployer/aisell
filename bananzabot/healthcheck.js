#!/usr/bin/env node
// CHANGE: Add health check script with Telegram notifications
// WHY: Monitor system health and alert admin if something breaks
// QUOTE(ТЗ): "если падает то шли мне в телеграм уведомление"
// REF: User request - monitoring with Telegram alerts

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ВАЖНО: Используем python3 telegram_sender для отправки уведомлений
const TELEGRAM_SENDER = '/root/space2/hababru/telegram_sender.py';
const ADMIN_USERNAME = 'sashanoxon';

// Конфигурация проверок
const CHECKS = {
    pm2Process: {
        name: 'PM2 Process Running',
        check: () => {
            try {
                const result = execSync('pm2 jlist', { encoding: 'utf8' });
                const data = JSON.parse(result);
                const bananza = data.find(p => p.name === 'bananzabot');

                if (bananza && bananza.pm2_env && bananza.pm2_env.status === 'online') {
                    return { ok: true, message: 'Process online' };
                }
                return { ok: false, message: 'Process not online or not found' };
            } catch (error) {
                return { ok: false, message: `PM2 error: ${error.message}` };
            }
        }
    },
    botsDatabase: {
        name: 'Bots Database Accessible',
        check: () => {
            try {
                const dbPath = path.join(__dirname, 'bots_database', 'bots.json');
                if (!fs.existsSync(dbPath)) {
                    return { ok: false, message: 'Database file not found' };
                }
                const data = fs.readFileSync(dbPath, 'utf8');
                JSON.parse(data); // Validate JSON
                return { ok: true, message: 'Database OK' };
            } catch (error) {
                return { ok: false, message: `Database error: ${error.message}` };
            }
        }
    },
    activeBots: {
        name: 'Active Bots Running',
        check: () => {
            try {
                const Analytics = require('./analytics');
                const metrics = Analytics.collectBotMetrics();

                if (!metrics) {
                    return { ok: false, message: 'Cannot collect metrics' };
                }

                if (metrics.activeBots === 0 && metrics.totalBots > 0) {
                    return { ok: false, message: `No active bots (${metrics.totalBots} total)` };
                }

                return {
                    ok: true,
                    message: `${metrics.activeBots}/${metrics.totalBots} bots active`
                };
            } catch (error) {
                return { ok: false, message: `Analytics error: ${error.message}` };
            }
        }
    },
    memoryUsage: {
        name: 'Memory Usage',
        check: () => {
            try {
                const result = execSync('pm2 jlist', { encoding: 'utf8' });
                const data = JSON.parse(result);
                const bananza = data.find(p => p.name === 'bananzabot');

                if (bananza && bananza.monit) {
                    const memoryMB = Math.round(bananza.monit.memory / 1024 / 1024);
                    const MAX_MEMORY_MB = 500; // Alert if > 500MB

                    if (memoryMB > MAX_MEMORY_MB) {
                        return {
                            ok: false,
                            message: `High memory usage: ${memoryMB}MB (max ${MAX_MEMORY_MB}MB)`
                        };
                    }

                    return { ok: true, message: `${memoryMB}MB` };
                }
                return { ok: false, message: 'Cannot read memory stats' };
            } catch (error) {
                return { ok: false, message: `Memory check error: ${error.message}` };
            }
        }
    },
    restarts: {
        name: 'Recent Restarts Check',
        check: () => {
            try {
                const result = execSync('pm2 jlist', { encoding: 'utf8' });
                const data = JSON.parse(result);
                const bananza = data.find(p => p.name === 'bananzabot');

                if (bananza && bananza.pm2_env) {
                    const restarts = bananza.pm2_env.restart_time;
                    const MAX_RESTARTS = 5; // Alert if > 5 restarts

                    if (restarts > MAX_RESTARTS) {
                        return {
                            ok: false,
                            message: `Too many restarts: ${restarts} (max ${MAX_RESTARTS})`
                        };
                    }

                    return { ok: true, message: `${restarts} restarts` };
                }
                return { ok: false, message: 'Cannot read restart count' };
            } catch (error) {
                return { ok: false, message: `Restart check error: ${error.message}` };
            }
        }
    }
};

/**
 * Отправка уведомления в Telegram через telegram_sender.py
 * @param {string} message Сообщение для отправки
 */
function sendTelegramAlert(message) {
    try {
        // Экранируем специальные символы для shell
        const escapedMessage = message.replace(/"/g, '\\"').replace(/\n/g, '\\n');
        const command = `python3 ${TELEGRAM_SENDER} "напиши @${ADMIN_USERNAME} ${escapedMessage}"`;
        execSync(command, { encoding: 'utf8', timeout: 10000 });
        console.log('[HealthCheck] Telegram alert sent successfully');
    } catch (error) {
        console.error('[HealthCheck] Failed to send Telegram alert:', error.message);
    }
}

/**
 * Запуск всех проверок
 */
function runHealthChecks() {
    console.log('\n🏥 Bananzabot Health Check');
    console.log(`${' '.repeat(60)}`);
    console.log(`Timestamp: ${new Date().toISOString()}\n`);

    const results = [];
    let allOk = true;

    // Запускаем все проверки
    for (const [key, config] of Object.entries(CHECKS)) {
        const result = config.check();
        results.push({
            name: config.name,
            ok: result.ok,
            message: result.message
        });

        const status = result.ok ? '✅' : '❌';
        console.log(`${status} ${config.name}: ${result.message}`);

        if (!result.ok) {
            allOk = false;
        }
    }

    console.log(`\n${' '.repeat(60)}`);
    console.log(`Status: ${allOk ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`);
    console.log(`${' '.repeat(60)}\n`);

    // Отправляем уведомление если есть проблемы
    if (!allOk) {
        const failedChecks = results.filter(r => !r.ok);
        const alertMessage = `🚨 BANANZABOT HEALTH CHECK FAILED\n\n` +
            failedChecks.map(check => `❌ ${check.name}: ${check.message}`).join('\n');

        console.log('[HealthCheck] Sending Telegram alert...');
        sendTelegramAlert(alertMessage);
    }

    // Сохраняем результаты
    saveHealthCheckResults(results, allOk);

    // Exit code
    process.exit(allOk ? 0 : 1);
}

/**
 * Сохранение результатов health check
 * @param {Array} results Массив результатов проверок
 * @param {boolean} allOk Все ли проверки прошли успешно
 */
function saveHealthCheckResults(results, allOk) {
    const logsDir = path.join(__dirname, 'healthcheck_logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `healthcheck_${timestamp}.json`;
    const filepath = path.join(logsDir, filename);

    const logData = {
        timestamp: new Date().toISOString(),
        allOk: allOk,
        results: results
    };

    try {
        fs.writeFileSync(filepath, JSON.stringify(logData, null, 2));
        console.log(`[HealthCheck] Results saved: ${filename}`);
    } catch (error) {
        console.error('[HealthCheck] Failed to save results:', error.message);
    }

    // Оставляем только последние 100 логов
    cleanupOldLogs(logsDir, 100);
}

/**
 * Очистка старых логов
 * @param {string} dir Директория с логами
 * @param {number} maxFiles Максимальное количество файлов
 */
function cleanupOldLogs(dir, maxFiles) {
    try {
        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith('healthcheck_') && f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(dir, f),
                time: fs.statSync(path.join(dir, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);

        // Удаляем файлы старше maxFiles
        if (files.length > maxFiles) {
            const toDelete = files.slice(maxFiles);
            toDelete.forEach(file => {
                fs.unlinkSync(file.path);
            });
            console.log(`[HealthCheck] Cleaned up ${toDelete.length} old log files`);
        }
    } catch (error) {
        console.error('[HealthCheck] Cleanup error:', error.message);
    }
}

// Запуск проверок
if (require.main === module) {
    runHealthChecks();
}

module.exports = { runHealthChecks, CHECKS };
