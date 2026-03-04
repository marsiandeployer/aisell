#!/usr/bin/env node

/**
 * CLI script to run E2E tests for Bananzabot
 * Usage: npm run test:e2e
 */

const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const crypto = require('crypto');

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TestRunner = require('./testRunner');
const promptManager = require('./promptManager');
const { readAiSettings } = require('../aiSettings');

function sha256Hex(text) {
    return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function computeFixturesHash(fixturesDir, testId) {
    const files = fs.readdirSync(fixturesDir)
        .filter(f => f.endsWith('.json'))
        .sort();

    const selected = testId
        ? files.filter(file => {
            const testCase = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
            return testCase.id === testId;
        })
        : files;

    const h = crypto.createHash('sha256');
    for (const f of selected) {
        const full = path.join(fixturesDir, f);
        const content = fs.readFileSync(full, 'utf8');
        h.update(f, 'utf8');
        h.update('\n', 'utf8');
        h.update(content, 'utf8');
        h.update('\n---\n', 'utf8');
    }
    return { hash: h.digest('hex'), count: selected.length, files: selected };
}

function getFixturesLatestMtimeMs(fixturesDir) {
    let max = 0;
    const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
        const st = fs.statSync(path.join(fixturesDir, f));
        if (st.mtimeMs > max) max = st.mtimeMs;
    }
    return max;
}

function loadPromptsFile() {
    const promptsPath = path.join(__dirname, '..', 'prompts.json');
    const raw = fs.readFileSync(promptsPath, 'utf8');
    return JSON.parse(raw);
}

