const assert = require('assert');
const utilities = require('../utilities');

function runTests() {
    console.log('\n🧪 Running Utilities Tests...\n');

    let passed = 0;
    let failed = 0;
    const failures = [];

    const testSuites = [
        {
            name: 'sanitizeString()',
            tests: [
                {
                    name: 'should return string unchanged',
                    fn: () => {
                        const input = 'test string <script>alert(1)</script>';
                        const result = utilities.sanitizeString(input);
                        assert.strictEqual(result, input);
                    }
                },
                {
                    name: 'should handle empty string',
                    fn: () => {
                        const result = utilities.sanitizeString('');
                        assert.strictEqual(result, '');
                    }
                },
                {
                    name: 'should handle unicode',
                    fn: () => {
                        const input = 'Привет мир 🌍';
                        const result = utilities.sanitizeString(input);
                        assert.strictEqual(result, input);
                    }
                }
            ]
        },
        {
            name: 'validateChatId()',
            tests: [
                {
                    name: 'should accept valid number chatId',
                    fn: () => {
                        assert.strictEqual(utilities.validateChatId(123456789), true);
                        assert.strictEqual(utilities.validateChatId(-123456789), true);
                    }
                },
                {
                    name: 'should accept valid string chatId',
                    fn: () => {
                        assert.strictEqual(utilities.validateChatId('123456789'), true);
                        assert.strictEqual(utilities.validateChatId('-123456789'), true);
                    }
                },
                {
                    name: 'should reject zero',
                    fn: () => {
                        assert.strictEqual(utilities.validateChatId(0), false);
                        assert.strictEqual(utilities.validateChatId('0'), false);
                    }
                },
                {
                    name: 'should reject non-integer numbers',
                    fn: () => {
                        assert.strictEqual(utilities.validateChatId(123.45), false);
                        assert.strictEqual(utilities.validateChatId('123.45'), false);
                    }
                },
                {
                    name: 'should reject invalid types',
                    fn: () => {
                        assert.strictEqual(utilities.validateChatId(null), false);
                        assert.strictEqual(utilities.validateChatId(undefined), false);
                        assert.strictEqual(utilities.validateChatId({}), false);
                        assert.strictEqual(utilities.validateChatId([]), false);
                        assert.strictEqual(utilities.validateChatId('abc'), false);
                    }
                }
            ]
        },
        {
            name: 'validateImageResponse()',
            tests: [
                {
                    name: 'should accept valid response',
                    fn: () => {
                        const response = { data: { length: 1000 } };
                        assert.strictEqual(utilities.validateImageResponse(response), true);
                    }
                },
                {
                    name: 'should reject null/undefined',
                    fn: () => {
                        assert.throws(() => utilities.validateImageResponse(null), /Invalid image response/);
                        assert.throws(() => utilities.validateImageResponse(undefined), /Invalid image response/);
                    }
                },
                {
                    name: 'should reject missing data',
                    fn: () => {
                        assert.throws(() => utilities.validateImageResponse({}), /Invalid image response/);
                    }
                },
                {
                    name: 'should reject oversized images',
                    fn: () => {
                        const response = { data: { length: 20 * 1024 * 1024 } };
                        assert.throws(
                            () => utilities.validateImageResponse(response, 10 * 1024 * 1024),
                            /exceeds maximum/
                        );
                    }
                },
                {
                    name: 'should accept custom max size',
                    fn: () => {
                        const response = { data: { length: 5 * 1024 * 1024 } };
                        assert.strictEqual(utilities.validateImageResponse(response, 10 * 1024 * 1024), true);
                    }
                }
            ]
        },
        {
            name: 'validateMimeTypeImg()',
            tests: [
                {
                    name: 'should accept valid image mime types',
                    fn: () => {
                        assert.strictEqual(utilities.validateMimeTypeImg('image/jpeg'), true);
                        assert.strictEqual(utilities.validateMimeTypeImg('image/png'), true);
                        assert.strictEqual(utilities.validateMimeTypeImg('image/gif'), true);
                        assert.strictEqual(utilities.validateMimeTypeImg('image/webp'), true);
                        assert.strictEqual(utilities.validateMimeTypeImg('image/bmp'), true);
                    }
                },
                {
                    name: 'should reject invalid mime types',
                    fn: () => {
                        assert.strictEqual(utilities.validateMimeTypeImg('image/svg+xml'), false);
                        assert.strictEqual(utilities.validateMimeTypeImg('video/mp4'), false);
                        assert.strictEqual(utilities.validateMimeTypeImg('text/plain'), false);
                    }
                }
            ]
        },
        {
            name: 'validateMimeTypeAudio()',
            tests: [
                {
                    name: 'should accept valid audio mime types',
                    fn: () => {
                        assert.strictEqual(utilities.validateMimeTypeAudio('audio/mp3'), true);
                        assert.strictEqual(utilities.validateMimeTypeAudio('audio/mpeg'), true);
                        assert.strictEqual(utilities.validateMimeTypeAudio('audio/ogg'), true);
                        assert.strictEqual(utilities.validateMimeTypeAudio('audio/wav'), true);
                        assert.strictEqual(utilities.validateMimeTypeAudio('audio/x-wav'), true);
                        assert.strictEqual(utilities.validateMimeTypeAudio('audio/mp4'), true);
                        assert.strictEqual(utilities.validateMimeTypeAudio('audio/m4a'), true);
                        assert.strictEqual(utilities.validateMimeTypeAudio('audio/x-m4a'), true);
                    }
                },
                {
                    name: 'should reject invalid mime types',
                    fn: () => {
                        assert.strictEqual(utilities.validateMimeTypeAudio('audio/flac'), false);
                        assert.strictEqual(utilities.validateMimeTypeAudio('video/mp4'), false);
                        assert.strictEqual(utilities.validateMimeTypeAudio('text/plain'), false);
                    }
                }
            ]
        },
        {
            name: 'generateMessageHash()',
            tests: [
                {
                    name: 'should return hex string',
                    fn: () => {
                        const hash = utilities.generateMessageHash(123, Date.now());
                        assert.strictEqual(typeof hash, 'string');
                        assert.ok(/^[a-f0-9]{64}$/.test(hash), 'Should be 64 hex chars');
                    }
                },
                {
                    name: 'should produce consistent hashes',
                    fn: () => {
                        const chatId = 123456;
                        const timestamp = 1700000000000;
                        const hash1 = utilities.generateMessageHash(chatId, timestamp);
                        const hash2 = utilities.generateMessageHash(chatId, timestamp);
                        assert.strictEqual(hash1, hash2);
                    }
                },
                {
                    name: 'should produce different hashes for different inputs',
                    fn: () => {
                        const hash1 = utilities.generateMessageHash(123, 1000);
                        const hash2 = utilities.generateMessageHash(456, 1000);
                        const hash3 = utilities.generateMessageHash(123, 2000);
                        assert.notStrictEqual(hash1, hash2);
                        assert.notStrictEqual(hash1, hash3);
                    }
                }
            ]
        }
    ];

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

if (require.main === module) {
    runTests();
}

module.exports = { runTests };
