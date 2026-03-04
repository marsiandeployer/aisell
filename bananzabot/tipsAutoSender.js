// CHANGE: Auto-generate and send contextual AI tips to bot creators after deployment
// WHY: Users don't discover features (buttons, notifications, broadcast) on their own
// REF: user request 2026-02-20 "настрой серию фоловапов с hint лайвхаками"
// v2: AI-generated contextual tips, two-step process (generate → send), commercial only

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DATA_DIR = path.join(__dirname, 'user_data');
const CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations');
const BOTS_PATH = path.join(__dirname, 'bots_database', 'bots.json');
const CRM_STATE_PATH = path.join(DATA_DIR, 'crm_followups.json');
const TIPS_STATE_PATH = path.join(DATA_DIR, 'tips_state.json');
const HYDRA_LOGS_DIR = path.join(DATA_DIR, 'hydra_logs');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const HYDRA_BASE_URL = process.env.HYDRA_BASE_URL || 'https://api.hydraai.ru/v1';
const HYDRA_API_URL = `${HYDRA_BASE_URL}/chat/completions`;
const HYDRA_API_KEY = process.env.HYDRA_API_KEY || '';

const ANTI_FLOOD_HOURS = 48;
const DAILY_SEND_LIMIT = 5;

// Count all messages sent today across ALL channels (CRM followups + tips)
function countTodaySentMessages() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    let count = 0;

    // Source 1: CRM followups sent today
    const crmState = readJsonFile(CRM_STATE_PATH);
    if (crmState && typeof crmState === 'object') {
        for (const userId of Object.keys(crmState)) {
            const entry = crmState[userId];
            if (entry && entry.lastSentAt) {
                const ts = new Date(entry.lastSentAt).getTime();
                if (ts >= todayMs) count++;
            }
        }
    }

    // Source 2: Tips sent today
    const tipsState = readJsonFile(TIPS_STATE_PATH);
    if (tipsState && typeof tipsState === 'object') {
        for (const userId of Object.keys(tipsState)) {
            const userEntry = tipsState[userId];
            if (!userEntry || !userEntry.tips) continue;
            for (const tipId of Object.keys(userEntry.tips)) {
                const tip = userEntry.tips[tipId];
                if (tip && tip.sentAt) {
                    const ts = new Date(tip.sentAt).getTime();
                    if (ts >= todayMs) count++;
                }
            }
        }
    }

    return count;
}

// B2B best practice: first tip at day 2, intervals widen (3→3→4→5→4 days)
const TIPS_THEMES = [
    {
        id: 'tip_buttons',
        daysAfterDeploy: 2,
        theme: 'Inline-кнопки в боте',
        instruction: 'Пользователь может добавить в промпт бота инструкцию типа «предложи варианты через кнопки». Бот автоматически создаст Telegram inline-кнопки для выбора. Настройка через /editbot в @bananza_bot.'
    },
    {
        id: 'tip_notifications',
        daysAfterDeploy: 5,
        theme: 'Уведомления о заявках для админа',
        instruction: 'Бот умеет отправлять уведомление владельцу когда клиент оставляет заявку или контакт. Нужно добавить в промпт инструкцию «отправь уведомление админу с данными клиента». Настройка через /editbot в @bananza_bot.'
    },
    {
        id: 'tip_broadcast',
        daysAfterDeploy: 8,
        theme: 'Рассылка всем пользователям бота',
        instruction: 'Команда /broadcast в чате своего бота отправляет сообщение всем пользователям. Пример использования: /broadcast Привет! У нас акция — скидка 20% до конца недели!'
    },
    {
        id: 'tip_reply',
        daysAfterDeploy: 12,
        theme: 'Быстрый ответ клиенту через уведомление',
        instruction: 'Когда бот присылает владельцу уведомление о заявке клиента, можно нажать Reply (Ответить) на это сообщение — ответ автоматически переслается клиенту от имени бота. Не нужно искать чат с клиентом.'
    },
    {
        id: 'tip_stats',
        daysAfterDeploy: 17,
        theme: 'Статистика и список пользователей',
        instruction: 'Команды в чате своего бота: /mystats показывает сколько пользователей и сообщений, /users показывает список всех пользователей с именами и датами.'
    },
    {
        id: 'tip_editbot',
        daysAfterDeploy: 21,
        theme: 'Улучшение и доработка бота',
        instruction: 'Команда /editbot в @bananza_bot позволяет изменить поведение бота: добавить новые услуги, изменить цены, добавить FAQ или правила. Просто опишите что изменить — промпт обновится автоматически.'
    }
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function readJsonFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
        console.error(`[Tips] ⚠️ Failed to parse JSON: ${filePath}: ${error.message}`);
        return null;
    }
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadConversation(userId) {
    return readJsonFile(path.join(CONVERSATIONS_DIR, String(userId), 'conversation.json'));
}

