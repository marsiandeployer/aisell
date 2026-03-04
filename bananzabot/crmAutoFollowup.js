// CHANGE: Auto-generate follow-up messages for commercial leads every day via cron
// WHY: Automatically reach out to users who didn't complete bot creation
// REF: user request 2026-02-12 "добавь так же по крону в пм2 автогенерацию фоловапа, фоловап через день после последнего сообщения от него"

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
const HYDRA_BASE_URL = process.env.HYDRA_BASE_URL || 'https://api.hydraai.ru/v1';
const HYDRA_API_URL = `${HYDRA_BASE_URL}/chat/completions`;
const HYDRA_API_KEY = process.env.HYDRA_API_KEY || '';
const HYDRA_LOGS_DIR = path.join(DATA_DIR, 'hydra_logs');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
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

// CHANGE: Inline Hydra logger to avoid TS import issues
// WHY: hydraLogger.ts is TypeScript, this is plain JS
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
    const convPath = path.join(CONVERSATIONS_DIR, String(userId), 'conversation.json');
    const data = readJsonFile(convPath);

    if (!data) {
        return null;
    }

    return {
        ...data,
        history: data.messages || []
    };
}

function getConversationSummary(conversation) {
    const history = conversation?.history || [];
    const messages = [];
    for (const entry of history) {
        if (entry.role === 'user') {
            messages.push(`[USER]: ${entry.content}`);
        } else if (entry.role === 'assistant') {
            messages.push(`[BOT]: ${entry.content}`);
        }
    }

    // Take last 15 messages for context
    const recentMessages = messages.slice(-15);
    return recentMessages.join('\n');
}

function normalizeUsername(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value).trim();
    if (!text) {
        return null;
    }
    return text.startsWith('@') ? text : `@${text}`;
}

function extractUsernameFromChat(chatData) {
    if (!Array.isArray(chatData)) {
        return null;
    }
    for (const entry of chatData) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const userInfo = entry.userInfo && typeof entry.userInfo === 'object' ? entry.userInfo : null;
        const usernameFromInfo = normalizeUsername(userInfo && userInfo.username);
        if (usernameFromInfo) {
            return usernameFromInfo;
        }
        const legacyUsername = normalizeUsername(entry.username);
        if (legacyUsername) {
            return legacyUsername;
        }
    }
    return null;
}

function extractUsernameFromProfile(profile) {
    if (!profile || typeof profile !== 'object') {
        return null;
    }
    return normalizeUsername(profile.username);
}

function listBotCandidatesForUser(userId) {
    const bots = readJsonFile(BOTS_PATH);
    const preferred = [];
    if (Array.isArray(bots)) {
        for (const bot of bots) {
            const ownerId = bot && bot.user_id !== undefined ? String(bot.user_id) : null;
            const name = bot && typeof bot.nameprompt === 'string' ? bot.nameprompt : null;
            if (ownerId === String(userId) && name) {
                preferred.push(name);
            }
        }
    }

    const fallbackDirs = fs.existsSync(DATA_DIR)
        ? fs.readdirSync(DATA_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && entry.name.startsWith('bot_'))
            .map(entry => entry.name)
        : [];

    return [...new Set([...preferred, ...fallbackDirs])];
}

function findLeadUsername(userId) {
    const candidates = listBotCandidatesForUser(userId);
    for (const botName of candidates) {
        const botDir = path.join(DATA_DIR, botName);
        if (!fs.existsSync(botDir)) {
            continue;
        }
        const profilePath = path.join(botDir, `${userId}.json`);
        if (fs.existsSync(profilePath)) {
            const username = extractUsernameFromProfile(readJsonFile(profilePath));
            if (username) {
                return username;
            }
        }
        const chatPath = path.join(botDir, `chat_${userId}.json`);
        if (fs.existsSync(chatPath)) {
            const username = extractUsernameFromChat(readJsonFile(chatPath));
            if (username) {
                return username;
            }
        }
    }
    return null;
}

