console.log('this is file openai.ts');


const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { sanitizeString, validateChatId, logChat } = require('./utilities.ts');
const config = require('./config.ts');

// Safe import of cost tracker with fallback
let costTracker = null;
try {
    costTracker = require('./costTracker');
    console.log('[OpenAI] Cost tracking enabled');
} catch (error) {
    console.warn('[OpenAI] Cost tracking disabled - costTracker module not found:', error.message);
}

// CHANGE: Import Hydra logger for tracking all LLM requests
// WHY: User requested full request/response logging with feedback capability
// REF: user request 2026-02-11
const { logHydraRequest } = require('./hydraLogger.ts');

const { CHAT_HISTORIES_DIR, USER_DATA_DIR, NAMEPROMPT, MAX_HISTORY } = config;

// --- Configuration & State ---
let systemMessage;
let openaiApiKey = process.env.OPENAI_API_KEY;
let deepseekApiKey = process.env.DEEPSEEK_API_KEY;
let model = process.env.MODEL || 'openai';
const rateLimits = new Map();

// Ensure directories exist
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}
if (!fs.existsSync(CHAT_HISTORIES_DIR)) {
    fs.mkdirSync(CHAT_HISTORIES_DIR, { recursive: true });
}

// --- Functions ---

function setSystemMessage(content) {
    systemMessage = {
        role: 'system',
        content: [{ type: 'input_text', text: content }]
    };
    console.log("System message set.");
}

function setOpenAIKey(key) {
    openaiApiKey = key;
    console.log("OpenAI API key set.");
}

function setDeepSeekKey(key) {
    deepseekApiKey = key;
    console.log("DeepSeek API key set.");
}

function setModel(newModel) {
    model = newModel;
    console.log(`Model set to: ${model}`);
}

function getRateLimit(chatId) {
    const now = Date.now();
    const limit = rateLimits.get(chatId) || { count: 0, timestamp: now };

    if (now - limit.timestamp > 60000) {
        limit.count = 0;
        limit.timestamp = now;
    }

    limit.count++;
    rateLimits.set(chatId, limit);

    return {
        canProceed: limit.count <= 15,
        remainingRequests: Math.max(0, 15 - limit.count)
    };
}

function loadUserData(chatId) {
    const userFilePath = path.join(USER_DATA_DIR, `${chatId}.json`);
    const defaultUserData = { longMemory: '', lastLongMemoryUpdate: 0, isPaid: false };
    if (fs.existsSync(userFilePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(userFilePath, 'utf8'));
            return { ...defaultUserData, ...data };
        } catch (error) {
            console.error(`Ошибка чтения данных пользователя для чата ${chatId}:`, error);
            return { ...defaultUserData };
        }
    }
    return { ...defaultUserData };
}

function saveUserData(chatId, userData) {
    try {
        const userFilePath = path.join(USER_DATA_DIR, `${chatId}.json`);
        fs.writeFileSync(userFilePath, JSON.stringify(userData, null, 2));
    } catch (error) {
        console.error(`Ошибка сохранения данных пользователя для чата ${chatId}:`, error);
    }
}

