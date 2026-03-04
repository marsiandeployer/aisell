// CHANGE: Add notification tests
// WHY: Ensure [NOTIFY_USER] and [NOTIFY_ADMIN] parsing + sending works
// REF: User request - проверить что оповещения срабатывают
const assert = require('assert');

const ConversationManager = require('../conversationManager');

function runTests() {
    console.log('\n🧪 Running Notification Tests...\n');

    let passed = 0;
    let failed = 0;
    const failures = [];

    const cm = new ConversationManager();

    const testSuites = [
        {
            name: 'parseNotificationCommands()',
            tests: [
                {
                    name: 'should extract user/admin notifications and strip from chat',
                    fn: () => {
                        const response = [
                            'Принято! Заявка оформлена.',
                            '[NOTIFY_USER] Спасибо! Мы свяжемся с вами.',
                            '[NOTIFY_ADMIN]',
                            'Новая заявка от @user'
                        ].join('\n');

                        const parsed = cm.parseNotificationCommands(response);
                        assert.strictEqual(parsed.chatMessage, 'Принято! Заявка оформлена.');
                        assert.strictEqual(parsed.userNotification, 'Спасибо! Мы свяжемся с вами.');
                        assert.strictEqual(parsed.adminNotification, 'Новая заявка от @user');
                    }
                }
            ]
        },
        {
            name: 'sendNotifications()',
            tests: [
                {
                    name: 'should send both user and admin notifications',
                    fn: async () => {
                        const calls = [];
                        const bot = {
                            sendMessage: async (chatId, text) => {
                                calls.push({ chatId, text });
                            }
                        };

                        const result = await cm.sendNotifications(
                            bot,
                            'user-123',
                            'chat-123',
                            {
                                userNotification: 'User message',
                                adminNotification: 'Admin message'
                            },
                            {
                                sendPrivateMessages: true,
                                notificationChannel: 'admin-channel'
                            }
                        );

                        assert.strictEqual(result.userNotificationSent, true);
                        assert.strictEqual(result.adminNotificationSent, true);
                        assert.strictEqual(calls.length, 2);
                        assert.deepStrictEqual(calls[0], { chatId: 'user-123', text: 'User message' });
                        assert.deepStrictEqual(calls[1], { chatId: 'admin-channel', text: 'Admin message\n\n👤 User ID: user-123' });
                    }
                },
                {
                    name: 'should skip user notification when disabled',
                    fn: async () => {
                        const calls = [];
                        const bot = {
                            sendMessage: async (chatId, text) => {
                                calls.push({ chatId, text });
                            }
                        };

                        const result = await cm.sendNotifications(
                            bot,
                            'user-456',
                            'chat-456',
                            {
                                userNotification: 'User message',
                                adminNotification: 'Admin message'
                            },
                            {
                                sendPrivateMessages: false,
                                notificationChannel: 'admin-channel'
                            }
                        );

                        assert.strictEqual(result.userNotificationSent, false);
                        assert.strictEqual(result.adminNotificationSent, true);
                        assert.strictEqual(calls.length, 1);
                        assert.deepStrictEqual(calls[0], { chatId: 'admin-channel', text: 'Admin message\n\n👤 User ID: user-456' });
                    }
                }
            ]
        }
    ];

    function runTest(test) {
        try {
            const result = test.fn();
            if (result && typeof result.then === 'function') {
                return result.then(() => ({ ok: true })).catch((err) => ({ ok: false, err }));
            }
            return Promise.resolve({ ok: true });
        } catch (err) {
            return Promise.resolve({ ok: false, err });
        }
    }

    return (async () => {
        for (const suite of testSuites) {
            console.log(`\n📋 ${suite.name}`);
            for (const test of suite.tests) {
                const outcome = await runTest(test);
                if (outcome.ok) {
                    passed += 1;
                    console.log(`  ✅ ${test.name}`);
                } else {
                    failed += 1;
                    failures.push({ suite: suite.name, test: test.name, error: outcome.err });
                    console.log(`  ❌ ${test.name}`);
                    console.log(`     ${outcome.err && outcome.err.message ? outcome.err.message : outcome.err}`);
                }
            }
        }

        console.log('\n============================================================');
        console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
        console.log('============================================================\n');

        if (failed > 0) {
            process.exit(1);
        }
    })();
}

runTests();