function loadLatestTestHistoryRun() {
    const historyPath = path.join(__dirname, '..', 'test_history.json');
    if (!fs.existsSync(historyPath)) return null;
    const raw = fs.readFileSync(historyPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed[0];
}

function tryGetCachedResults({ promptInfo, systemPrompt, testModel, fixtures }) {
    // Skip cache for targeted single-test runs (simpler + avoids wrong reuse).
    if (fixtures.testId) return null;

    let prompts;
    try {
        prompts = loadPromptsFile();
    } catch {
        return null;
    }

    const currentVersion = promptInfo.version;
    const versionEntry = Array.isArray(prompts.versions) ? prompts.versions.find(v => v && v.version === currentVersion) : null;
    const tr = versionEntry && versionEntry.test_results ? versionEntry.test_results : null;
    if (!tr) return null;

    // Only cache if last run was fully green.
    if (typeof tr.failed !== 'number' || tr.failed !== 0) return null;
    if (typeof tr.passed !== 'number' || tr.passed <= 0) return null;

    const testedAtMs = Date.parse(tr.tested_at || '');
    if (!Number.isFinite(testedAtMs)) return null;

    // Ensure prompt and fixtures weren't updated after tests ran.
    const promptUpdatedMs = Date.parse(promptInfo.updated_at || '');
    if (Number.isFinite(promptUpdatedMs) && promptUpdatedMs > testedAtMs) return null;

    const fixturesLatestMtimeMs = getFixturesLatestMtimeMs(fixtures.fixturesDir);
    if (fixturesLatestMtimeMs > testedAtMs) return null;

    const expectedTotal = fixtures.count;
    if (typeof tr.total === 'number' && tr.total !== expectedTotal) return null;

    // Strong cache key if available (new format).
    const promptHash = sha256Hex(systemPrompt);
    if (tr.test_model && tr.system_prompt_hash && tr.fixtures_hash) {
        if (tr.test_model !== testModel) return null;
        if (tr.system_prompt_hash !== promptHash) return null;
        if (tr.fixtures_hash !== fixtures.hash) return null;
    } else {
        // Backward-compatible cache: verify latest history entry matches model and is not failing.
        const lastRun = loadLatestTestHistoryRun();
        if (!lastRun) return null;
        if (lastRun.testModel !== testModel) return null;
        if (lastRun.failed !== 0) return null;
        if (lastRun.passed !== lastRun.total) return null;
        if (lastRun.total !== expectedTotal) return null;
        const lastRunMs = Date.parse(lastRun.timestamp || '');
        if (!Number.isFinite(lastRunMs)) return null;
        // Ensure the last run happened after (or around) prompts.json tested_at.
        if (lastRunMs + 60_000 < testedAtMs) return null;
    }

    // Build "cached passed" results.
    const cachedResults = fixtures.files.map((file) => {
        const testCase = JSON.parse(fs.readFileSync(path.join(fixtures.fixturesDir, file), 'utf8'));
        return {
            testId: testCase.id,
            testName: testCase.name,
            category: testCase.category,
            passed: true,
            score: 100,
            model_used: testModel,
            conversation: [],
            checks: [],
            evaluation: { total: 100, feedback: 'SKIPPED (cached): prompt/fixtures/model unchanged' },
            executedAt: new Date().toISOString(),
            cached: true
        };
    });

    return {
        timestamp: new Date().toISOString(),
        systemPrompt: systemPrompt.substring(0, 100) + '...',
        testModel: testModel,
        total: cachedResults.length,
        passed: cachedResults.length,
        failed: 0,
        avgScore: 100,
        results: cachedResults,
        cached: true
    };
}

async function main() {
    console.log('🧪 Запуск E2E тестов Bananzabot...\n');

    try {
        // Получить testId из аргументов командной строки
        // Usage: npm run test:e2e test-001-prompt-creation-flower-shop
        const testId = process.argv[2];

        // Загрузить system prompt
        console.log('📖 Загрузка системного промпта...');
        const systemPrompt = await promptManager.loadSystemPrompt();
        const promptInfo = await promptManager.getCurrentPromptInfo();
        console.log(`✅ Промпт загружен (версия: ${promptInfo.version})\n`);

        // Получить test_model из ai_settings.json
        const aiSettings = readAiSettings();
        const testModel = aiSettings.test_model || aiSettings.bot_model;
        console.log(`🤖 Модель для тестирования: ${testModel}\n`);

        const fixturesDir = path.join(__dirname, 'fixtures');
        const fixtures = computeFixturesHash(fixturesDir, testId);
        fixtures.fixturesDir = fixturesDir;
        fixtures.testId = testId || null;

        // Cache: if prompt/fixtures/model unchanged and last results were green, skip Hydra calls.
        const cached = tryGetCachedResults({ promptInfo, systemPrompt, testModel, fixtures });
        if (cached) {
            console.log(`🧠 Cache hit: prompt v${promptInfo.version} unchanged. Skipping Hydra API calls.\n`);

            // Print results in the same format as normal run.
            console.log('\n📊 РЕЗУЛЬТАТЫ:\n');
            console.log('━'.repeat(60));
            console.log(`Всего тестов:     ${cached.total}`);
            console.log(`✅ Пройдено:      ${cached.passed} (${Math.round(cached.passed / cached.total * 100)}%)`);
            console.log(`❌ Провалено:     ${cached.failed} (${Math.round(cached.failed / cached.total * 100)}%)`);
            console.log(`📈 Средний score: ${cached.avgScore}%`);
            console.log('━'.repeat(60));

            console.log('\n📝 Детали тестов:\n');
            cached.results.forEach(r => {
                const status = r.passed ? '✅' : '❌';
                const color = r.passed ? '\x1b[32m' : '\x1b[31m';
                const reset = '\x1b[0m';
                console.log(`${status} ${color}${r.testName}${reset} - ${r.score}%`);
                console.log(`   Категория: ${r.category}`);
                if (r.evaluation && r.evaluation.feedback) {
                    console.log(`   Фидбек: ${r.evaluation.feedback}`);
                }
                console.log('');
            });

            console.log('✅ Все тесты успешно пройдены! (cached)\n');
            process.exit(0);
        }

        // Запустить тесты (все или один конкретный)
        console.log('🚀 Запуск тестов...\n');
        const results = await TestRunner.runAllTests(systemPrompt, testModel, testId);

        // Attach cache keys (stored in prompts.json for future cache hits).
        results.testModel = testModel;
        results.systemPromptHash = sha256Hex(systemPrompt);
        results.fixturesHash = fixtures.hash;

        // Сохранить результаты в версию промпта
        await promptManager.updateTestResults(results);

        // Вывести результаты
        console.log('\n📊 РЕЗУЛЬТАТЫ:\n');
        console.log('━'.repeat(60));
        console.log(`Всего тестов:     ${results.total}`);
        console.log(`✅ Пройдено:      ${results.passed} (${Math.round(results.passed / results.total * 100)}%)`);
        console.log(`❌ Провалено:     ${results.failed} (${Math.round(results.failed / results.total * 100)}%)`);
        console.log(`📈 Средний score: ${results.avgScore}%`);
        console.log('━'.repeat(60));

        // Детали по каждому тесту
        console.log('\n📝 Детали тестов:\n');
        results.results.forEach(r => {
            const status = r.passed ? '✅' : '❌';
            const color = r.passed ? '\x1b[32m' : '\x1b[31m'; // Green or Red
            const reset = '\x1b[0m';

            console.log(`${status} ${color}${r.testName}${reset} - ${r.score}%`);
            console.log(`   Категория: ${r.category}`);

            if (r.evaluation && r.evaluation.feedback) {
                console.log(`   Фидбек: ${r.evaluation.feedback}`);
            }

            if (r.error) {
                console.log(`   ⚠️  Ошибка: ${r.error}`);
            }

            console.log('');
        });

        // Exit code: 0 if all tests passed, 1 if any failed
        const exitCode = results.results.every(r => r.passed) ? 0 : 1;

        if (exitCode === 0) {
            console.log('✅ Все тесты успешно пройдены!\n');
        } else {
            console.log('❌ Некоторые тесты провалились. Проверьте логи выше.\n');
        }

        process.exit(exitCode);

    } catch (error) {
        console.error('\n❌ Ошибка при запуске тестов:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Запустить тесты
main();