function loadChatHistoryFromFile(chatId) {
    const chatLogPath = path.join(config.getChatHistoriesDir(), `chat_${chatId}.log`);
    const history = [];

    if (!fs.existsSync(chatLogPath)) {
        console.info(`[История чата ${chatId}] Файл истории не найден: ${chatLogPath}`);
        return history;
    }

    try {
        const fileContent = fs.readFileSync(chatLogPath, 'utf8');
        const lines = fileContent.split('\n').filter(Boolean);

        console.debug(`[История чата ${chatId}] Найдено ${lines.length} строк в логе`);

        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                let messageContent = null;

                // Проверяем, является ли content массивом (для сообщений user/assistant)
                if (entry.content && Array.isArray(entry.content)) {
                    messageContent = entry.content;
                }
                // Проверяем вложенный content.content (для исправления старого формата)
                else if (entry.content?.content && Array.isArray(entry.content.content)) {
                    messageContent = entry.content.content;
                }
                // Проверяем content.text как строку
                else if (entry.content?.text && typeof entry.content.text === 'string' && entry.content.text.trim() !== '') {
                    messageContent = [{ type: entry.role === 'user' ? 'input_text' : 'output_text', text: entry.content.text }];
                }

                if ((entry.role === 'user' || entry.role === 'assistant') && messageContent) {
                    history.push({ role: entry.role, content: messageContent });
                    console.debug(`[История чата ${chatId}] Добавлено сообщение:`, { role: entry.role, content: messageContent });
                }
            } catch (parseError) {
                console.warn(`[Загрузка истории ${chatId}] Пропуск некорректной строки: ${parseError.message}. Строка: "${line}"`);
            }
        }
    } catch (readError) {
        console.error(`Ошибка чтения файла истории для чата ${chatId}:`, readError);
        return [];
    }

    console.debug(`[История чата ${chatId}] Загружено ${history.length} сообщений`);
    return history.slice(-config.getMaxHistory());
}

function getUserMessageCount(chatId) {
    const history = loadChatHistoryFromFile(chatId);
    return history.filter(entry => entry.role === 'user').length;
}