// CHANGE: Generate personalized follow-up message with introduction
// WHY: User wants to reach out personally as creator of @bananza_bot
// REF: user request - "представится что то типа Здравствуйте, я Александр создатель @bananza_bot и подумай как лучше уточнить почему человек не продолжил какие пробелмы и почему не использовал предложи беслпатно помоч"
async function generateFollowupMessage(userId, conversationSummary, stage, leadUsername) {
    const systemPrompt = 'Ты помощник для написания follow-up сообщений. Возвращай только текст сообщения, без пояснений.';
    const hasKnownUsername = typeof leadUsername === 'string' && leadUsername.trim().length > 0;

    const modeInstructions = hasKnownUsername
        ? `Режим: username известен (${leadUsername}).\n` +
          `Пиши как личное сообщение от Александра, создателя @bananza_bot.\n` +
          `Не добавляй подпись вида "Пишите мне ...".\n`
        : `Режим: username неизвестен.\n` +
          `Пиши от имени сервиса @bananza_bot (не от лица Александра).\n` +
          `В конце добавь: "Вы можете ответить тут или написать разработчику @onoutnoxon Александр".\n`;

    const userPrompt = `Напиши персональное follow-up сообщение для Bananzabot.
${modeInstructions}

Далее в сообщении:
- Упомяни что заметил что пользователь начал создавать бота, но остановился
- Деликатно спроси что помешало продолжить (возникли вопросы? технические сложности?)
- Предложи бесплатную помощь в настройке и запуске бота
- Тон: дружелюбный, неформальный, но профессиональный
- Длина: максимум 420 символов
- НЕ используй markdown форматирование
- Не используй фразу "Пишите мне"
- НЕ добавляй ссылку https://t.me/bananza_bot в режиме без username (уже есть в инструкции выше)

Стадия процесса пользователя: ${stage}
Краткая история диалога:
${conversationSummary}

Напиши только текст сообщения:`;

    const requestStartTime = Date.now();
    const requestPayload = {
        model: 'gemini-3-flash',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 200
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

        logHydraRequest({
            caller: 'crmAutoFollowup:generateFollowupMessage',
            context: { userId, operation: 'auto-followup-generation' },
            request: requestPayload,
            response: {
                success: true,
                data: response.data,
                latencyMs,
                usage: response.data.usage || {}
            }
        });

        const content = response.data?.choices?.[0]?.message?.content || '';

        // Limit to 420 characters
        const trimmedContent = content.length > 420 ? content.substring(0, 417) + '...' : content;

        return {
            text: trimmedContent,
            generatedAt: new Date().toISOString()
        };
    } catch (error) {
        const latencyMs = Date.now() - requestStartTime;

        logHydraRequest({
            caller: 'crmAutoFollowup:generateFollowupMessage',
            context: { userId, operation: 'auto-followup-generation' },
            request: requestPayload,
            response: {
                success: false,
                error: error.message,
                latencyMs
            }
        });

        console.error(`[CRM Auto-Followup] API error for ${userId}:`, error.message);
        throw error;
    }
}

// CHANGE: Send follow-up message via Telegram Bot API (safe channel)
// WHY: Auto-send through bot is safe — ban only affects one user, not the whole account
async function sendViaBananzaBot(chatId, text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await axios.post(url, { chat_id: chatId, text: text }, { timeout: 15000 });
    return response.data;
}

// Append sent follow-up to conversation.json so it's visible in admin dialog history
function appendFollowupToConversation(userId, text) {
    const convPath = path.join(CONVERSATIONS_DIR, String(userId), 'conversation.json');
    const conversation = readJsonFile(convPath);
    if (!conversation) return;
    if (!Array.isArray(conversation.messages)) conversation.messages = [];
    conversation.messages.push({
        role: 'assistant',
        content: text,
        timestamp: new Date().toISOString()
    });
    writeJsonFile(convPath, conversation);
}

// Anti-flood: find the most recent outgoing timestamp across all channels
function getLastOutgoingTimestamp(userId, conversation, crmState) {
    const timestamps = [];

    // Source 1: Last assistant message in conversation
    const messages = Array.isArray(conversation?.messages || conversation?.history)
        ? (conversation.messages || conversation.history) : [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg && msg.role === 'assistant' && msg.timestamp) {
            const ts = new Date(msg.timestamp).getTime();
            if (Number.isFinite(ts)) timestamps.push(ts);
            break;
        }
    }

    // Source 2: CRM followup lastSentAt
    const crm = crmState[String(userId)];
    if (crm && crm.lastSentAt) {
        const ts = new Date(crm.lastSentAt).getTime();
        if (Number.isFinite(ts)) timestamps.push(ts);
    }

    // Source 3: Tips state sentAt
    const tipsState = readJsonFile(TIPS_STATE_PATH);
    const userTips = tipsState && tipsState[String(userId)];
    if (userTips && userTips.tips) {
        for (const tipId of Object.keys(userTips.tips)) {
            const tip = userTips.tips[tipId];
            if (tip && tip.sentAt) {
                const ts = new Date(tip.sentAt).getTime();
                if (Number.isFinite(ts)) timestamps.push(ts);
            }
        }
    }

    if (timestamps.length === 0) return 0;
    return Math.max(...timestamps);
}

