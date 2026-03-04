const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const BotsManagerModule = require('../botsManager.ts');
const BotsManager = BotsManagerModule.default || BotsManagerModule;

function runTests() {
    console.log('\n🧪 Running BotsManager Dedupe Tests...\n');

    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`✅ ${name}`);
            passed += 1;
        } catch (error) {
            console.log(`❌ ${name}`);
            console.log(`   ${error && error.message ? error.message : String(error)}`);
            failed += 1;
        }
    }

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bananzabot-bots-manager-'));
    const tmpDbDir = path.join(tmpRoot, 'bots_database');
    const tmpDbPath = path.join(tmpDbDir, 'bots.json');

    try {
        const manager = new BotsManager();
        manager.botsDbPath = tmpDbPath;
        manager.ensureDatabase();

        test('createBot should upsert by api_key (no duplicate bot record)', () => {
            const first = manager.createBot('u1', '111:token_same_key_abcdefghijklmnopqrstuvwxyz', 'prompt 1', [{ role: 'user', content: 'a' }], null, { username: 'firstbot' });
            const second = manager.createBot('u1', '111:token_same_key_abcdefghijklmnopqrstuvwxyz', 'prompt 2', [{ role: 'user', content: 'b' }], null, { username: 'secondbot' });

            assert.strictEqual(first.bot_id, second.bot_id, 'Bot ID must be reused for same api_key');
            const bots = manager.loadBots();
            assert.strictEqual(bots.length, 1, 'Only one bot record should exist for same api_key');
            assert.strictEqual(bots[0].prompt, 'prompt 2', 'Prompt should be updated on upsert');
            assert.strictEqual(bots[0].status, 'pending_deploy', 'Upserted bot should be set to pending_deploy');
        });

        test('ensureUniqueActiveBotsByApiKey should keep only newest active bot per token', () => {
            const bots = [
                {
                    bot_id: 'old1',
                    api_key: '222:dup_token_abcdefghijklmnopqrstuvwxyz',
                    created_at: '2026-02-10T10:00:00.000Z',
                    updated_at: '2026-02-10T10:05:00.000Z',
                    user_id: 'u2',
                    conversation_history: [],
                    prompt: 'p1',
                    status: 'active',
                    nameprompt: 'bot_old1',
                    username: null,
                    first_name: null,
                    telegram_id: null,
                    notifications: { sendPrivateMessages: true, notificationChannel: 'u2' }
                },
                {
                    bot_id: 'new1',
                    api_key: '222:dup_token_abcdefghijklmnopqrstuvwxyz',
                    created_at: '2026-02-11T10:00:00.000Z',
                    updated_at: '2026-02-11T10:10:00.000Z',
                    user_id: 'u2',
                    conversation_history: [],
                    prompt: 'p2',
                    status: 'active',
                    nameprompt: 'bot_new1',
                    username: null,
                    first_name: null,
                    telegram_id: null,
                    notifications: { sendPrivateMessages: true, notificationChannel: 'u2' }
                },
                {
                    bot_id: 'single',
                    api_key: '333:single_token_abcdefghijklmnopqrstuvwxyz',
                    created_at: '2026-02-11T09:00:00.000Z',
                    user_id: 'u3',
                    conversation_history: [],
                    prompt: 'p3',
                    status: 'active',
                    nameprompt: 'bot_single',
                    username: null,
                    first_name: null,
                    telegram_id: null,
                    notifications: { sendPrivateMessages: true, notificationChannel: 'u3' }
                }
            ];
            manager.saveBots(bots);

            const summary = manager.ensureUniqueActiveBotsByApiKey();
            assert.strictEqual(summary.changed, true, 'Summary should indicate changes');
            assert.strictEqual(summary.duplicateGroups, 1, 'Expected one duplicate group');
            assert.ok(summary.stoppedBotIds.includes('old1'), 'Old bot should be stopped');
            assert.ok(summary.keptBotIds.includes('new1'), 'Newest bot should be kept active');

            const after = manager.loadBots();
            const old = after.find((b) => b.bot_id === 'old1');
            const fresh = after.find((b) => b.bot_id === 'new1');
            assert.strictEqual(old.status, 'stopped', 'Older duplicate must be stopped');
            assert.strictEqual(fresh.status, 'active', 'Newest duplicate must stay active');
        });
    } finally {
        try {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
            // no-op
        }
    }

    console.log('\n============================================================');
    console.log('📊 BotsManager Dedupe Test Summary');
    console.log('============================================================');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Total: ${passed + failed}`);
    console.log('============================================================\n');

    process.exit(failed === 0 ? 0 : 1);
}

runTests();