async function updateLongMemory(chatId) {
    // Skip immediately if chatId is 1
    if (chatId === 1) {
        console.info(`[LongMemory ${chatId}] Пропуск обновления для chatId = 1`);
        return;
    }

    console.info(`[LongMemory ${chatId}] Проверка необходимости обновления долговременной памяти.`);
    const chatLogPath = path.join(CHAT_HISTORIES_DIR, `chat_${chatId}.log`);
    const userData = loadUserData(chatId);
    const lastLongMemoryUpdate = userData.lastLongMemoryUpdate || 0;
    const now = Date.now();
    const updateInterval = 1 * 60 * 60 * 1000; // 1 час

    if (!fs.existsSync(chatLogPath)) {
        console.info(`[LongMemory ${chatId}] Файл лога чата не существует, обновление пропускается.`);
        return;
    }

    let logs = [];
    try {
        const fileContent = fs.readFileSync(chatLogPath, 'utf8');
        logs = fileContent.split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
        console.error(`[LongMemory ${chatId}] Ошибка чтения лога:`, error);
        return;
    }

    const textMessages = logs.filter(entry =>
        entry.role && (
            (entry.content && Array.isArray(entry.content) && entry.content.some(c => c.text?.trim())) ||
            (typeof entry.text === 'string' && entry.text.trim() !== '')
        )
    );

    const userMessageCount = textMessages.filter(m => m.role === 'user').length;
    const isInitialPhase = userMessageCount > 0 && userMessageCount <= 5;
    const intervalPassed = now - lastLongMemoryUpdate >= updateInterval;

    if (!isInitialPhase && !intervalPassed) {
        console.info(`[LongMemory ${chatId}] Обновление не требуется.`);
        return;
    }

    if (textMessages.length === 0) {
        console.info(`[LongMemory ${chatId}] Нет текстовых сообщений для анализа.`);
        return;
    }

    const currentMemory = userData.longMemory || '';
    const systemPromptText = systemMessage?.content?.[0]?.text || 'You are a helpful assistant.';
    const analysisConversation = [
        {
            role: 'system',
            content: [{
                type: 'input_text',
                text: `Current long-term memory: ${currentMemory}\n\nAnalyze recent messages and update the memory. Output ONLY JSON with fields like name, city, interests. Recent Messages:`
            }]
        },
        {
            role: 'system',
            content: [{
                type: 'input_text',
                text: textMessages.slice(-20).map(log => {
                    const textContent = log.content?.find(c => c.text)?.text || log.text || '[non-text content]';
                    return `${log.role}: ${textContent}`;
                }).join('\n')
            }]
        }
    ];

    const payload = {
        model: 'gpt-5.2',
        input: analysisConversation,
        text: { format: { type: 'json_object' } },
        temperature: 0.1,
        max_output_tokens: 512
    };

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/responses',
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiApiKey}`
                },
                timeout: 30 * 1000
            }
        );

        const jsonObject = response.data.output.find(output => output.type === 'message')?.content.find(c => c.type === 'output_json_object')?.json_object || JSON.parse(response.data.output.find(output => output.type === 'message')?.content.find(c => c.type === 'output_text')?.text || '{}');
        const newLongMemoryString = JSON.stringify(jsonObject);

        if (newLongMemoryString !== currentMemory) {
            userData.longMemory = newLongMemoryString;
            userData.lastLongMemoryUpdate = now;
            saveUserData(chatId, userData);
            console.info(`[LongMemory ${chatId}] Память обновлена: ${newLongMemoryString}`);
        } else {
            userData.lastLongMemoryUpdate = now;
            saveUserData(chatId, userData);
            console.info(`[LongMemory ${chatId}] Память не изменилась, обновлен timestamp.`);
        }
    } catch (error) {
        console.error(`[LongMemory ${chatId}] Ошибка API:`, error.message);
    }
}

async function callLLM(chatId, userMessageContent) {
    console.info(`[LLM ${chatId}] Вызов модели: ${model}`);
    if (model === 'deepseek') {
        return callDeepSeek(chatId, userMessageContent);
    }
    return callOpenAI(chatId, userMessageContent);
}

// Для OpenAI
async function callOpenAI(chatId, messages) {
    // BEFORE:
    // if (!validateChatId(chatId)) {
    //     throw new Error('Некорректный chat ID');
    // }

    // AFTER: allow plain positive-integer IDs first
    if (typeof chatId === 'string' && /^\d+$/.test(chatId) && BigInt(chatId) > 0) {
        // bypass the old validator
    } else if (!validateChatId(chatId)) {
        throw new Error('Некорректный chat ID');
    }
    if (!openaiApiKey) {
        console.error("Ключ OpenAI API не установлен!");
        throw new Error("Ключ OpenAI API не настроен.");
    }
    if (!systemMessage) {
        console.error("Системное сообщение не установлено!");
        throw new Error("Системное сообщение не настроено.");
    }

    const rateLimit = getRateLimit(chatId);
    if (!rateLimit.canProceed) {
        console.warn(`Превышен лимит запросов для чата ${chatId}`);
        throw new Error('Превышен лимит запросов.');
    }

    const userData = loadUserData(chatId);
    const longMemory = userData.longMemory || '';
    const currentTime = new Date().toISOString();
    const sanitizedContent = messages.map(content => {
        const newContent = { ...content };
        if (newContent.text) newContent.text = sanitizeString(newContent.text);
        if (newContent.image_url && !newContent.image_url.startsWith('data:image/')) {
            try {
                const parsedUrl = new URL(newContent.image_url);
                if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') throw new Error('Invalid protocol');
                newContent.image_url = parsedUrl.toString();
            } catch {
                console.warn(`Некорректный URL изображения: ${newContent.image_url}`);
                delete newContent.image_url;
            }
        }
        return newContent;
    }).filter(c => c.text || c.image_url);

    if (sanitizedContent.length === 0) {
        throw new Error("Содержимое сообщения пусто после обработки.");
    }

    // Добавляем текущее время к каждому текстовому сообщению пользователя
    const userMessageWithTime = sanitizedContent.map(content => {
        if (content.text) {
            return {
                ...content,
                text: `${content.text}\n\nТекущее время: ${currentTime}`
            };
        }
        return content;
    });

    // Пользовательское сообщение с временем
    const userMessageForApi = {
        role: 'user',
        content: userMessageWithTime
    };

    // Системное сообщение с контекстной информацией
    const contextSystemMessage = {
        role: 'system',
        content: [{ 
            type: 'input_text', 
            text: `${systemMessage.content[0].text}\n\nСлужебная информация (не упоминайте её пользователю): ChatID: ${chatId}, Текущее время: ${currentTime}${longMemory && longMemory !== '{}' ? `, Контекст: ${longMemory}` : ''}`
        }]
    };

    logChat(chatId, { role: 'user', content: sanitizedContent }, 'user');
    const conversationHistory = loadChatHistoryFromFile(chatId);

    updateLongMemory(chatId).catch(err => console.error(`Ошибка обновления памяти для ${chatId}:`, err));

    // Используем обновленное системное сообщение с контекстом
    const apiInput = [contextSystemMessage, ...conversationHistory, userMessageForApi];
    const modelName = process.env.OPENAIMODEL || 'gpt-5.2';
    const payload = {
        model: modelName,
        tools: [{ type: "web_search_preview" }],
        input: apiInput,
        text: { format: { type: 'text' } },
        temperature: 1,
        max_output_tokens: 2048,
        top_p: 1,
        store: true
    };

    console.info(`[API Call ${chatId}] Отправка в OpenAI. Модель: ${modelName}. История: ${conversationHistory.length} сообщений.`);
    const payloadString = JSON.stringify(payload, null, 2);
    console.debug(`[API Call ${chatId}] Payload (first 250 chars):`, payloadString.substring(0, 250));

    const requestStartTime = Date.now();
    try {
        let response = null;
        let lastError = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                response = await axios.post(
                    'https://api.openai.com/v1/responses',
                    payload,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${openaiApiKey}`
                        },
                        timeout: attempt === 1 ? 45000 : 90000,
                        maxContentLength: 50 * 1024 * 1024
                    }
                );
                break;
            } catch (retryError) {
                lastError = retryError;
                const status = retryError?.response?.status || 0;
                const msg = String(retryError?.message || '').toLowerCase();
                const isRetryable = status === 429 || status >= 500 ||
                    msg.includes('timeout') || msg.includes('econnreset') ||
                    msg.includes('socket hang up') || msg.includes('econnaborted');
                if (!isRetryable || attempt === 3) break;
                console.warn(`[API Call ${chatId}] Attempt ${attempt} failed (${status || msg.substring(0, 50)}), retrying in ${3 * attempt}s...`);
                await new Promise(r => setTimeout(r, 3000 * attempt));
            }
        }

        if (!response) {
            throw (lastError || new Error('OpenAI request failed after 3 attempts'));
        }

        const latencyMs = Date.now() - requestStartTime;
        const assistantText = response.data.output.find(output => output.type === 'message')?.content.find(c => c.type === 'output_text')?.text;
        if (assistantText === undefined) throw new Error('Некорректный ответ от OpenAI.');

        // Track token usage and cost (safe)
        const usage = response.data.usage || {};
        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        try {
            trackCost(chatId, modelName, inputTokens, outputTokens);
        } catch (costError) {
            console.warn('[OpenAI] Cost tracking failed for this request:', costError.message);
        }

        // CHANGE: Log Hydra request with full context
        // WHY: Track all LLM requests for debugging and quality monitoring
        try {
            logHydraRequest({
                caller: 'callOpenAI',
                context: {
                    chatId: String(chatId),
                    operation: 'chat'
                },
                request: {
                    model: modelName,
                    messages: apiInput,
                    temperature: payload.temperature,
                    max_tokens: payload.max_output_tokens,
                    tools: payload.tools
                },
                response: {
                    success: true,
                    data: response.data,
                    latencyMs,
                    usage: {
                        prompt_tokens: inputTokens,
                        completion_tokens: outputTokens,
                        total_tokens: inputTokens + outputTokens
                    }
                }
            });
        } catch (logError) {
            console.warn('[Hydra Logger] Failed to log request:', logError.message);
        }

        // Remove sanitization of assistant responses
        logChat(chatId, { role: 'assistant', content: [{ type: 'output_text', text: assistantText }] }, 'assistant');

        return assistantText;
    } catch (error) {
        const latencyMs = Date.now() - requestStartTime;

        // CHANGE: Log failed Hydra request
        try {
            logHydraRequest({
                caller: 'callOpenAI',
                context: {
                    chatId: String(chatId),
                    operation: 'chat'
                },
                request: {
                    model: modelName,
                    messages: apiInput,
                    temperature: payload.temperature,
                    max_tokens: payload.max_output_tokens,
                    tools: payload.tools
                },
                response: {
                    success: false,
                    error: error.message,
                    latencyMs
                }
            });
        } catch (logError) {
            console.warn('[Hydra Logger] Failed to log error:', logError.message);
        }

        console.error(`Ошибка вызова OpenAI API для чата ${chatId}:`, error.message);
        throw new Error('Ошибка при обработке запроса.');
    }
}