function getAllConversationUserIds() {
    if (!fs.existsSync(CONVERSATIONS_DIR)) {
        return [];
    }
    return fs.readdirSync(CONVERSATIONS_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
}

// CHANGE: Main function to generate follow-ups for qualified commercial leads
// WHY: Reach out to users who didn't complete bot creation after 24 hours
async function generateFollowupsForLeads() {
    try {
        console.log('[CRM Auto-Followup] Starting auto-followup generation job...');

        const crmState = readCrmState();
        const allUserIds = getAllConversationUserIds();

        // CHANGE: Filter for commercial leads who need follow-up
        // WHY: Only reach out to qualified commercial leads who didn't complete
        const eligibleUserIds = allUserIds.filter(userId => {
            // Skip test user
            if (userId === '9999999999') {
                return false;
            }

            const crm = crmState[userId];

            // Must be qualified as commercial
            if (!crm || !crm.qualification || crm.qualification.verdict !== 'commercial') {
                return false;
            }

            // CHANGE: Skip users who already received a personal follow-up from our account
            // WHY: Personal follow-ups (via Pyrogram/telegram_sender.py) must be sent at most once;
            //       re-sending from personal account = spam risk + Telegram ban risk
            if (crm.personalFollowupSentAt) {
                return false;
            }

            // CHANGE: Skip users already contacted (status was set by manual send)
            // WHY: Don't overwrite manual "contacted" status with new auto-generated followup
            if (crm.status === 'contacted') {
                return false;
            }

            // Must not have completed bot creation
            const convo = loadAuthorConversation(userId);
            if (!convo) {
                return false;
            }

            const stage = typeof convo.stage === 'string' ? convo.stage : 'n/a';
            if (stage === 'bot_created') {
                return false;
            }

            // CHANGE: Must be 24 hours since last user message
            // WHY: User request - "фоловап через день после последнего сообщения от него"
            const history = convo?.history || convo?.messages || [];
            const lastUserMessage = [...history].reverse().find(msg => msg.role === 'user');

            if (!lastUserMessage || !lastUserMessage.timestamp) {
                return false;
            }

            const lastMessageTime = new Date(lastUserMessage.timestamp).getTime();
            const now = Date.now();
            const hoursSinceLastMessage = (now - lastMessageTime) / (1000 * 60 * 60);

            // Must be at least 24 hours since last message
            if (hoursSinceLastMessage < 24) {
                return false;
            }

            // CHANGE: Check if follow-up already generated recently (within 7 days)
            // WHY: Don't spam users with multiple follow-ups
            if (crm.followupText && crm.followupGeneratedAt) {
                const followupTime = new Date(crm.followupGeneratedAt).getTime();
                const daysSinceFollowup = (now - followupTime) / (1000 * 60 * 60 * 24);

                if (daysSinceFollowup < 7) {
                    return false;
                }
            }

            return true;
        });

        if (eligibleUserIds.length === 0) {
            console.log('[CRM Auto-Followup] No eligible leads for follow-up');
            return;
        }

        console.log(`[CRM Auto-Followup] Found ${eligibleUserIds.length} eligible leads for follow-up`);

        if (!TELEGRAM_BOT_TOKEN) {
            console.error('[CRM Auto-Followup] TELEGRAM_BOT_TOKEN not set, exiting');
            return;
        }

        // Daily send limit across ALL channels (CRM + tips)
        const alreadySentToday = countTodaySentMessages();
        console.log(`[CRM Auto-Followup] Daily limit: ${alreadySentToday}/${DAILY_SEND_LIMIT} messages sent today`);
        if (alreadySentToday >= DAILY_SEND_LIMIT) {
            console.log(`[CRM Auto-Followup] ⛔ Daily send limit reached (${DAILY_SEND_LIMIT}), skipping all sends`);
            return;
        }

        let generated = 0;
        let sent = 0;
        let failed = 0;
        let skipped = 0;
        let antiFloodBlocked = 0;
        let dailyLimitReached = false;

        for (const userId of eligibleUserIds) {
            try {
                const convo = loadAuthorConversation(userId);
                if (!convo) {
                    skipped++;
                    continue;
                }

                const stage = typeof convo.stage === 'string' ? convo.stage : 'n/a';
                const conversationSummary = getConversationSummary(convo);
                const leadUsername = findLeadUsername(userId);

                const followup = await generateFollowupMessage(userId, conversationSummary, stage, leadUsername);

                const current = crmState[userId] && typeof crmState[userId] === 'object' ? crmState[userId] : {};
                crmState[userId] = {
                    ...current,
                    status: 'followup_ready',
                    followupText: followup.text,
                    followupGeneratedAt: followup.generatedAt,
                    followupStatus: 'pending',
                    updatedAt: new Date().toISOString()
                };

                generated++;
                console.log(`[CRM Auto-Followup] ✅ Generated follow-up for ${userId}`);

                // Anti-flood check: 48h since last outgoing message
                const lastOutgoing = getLastOutgoingTimestamp(userId, convo, crmState);
                if (lastOutgoing > 0) {
                    const hoursSince = (Date.now() - lastOutgoing) / (1000 * 60 * 60);
                    if (hoursSince < ANTI_FLOOD_HOURS) {
                        console.log(`[CRM Auto-Followup] ⏳ Anti-flood: skip sending to ${userId}, last outgoing ${Math.round(hoursSince)}h ago (need ${ANTI_FLOOD_HOURS}h)`);
                        antiFloodBlocked++;
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }
                }

                // Send via Telegram Bot API (safe channel)
                try {
                    await sendViaBananzaBot(userId, followup.text);
                    crmState[userId].followupStatus = 'sent';
                    crmState[userId].lastSentAt = new Date().toISOString();
                    crmState[userId].sentCount = (current.sentCount || 0) + 1;
                    appendFollowupToConversation(userId, followup.text);
                    sent++;
                    console.log(`[CRM Auto-Followup] ✅ Sent via bot to ${userId} (${alreadySentToday + sent}/${DAILY_SEND_LIMIT} today)`);
                    if (alreadySentToday + sent >= DAILY_SEND_LIMIT) {
                        console.log(`[CRM Auto-Followup] ⛔ Daily send limit reached (${DAILY_SEND_LIMIT}), stopping`);
                        dailyLimitReached = true;
                    }
                } catch (sendError) {
                    const httpStatus = sendError.response && sendError.response.status;
                    if (httpStatus === 403) {
                        console.log(`[CRM Auto-Followup] 🚫 Bot blocked by ${userId} (403)`);
                        crmState[userId].followupStatus = 'blocked';
                    } else if (httpStatus === 400) {
                        console.log(`[CRM Auto-Followup] 🚫 Chat not found for ${userId} (400)`);
                        crmState[userId].followupStatus = 'chat_not_found';
                    } else {
                        console.error(`[CRM Auto-Followup] ❌ Send failed for ${userId}: ${sendError.message}`);
                        crmState[userId].followupStatus = 'send_failed';
                    }
                }

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 2000));

                if (dailyLimitReached) break;

            } catch (error) {
                failed++;
                console.error(`[CRM Auto-Followup] ❌ Failed to generate follow-up for ${userId}:`, error.message);
            }
        }

        // Save all generated follow-ups at once
        if (generated > 0) {
            writeCrmState(crmState);
            console.log(`[CRM Auto-Followup] Completed: ${generated} generated, ${sent} sent, ${antiFloodBlocked} anti-flood blocked, ${failed} failed, ${skipped} skipped`);
        } else {
            console.log(`[CRM Auto-Followup] No follow-ups were generated (${failed} failed, ${skipped} skipped)`);
        }

    } catch (error) {
        console.error('[CRM Auto-Followup] Job error:', error);
    }
}

// CHANGE: Run every day at 10:00 AM
// WHY: Check once per day for leads that need follow-up
cron.schedule('0 10 * * *', generateFollowupsForLeads);

console.log('[CRM Auto-Followup] Cron job started: runs daily at 10:00 AM');

// Run immediately on startup for testing
generateFollowupsForLeads();
