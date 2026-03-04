// CHANGE: Add tests for conversation history persistence
// WHY: Ensure chat history is saved to disk and survives process restarts (admin relies on it)
// REF: User request - "добавь тест что история переписки с ботами точно сохраняется"
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const conversationStore = require('../conversationStore');
const ConversationManager = require('../conversationManager');

/**
 * Simple test runner (no external dependencies)
 */
function runTests() {
    console.log('\n🧪 Running History Persistence Tests...\n');

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

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bananzabot-history-'));
    const tmpConversationsBase = path.join(tmpRoot, 'conversations');

    // Monkey-patch storage location to avoid touching real data in repo.
    const originalGetBaseDir = conversationStore.getBaseDir;
    const originalMigrate = conversationStore.migrateLegacyConversationsIfNeeded;
    conversationStore.getBaseDir = () => tmpConversationsBase;
    conversationStore.migrateLegacyConversationsIfNeeded = () => ({ migrated: false, reason: 'skipped_for_test' });

    try {
        const userId = '9999999999';
        const marker = `HISTORY_MARKER_${Date.now()}`;
        const assistantMarker = `ASSISTANT_${marker}`;

        test('should write conversation file to disk (atomic write, no .tmp left)', () => {
            const cm = new ConversationManager();
            cm.addMessage(userId, 'user', marker);
            cm.addMessage(userId, 'assistant', assistantMarker);
            cm.setUserStage(userId, 'testing');

            const convoPath = conversationStore.getMainConversationPath(userId);
            assert.ok(fs.existsSync(convoPath), `Conversation file missing: ${convoPath}`);
            assert.ok(!fs.existsSync(`${convoPath}.tmp`), 'Atomic tmp file should not remain on disk');

            const onDisk = JSON.parse(fs.readFileSync(convoPath, 'utf8'));
            assert.strictEqual(onDisk.stage, 'testing', 'Stage should be persisted');
            assert.ok(Array.isArray(onDisk.messages), 'messages should be an array');
            assert.ok(onDisk.messages.some((m) => m && m.content === marker), 'User message should be persisted');
            assert.ok(onDisk.messages.some((m) => m && m.content === assistantMarker), 'Assistant message should be persisted');
        });

        test('should load persisted conversation in a new instance (simulated restart)', () => {
            const cm = new ConversationManager();
            const convo = cm.getUserConversation(userId);
            assert.strictEqual(convo.stage, 'testing', 'Stage should survive restart');
            assert.ok(convo.messages.some((m) => m && m.content === marker), 'User message should survive restart');
            assert.ok(convo.messages.some((m) => m && m.content === assistantMarker), 'Assistant message should survive restart');
        });
    } finally {
        // Restore monkey patches.
        conversationStore.getBaseDir = originalGetBaseDir;
        conversationStore.migrateLegacyConversationsIfNeeded = originalMigrate;

        // Cleanup temp folder.
        try {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
            // no-op
        }
    }

    console.log('\n============================================================');
    console.log('📊 History Persistence Test Summary');
    console.log('============================================================');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Total: ${passed + failed}`);
    console.log('============================================================\n');

    process.exit(failed === 0 ? 0 : 1);
}

runTests();

