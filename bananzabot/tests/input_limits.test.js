const assert = require('assert');
const inputLimitsModule = require('../inputLimits.ts');
const { MAX_SINGLE_MESSAGE_INPUT_CHARS, validateSingleMessageInputLength } = inputLimitsModule.default || inputLimitsModule;

function runTests() {
    console.log('\n🧪 Running Input Limits Tests...\n');

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

    test('should allow text up to the configured max length', () => {
        const text = 'a'.repeat(MAX_SINGLE_MESSAGE_INPUT_CHARS);
        const result = validateSingleMessageInputLength(text);
        assert.strictEqual(result.ok, true);
    });

    test('should reject text longer than max and mention telegram limit', () => {
        const text = 'a'.repeat(MAX_SINGLE_MESSAGE_INPUT_CHARS + 1);
        const result = validateSingleMessageInputLength(text);
        assert.strictEqual(result.ok, false);
        assert.ok(result.message.includes(String(MAX_SINGLE_MESSAGE_INPUT_CHARS)));
        assert.ok(result.message.toLowerCase().includes('telegram'));
    });

    console.log('\n============================================================');
    console.log('📊 Input Limits Test Summary');
    console.log('============================================================');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Total: ${passed + failed}`);
    console.log('============================================================\n');

    process.exit(failed === 0 ? 0 : 1);
}

runTests();

