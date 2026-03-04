const axios = require('axios');
const { getHydraConfig } = require('../aiSettings');

class TestEvaluator {
    /**
     * Оценить качество диалога с помощью AI
     * @param {Array} conversation - Массив сообщений диалога
     * @param {Object} testCase - Тест-кейс с критериями оценки
     * @param {string} evaluatorModel - Модель AI для оценки
     * @returns {Promise<Object>} Результаты оценки
     */
    static async evaluateConversation(conversation, testCase, evaluatorModel) {
        const evaluatorPrompt = `Ты - эксперт по оценке качества чат-ботов. Твоя задача - объективно оценить качество диалога.

ТЕСТ-КЕЙС: ${testCase.name}
КАТЕГОРИЯ: ${testCase.category}

ДИАЛОГ:
${JSON.stringify(conversation, null, 2)}

КРИТЕРИИ ОЦЕНКИ:
${JSON.stringify(testCase.evaluation_criteria, null, 2)}

ИНСТРУКЦИЯ ПО ОЦЕНКЕ:
${testCase.ai_evaluator_prompt}

ВАЖНО: Верни ТОЛЬКО валидный JSON без markdown блоков, без дополнительного текста. Только чистый JSON объект.`;

        try {
            const response = await this.callAI(evaluatorPrompt, evaluatorModel);

            // Пытаемся извлечь JSON из ответа
            let evaluation;
            try {
                // Удаляем markdown блоки если есть
                const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                evaluation = JSON.parse(cleanedResponse);
            } catch (parseError) {
                console.error('[TestEvaluator] Failed to parse AI response:', response);

                // Fallback: создаем структуру вручную
                evaluation = {
                    total: 50,
                    feedback: `Failed to parse AI evaluation. Raw response: ${response.substring(0, 200)}...`
                };

                // Пытаемся заполнить критерии нулями
                Object.keys(testCase.evaluation_criteria).forEach(key => {
                    evaluation[key] = 0;
                });
            }

            // Валидация результата
            if (typeof evaluation.total !== 'number') {
                console.warn('[TestEvaluator] Invalid total score, using 50 as default');
                evaluation.total = 50;
            }

            // CHANGE: Recompute total score from criterion fields when AI returns an incorrect "total".
            // WHY: Some evaluator models return "total" as an average instead of the requested sum.
            // This breaks the pass/fail threshold even when all criterion scores are perfect.
            // REF: Flaky E2E results where criteria sum to 100 but total is ~25-35.
            try {
                const criteriaKeys = testCase && testCase.evaluation_criteria && typeof testCase.evaluation_criteria === 'object'
                    ? Object.keys(testCase.evaluation_criteria)
                    : [];
                if (criteriaKeys.length) {
                    const computedTotal = criteriaKeys.reduce((sum, key) => {
                        const value = evaluation[key];
                        return typeof value === 'number' && Number.isFinite(value) ? sum + value : sum;
                    }, 0);

                    // Only override when it looks like the model computed total incorrectly.
                    if (computedTotal > 0 && Math.abs(evaluation.total - computedTotal) >= 3) {
                        console.warn(`[TestEvaluator] Overriding total score: model=${evaluation.total}, computed=${computedTotal}`);
                        evaluation.total = computedTotal;
                        if (typeof evaluation.feedback === 'string' && evaluation.feedback.trim()) {
                            evaluation.feedback += `\n\n[auto] Total recomputed from criteria: ${computedTotal}.`;
                        } else {
                            evaluation.feedback = `[auto] Total recomputed from criteria: ${computedTotal}.`;
                        }
                    }
                }
            } catch (e) {
                console.warn('[TestEvaluator] Failed to recompute total score:', e.message);
            }

            return evaluation;
        } catch (error) {
            console.error('[TestEvaluator] Evaluation failed:', error.message);

            // Возвращаем дефолтный результат при ошибке
            const defaultEval = {
                total: 0,
                feedback: `Evaluation failed: ${error.message}`
            };

            Object.keys(testCase.evaluation_criteria).forEach(key => {
                defaultEval[key] = 0;
            });

            return defaultEval;
        }
    }

    /**
     * Вызов AI через Hydra API
     * @param {string} prompt - Промпт для AI
     * @param {string} model - Модель AI
     * @returns {Promise<string>} Ответ AI
     */
    static async callAI(prompt, model) {
        const config = getHydraConfig();

        // CHANGE: Reduce max_tokens to 500 and increase temperature slightly
        // WHY: Shorter responses = faster evaluation, 0.5 temperature balances creativity and consistency
        // REF: Optimize evaluation speed while maintaining quality
        const requestBody = {
            model: model,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.5, // Balanced temperature
            max_tokens: 500  // Reduced for faster responses
        };

        try {
            // CHANGE: Create axios instance with proper config to fix 400 Bad Request
            // WHY: Default axios config was causing 400 errors from nginx
            // REF: Same fix as in testRunner.js
            // CHANGE: Increase timeout to 120 seconds for AI evaluation
            // WHY: AI evaluation takes longer than bot responses (analysis is complex)
            // REF: Tests were timing out at 60 seconds during evaluation phase
            const axiosInstance = axios.create({
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 120000, // 120 seconds for evaluation
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

            // CHANGE: Add retries/backoff for Hydra rate limits (429).
            // WHY: E2E suite can exceed 10 req/min when including evaluation calls.
            const maxAttempts = 5;
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
                    if (status === 429 && attempt < maxAttempts) {
                        const waitMs = 12000 * attempt;
                        console.warn(`[TestEvaluator] Rate limited (429). Waiting ${Math.round(waitMs / 1000)}s before retry (${attempt}/${maxAttempts})...`);
                        await new Promise(resolve => setTimeout(resolve, waitMs));
                        continue;
                    }
                    throw error;
                }
            }

            throw new Error('Hydra evaluator call failed after retries');
        } catch (error) {
            console.error('[TestEvaluator] API call failed:', error.message);
            throw error;
        }
    }

    /**
     * Проверить обязательные элементы в ответе
     * @param {string} content - Содержимое ответа
     * @param {Array} mustInclude - Массив обязательных строк
     * @returns {Object} Результат проверки
     */
    static checkMustInclude(content, mustInclude = []) {
        const missing = [];
        const found = [];

        mustInclude.forEach(requirement => {
            if (content.includes(requirement)) {
                found.push(requirement);
            } else {
                missing.push(requirement);
            }
        });

        return {
            passed: missing.length === 0,
            found,
            missing
        };
    }

    /**
     * Проверить наличие ключевых слов
     * @param {string} content - Содержимое ответа
     * @param {Array} keywords - Массив ключевых слов
     * @returns {Object} Результат проверки
     */
    static checkKeywords(content, keywords = []) {
        const contentLower = content.toLowerCase();
        const found = [];
        const missing = [];

        keywords.forEach(keyword => {
            if (contentLower.includes(keyword.toLowerCase())) {
                found.push(keyword);
            } else {
                missing.push(keyword);
            }
        });

        return {
            passed: found.length >= Math.ceil(keywords.length / 2), // Половина ключевых слов должна присутствовать
            found,
            missing,
            coverage: keywords.length > 0 ? (found.length / keywords.length) * 100 : 100
        };
    }
}

module.exports = TestEvaluator;
