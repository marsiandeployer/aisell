// CHANGE: Auto-qualify CRM leads every 10 minutes via cron
// WHY: Automatically process unqualified leads in background instead of manual button
// REF: user request 2026-02-11 "сделай квалификацию по крону раз в 10 минут всех не квалифицированныз"

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');

const DATA_DIR = path.join(__dirname, 'user_data');
const CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations');
const BOTS_PATH = path.join(__dirname, 'bots_database', 'bots.json');
const CRM_STATE_PATH = path.join(DATA_DIR, 'crm_followups.json');
const HYDRA_BASE_URL = process.env.HYDRA_BASE_URL || 'https://api.hydraai.ru/v1';
const HYDRA_API_URL = `${HYDRA_BASE_URL}/chat/completions`;
const HYDRA_API_KEY = process.env.HYDRA_API_KEY || '';
const HYDRA_LOGS_DIR = path.join(DATA_DIR, 'hydra_logs');

// CHANGE: Inline Hydra logger to avoid TS import issues
// WHY: hydraLogger.ts is TypeScript, crmAutoQualifier.js is plain JS
function logHydraRequest(entry) {
    const id = `hydra-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const logEntry = {
        id,
        timestamp: new Date().toISOString(),
        ...entry
    };

    if (!fs.existsSync(HYDRA_LOGS_DIR)) {
        fs.mkdirSync(HYDRA_LOGS_DIR, { recursive: true });
    }

    const filePath = path.join(HYDRA_LOGS_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(logEntry, null, 2));
    console.log(`✅ Hydra request logged: ${id}`);
    return id;
}

function readJsonFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readCrmState() {
    const state = readJsonFile(CRM_STATE_PATH);
    return state && typeof state === 'object' ? state : {};
}

function writeCrmState(state) {
    writeJsonFile(CRM_STATE_PATH, state);
}

function loadAuthorConversation(userId) {
    // CHANGE: Use new per-user directory structure (userId/conversation.json)
    // WHY: Conversation storage was migrated from flat structure to nested
    // REF: conversationStore.js migration
    const convPath = path.join(CONVERSATIONS_DIR, String(userId), 'conversation.json');
    const data = readJsonFile(convPath);

    if (!data) {
        return null;
    }

    // CHANGE: Normalize conversation structure (messages -> history)
    // WHY: New structure uses 'messages' field, need to map to 'history' for compatibility
    return {
        ...data,
        history: data.messages || []
    };
}

function getMessagesInfo(conversation) {
    const history = conversation?.history || [];
    const messages = [];
    for (const entry of history) {
        if (entry.role === 'user') {
            messages.push(`[USER]: ${entry.content}`);
        } else if (entry.role === 'assistant') {
            messages.push(`[BOT]: ${entry.content}`);
        }
    }

    // CHANGE: Take only last 10 messages for qualification
    // WHY: Focus on recent conversation context, avoid token overflow
    // REF: user request - "для квалицификации бери только последние 10 сообщений"
    const recentMessages = messages.slice(-10);

    return { messages: recentMessages };
}

async function generateQualificationResult(userId, messages) {
    const messagesStr = messages.join('\n');

    const systemPrompt = 'Ты аналитик CRM, отвечаешь только валидным JSON без markdown.';
    const userPrompt = `Проанализируй диалог пользователя с Telegram-ботом Bananzabot (сервис создания ботов для бизнеса).
Твоя задача — определить, является ли этот пользователь коммерчески перспективным лидом.

Верни ответ СТРОГО в формате JSON (без markdown, без лишнего текста):
{
  "verdict": "commercial" | "non_commercial" | "unclear",
  "reason": "короткое объяснение на русском (1-2 предложения)",
  "flags": ["список тревожных сигналов, если есть"]
}

Признаки НЕкоммерческого/нежелательного лида:
- Магазины CS GO, игровых читов, нелегального ПО
- Казино, гемблинг, ставки
- Спам-боты, рассылки без согласия
- Скам/фишинг/мошенничество
- Тесты, демо, исследования без реального бизнеса
- Студенческие проекты без бюджета
- Явно нецелевой запрос

Признаки коммерческого лида:
- Реальный бизнес с продуктом/услугой
- Конкретное описание бизнес-задачи
- Упоминание клиентов, продаж, сервиса
- Готовность платить или вопросы о тарифах
- Профессиональная сфера (e-commerce, услуги, образование и т.д.)

Диалог:
${messagesStr}`;

    const requestStartTime = Date.now();
    const requestPayload = {
        model: 'gemini-3-flash',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 300
    };

    try {
        const response = await axios.post(
            HYDRA_API_URL,
            requestPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${HYDRA_API_KEY}`
                },
                timeout: 30000
            }
        );

        const latencyMs = Date.now() - requestStartTime;

        // Log successful Hydra request
        logHydraRequest({
            caller: 'crmAutoQualifier:generateQualificationResult',
            context: { userId, operation: 'auto-qualification' },
            request: requestPayload,
            response: {
                success: true,
                data: response.data,
                latencyMs,
                usage: response.data.usage || {}
            }
        });

        const content = response.data?.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in response');
        }

        const result = JSON.parse(jsonMatch[0]);
        return {
            verdict: result.verdict || 'unclear',
            reason: result.reason || 'No reason provided',
            flags: result.flags || [],
            analyzedAt: new Date().toISOString()
        };
    } catch (error) {
        const latencyMs = Date.now() - requestStartTime;

        // Log failed Hydra request
        logHydraRequest({
            caller: 'crmAutoQualifier:generateQualificationResult',
            context: { userId, operation: 'auto-qualification' },
            request: requestPayload,
            response: {
                success: false,
                error: error.message,
                latencyMs
            }
        });

        console.error(`[CRM Auto-Qualify] API error for ${userId}:`, error.message);
        throw error;
    }
}