// Для DeepSeek
async function callDeepSeek(chatId, userMessageContent) {
    if (!validateChatId(chatId)) {
        console.error(`Некорректный chat ID: ${chatId}`);
        throw new Error('Некорректный chat ID');
    }
    if (!deepseekApiKey) {
        console.error("Ключ DeepSeek API не установлен!");
        throw new Error("Ключ DeepSeek API не настроен.");
    }
    if (!systemMessage) {
        console.error("Системное сообщение не установлено!");
        throw new Error("Системное сообщение не настроено.");
    }

    const rateLimit = getRateLimit(chatId);
    if (!rateLimit.canProceed) {
        console.warn(`Превышен лимит запросов для чата ${chatId}`);
        throw new Error('Превышен лимит запросов.');
    }

    const userData = loadUserData(chatId);
    const longMemory = userData.longMemory || '';
    const sanitizedContent = userMessageContent.map(content => {
        const newContent = { ...content };
        if (newContent.text) newContent.text = sanitizeString(newContent.text);
        return newContent;
    }).filter(c => c.text);

    if (sanitizedContent.length === 0) {
        throw new Error("Содержимое сообщения пусто после обработки.");
    }

    // Системное сообщение с служебной информацией
    const systemMessageWithContext = `${systemMessage.content[0].text}\n\nСлужебная информация (не упоминайте её пользователю): ChatID: ${chatId}, Текущее время: ${new Date().toISOString()}${longMemory && longMemory !== '{}' ? `, Данные о пользователе: ${longMemory}` : ''}`;

    const messages = [
        { role: 'system', content: systemMessageWithContext },
        ...loadChatHistoryFromFile(chatId).map(msg => ({
            role: msg.role,
            content: msg.content.find(c => c.text)?.text || ''
        })),
        {
            role: 'user',
            content: sanitizedContent[0].text
        }
    ];

    logChat(chatId, { role: 'user', content: sanitizedContent }, 'user');

    const payload = {
        model: 'deepseek-chat',
        messages,
        temperature: 1,
        max_tokens: 2048
    };

    console.info(`[API Call ${chatId}] Отправка в DeepSeek. История: ${messages.length - 2} сообщений.`);
    console.debug(`[API Call ${chatId}] Payload:`, JSON.stringify(payload, null, 2));

    try {
        let response = null;
        let lastError = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                response = await axios.post(
                    'https://api.deepseek.com/v1/chat/completions',
                    payload,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${deepseekApiKey}`
                        },
                        timeout: attempt === 1 ? 45000 : 90000
                    }
                );
                break;
            } catch (retryError) {
                lastError = retryError;
                const status = retryError?.response?.status || 0;
                const msg = String(retryError?.message || '').toLowerCase();
                const isRetryable = status === 429 || status >= 500 ||
                    msg.includes('timeout') || msg.includes('econnreset') ||
                    msg.includes('socket hang up');
                if (!isRetryable || attempt === 3) break;
                console.warn(`[DeepSeek ${chatId}] Attempt ${attempt} failed (${status || msg.substring(0, 50)}), retrying in ${3 * attempt}s...`);
                await new Promise(r => setTimeout(r, 3000 * attempt));
            }
        }

        if (!response) {
            throw (lastError || new Error('DeepSeek request failed after 3 attempts'));
        }

        const assistantText = response.data.choices[0].message.content;
        if (!assistantText) throw new Error('Некорректный ответ от DeepSeek.');

        // Track token usage and cost (safe)
        try {
            const usage = response.data.usage || {};
            const inputTokens = usage.prompt_tokens || 0;
            const outputTokens = usage.completion_tokens || 0;
            trackCost(chatId, 'deepseek-chat', inputTokens, outputTokens);
        } catch (costError) {
            console.warn('[DeepSeek] Cost tracking failed for this request:', costError.message);
        }

        // Remove sanitization of assistant responses
        logChat(chatId, { role: 'assistant', content: [{ type: 'output_text', text: assistantText }] }, 'assistant');
        return assistantText;
    } catch (error) {
        console.error(`Ошибка вызова DeepSeek API для чата ${chatId}:`, error.message);
        throw new Error('Ошибка при обработке запроса через DeepSeek.');
    }
}

async function transcribeAudio(audioUrlOrPath, language='en') {
    if (!openaiApiKey) {
        throw new Error('Ключ OpenAI API не установлен для транскрипции.');
    }

    const formData = new FormData();
    //do noot use language for now 
    try {
        if (audioUrlOrPath.startsWith('http://') || audioUrlOrPath.startsWith('https://')) {
            console.info(`[Transcribe ${language}] Транскрибация из URL: ${audioUrlOrPath}`);
            const audioResponse = await axios.get(audioUrlOrPath, { responseType: 'stream', timeout: 20000 });
            formData.append('file', audioResponse.data, 'audio_from_url.mp3');
        } else {
            console.info(`[Transcribe ${language}] Транскрибация из пути: ${audioUrlOrPath}`);
            if (!fs.existsSync(audioUrlOrPath)) throw new Error(`Аудиофайл не существует: ${audioUrlOrPath}`);
            formData.append('file', fs.createReadStream(audioUrlOrPath));
        }

        formData.append('model', 'whisper-1');
        formData.append('response_format', 'text');

        const response = await axios.post(
            'https://api.openai.com/v1/audio/transcriptions',
            formData,
            {
                headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${openaiApiKey}` },
                timeout: 60 * 1000
            }
        );

        const transcribedText = sanitizeString(response.data);
        
        // Track transcription cost (safe)
        try {
            const audioMinutes = 1; // You might want to calculate this based on file size or actual duration
            trackCost('transcription', 'whisper-1', 0, 0, audioMinutes);
        } catch (costError) {
            console.warn('[Transcribe] Cost tracking failed for this request:', costError.message);
        }
        
        console.info(`[Transcribe ${language}] Успешно транскрибировано. Длина: ${transcribedText.length}`);
        return transcribedText;
    } catch (error) {
        console.error(`Ошибка транскрибации аудио:`, error.message);
        throw new Error('Не удалось расшифровать аудио.');
    }
}

// Safe cost tracking function
function trackCost(chatId, model, inputTokens, outputTokens, audioMinutes = 0) {
    if (costTracker) {
        try {
            const cost = costTracker.calculateCost(model, inputTokens, outputTokens, audioMinutes);
            costTracker.saveCostData(chatId, model, inputTokens, outputTokens, cost, audioMinutes, NAMEPROMPT);
        } catch (error) {
            console.warn('[OpenAI] Cost tracking failed:', error.message);
        }
    }
}

module.exports = {
    setSystemMessage,
    setOpenAIKey,
    setDeepSeekKey,
    setModel,
    callLLM,
    callOpenAI,
    callDeepSeek,
    transcribeAudio,
    updateLongMemory,
    loadUserData, // Ensure loadUserData is exported if it wasn't already implicitly
    saveUserData, // Ensure saveUserData is exported
    getUserMessageCount
};
