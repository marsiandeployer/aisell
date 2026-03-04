// Test: callOpenAI retry behavior on 429 (rate limit) errors
// Validates that BotInstanceManager retries at least 3 times with sufficient backoff
//
// Since botInstanceManager.ts uses `export =` (not supported by Node strip-only TS),
// we read the source and verify the retry constants directly.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
    console.log('\n🧪 Running 429 Retry Tests...\n');

    let passed = 0;
    let failed = 0;
    const failures = [];

    const src = fs.readFileSync(
        path.join(__dirname, '..', 'botInstanceManager.ts'),
        'utf-8'
    );

    // Find the callOpenAI method and extract its retry loop
    const callOpenAIStart = src.indexOf('async callOpenAI(');
    assert.ok(callOpenAIStart !== -1, 'callOpenAI method not found');

    // Extract a window around the retry loop (enough context for the full method)
    const searchWindow = src.slice(callOpenAIStart, callOpenAIStart + 3000);

    const tests = [
        {
            name: 'callOpenAI should have at least 3 retry attempts',
            fn: () => {
                // Match: for (let attempt = 1; attempt <= N; ...)
                const loopMatch = searchWindow.match(
                    /for\s*\(\s*let\s+attempt\s*=\s*1\s*;\s*attempt\s*<=\s*(\d+)/
                );
                assert.ok(loopMatch, 'Retry loop not found in callOpenAI');
                const maxAttempts = parseInt(loopMatch[1], 10);
                assert.ok(
                    maxAttempts >= 3,
                    `Expected at least 3 max attempts, got ${maxAttempts}`
                );
            },
        },
        {
            name: 'callOpenAI break condition should match max attempts',
            fn: () => {
                // Match: attempt === N) break;
                const breakMatch = searchWindow.match(
                    /attempt\s*===\s*(\d+)\)\s*break/
                );
                assert.ok(breakMatch, 'Break condition not found in callOpenAI');
                const breakAt = parseInt(breakMatch[1], 10);
                assert.ok(
                    breakAt >= 3,
                    `Expected break at attempt >= 3, got ${breakAt}`
                );
            },
        },
        {
            name: 'callOpenAI should have backoff >= 3000ms per attempt',
            fn: () => {
                // Match: sleep(N * attempt) or sleep(N*attempt)
                const sleepMatch = searchWindow.match(
                    /sleep\(\s*(\d+)\s*\*\s*attempt\s*\)/
                );
                assert.ok(sleepMatch, 'sleep(N * attempt) not found in callOpenAI');
                const baseMs = parseInt(sleepMatch[1], 10);
                assert.ok(
                    baseMs >= 3000,
                    `Expected base backoff >= 3000ms, got ${baseMs}ms`
                );
            },
        },
        {
            name: 'total minimum backoff should be >= 6000ms for 3 attempts',
            fn: () => {
                const loopMatch = searchWindow.match(
                    /for\s*\(\s*let\s+attempt\s*=\s*1\s*;\s*attempt\s*<=\s*(\d+)/
                );
                const sleepMatch = searchWindow.match(
                    /sleep\(\s*(\d+)\s*\*\s*attempt\s*\)/
                );
                assert.ok(loopMatch && sleepMatch, 'Could not parse retry parameters');
                const maxAttempts = parseInt(loopMatch[1], 10);
                const baseMs = parseInt(sleepMatch[1], 10);
                // Backoff happens between attempts: sleep after attempt 1, 2, ..., (N-1)
                // Total = baseMs * (1 + 2 + ... + (N-1))
                let totalBackoff = 0;
                for (let a = 1; a < maxAttempts; a++) {
                    totalBackoff += baseMs * a;
                }
                assert.ok(
                    totalBackoff >= 6000,
                    `Expected total backoff >= 6000ms, got ${totalBackoff}ms (base=${baseMs}, attempts=${maxAttempts})`
                );
            },
        },
    ];

    for (const test of tests) {
        try {
            test.fn();
            console.log(`  ✅ ${test.name}`);
            passed++;
        } catch (err) {
            console.log(`  ❌ ${test.name}`);
            console.log(`     ${err.message}`);
            failures.push({ name: test.name, error: err.message });
            failed++;
        }
    }

    console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
    if (failures.length > 0) {
        console.log('Failures:');
        failures.forEach((f) => console.log(`  - ${f.name}: ${f.error}`));
        process.exit(1);
    }
}

runTests();
