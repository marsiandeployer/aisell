const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const BotsManagerModule = require('../botsManager.ts');
const BotsManager = BotsManagerModule.default || BotsManagerModule;

function runTests() {
    console.log('\n🧪 Running BotsManager Metadata Tests...\n');

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

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bananzabot-bots-manager-meta-'));
    const tmpDbDir = path.join(tmpRoot, 'bots_database');
    const tmpDbPath = path.join(tmpDbDir, 'bots.json');

    try {
        const manager = new BotsManager();
        manager.botsDbPath = tmpDbPath;
        manager.ensureDatabase();

        test('createBot should persist bot metadata from Telegram getMe', () => {
            const created = manager.createBot(
                'u-meta-1',
                '777:token_metadata_abcdefghijklmnopqrstuvwxyz',
                'prompt',
                [{ role: 'user', content: 'hi' }],
                null,
                { username: 'meta_bot', first_name: 'Meta Bot', id: 123456789 }
            );

            assert.strictEqual(created.username, 'meta_bot');
            assert.strictEqual(created.first_name, 'Meta Bot');
            assert.strictEqual(created.telegram_id, 123456789);
        });

        test('upsert by api_key should refresh metadata on second token submission', () => {
            const first = manager.createBot(
                'u-meta-2',
                '888:token_same_meta_abcdefghijklmnopqrstuvwxyz',
                'prompt one',
                [],
                null,
                { username: 'old_name', first_name: 'Old Name', id: 111 }
            );
            const second = manager.createBot(
                'u-meta-2',
                '888:token_same_meta_abcdefghijklmnopqrstuvwxyz',
                'prompt two',
                [],
                null,
                { username: 'new_name', first_name: 'New Name', id: 222 }
            );

            assert.strictEqual(first.bot_id, second.bot_id, 'upsert must keep same bot_id');
            const stored = manager.getBotByApiKey('888:token_same_meta_abcdefghijklmnopqrstuvwxyz');
            assert.ok(stored, 'stored bot must exist');
            assert.strictEqual(stored.username, 'new_name');
            assert.strictEqual(stored.first_name, 'New Name');
            assert.strictEqual(stored.telegram_id, 222);
            assert.strictEqual(stored.prompt, 'prompt two');
        });
    } finally {
        try {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
            // no-op
        }
    }

    console.log('\n============================================================');
    console.log('📊 BotsManager Metadata Test Summary');
    console.log('============================================================');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Total: ${passed + failed}`);
    console.log('============================================================\n');

    process.exit(failed === 0 ? 0 : 1);
}

runTests();