function loadBots() {
    const bots = readJsonFile(BOTS_PATH);
    return Array.isArray(bots) ? bots : [];
}

function loadCrmState() {
    const s = readJsonFile(CRM_STATE_PATH);
    return s && typeof s === 'object' ? s : {};
}

function loadTipsState() {
    const s = readJsonFile(TIPS_STATE_PATH);
    return s && typeof s === 'object' ? s : {};
}

function saveTipsState(state) {
    writeJsonFile(TIPS_STATE_PATH, state);
}

function logHydraRequest(entry) {
    const id = `hydra-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const logEntry = { id, timestamp: new Date().toISOString(), ...entry };
    if (!fs.existsSync(HYDRA_LOGS_DIR)) fs.mkdirSync(HYDRA_LOGS_DIR, { recursive: true });
    fs.writeFileSync(path.join(HYDRA_LOGS_DIR, `${id}.json`), JSON.stringify(logEntry, null, 2));
    return id;
}

function getConversationSummary(conversation) {
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    const lines = [];
    for (const entry of messages) {
        if (entry.role === 'user') lines.push(`[USER]: ${entry.content}`);
        else if (entry.role === 'assistant') lines.push(`[BOT]: ${entry.content}`);
    }
    return lines.slice(-15).join('\n');
}

function getBotDeployDate(bots, userId) {
    let latest = null;
    for (const bot of bots) {
        if (String(bot.user_id) === String(userId) && bot.status === 'active' && bot.created_at) {
            const d = new Date(bot.created_at);
            if (!latest || d > latest) latest = d;
        }
    }
    return latest;
}

function getBotPromptAndName(bots, userId) {
    let best = null;
    for (const bot of bots) {
        if (String(bot.user_id) === String(userId) && bot.status === 'active') {
            if (!best || new Date(bot.created_at || 0) > new Date(best.created_at || 0)) best = bot;
        }
    }
    return best ? { prompt: best.prompt || '', username: best.username || '' } : { prompt: '', username: '' };
}

// Append sent tip to conversation.json so it's visible in admin dialog history
function appendTipToConversation(userId, tipText) {
    const convPath = path.join(CONVERSATIONS_DIR, String(userId), 'conversation.json');
    const conversation = readJsonFile(convPath);
    if (!conversation) return;
    if (!Array.isArray(conversation.messages)) conversation.messages = [];
    conversation.messages.push({
        role: 'assistant',
        content: tipText,
        timestamp: new Date().toISOString()
    });
    writeJsonFile(convPath, conversation);
}

// Anti-flood: find the most recent outgoing timestamp from all channels
function getLastOutgoing(userId, conversation, crmState, tipsState) {
    const sources = [];

    // Source 1: Last assistant message in conversation
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg && msg.role === 'assistant' && msg.timestamp) {
            const ts = new Date(msg.timestamp).getTime();
            if (Number.isFinite(ts)) sources.push({ timestamp: ts, source: 'conversation' });
            break;
        }
    }

    // Source 2: Last sent tip from tips_state
    const userTips = tipsState[String(userId)];
    if (userTips && userTips.tips) {
        for (const tipId of Object.keys(userTips.tips)) {
            const tip = userTips.tips[tipId];
            if (tip && tip.sentAt) {
                const ts = new Date(tip.sentAt).getTime();
                if (Number.isFinite(ts)) sources.push({ timestamp: ts, source: `tip:${tipId}` });
            }
        }
    }

    // Source 2b: Legacy tipsSent in conversation.json
    const legacyTips = conversation.tipsSent && typeof conversation.tipsSent === 'object' ? conversation.tipsSent : {};
    for (const tipId of Object.keys(legacyTips)) {
        const ts = legacyTips[tipId];
        if (typeof ts === 'string') {
            const parsed = new Date(ts).getTime();
            if (Number.isFinite(parsed)) sources.push({ timestamp: parsed, source: `legacy_tip:${tipId}` });
        }
    }

    // Source 3: CRM follow-up
    const crm = crmState[String(userId)];
    if (crm && crm.lastSentAt) {
        const ts = new Date(crm.lastSentAt).getTime();
        if (Number.isFinite(ts)) sources.push({ timestamp: ts, source: 'crm_followup' });
    }

    if (sources.length === 0) return { timestamp: 0, source: 'none' };
    sources.sort((a, b) => b.timestamp - a.timestamp);
    return sources[0];
}

// ---------------------------------------------------------------------------
// Inline qualification for bot_created users (crmAutoQualifier skips them)
// ---------------------------------------------------------------------------

function saveCrmState(state) {
    writeJsonFile(CRM_STATE_PATH, state);
}

async function qualifyUser(userId, conversation, crmState) {
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    const formatted = [];
    for (const entry of messages) {
        if (entry.role === 'user') formatted.push(`[USER]: ${entry.content}`);
        else if (entry.role === 'assistant') formatted.push(`[BOT]: ${entry.content}`);
    }
    const recentMessages = formatted.slice(-10);

    if (recentMessages.length === 0 || !recentMessages.some(m => m.startsWith('[USER]:'))) {
        console.log(`[Tips:Qualify] skip ${userId}: no user messages`);
        return 'unclear';
    }

    const messagesStr = recentMessages.join('\n');
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
        const response = await axios.post(HYDRA_API_URL, requestPayload, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${HYDRA_API_KEY}` },
            timeout: 30000
        });

        const latencyMs = Date.now() - requestStartTime;
        logHydraRequest({
            caller: 'tipsAutoSender:qualifyUser',
            context: { userId, operation: 'inline-qualification' },
            request: requestPayload,
            response: { success: true, data: response.data, latencyMs, usage: response.data.usage || {} }
        });

        const content = response.data?.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in qualification response');

        const result = JSON.parse(jsonMatch[0]);
        const qualification = {
            verdict: result.verdict || 'unclear',
            reason: result.reason || 'No reason provided',
            flags: result.flags || [],
            analyzedAt: new Date().toISOString()
        };

        // Persist to crm_followups.json
        const current = crmState[String(userId)] && typeof crmState[String(userId)] === 'object' ? crmState[String(userId)] : {};
        crmState[String(userId)] = { ...current, qualification, updatedAt: new Date().toISOString() };
        saveCrmState(crmState);

        console.log(`[Tips:Qualify] ✅ Qualified ${userId}: ${qualification.verdict} (${qualification.reason})`);
        return qualification.verdict;

    } catch (error) {
        const latencyMs = Date.now() - requestStartTime;
        logHydraRequest({
            caller: 'tipsAutoSender:qualifyUser',
            context: { userId, operation: 'inline-qualification' },
            request: requestPayload,
            response: { success: false, error: error.message, latencyMs }
        });
        console.error(`[Tips:Qualify] ❌ Failed to qualify ${userId}: ${error.message}`);
        return 'unclear';
    }
}

