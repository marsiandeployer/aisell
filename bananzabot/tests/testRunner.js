const fs = require('fs');
const path = require('path');
const axios = require('axios');
const TestEvaluator = require('./testEvaluator');
const { getHydraConfig } = require('../aiSettings');

class TestRunner {
    /**
     * Запустить все E2E тесты (или один конкретный по ID)
     * @param {string} systemPrompt - Системный промпт для тестирования
     * @param {string} testModel - Модель AI для тестирования (например, gemini-3-flash)
     * @param {string} testId - Опционально: ID конкретного теста для запуска
     * @returns {Promise<Object>} Результаты всех тестов
     */
    static async runAllTests(systemPrompt, testModel, testId = null) {
        console.log('[TestRunner] 🧪 Запуск всех E2E тестов...');
        console.log(`[TestRunner] Модель для тестирования: ${testModel}`);
        if (testId) {
            console.log(`[TestRunner] Запуск только теста: ${testId}`);
        }

        try {
            // Загрузить все тест-кейсы из fixtures/
            const fixturesDir = path.join(__dirname, 'fixtures');
            let testFiles = fs.readdirSync(fixturesDir)
                .filter(file => file.endsWith('.json'))
                .sort();

            // Фильтровать по testId если указан
            if (testId) {
                testFiles = testFiles.filter(file => {
                    const testCase = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
                    return testCase.id === testId;
                });

                if (testFiles.length === 0) {
                    throw new Error(`Тест с ID "${testId}" не найден`);
                }
            }

            console.log(`[TestRunner] Найдено ${testFiles.length} тест-кейсов`);

            const results = [];

            // Запустить каждый тест
            for (let i = 0; i < testFiles.length; i++) {
                const testFile = testFiles[i];
                const testCasePath = path.join(fixturesDir, testFile);
                const testCase = JSON.parse(fs.readFileSync(testCasePath, 'utf8'));

                console.log(`[TestRunner] Запуск теста: ${testCase.name} (${testCase.id})`);

                const result = await this.runSingleTest(testCase, systemPrompt, testModel);
                results.push(result);

                console.log(`[TestRunner] ${result.passed ? '✅' : '❌'} ${testCase.id} - Score: ${result.score}%`);

                // CHANGE: Add delay between tests to avoid rate limits
                // WHY: Hydra API has rate limit of 10 requests per minute
                // REF: 429 Too Many Requests error in test results
                if (i < testFiles.length - 1) {
                    console.log('[TestRunner] ⏳ Waiting 8 seconds to avoid rate limits...');
                    await new Promise(resolve => setTimeout(resolve, 8000));
                }
            }

            // Подготовить итоговый summary
            const summary = {
                timestamp: new Date().toISOString(),
                systemPrompt: systemPrompt.substring(0, 100) + '...',
                testModel: testModel,
                total: results.length,
                passed: results.filter(r => r.passed).length,
                failed: results.filter(r => !r.passed).length,
                avgScore: Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length),
                results: results
            };

            // Сохранить результаты в test_history.json
            await this.saveTestHistory(summary);

            console.log('[TestRunner] ✅ Все тесты завершены');
            console.log(`[TestRunner] Пройдено: ${summary.passed}/${summary.total}`);
            console.log(`[TestRunner] Средний score: ${summary.avgScore}%`);

            return summary;

        } catch (error) {
            console.error('[TestRunner] Ошибка при запуске тестов:', error.message);
            throw error;
        }
    }

    /**
     * Запустить один тест-кейс
     * @param {Object} testCase - Тест-кейс из fixtures/
     * @param {string} systemPrompt - Системный промпт
     * @param {string} testModel - Модель AI для тестирования
     * @returns {Promise<Object>} Результат теста
     */
    static async runSingleTest(testCase, systemPrompt, testModel) {
        const conversation = [];
        const checks = [];

        try {
            // CHANGE: Support use_system_prompt flag for prompt generation tests
            // WHY: Prompt generation tests should use actual promptBuilder system prompt
            // REF: Testing bot creation process, not ready-made bots
            const promptToUse = testCase.use_system_prompt ? systemPrompt : (testCase.bot_prompt || systemPrompt);

            // Проходим по каждому шагу диалога
            for (let i = 0; i < testCase.conversation.length; i++) {
                const turn = testCase.conversation[i];

                if (turn.role === 'user') {
                    // Эмулируем сообщение пользователя
                    conversation.push({
                        role: 'user',
                        content: turn.content,
                        timestamp: new Date().toISOString()
                    });

                    // Получаем ответ бота через AI
                    const botResponse = await this.callAI(
                        promptToUse,
                        conversation,
                        testModel
                    );

                    conversation.push({
                        role: 'assistant',
                        content: botResponse,
                        timestamp: new Date().toISOString()
                    });

                    // ВАЖНО: Проверяем что текст отправлен юзеру (не пустой)
                    const messageSentCheck = {
                        type: 'message_sent_to_user',
                        passed: botResponse && botResponse.trim().length > 0,
                        message: botResponse ? `Message sent to user (${botResponse.length} chars)` : 'No message sent to user',
                        content: botResponse
                    };
                    checks.push(messageSentCheck);

                    console.log(`[TestRunner] ${messageSentCheck.passed ? '✅' : '❌'} Message sent to user: ${botResponse.substring(0, 50)}...`);

                    // Проверяем следующий шаг (ожидаемый ответ бота)
                    if (i + 1 < testCase.conversation.length && testCase.conversation[i + 1].role === 'assistant') {
                        const expected = testCase.conversation[i + 1];

                        // Проверка must_include (обязательные элементы)
                        if (expected.must_include) {
                            const mustIncludeCheck = TestEvaluator.checkMustInclude(
                                botResponse,
                                expected.must_include
                            );
                            checks.push({
                                type: 'must_include',
                                passed: mustIncludeCheck.passed,
                                details: mustIncludeCheck
                            });
                        }

                        // Проверка expected_keywords (ключевые слова)
                        if (expected.expected_keywords) {
                            const keywordsCheck = TestEvaluator.checkKeywords(
                                botResponse,
                                expected.expected_keywords
                            );
                            checks.push({
                                type: 'keywords',
                                passed: keywordsCheck.passed,
                                details: keywordsCheck
                            });
                        }

                        // Пропускаем следующий элемент (expected assistant response)
                        i++;
                    }
                }
            }

            // Вызываем AI evaluator для оценки всего диалога
            const aiEvaluation = await TestEvaluator.evaluateConversation(
                conversation,
                testCase,
                testModel
            );

            // Определяем прохождение теста (порог 70%)
            const passed = aiEvaluation.total >= 70;

            return {
                testId: testCase.id,
                testName: testCase.name,
                category: testCase.category,
                passed: passed,
                score: aiEvaluation.total,
                model_used: testModel, // ВАЖНО: Указываем какая модель использовалась
                conversation: conversation, // ВАЖНО: Конкретные диалоги видны в истории
                checks: checks,
                evaluation: aiEvaluation,
                executedAt: new Date().toISOString()
            };

        } catch (error) {
            console.error(`[TestRunner] Ошибка при выполнении теста ${testCase.id}:`, error.message);

            // Возвращаем провальный результат при ошибке
            return {
                testId: testCase.id,
                testName: testCase.name,
                category: testCase.category,
                passed: false,
                score: 0,
                model_used: testModel,
                conversation: conversation,
                checks: checks,
                evaluation: {
                    total: 0,
                    feedback: `Test execution failed: ${error.message}`
                },
                error: error.message,
                executedAt: new Date().toISOString()
            };
        }
    }

    /**
     * Вызов AI через Hydra API
     * @param {string} systemPrompt - Системный промпт
     * @param {Array} conversation - История диалога
     * @param {string} model - Модель AI
     * @returns {Promise<string>} Ответ AI
     */
    static async callAI(systemPrompt, conversation, model) {
        const config = getHydraConfig();

        const messages = [
            { role: 'system', content: systemPrompt },
            ...conversation.map(m => ({
                role: m.role,
                content: m.content
            }))
        ];

        const requestBody = {
            model: model,
            messages: messages,
            temperature: 0.8, // Обычная temperature для ботов
            max_tokens: 600
        };

        console.log(`[TestRunner] 🔍 Calling Hydra API with model: ${model}`);

        try {
            // CHANGE: Create axios instance with proper config to fix 400 Bad Request
            // WHY: Default axios config was causing 400 errors from nginx
            // REF: Tested with native https and found axios needs explicit config
            // CHANGE: Set timeout to 120 seconds for Hydra API calls in E2E tests
            // WHY: Some model responses are slow under load and 30s causes false negatives (0/4).
            const axiosInstance = axios.create({
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 120000, // 120 seconds to avoid false timeout failures
                proxy: false,
                maxRedirects: 0,
                transformRequest: [(data) => JSON.stringify(data)],
                transformResponse: [(data) => {
                    try {
                        return JSON.parse(data);
                    } catch (e) {
                        return data;
                    }
                }]
            });

            // CHANGE: Add retries/backoff for transient Hydra failures.
            // WHY: Full E2E run may hit 429/5xx/timeouts and should retry instead of hard-failing the suite.
            // REF: "Too many requests. Limit: 10 per minute." during test-004.
            const maxAttempts = 6;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    const response = await axiosInstance.post(
                        `${config.baseUrl}/chat/completions`,
                        requestBody
                    );

                    if (response.data && response.data.choices && response.data.choices[0]) {
                        return response.data.choices[0].message.content;
                    }

                    throw new Error('Invalid API response structure');
                } catch (error) {
                    const status = error && error.response ? error.response.status : null;
                    const timeoutErr = error && (error.code === 'ECONNABORTED' || String(error.message || '').toLowerCase().includes('timeout'));
                    const retriableStatus = status === 429 || (typeof status === 'number' && status >= 500);
                    if ((timeoutErr || retriableStatus) && attempt < maxAttempts) {
                        const waitMs = timeoutErr ? 8000 * attempt : 12000 * attempt;
                        const reason = timeoutErr ? 'timeout' : `status ${status}`;
                        console.warn(`[TestRunner] Transient API failure (${reason}). Waiting ${Math.round(waitMs / 1000)}s before retry (${attempt}/${maxAttempts})...`);
                        await new Promise(resolve => setTimeout(resolve, waitMs));
                        continue;
                    }

                    console.error('[TestRunner] API call failed:', error.message);
                    if (error.response) {
                        console.error('[TestRunner] Response status:', error.response.status);
                        console.error('[TestRunner] Response data:', JSON.stringify(error.response.data).substring(0, 500));
                    }
                    throw error;
                }
            }

            throw new Error('Hydra API call failed after retries');
        } catch (error) {
            console.error('[TestRunner] API call failed:', error.message);
            if (error.response) {
                console.error('[TestRunner] Response status:', error.response.status);
                console.error('[TestRunner] Response data:', JSON.stringify(error.response.data).substring(0, 500));
            }
            throw error;
        }
    }

    /**
     * Сохранить результаты в test_history.json
     * @param {Object} summary - Результаты тестов
     */
    static async saveTestHistory(summary) {
        const historyPath = path.join(__dirname, '..', 'test_history.json');

        let history = [];
        if (fs.existsSync(historyPath)) {
            try {
                history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
            } catch (error) {
                console.warn('[TestRunner] Failed to load test history, starting fresh');
                history = [];
            }
        }

        // Добавляем новый запуск в начало
        history.unshift(summary);

        // Храним только последние 20 запусков
        if (history.length > 20) {
            history = history.slice(0, 20);
        }

        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
        console.log(`[TestRunner] Результаты сохранены в ${historyPath}`);
    }

    /**
     * Получить историю запусков тестов
     * @param {number} limit - Количество последних запусков
     * @returns {Array} История запусков
     */
    static getTestHistory(limit = 10) {
        const historyPath = path.join(__dirname, '..', 'test_history.json');

        if (!fs.existsSync(historyPath)) {
            return [];
        }

        try {
            const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
            return history.slice(0, limit);
        } catch (error) {
            console.error('[TestRunner] Failed to load test history:', error.message);
            return [];
        }
    }
}

module.exports = TestRunner;