// CHANGE: Scan all conversations directories to find unqualified leads
// WHY: buildCrmLeads in adminServer shows all users from conversations/, not just crm_followups.json
// REF: user issue - "вижу что квалификация была ток у 2 лидов а почему по крону остальные не сделались"
function getAllConversationUserIds() {
    if (!fs.existsSync(CONVERSATIONS_DIR)) {
        return [];
    }
    return fs.readdirSync(CONVERSATIONS_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
}

async function qualifyAllUnqualifiedLeads() {
    try {
        console.log('[CRM Auto-Qualify] Starting auto-qualification job...');

        const crmState = readCrmState();

        // CHANGE: Get all user IDs from conversations directory, not just from crm_followups.json
        // WHY: Match buildCrmLeads logic in adminServer.ts
        const allUserIds = getAllConversationUserIds();

        const unqualifiedUserIds = allUserIds.filter(userId => {
            const crm = crmState[userId];
            return !crm || !crm.qualification;
        });

        if (unqualifiedUserIds.length === 0) {
            console.log('[CRM Auto-Qualify] No unqualified leads found');
            return;
        }

        console.log(`[CRM Auto-Qualify] Found ${unqualifiedUserIds.length} unqualified leads, processing...`);

        let qualified = 0;
        let failed = 0;
        let skipped = 0;

        for (const userId of unqualifiedUserIds) {
            try {
                // CHANGE: Skip test user ID 9999999999
                // WHY: This is a test account used for development/testing
                // REF: user request - "9999999999 это тестовый айди для него не делаем квалификации"
                if (userId === '9999999999') {
                    console.log(`[CRM Auto-Qualify] Skipping ${userId}: test user ID`);
                    skipped++;
                    continue;
                }

                const convo = loadAuthorConversation(userId);
                if (!convo) {
                    console.log(`[CRM Auto-Qualify] Skipping ${userId}: no conversation found`);
                    skipped++;
                    continue;
                }

                // CHANGE: Skip leads that already completed bot creation (stage === 'bot_created')
                // WHY: Match buildCrmLeads filter in adminServer.ts line 633
                const stage = typeof convo.stage === 'string' ? convo.stage : 'n/a';
                if (stage === 'bot_created') {
                    console.log(`[CRM Auto-Qualify] Skipping ${userId}: bot already created`);
                    skipped++;
                    continue;
                }

                // CHANGE: Check if 10 minutes passed since last user message
                // WHY: Only qualify leads after conversation cooldown period
                // REF: user request - "квалифицировать только после 10 минут когда человек что то делал последний раз"
                const history = convo?.history || convo?.messages || [];
                const lastUserMessage = [...history].reverse().find(msg => msg.role === 'user');

                if (lastUserMessage && lastUserMessage.timestamp) {
                    const lastMessageTime = new Date(lastUserMessage.timestamp).getTime();
                    const now = Date.now();
                    const minutesSinceLastMessage = (now - lastMessageTime) / (1000 * 60);

                    if (minutesSinceLastMessage < 10) {
                        console.log(`[CRM Auto-Qualify] Skipping ${userId}: only ${Math.floor(minutesSinceLastMessage)} minutes since last message (need 10)`);
                        skipped++;
                        continue;
                    }
                }

                const { messages } = getMessagesInfo(convo);
                if (!messages || !messages.length) {
                    console.log(`[CRM Auto-Qualify] Skipping ${userId}: no messages found`);
                    skipped++;
                    continue;
                }

                // CHANGE: Check if there is at least one user message with content
                // WHY: Match buildCrmLeads filter in adminServer.ts line 630
                // NOTE: getMessagesInfo returns array of strings like "[USER]: text", not objects
                const hasUserMessage = messages.find(msg => typeof msg === 'string' && msg.startsWith('[USER]:'));
                if (!hasUserMessage) {
                    console.log(`[CRM Auto-Qualify] Skipping ${userId}: no user messages with content`);
                    skipped++;
                    continue;
                }

                const qualification = await generateQualificationResult(userId, messages);

                const current = crmState[userId] && typeof crmState[userId] === 'object' ? crmState[userId] : {};
                crmState[userId] = {
                    ...current,
                    qualification,
                    updatedAt: new Date().toISOString()
                };

                qualified++;
                console.log(`[CRM Auto-Qualify] ✅ Qualified ${userId}: ${qualification.verdict}`);

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 2000));

            } catch (error) {
                failed++;
                console.error(`[CRM Auto-Qualify] ❌ Failed to qualify ${userId}:`, error.message);
            }
        }

        // Save all updated qualifications at once
        if (qualified > 0) {
            writeCrmState(crmState);
            console.log(`[CRM Auto-Qualify] Completed: ${qualified} qualified, ${failed} failed, ${skipped} skipped`);
        } else {
            console.log(`[CRM Auto-Qualify] No leads were qualified (${failed} failed, ${skipped} skipped)`);
        }

    } catch (error) {
        console.error('[CRM Auto-Qualify] Job error:', error);
    }
}

// Run every 10 minutes
cron.schedule('*/10 * * * *', qualifyAllUnqualifiedLeads);

console.log('[CRM Auto-Qualify] Cron job started: runs every 10 minutes');

// Run immediately on startup for testing
qualifyAllUnqualifiedLeads();