// ---------------------------------------------------------------------------
// AI tip generation via Hydra
// ---------------------------------------------------------------------------

async function generateTipText(userId, theme, conversation, botInfo) {
    const firstName = conversation.userInfo && conversation.userInfo.firstName
        ? conversation.userInfo.firstName : '';
    const productDesc = conversation.product_description || '';
    const botPrompt = (botInfo.prompt || '').substring(0, 500);
    const summary = getConversationSummary(conversation);

    const systemPrompt = 'Ты помощник сервиса @bananza_bot. Пишешь короткие полезные советы создателям Telegram-ботов. Возвращай только текст сообщения, без пояснений.';

    const userPrompt = `Напиши персональный совет для создателя бота.

Тема совета: ${theme.theme}
Инструкция по фиче: ${theme.instruction}

Контекст бизнеса пользователя:
- Описание бизнеса: ${productDesc || 'не указано'}
- Промпт бота (первые 500 символов): ${botPrompt || 'не указан'}
- Имя пользователя: ${firstName || 'неизвестно'}

Краткая история диалога создания бота:
${summary || 'нет данных'}

Требования:
- Обратись по имени если известно
- Приведи КОНКРЕТНЫЙ пример для ЕГО бизнеса (если бизнес понятен из контекста)
- Начни с 💡
- Максимум 500 символов
- НЕ используй markdown форматирование (звёздочки, решётки и тд)
- Тон: дружелюбный, полезный, без навязчивости
- Не пиши "Привет" или "Здравствуйте" — это не первое сообщение

Напиши только текст сообщения:`;

    const requestStartTime = Date.now();
    const requestPayload = {
        model: 'gemini-3-flash',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 300
    };

    try {
        const response = await axios.post(HYDRA_API_URL, requestPayload, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${HYDRA_API_KEY}` },
            timeout: 30000
        });

        const latencyMs = Date.now() - requestStartTime;
        logHydraRequest({
            caller: 'tipsAutoSender:generateTipText',
            context: { userId, tipId: theme.id, operation: 'tip-generation' },
            request: requestPayload,
            response: { success: true, data: response.data, latencyMs, usage: response.data.usage || {} }
        });

        const content = response.data?.choices?.[0]?.message?.content || '';
        const trimmed = content.length > 500 ? content.substring(0, 497) + '...' : content;
        return trimmed;

    } catch (error) {
        const latencyMs = Date.now() - requestStartTime;
        logHydraRequest({
            caller: 'tipsAutoSender:generateTipText',
            context: { userId, tipId: theme.id, operation: 'tip-generation' },
            request: requestPayload,
            response: { success: false, error: error.message, latencyMs }
        });
        throw error;
    }
}

// ---------------------------------------------------------------------------
// Step 1: GENERATE tips (cron 10:30)
// ---------------------------------------------------------------------------

async function processGeneration() {
    try {
        console.log('[Tips:Generate] Starting AI tip generation...');

        if (!HYDRA_API_KEY) {
            console.error('[Tips:Generate] HYDRA_API_KEY not set, exiting');
            return;
        }

        const bots = loadBots();
        const crmState = loadCrmState();
        const tipsState = loadTipsState();

        // Collect active bot owners
        const ownerIds = new Set();
        for (const bot of bots) {
            if (bot.status === 'active' && bot.user_id) ownerIds.add(String(bot.user_id));
        }

        if (ownerIds.size === 0) {
            console.log('[Tips:Generate] No active bot owners');
            return;
        }

        console.log(`[Tips:Generate] Checking ${ownerIds.size} bot owners...`);

        let generated = 0;
        let skipped = 0;
        let consecutiveApiErrors = 0;

        for (const userId of ownerIds) {
            // Fail-fast: stop if API is broken (3 consecutive errors)
            if (consecutiveApiErrors >= 3) {
                console.error(`[Tips:Generate] ⛔ Stopping: ${consecutiveApiErrors} consecutive API errors (Hydra API may be down)`);
                break;
            }

            try {
                const conversation = loadConversation(userId);
                if (!conversation) {
                    console.log(`[Tips:Generate] skip ${userId}: no conversation`);
                    skipped++;
                    continue;
                }

                if (conversation.stage !== 'bot_created') {
                    console.log(`[Tips:Generate] skip ${userId}: stage=${conversation.stage || 'none'}`);
                    skipped++;
                    continue;
                }

                // Only commercial users — inline-qualify if no verdict yet
                const crm = crmState[String(userId)];
                let verdict = crm?.qualification?.verdict || null;

                if (!verdict) {
                    console.log(`[Tips:Generate] ${userId}: no qualification, running inline qualification...`);
                    verdict = await qualifyUser(userId, conversation, crmState);
                    if (verdict === 'unclear' && (!crm || !crm.qualification)) {
                        // qualifyUser returns 'unclear' on API errors — check if it was a real result or API failure
                        const freshCrm = crmState[String(userId)];
                        if (!freshCrm || !freshCrm.qualification) {
                            consecutiveApiErrors++;
                            skipped++;
                            continue;
                        }
                    }
                    consecutiveApiErrors = 0; // reset on success
                    await new Promise(r => setTimeout(r, 2000)); // rate limit
                }

                if (verdict !== 'commercial') {
                    console.log(`[Tips:Generate] skip ${userId}: not commercial (verdict=${verdict})`);
                    skipped++;
                    continue;
                }

                const deployDate = getBotDeployDate(bots, userId);
                if (!deployDate) {
                    console.log(`[Tips:Generate] skip ${userId}: no deploy date`);
                    skipped++;
                    continue;
                }

                const daysSinceDeploy = (Date.now() - deployDate.getTime()) / (1000 * 60 * 60 * 24);

                // Init user tips state
                if (!tipsState[userId]) tipsState[userId] = { tips: {} };
                const userTips = tipsState[userId].tips;

                // Don't generate if there's already a pending_send tip waiting
                const hasPending = Object.values(userTips).some(t => t.status === 'pending_send');
                if (hasPending) {
                    console.log(`[Tips:Generate] skip ${userId}: has pending_send tip awaiting delivery`);
                    continue;
                }

                // Check minimum spacing between tips (use original daysAfterDeploy gaps)
                // This prevents sending all 6 tips in rapid succession if Hydra was down for weeks
                const lastSentTip = Object.values(userTips).filter(t => t.sentAt).sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())[0];
                const MIN_TIP_SPACING_DAYS = 3;
                if (lastSentTip && lastSentTip.sentAt) {
                    const daysSinceLastTip = (Date.now() - new Date(lastSentTip.sentAt).getTime()) / (1000 * 60 * 60 * 24);
                    if (daysSinceLastTip < MIN_TIP_SPACING_DAYS) {
                        console.log(`[Tips:Generate] skip ${userId}: last tip sent ${Math.round(daysSinceLastTip * 10) / 10}d ago (need ${MIN_TIP_SPACING_DAYS}d spacing)`);
                        continue;
                    }
                }

                // Find next tip to generate
                let nextTheme = null;
                for (const theme of TIPS_THEMES) {
                    if (!userTips[theme.id] && daysSinceDeploy >= theme.daysAfterDeploy) {
                        nextTheme = theme;
                        break;
                    }
                }

                if (!nextTheme) {
                    const allDone = TIPS_THEMES.every(t => Boolean(userTips[t.id]));
                    if (!allDone) {
                        const next = TIPS_THEMES.find(t => !userTips[t.id]);
                        if (next) console.log(`[Tips:Generate] skip ${userId}: day ${Math.round(daysSinceDeploy)}, next ${next.id} at day ${next.daysAfterDeploy}`);
                    }
                    continue;
                }

                // Generate AI text
                const botInfo = getBotPromptAndName(bots, userId);
                console.log(`[Tips:Generate] Generating ${nextTheme.id} for ${userId} (day ${Math.round(daysSinceDeploy)})...`);

                const generatedText = await generateTipText(userId, nextTheme, conversation, botInfo);

                userTips[nextTheme.id] = {
                    status: 'pending_send',
                    generatedText: generatedText,
                    generatedAt: new Date().toISOString(),
                    sentAt: null
                };

                saveTipsState(tipsState);
                generated++;
                console.log(`[Tips:Generate] ✅ Generated ${nextTheme.id} for ${userId}: "${generatedText.substring(0, 80)}..."`);

                // Rate limit between AI calls
                await new Promise(r => setTimeout(r, 2000));

            } catch (error) {
                console.error(`[Tips:Generate] ❌ Error ${userId}: ${error.message}`);
                const httpStatus = error.response && error.response.status;
                if (httpStatus === 402 || httpStatus === 403 || httpStatus === 429) {
                    consecutiveApiErrors++;
                } else {
                    consecutiveApiErrors = 0;
                }
            }
        }

        console.log(`[Tips:Generate] Done: ${generated} generated, ${skipped} skipped`);

    } catch (error) {
        console.error('[Tips:Generate] Job error:', error);
    }
}

// ---------------------------------------------------------------------------
// Step 2: SEND tips (cron 11:00)
// ---------------------------------------------------------------------------

async function processSending() {
    try {
        console.log('[Tips:Send] Starting tip delivery...');

        if (!TELEGRAM_BOT_TOKEN) {
            console.error('[Tips:Send] TELEGRAM_BOT_TOKEN not set, exiting');
            return;
        }

        // Daily send limit across ALL channels (CRM + tips)
        const alreadySentToday = countTodaySentMessages();
        console.log(`[Tips:Send] Daily limit: ${alreadySentToday}/${DAILY_SEND_LIMIT} messages sent today`);
        if (alreadySentToday >= DAILY_SEND_LIMIT) {
            console.log(`[Tips:Send] ⛔ Daily send limit reached (${DAILY_SEND_LIMIT}), skipping all sends`);
            return;
        }

        const tipsState = loadTipsState();
        const crmState = loadCrmState();
        const userIds = Object.keys(tipsState);

        if (userIds.length === 0) {
            console.log('[Tips:Send] No users in tips state');
            return;
        }

        let sent = 0;
        let antiFloodBlocked = 0;
        let noPending = 0;

        for (const userId of userIds) {
            try {
                const userEntry = tipsState[userId];
                if (!userEntry || !userEntry.tips) continue;

                // Find first pending_send tip
                let pendingTipId = null;
                let pendingTip = null;
                for (const tipId of Object.keys(userEntry.tips)) {
                    if (userEntry.tips[tipId].status === 'pending_send') {
                        pendingTipId = tipId;
                        pendingTip = userEntry.tips[tipId];
                        break;
                    }
                }

                if (!pendingTip) {
                    noPending++;
                    continue;
                }

                // Anti-flood check
                const conversation = loadConversation(userId) || {};
                const lastOutgoing = getLastOutgoing(userId, conversation, crmState, tipsState);
                if (lastOutgoing.timestamp > 0) {
                    const hoursSince = (Date.now() - lastOutgoing.timestamp) / (1000 * 60 * 60);
                    if (hoursSince < ANTI_FLOOD_HOURS) {
                        console.log(`[Tips:Send] ⏳ anti-flood ${userId}: last outgoing ${Math.round(hoursSince)}h ago via ${lastOutgoing.source} (need ${ANTI_FLOOD_HOURS}h)`);
                        antiFloodBlocked++;
                        continue;
                    }
                }

                // Send
                console.log(`[Tips:Send] Sending ${pendingTipId} to ${userId}: "${pendingTip.generatedText.substring(0, 60)}..."`);
                await sendTelegramMessage(userId, pendingTip.generatedText);

                pendingTip.status = 'sent';
                pendingTip.sentAt = new Date().toISOString();
                saveTipsState(tipsState);

                // Record in conversation.json for admin dialog visibility
                appendTipToConversation(userId, pendingTip.generatedText);

                sent++;
                console.log(`[Tips:Send] ✅ Sent ${pendingTipId} to ${userId} (${alreadySentToday + sent}/${DAILY_SEND_LIMIT} today)`);

                if (alreadySentToday + sent >= DAILY_SEND_LIMIT) {
                    console.log(`[Tips:Send] ⛔ Daily send limit reached (${DAILY_SEND_LIMIT}), stopping`);
                    break;
                }

                await new Promise(r => setTimeout(r, 1000));

            } catch (error) {
                const status = error.response && error.response.status;
                const userEntry = tipsState[userId];

                // Mark as failed so we don't retry forever
                if (userEntry && userEntry.tips) {
                    for (const tipId of Object.keys(userEntry.tips)) {
                        if (userEntry.tips[tipId].status === 'pending_send') {
                            userEntry.tips[tipId].status = 'failed';
                            userEntry.tips[tipId].error = error.message;
                            break;
                        }
                    }
                    saveTipsState(tipsState);
                }

                if (status === 403) {
                    console.log(`[Tips:Send] 🚫 ${userId}: bot blocked by user (403)`);
                } else if (status === 400) {
                    console.log(`[Tips:Send] 🚫 ${userId}: chat not found (400)`);
                } else {
                    console.error(`[Tips:Send] ❌ ${userId}: ${error.message}${status ? ` (HTTP ${status})` : ''}`);
                }
            }
        }

        console.log(`[Tips:Send] Done: ${sent} sent, ${antiFloodBlocked} anti-flood blocked, ${noPending} no pending`);

    } catch (error) {
        console.error('[Tips:Send] Job error:', error);
    }
}

async function sendTelegramMessage(chatId, text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await axios.post(url, { chat_id: chatId, text: text }, { timeout: 15000 });
    return response.data;
}

// ---------------------------------------------------------------------------
// Cron schedule
// ---------------------------------------------------------------------------

// Step 1: Generate at 10:30 (30 min before send — window for admin review)
cron.schedule('30 10 * * *', processGeneration);
// Step 2: Send at 11:00
cron.schedule('0 11 * * *', processSending);

console.log('[Tips] Cron started: generate 10:30, send 11:00');
console.log(`[Tips] ${TIPS_THEMES.length} themes, anti-flood ${ANTI_FLOOD_HOURS}h, commercial only`);

// Run on startup only if RUN_ON_STARTUP=1 (avoids hammering broken API on every PM2 restart)
if (process.env.RUN_ON_STARTUP === '1') {
    console.log('[Tips] RUN_ON_STARTUP=1, running immediately...');
    processGeneration().then(() => {
        console.log('[Tips] Generation done, starting send in 5s...');
        setTimeout(() => processSending(), 5000);
    });
} else {
    console.log('[Tips] Waiting for cron schedule (set RUN_ON_STARTUP=1 to run immediately)');
}
