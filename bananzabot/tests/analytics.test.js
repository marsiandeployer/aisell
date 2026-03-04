// CHANGE: Add comprehensive tests for analytics module
// WHY: Ensure analytics system works correctly and catches regressions
// REF: User request - покрыть все тестами
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const Analytics = require('../analytics');

/**
 * Simple test runner (no external dependencies)
 */
function runTests() {
    console.log('\n🧪 Running Analytics Tests...\n');

    let passed = 0;
    let failed = 0;
    const failures = [];

    const testSuites = [
        {
            name: 'collectBotMetrics()',
            tests: [
                {
                    name: 'should return valid metrics structure',
                    fn: () => {
                        const metrics = Analytics.collectBotMetrics();
                        if (!metrics) {
                            console.log('     ⚠️  No bots database found, skipping');
                            return;
                        }

                        assert.ok(metrics, 'Metrics should not be null');
                        assert.ok(typeof metrics.totalBots === 'number', 'totalBots should be number');
                        assert.ok(typeof metrics.activeBots === 'number', 'activeBots should be number');
                        assert.ok(typeof metrics.totalCreators === 'number', 'totalCreators should be number');
                        assert.ok(Array.isArray(metrics.botDetails), 'botDetails should be array');
                        assert.ok(typeof metrics.conversionRate === 'string', 'conversionRate should be string');
                    }
                },
                {
                    name: 'should sort bots by message count (descending)',
                    fn: () => {
                        const metrics = Analytics.collectBotMetrics();
                        if (!metrics || metrics.botDetails.length < 2) {
                            console.log('     ⚠️  Not enough bots to test sorting');
                            return;
                        }

                        for (let i = 0; i < metrics.botDetails.length - 1; i++) {
                            assert.ok(
                                metrics.botDetails[i].messages >= metrics.botDetails[i + 1].messages,
                                `Bot ${i} should have >= messages than bot ${i + 1}`
                            );
                        }
                    }
                },
                {
                    name: 'should calculate correct conversion rate',
                    fn: () => {
                        const metrics = Analytics.collectBotMetrics();
                        if (!metrics || metrics.totalUsers === 0) {
                            console.log('     ⚠️  No users found, skipping');
                            return;
                        }

                        const expectedRate = (metrics.activeUsers / metrics.totalUsers * 100).toFixed(1);
                        assert.strictEqual(metrics.conversionRate, expectedRate, 'Conversion rate mismatch');
                    }
                },
                {
                    name: 'should have valid bot details structure',
                    fn: () => {
                        const metrics = Analytics.collectBotMetrics();
                        if (!metrics || metrics.botDetails.length === 0) {
                            console.log('     ⚠️  No bots found, skipping');
                            return;
                        }

                        const bot = metrics.botDetails[0];
                        assert.ok(bot.botId, 'Bot should have botId');
                        assert.ok(bot.nameprompt, 'Bot should have nameprompt');
                        assert.ok(typeof bot.users === 'number', 'users should be number');
                        assert.ok(typeof bot.messages === 'number', 'messages should be number');
                        assert.ok(bot.activeUsers <= bot.users, 'activeUsers <= users');
                    }
                }
            ]
        },
        {
            name: 'formatMetricsForTelegram()',
            tests: [
                {
                    name: 'should handle null metrics',
                    fn: () => {
                        const result = Analytics.formatMetricsForTelegram(null);
                        assert.strictEqual(result, '❌ Ошибка при сборе метрик');
                    }
                },
                {
                    name: 'should format valid metrics',
                    fn: () => {
                        const mockMetrics = {
                            totalBots: 5,
                            activeBots: 4,
                            botsWithActivity: 3,
                            botActivityRate: '60.0',
                            totalCreators: 3,
                            totalUsers: 10,
                            activeUsers: 8,
                            conversionRate: '80.0',
                            totalMessages: 50,
                            botDetails: [
                                {
                                    nameprompt: 'test_bot_1',
                                    users: 5,
                                    activeUsers: 4,
                                    messages: 30,
                                    lastActivity: '2025-12-26T10:00:00.000Z'
                                }
                            ]
                        };
                        const text = Analytics.formatMetricsForTelegram(mockMetrics);
                        assert.ok(text.includes('АНАЛИТИКА BANANZABOT'), 'Should include header');
                        assert.ok(text.includes('Всего создано ботов: 5'), 'Should include total bots');
                        assert.ok(text.includes('test_bot_1'), 'Should include bot name');
                    }
                },
                {
                    name: 'should show problems section',
                    fn: () => {
                        const mockMetrics = {
                            totalBots: 3,
                            activeBots: 3,
                            botsWithActivity: 1,
                            botActivityRate: '33.3',
                            totalCreators: 2,
                            totalUsers: 5,
                            activeUsers: 3,
                            conversionRate: '60.0',
                            totalMessages: 10,
                            botDetails: [
                                {
                                    nameprompt: 'inactive_bot',
                                    users: 0,
                                    activeUsers: 0,
                                    messages: 0,
                                    lastActivity: null
                                },
                                {
                                    nameprompt: 'low_activity_bot',
                                    users: 1,
                                    activeUsers: 1,
                                    messages: 3,
                                    lastActivity: '2025-12-26T10:00:00.000Z'
                                }
                            ]
                        };
                        const text = Analytics.formatMetricsForTelegram(mockMetrics);
                        assert.ok(text.includes('⚠️ ПРОБЛЕМЫ'), 'Should show problems');
                        assert.ok(text.includes('Ботов без пользователей'), 'Should show inactive bots');
                    }
                }
            ]
        },
        {
            name: 'saveMetricsSnapshot()',
            tests: [
                {
                    name: 'should create analytics directory',
                    fn: () => {
                        const snapshotsDir = path.join(__dirname, '..', 'analytics');

                        // Clean up first
                        if (fs.existsSync(snapshotsDir)) {
                            fs.rmSync(snapshotsDir, { recursive: true });
                        }

                        const mockMetrics = { totalBots: 1, activeBots: 1 };
                        Analytics.saveMetricsSnapshot(mockMetrics);

                        assert.ok(fs.existsSync(snapshotsDir), 'Should create analytics dir');
                    }
                },
                {
                    name: 'should save valid JSON snapshot',
                    fn: () => {
                        const snapshotsDir = path.join(__dirname, '..', 'analytics');
                        const mockMetrics = { totalBots: 5, activeBots: 4 };

                        // Clean up
                        if (fs.existsSync(snapshotsDir)) {
                            fs.rmSync(snapshotsDir, { recursive: true });
                        }

                        Analytics.saveMetricsSnapshot(mockMetrics);

                        const files = fs.readdirSync(snapshotsDir);
                        assert.ok(files.length > 0, 'Should create snapshot file');

                        const filepath = path.join(snapshotsDir, files[0]);
                        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));

                        assert.ok(data.timestamp, 'Should have timestamp');
                        assert.ok(data.metrics, 'Should have metrics');
                        assert.strictEqual(data.metrics.totalBots, 5, 'Should preserve data');
                    }
                }
            ]
        },
        {
            name: 'Integration',
            tests: [
                {
                    name: 'complete workflow: collect -> format -> save',
                    fn: () => {
                        const metrics = Analytics.collectBotMetrics();
                        if (!metrics) {
                            console.log('     ⚠️  No bots database, skipping');
                            return;
                        }

                        // Format
                        const text = Analytics.formatMetricsForTelegram(metrics);
                        assert.ok(text.length > 100, 'Formatted text should be substantial');

                        // Save
                        Analytics.saveMetricsSnapshot(metrics);

                        // Verify
                        const snapshotsDir = path.join(__dirname, '..', 'analytics');
                        const files = fs.readdirSync(snapshotsDir);
                        assert.ok(files.length > 0, 'Should save snapshot');
                    }
                }
            ]
        }
    ];

    // Run all tests
    testSuites.forEach(suite => {
        console.log(`\n📋 ${suite.name}`);
        suite.tests.forEach(test => {
            try {
                test.fn();
                console.log(`  ✅ ${test.name}`);
                passed++;
            } catch (error) {
                console.log(`  ❌ ${test.name}`);
                console.log(`     Error: ${error.message}`);
                failed++;
                failures.push({
                    suite: suite.name,
                    test: test.name,
                    error: error.message
                });
            }
        });
    });

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
    console.log(`${'='.repeat(60)}\n`);

    if (failures.length > 0) {
        console.log('❌ Failed tests:\n');
        failures.forEach(f => {
            console.log(`   ${f.suite} > ${f.test}`);
            console.log(`   ${f.error}\n`);
        });
        process.exit(1);
    } else {
        console.log('✅ All tests passed!\n');
        process.exit(0);
    }
}

// Run tests if executed directly
if (require.main === module) {
    runTests();
}

module.exports = { runTests };
