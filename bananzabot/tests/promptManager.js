const fs = require('fs');
const path = require('path');

const PROMPTS_FILE = path.join(__dirname, '..', 'prompts.json');

class PromptManager {
    /**
     * Загрузить текущий системный промпт
     * @returns {string} Текущий системный промпт
     */
    static loadSystemPrompt() {
        try {
            const data = fs.readFileSync(PROMPTS_FILE, 'utf8');
            const prompts = JSON.parse(data);
            return prompts.system_prompt.current;
        } catch (error) {
            console.error('[PromptManager] Failed to load system prompt:', error.message);
            throw new Error('Failed to load system prompt: ' + error.message);
        }
    }

    /**
     * Сохранить новый системный промпт и создать версию
     * @param {string} prompt - Новый системный промпт
     * @param {string} [description] - Описание изменений
     * @returns {Object} Результат сохранения
     */
    static saveSystemPrompt(prompt, description = '') {
        try {
            const data = fs.readFileSync(PROMPTS_FILE, 'utf8');
            const prompts = JSON.parse(data);

            // Получаем текущую версию
            const currentVersion = prompts.system_prompt.version;
            const versionParts = currentVersion.split('.');
            const newVersion = `${versionParts[0]}.${parseInt(versionParts[1]) + 1}.0`;

            // Обновляем текущий промпт
            prompts.system_prompt.current = prompt;
            prompts.system_prompt.version = newVersion;
            prompts.system_prompt.updated_at = new Date().toISOString();
            prompts.system_prompt.description = description;

            // Добавляем в историю
            prompts.versions.unshift({
                version: newVersion,
                prompt: prompt,
                created_at: new Date().toISOString(),
                test_results: null,
                description: description
            });

            // Ограничиваем историю последними 50 версиями
            if (prompts.versions.length > 50) {
                prompts.versions = prompts.versions.slice(0, 50);
            }

            // Сохраняем
            fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2), 'utf8');

            console.log(`[PromptManager] System prompt saved: version ${newVersion}`);

            return {
                success: true,
                version: newVersion,
                updated_at: prompts.system_prompt.updated_at
            };
        } catch (error) {
            console.error('[PromptManager] Failed to save system prompt:', error.message);
            throw new Error('Failed to save system prompt: ' + error.message);
        }
    }

    /**
     * Получить историю версий промптов
     * @param {number} [limit=10] - Количество версий для возврата
     * @returns {Array} Массив версий
     */
    static getPromptHistory(limit = 10) {
        try {
            const data = fs.readFileSync(PROMPTS_FILE, 'utf8');
            const prompts = JSON.parse(data);
            return prompts.versions.slice(0, limit);
        } catch (error) {
            console.error('[PromptManager] Failed to load prompt history:', error.message);
            throw new Error('Failed to load prompt history: ' + error.message);
        }
    }

    /**
     * Откатиться к определенной версии промпта
     * @param {string} version - Версия для отката (например, "1.0.0")
     * @returns {Object} Результат отката
     */
    static rollbackToVersion(version) {
        try {
            const data = fs.readFileSync(PROMPTS_FILE, 'utf8');
            const prompts = JSON.parse(data);

            // Найти версию
            const targetVersion = prompts.versions.find(v => v.version === version);
            if (!targetVersion) {
                throw new Error(`Version ${version} not found`);
            }

            // Создать новую версию на основе старой
            const versionParts = prompts.system_prompt.version.split('.');
            const newVersion = `${versionParts[0]}.${parseInt(versionParts[1]) + 1}.0`;

            // Обновить текущий промпт
            prompts.system_prompt.current = targetVersion.prompt;
            prompts.system_prompt.version = newVersion;
            prompts.system_prompt.updated_at = new Date().toISOString();
            prompts.system_prompt.description = `Rollback to version ${version}`;

            // Добавить в историю
            prompts.versions.unshift({
                version: newVersion,
                prompt: targetVersion.prompt,
                created_at: new Date().toISOString(),
                test_results: null,
                description: `Rollback to version ${version}`
            });

            // Сохранить
            fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2), 'utf8');

            console.log(`[PromptManager] Rolled back to version ${version} (new version: ${newVersion})`);

            return {
                success: true,
                version: newVersion,
                rolled_back_from: version
            };
        } catch (error) {
            console.error('[PromptManager] Failed to rollback:', error.message);
            throw new Error('Failed to rollback: ' + error.message);
        }
    }

    /**
     * Обновить результаты тестов для текущей версии
     * @param {Object} testResults - Результаты тестов
     */
    static updateTestResults(testResults) {
        try {
            const data = fs.readFileSync(PROMPTS_FILE, 'utf8');
            const prompts = JSON.parse(data);

            const currentVersion = prompts.system_prompt.version;

            // Найти текущую версию в истории и обновить результаты тестов
            const versionIndex = prompts.versions.findIndex(v => v.version === currentVersion);
            if (versionIndex !== -1) {
                prompts.versions[versionIndex].test_results = {
                    passed: testResults.passed,
                    failed: testResults.failed,
                    total: testResults.total,
                    score: testResults.avgScore,
                    tested_at: new Date().toISOString(),
                    test_model: testResults.testModel,
                    system_prompt_hash: testResults.systemPromptHash,
                    fixtures_hash: testResults.fixturesHash
                };

                fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2), 'utf8');

                console.log(`[PromptManager] Test results updated for version ${currentVersion}`);
            }
        } catch (error) {
            console.error('[PromptManager] Failed to update test results:', error.message);
        }
    }

    /**
     * Получить информацию о текущем промпте
     * @returns {Object} Информация о промпте
     */
    static getCurrentPromptInfo() {
        try {
            const data = fs.readFileSync(PROMPTS_FILE, 'utf8');
            const prompts = JSON.parse(data);
            return prompts.system_prompt;
        } catch (error) {
            console.error('[PromptManager] Failed to load current prompt info:', error.message);
            throw new Error('Failed to load current prompt info: ' + error.message);
        }
    }
}

module.exports = PromptManager;
