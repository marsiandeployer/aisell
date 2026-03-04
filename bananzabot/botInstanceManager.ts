// @ts-nocheck
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// CHANGE: Import ConversationManager for notification parsing
// WHY: Reuse notification command parsing logic
// REF: #17
// IMPORTANT: explicit .ts keeps runtime on TypeScript sources.
const ConversationManagerModule = require('./conversationManager.ts');
const ConversationManager = ConversationManagerModule.default || ConversationManagerModule;
const { getBotModel, getHydraConfig } = require('./aiSettings.ts');
const { logHydraRequest } = require('./hydraLogger.ts');

const BUTTONS_RUNTIME_INSTRUCTION = `\n\n---\nИНЛАЙН-КНОПКИ TELEGRAM:\n- Если пользователь просит меню/кнопки/варианты выбора, после обычного текста добавь блок:\n[BUTTONS]\n[[{"text":"Кнопка 1","callback_data":"btn_1"}]]\n- В [BUTTONS] передавай только валидный JSON массива строк inline_keyboard.\n- У каждой кнопки обязательно поле "text" и одно действие: url ИЛИ callback_data ИЛИ switch_inline_query ИЛИ switch_inline_query_current_chat ИЛИ web_app ИЛИ pay.\n- Если кнопки не нужны, [BUTTONS] не добавляй.\n- Не пиши пояснений вокруг JSON, только сам блок [BUTTONS] и JSON.`;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableHydraError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    const code = String(error?.code || '').toUpperCase();
    const status = Number(error?.response?.status || 0);

    if (code === 'ECONNABORTED') return true;
    if (message.includes('timeout') || message.includes('socket hang up') || message.includes('econnreset')) return true;
    if (status === 429 || status >= 500) return true;
    return false;
}

class BotInstanceManager {
    constructor() {
        this.activeBots = new Map(); // Map<botId, botInstance>
        this.hydraApiKey = process.env.HYDRA_API_KEY;
        // CHANGE: Initialize ConversationManager for notification parsing
        // WHY: Reuse existing notification methods
        // REF: #17
        this.conversationManager = new ConversationManager();
        // CHANGE: Track first user notifications per bot
        // WHY: Notify owner when their bot gets first user
        // REF: User request - уведомление о первых пользователях
        this.notifiedFirstUsers = new Set();
    }

    async startBot(botData) {
        try {
            if (this.activeBots.has(botData.bot_id)) {
                console.log(`[BotInstance] Bot ${botData.bot_id} already running`);
                return { success: false, error: 'Bot already running' };
            }

            // CHANGE: Stop any bot using the same API token before starting new one
            // WHY: Telegram doesn't allow multiple bots with same token (409 Conflict)
            // REF: User request - "если запушен похожий токен то останавливай бота"
            for (const [existingBotId, existingBot] of this.activeBots.entries()) {
                if (existingBot.botData.api_key === botData.api_key && existingBotId !== botData.bot_id) {
                    console.log(`[BotInstance] Stopping bot ${existingBotId} with duplicate token before starting ${botData.bot_id}`);
                    await this.stopBot(existingBotId);
                }
            }

            console.log(`[BotInstance] Starting bot ${botData.bot_id} (${botData.nameprompt})`);

            const bot = new TelegramBot(botData.api_key, {
                polling: false
            });
            const userDataDir = path.join(__dirname, 'user_data', botData.nameprompt);

            // Ensure user data directory exists
            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, { recursive: true });
            }

            // Setup bot handlers
            this.setupBotHandlers(bot, botData, userDataDir);

            // Generate secret token for webhook verification
            const secretToken = crypto
                .createHmac('sha256', this.hydraApiKey)
                .update(botData.bot_id)
                .digest('hex');

            // Store bot instance
            this.activeBots.set(botData.bot_id, {
                bot,
                botData,
                userDataDir,
                startedAt: new Date(),
                secretToken
            });

            // Set webhook
            const webhookBaseUrl = process.env.WEBHOOK_BASE_URL || 'https://bananzabot.wpmix.net';
            const webhookUrl = `${webhookBaseUrl}/webhook/${botData.bot_id}`;
            await bot.setWebHook(webhookUrl, {
                secret_token: secretToken
            });

            console.log(`[BotInstance] ✅ Bot ${botData.nameprompt} webhook set: ${webhookUrl}`);

            return { success: true, botId: botData.bot_id };

        } catch (error) {
            // Clean up if bot was added to activeBots but setWebHook failed
            this.activeBots.delete(botData.bot_id);
            console.error(`[BotInstance] Error starting bot ${botData.bot_id}:`, error);
            return { success: false, error: error.message };
        }
    }

    setupBotHandlers(bot, botData, userDataDir) {
        const prompt = botData.prompt;

        // /start command
        // CHANGE: Extract start parameter and referral source
        // WHY: Need to track where users came from (t_* for Telegram channels)
        // REF: User request - если идет через start t_* это значит что юзер зашел с тг канала
        bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const startParam = match?.[1];
            const isOwner = msg.from.id.toString() === botData.user_id;
            let startTaskText = null;

            try {
                // CHANGE: Send different message for owner (admin)
                // WHY: Admin needs to know they will receive forwarded messages and can reply
                // REF: User request - "если ему пишет админ /start что вы админ и вам будут пересылатся сообщения от этого бота и если вы отвечаете то сообщение будет пересылатся по reply"
                if (isOwner) {
                    await bot.sendMessage(
                        chatId,
                        '👨‍💼 Вы - владелец этого бота!\n\n' +
                        '📨 Вам будут пересылаться все сообщения от пользователей.\n\n' +
                        '💬 Чтобы ответить пользователю:\n' +
                        '• Используйте Reply (ответить) на уведомление от бота\n' +
                        '• Ваш ответ будет автоматически отправлен пользователю\n\n' +
                        'Доступные команды: /help, /stats, /broadcast'
                    );
                } else {
                    // CHANGE: If start parameter provided, send it as the message instead of default greeting
                    // WHY: User wants to see the referral message (e.g., t_vygruzka-iz-1s-v-sbis should show task info)
                    // REF: User request - "бот прислал стандартную отбивку а надо отправлять то сообщение которое в start передалось"
                    if (startParam && startParam.startsWith('t_')) {
                        startTaskText = startParam.substring(2).replace(/-/g, ' ').trim(); // Remove "t_" and replace hyphens with spaces
                    } else {
                        await bot.sendMessage(
                            chatId,
                            'Привет! Я готов помочь вам. Напишите мне, чем я могу быть полезен?'
                        );
                    }
                }

                // CHANGE: Only create profile if it doesn't exist
                // WHY: User request - запрети перезаписывать и обновлять в профиле при перезапуски все
                // REF: User request
                const userFile = path.join(userDataDir, `${chatId}.json`);
                let userData = {};
                let isNewUser = false;

                if (fs.existsSync(userFile)) {
                    // Load existing profile
                    userData = JSON.parse(fs.readFileSync(userFile, 'utf8'));
                    console.log(`[Bot ${botData.nameprompt}] User ${chatId} profile already exists, not overwriting`);
                } else {
                    // Create new profile with firstVisit
                    isNewUser = true;
                    userData = {
                        chatId: chatId.toString(),
                        firstVisit: new Date().toISOString(),
                        username: msg.from?.username || null,
                        firstName: msg.from?.first_name || null
                    };
                    console.log(`[Bot ${botData.nameprompt}] Created new profile for user ${chatId}`);
                }

                // CHANGE: Parse referral source from start parameter
                // WHY: Track where users came from (t_* for Telegram channels)
                // REF: User request - если в главный бот идет через start t_* это значит что юзер зашел с тг канала
                if (startParam && startParam.startsWith('t_')) {
                    const channelName = startParam.substring(2); // Remove "t_" prefix
                    userData.referralSource = `telegram_channel:${channelName}`;
                    userData.referralParam = startParam;
                    userData.referralDate = new Date().toISOString();
                    console.log(`[Bot ${botData.nameprompt}] User ${chatId} came from Telegram channel: ${channelName}`);

                    // CHANGE: Send notification to owner when user starts with referral parameter
                    // WHY: Owner wants to be notified about every referral start, not just first user
                    // REF: User request - "уведомление не пришло админу этого бота"
                    this.notifyOwnerReferralStart(botData, msg.from, channelName);
                }

                fs.writeFileSync(userFile, JSON.stringify(userData, null, 2));

                // CHANGE: Notify owner about first user
                // WHY: Owner wants to know when their bot gets traction
                // REF: User request - уведомление о первых пользователях
                if (isNewUser) {
                    const userCount = this.countBotUsers(userDataDir);
                    if (userCount === 1 && !this.notifiedFirstUsers.has(botData.bot_id)) {
                        this.notifiedFirstUsers.add(botData.bot_id);
                        this.notifyOwnerFirstUser(botData, msg.from);
                    }
                }

                // CHANGE: For /start t_* immediately process task via AI instead of static placeholder.
                // WHY: User wants instant meaningful reply, not "Расскажите подробнее..." stub.
                // REF: user request 2026-02-12
                if (!isOwner && startTaskText) {
                    await bot.sendChatAction(chatId, 'typing');

                    const userInfo = {
                        id: msg.from.id,
                        username: msg.from.username ? `@${msg.from.username}` : null,
                        firstName: msg.from.first_name || null,
                        lastName: msg.from.last_name || null,
                        fullName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'Пользователь'
                    };

                    console.log(`[Bot ${botData.nameprompt}] User message: ${JSON.stringify({ chatId, userId: userInfo.id, username: userInfo.username, text: startTaskText, source: 'start_param' })}`);

                    const historyFile = path.join(userDataDir, `chat_${chatId}.json`);
                    let chatHistory = [];
                    if (fs.existsSync(historyFile)) {
                        chatHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
                    }

                    chatHistory.push({
                        role: 'user',
                        content: startTaskText,
                        timestamp: new Date().toISOString(),
                        userInfo
                    });

                    if (chatHistory.length > 20) {
                        chatHistory = chatHistory.slice(-20);
                    }

                    const enhancedPrompt = prompt + `\n\n---\nВАЖНО: Текущий пользователь - ${userInfo.fullName} (Telegram: ${userInfo.username || 'ID:' + userInfo.id}). Когда отправляешь уведомление админу через [NOTIFY_ADMIN], ОБЯЗАТЕЛЬНО указывай контакт пользователя: ${userInfo.username || 'ID:' + userInfo.id}` + BUTTONS_RUNTIME_INSTRUCTION;
                    const response = await this.callOpenAI(enhancedPrompt, chatHistory, {
                        chatId: String(chatId),
                        userId: String(userInfo.id),
                        operation: 'bot_runtime_chat_start',
                        botId: String(botData.bot_id)
                    });

                    const parsedResponse = this.conversationManager.parseNotificationCommands(response);
                    chatHistory.push({
                        role: 'assistant',
                        content: response,
                        timestamp: new Date().toISOString()
                    });
                    fs.writeFileSync(historyFile, JSON.stringify(chatHistory, null, 2));

                    const messageOptions = this.buildChatMessageOptions(parsedResponse);
                    if (messageOptions) {
                        await bot.sendMessage(chatId, parsedResponse.chatMessage, messageOptions);
                    } else {
                        await bot.sendMessage(chatId, parsedResponse.chatMessage);
                    }
                    console.log(`[Bot ${botData.nameprompt}] Bot response: ${JSON.stringify({ chatId, userId: userInfo.id, message: parsedResponse.chatMessage, source: 'start_param' })}`);
                }

            } catch (error) {
                console.error(`[Bot ${botData.nameprompt}] Error in /start:`, error);
            }
        });

        // CHANGE: Add /help command for created bots
        // WHY: Users need to know available commands and bot capabilities
        // REF: User request - добавить /help для созданных ботов
        bot.onText(/\/help/, async (msg) => {
            const chatId = msg.chat.id;
            const isOwner = msg.from.id.toString() === botData.user_id;

            let helpMessage = `Доступные команды:\n\n`;
            helpMessage += `/start - Начать диалог\n`;
            helpMessage += `/help - Показать эту справку\n`;
            helpMessage += `/clear - Очистить историю диалога\n`;

            if (isOwner) {
                helpMessage += `\n--- Команды владельца ---\n`;
                helpMessage += `/mystats - Статистика вашего бота\n`;
                helpMessage += `/broadcast <текст> - Рассылка по всем пользователям\n`;
                helpMessage += `/users - Список пользователей бота\n`;
                // CHANGE: Explain how the owner can reply to user messages.
                // WHY: Owners ask how to respond to user requests coming from the bot.
                // QUOTE(ТЗ): "пользователь админ бота спрашивает как отвечать на сообщения от юзеров в боте"
                // REF: user request 2026-01-28
                helpMessage += `\nКак отвечать пользователям:\n`;
                helpMessage += `- Ответьте пользователю напрямую в личку по @username из уведомления.\n`;
            }

            await bot.sendMessage(chatId, helpMessage);
        });

        // CHANGE: Add /clear command to reset conversation
        // WHY: Users may want to start fresh without /start
        // REF: User request - добавить возможность очистки истории
        bot.onText(/\/clear/, async (msg) => {
            const chatId = msg.chat.id;
            const historyFile = path.join(userDataDir, `chat_${chatId}.json`);

            try {
                if (fs.existsSync(historyFile)) {
                    fs.writeFileSync(historyFile, JSON.stringify([], null, 2));
                }
                await bot.sendMessage(chatId, 'История диалога очищена. Можете начать заново!');
            } catch (error) {
                console.error(`[Bot ${botData.nameprompt}] Error clearing history:`, error);
                await bot.sendMessage(chatId, 'Не удалось очистить историю. Попробуйте позже.');
            }
        });

        // CHANGE: Add /mystats command for bot owners
        // WHY: Owners want to see their bot's activity metrics
        // REF: User request - персональная аналитика для владельцев ботов
        bot.onText(/\/mystats/, async (msg) => {
            const chatId = msg.chat.id;
            const isOwner = msg.from.id.toString() === botData.user_id;

            if (!isOwner) {
                await bot.sendMessage(chatId, 'Эта команда доступна только владельцу бота.');
                return;
            }

            try {
                const stats = this.collectBotStats(userDataDir, botData);
                await bot.sendMessage(chatId, stats);
            } catch (error) {
                console.error(`[Bot ${botData.nameprompt}] Error getting stats:`, error);
                await bot.sendMessage(chatId, 'Не удалось получить статистику.');
            }
        });

        // CHANGE: Add /users command to list bot users
        // WHY: Owners want to see who uses their bot
        // REF: User request - список пользователей бота
        bot.onText(/\/users/, async (msg) => {
            const chatId = msg.chat.id;
            const isOwner = msg.from.id.toString() === botData.user_id;

            if (!isOwner) {
                await bot.sendMessage(chatId, 'Эта команда доступна только владельцу бота.');
                return;
            }

            try {
                const usersList = this.getBotUsersList(userDataDir);
                await bot.sendMessage(chatId, usersList);
            } catch (error) {
                console.error(`[Bot ${botData.nameprompt}] Error getting users:`, error);
                await bot.sendMessage(chatId, 'Не удалось получить список пользователей.');
            }
        });

        // CHANGE: Add /broadcast command for mass messaging
        // WHY: Owners want to send announcements to all users
        // REF: User request - рассылка по пользователям бота
        bot.onText(/\/broadcast (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const isOwner = msg.from.id.toString() === botData.user_id;
            const broadcastText = match[1];

            if (!isOwner) {
                await bot.sendMessage(chatId, 'Эта команда доступна только владельцу бота.');
                return;
            }

            try {
                await bot.sendMessage(chatId, 'Начинаю рассылку...');
                const result = await this.broadcastMessage(bot, userDataDir, broadcastText, botData.user_id);
                await bot.sendMessage(chatId, result);
            } catch (error) {
                console.error(`[Bot ${botData.nameprompt}] Error broadcasting:`, error);
                await bot.sendMessage(chatId, 'Ошибка при рассылке. Попробуйте позже.');
            }
        });

        // Regular messages
        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;
            const isOwner = msg.from.id.toString() === botData.user_id;

            // Ignore commands
            if (!text || text.startsWith('/')) {
                return;
            }

            try {
                // CHANGE: Handle owner reply to forward message to user
                // WHY: Owner needs to reply to users via bot by using Reply feature
                // QUOTE(ТЗ): "если вы отвечаете то сообщение будет пересылатся по reply"
                // REF: User request - reply forwarding
                // NOTE: If owner writes without reply, bot works normally (processes via AI)
                console.log(`[Bot ${botData.nameprompt}] Reply check: isOwner=${isOwner}, has_reply=${!!msg.reply_to_message}, reply_from_bot=${msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.is_bot}`);
                if (isOwner && msg.reply_to_message && msg.reply_to_message.from.is_bot) {
                    // Extract user ID from the notification message
                    const notificationText = msg.reply_to_message.text || '';
                    console.log(`[Bot ${botData.nameprompt}] Notification text: ${notificationText.substring(0, 200)}`);
                    const userIdMatch = notificationText.match(/ID:\s*(\d+)|от пользователя.*?(\d{9,})|User ID:\s*(\d+)|пользователь\s+(\d{9,})/i);
                    console.log(`[Bot ${botData.nameprompt}] User ID match result: ${userIdMatch ? userIdMatch[0] : 'null'}`);

                    if (userIdMatch) {
                        const targetUserId = userIdMatch[1] || userIdMatch[2] || userIdMatch[3] || userIdMatch[4];

                        try {
                            await bot.sendMessage(
                                targetUserId,
                                `💬 Ответ от администратора:\n\n${text}`
                            );

                            await bot.sendMessage(
                                chatId,
                                `✅ Ваш ответ отправлен пользователю ${targetUserId}`
                            );

                            console.log(`[Bot ${botData.nameprompt}] Owner reply forwarded to user ${targetUserId}: ${text}`);
                            return;
                        } catch (error) {
                            await bot.sendMessage(
                                chatId,
                                `❌ Не удалось отправить ответ пользователю: ${error.message}`
                            );
                            console.error(`[Bot ${botData.nameprompt}] Failed to forward owner reply:`, error);
                            return;
                        }
                    }
                    // CHANGE: If no user ID found in replied message, continue to normal AI processing
                    // WHY: Admin should be able to reply to regular bot messages without getting errors
                    // REF: User feedback - "лалала" reply to bot response caused error
                    // NOTE: Only actual notification messages (with user IDs) trigger reply forwarding
                }

                // CHANGE: Provide quick owner guidance when they ask how to reply.
                // WHY: Owners need a clear answer without invoking the AI flow.
                // QUOTE(ТЗ): "пользователь админ бота спрашивает как отвечать на сообщения от юзеров в боте"
                // REF: user request 2026-01-28
                const normalizedText = text.toLowerCase();
                if (isOwner && (normalizedText.includes('как отвечать') || normalizedText.includes('как ответить'))) {
                    await bot.sendMessage(
                        chatId,
                        'Используйте Reply (ответить) на уведомление от бота, чтобы отправить сообщение пользователю.'
                    );
                    console.log(`[Bot ${botData.nameprompt}] Owner asked about replies, sent guidance.`);
                    return;
                }

                await bot.sendChatAction(chatId, 'typing');

                // CHANGE: Extract user info for context
                // WHY: AI needs to know user's telegram username and name to include in notifications
                // REF: User request - "просто имя и сохраняй его телеграм"
                const userInfo = {
                    id: msg.from.id,
                    username: msg.from.username ? `@${msg.from.username}` : null,
                    firstName: msg.from.first_name || null,
                    lastName: msg.from.last_name || null,
                    fullName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'Пользователь'
                };

                // CHANGE: Log user messages for admin visibility.
                // WHY: Admin wants to see what users send and what the bot replies.
                // QUOTE(ТЗ): "в логах чтоб я тоже видел что пишет юзер боту (админу) и что тот отвечает"
                // REF: user request 2026-01-28
                console.log(`[Bot ${botData.nameprompt}] User message: ${JSON.stringify({ chatId, userId: userInfo.id, username: userInfo.username, text })}`);

                // Load chat history
                const historyFile = path.join(userDataDir, `chat_${chatId}.json`);
                let chatHistory = [];
                if (fs.existsSync(historyFile)) {
                    chatHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
                }

                // Add user message to history with user context
                chatHistory.push({
                    role: 'user',
                    content: text,
                    timestamp: new Date().toISOString(),
                    userInfo: userInfo // Store for reference
                });

                // Keep only last 20 messages
                if (chatHistory.length > 20) {
                    chatHistory = chatHistory.slice(-20);
                }

                // CHANGE: Build enhanced prompt with user context
                // WHY: AI needs to know who is writing to include their telegram in notifications
                // REF: User request - бот должен извлекать телеграм клиента
                const userContextPrefix = `[КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ: Имя: ${userInfo.fullName}, Telegram: ${userInfo.username || 'не указан'}, ID: ${userInfo.id}]\n\n`;
                const enhancedPrompt = prompt + `\n\n---\nВАЖНО: Текущий пользователь - ${userInfo.fullName} (Telegram: ${userInfo.username || 'ID:' + userInfo.id}). Когда отправляешь уведомление админу через [NOTIFY_ADMIN], ОБЯЗАТЕЛЬНО указывай контакт пользователя: ${userInfo.username || 'ID:' + userInfo.id}` + BUTTONS_RUNTIME_INSTRUCTION;

                // Call OpenAI with enhanced prompt
                const response = await this.callOpenAI(enhancedPrompt, chatHistory, {
                    chatId: String(chatId),
                    userId: String(userInfo.id),
                    operation: 'bot_runtime_chat',
                    botId: String(botData.bot_id)
                });

                // CHANGE: Parse notification commands from AI response
                // WHY: Support [NOTIFY_USER] and [NOTIFY_ADMIN] commands
                // REF: #17
                const parsedResponse = this.conversationManager.parseNotificationCommands(response);

                // Add assistant response to history (full version with commands)
                chatHistory.push({
                    role: 'assistant',
                    content: response,
                    timestamp: new Date().toISOString()
                });

                // Save history
                fs.writeFileSync(historyFile, JSON.stringify(chatHistory, null, 2));

                // Send chat message (without notification commands)
                const messageOptions = this.buildChatMessageOptions(parsedResponse);
                if (messageOptions) {
                    await bot.sendMessage(chatId, parsedResponse.chatMessage, messageOptions);
                } else {
                    await bot.sendMessage(chatId, parsedResponse.chatMessage);
                }
                console.log(`[Bot ${botData.nameprompt}] Bot response: ${JSON.stringify({ chatId, userId: userInfo.id, message: parsedResponse.chatMessage })}`);

                // CHANGE: Send notifications if configured and present in response
                // WHY: Enable bots to send DM and channel notifications
                // REF: #17
                const notificationConfig = botData.notifications || {};
                const legacyDefaults = notificationConfig.sendPrivateMessages === false && !notificationConfig.notificationChannel;
                const effectiveNotificationConfig = {
                    sendPrivateMessages: legacyDefaults ? true : notificationConfig.sendPrivateMessages !== false,
                    notificationChannel: notificationConfig.notificationChannel || botData.user_id
                };
                if (parsedResponse.userNotification || parsedResponse.adminNotification) {
                    const notificationResults = await this.conversationManager.sendNotifications(
                        bot,
                        msg.from.id,
                        chatId,
                        {
                            userNotification: parsedResponse.userNotification,
                            adminNotification: parsedResponse.adminNotification
                        },
                        effectiveNotificationConfig
                    );

                    // CHANGE: Log admin notification delivery with bot and user context.
                    // WHY: Need explicit log proving admin notification delivery per bot.
                    // QUOTE(ТЗ): "об этом должен быть лог тоже"
                    // REF: user request 2026-01-28
                    if (parsedResponse.adminNotification) {
                        if (notificationResults.adminNotificationSent) {
                            console.log(`[Notification] Bot ${botData.nameprompt} sent admin notification to ${effectiveNotificationConfig.notificationChannel} for user ${msg.from.id} (chat ${chatId})`);
                        } else if (notificationResults.errors.length > 0) {
                            console.log(`[Notification] Bot ${botData.nameprompt} failed admin notification to ${effectiveNotificationConfig.notificationChannel} for user ${msg.from.id} (chat ${chatId}): ${notificationResults.errors.join('; ')}`);
                        }
                    }

                    // If user notification failed, inform in chat
                    if (parsedResponse.userNotification && !notificationResults.userNotificationSent && notificationResults.errors.length > 0) {
                        const errorMsg = notificationResults.errors.find(e => e.includes('личку'));
                        if (errorMsg) {
                            await bot.sendMessage(chatId, `\n\n${errorMsg}`).catch(e => {});
                        }
                    }
                }

            } catch (error) {
                console.error(`[Bot ${botData.nameprompt}] Error handling message:`, error);
                await bot.sendMessage(
                    chatId,
                    'Извините, произошла ошибка. Попробуйте еще раз.'
                ).catch(e => console.error('Failed to send error message:', e));
            }
        });

        // CHANGE: Add callback_query handler for inline buttons
        // WHY: When user clicks inline buttons, bot needs to respond
        // REF: User request - кнопки не работают (бесконечная загрузка)
        bot.on('callback_query', async (query) => {
            const chatId = query.message.chat.id;
            const userId = query.from.id;
            const callbackData = query.data;
            const isOwner = userId.toString() === botData.user_id;

            try {
                // CHANGE: Show immediate feedback to user when button is clicked
                // WHY: User should see instant response that system is processing
                // REF: User request - "при нажатии на кнопку пусть будет какой-то отклик"
                await bot.answerCallbackQuery(query.id, {
                    text: '⏳ Обрабатываю ваш запрос...',
                    show_alert: false
                });

                // Process callback data as user message
                await bot.sendChatAction(chatId, 'typing');

                const userInfo = {
                    id: userId,
                    username: query.from.username ? `@${query.from.username}` : null,
                    firstName: query.from.first_name || null,
                    lastName: query.from.last_name || null,
                    fullName: [query.from.first_name, query.from.last_name].filter(Boolean).join(' ') || 'Пользователь'
                };

                console.log(`[Bot ${botData.nameprompt}] Callback query: ${JSON.stringify({ chatId, userId, username: userInfo.username, callbackData })}`);

                // Load chat history
                const historyFile = path.join(userDataDir, `chat_${chatId}.json`);
                let chatHistory = [];
                if (fs.existsSync(historyFile)) {
                    chatHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
                }

                // Add user action to history (callback data as message)
                chatHistory.push({
                    role: 'user',
                    content: callbackData,
                    timestamp: new Date().toISOString(),
                    userInfo: userInfo,
                    source: 'callback_query'
                });

                // Keep only last 20 messages
                if (chatHistory.length > 20) {
                    chatHistory = chatHistory.slice(-20);
                }

                // Build enhanced prompt with user context
                const enhancedPrompt = prompt + `\n\n---\nВАЖНО: Текущий пользователь - ${userInfo.fullName} (Telegram: ${userInfo.username || 'ID:' + userInfo.id}). Когда отправляешь уведомление админу через [NOTIFY_ADMIN], ОБЯЗАТЕЛЬНО указывай контакт пользователя: ${userInfo.username || 'ID:' + userInfo.id}` + BUTTONS_RUNTIME_INSTRUCTION;

                // Call OpenAI with enhanced prompt
                const response = await this.callOpenAI(enhancedPrompt, chatHistory, {
                    chatId: String(chatId),
                    userId: String(userId),
                    operation: 'bot_runtime_callback',
                    botId: String(botData.bot_id)
                });

                // Parse notification commands from AI response
                const parsedResponse = this.conversationManager.parseNotificationCommands(response);

                // Add assistant response to history
                chatHistory.push({
                    role: 'assistant',
                    content: response,
                    timestamp: new Date().toISOString()
                });

                // Save history
                fs.writeFileSync(historyFile, JSON.stringify(chatHistory, null, 2));

                // Send chat message (without notification commands)
                const messageOptions = this.buildChatMessageOptions(parsedResponse);
                if (messageOptions) {
                    await bot.sendMessage(chatId, parsedResponse.chatMessage, messageOptions);
                } else {
                    await bot.sendMessage(chatId, parsedResponse.chatMessage);
                }
                console.log(`[Bot ${botData.nameprompt}] Bot response to callback: ${JSON.stringify({ chatId, userId, message: parsedResponse.chatMessage })}`);

                // Send notifications if configured and present in response
                const notificationConfig = botData.notifications || {};
                const legacyDefaults = notificationConfig.sendPrivateMessages === false && !notificationConfig.notificationChannel;
                const effectiveNotificationConfig = {
                    sendPrivateMessages: legacyDefaults ? true : notificationConfig.sendPrivateMessages !== false,
                    notificationChannel: notificationConfig.notificationChannel || botData.user_id
                };
                if (parsedResponse.userNotification || parsedResponse.adminNotification) {
                    const notificationResults = await this.conversationManager.sendNotifications(
                        bot,
                        userId,
                        chatId,
                        {
                            userNotification: parsedResponse.userNotification,
                            adminNotification: parsedResponse.adminNotification
                        },
                        effectiveNotificationConfig
                    );

                    if (parsedResponse.adminNotification) {
                        if (notificationResults.adminNotificationSent) {
                            console.log(`[Notification] Bot ${botData.nameprompt} sent admin notification to ${effectiveNotificationConfig.notificationChannel} for user ${userId} (chat ${chatId})`);
                        } else if (notificationResults.errors.length > 0) {
                            console.log(`[Notification] Bot ${botData.nameprompt} failed admin notification to ${effectiveNotificationConfig.notificationChannel} for user ${userId} (chat ${chatId}): ${notificationResults.errors.join('; ')}`);
                        }
                    }

                    // If user notification failed, inform in chat
                    if (parsedResponse.userNotification && !notificationResults.userNotificationSent && notificationResults.errors.length > 0) {
                        const errorMsg = notificationResults.errors.find(e => e.includes('личку'));
                        if (errorMsg) {
                            await bot.sendMessage(chatId, `\n\n${errorMsg}`).catch(e => {});
                        }
                    }
                }

            } catch (error) {
                console.error(`[Bot ${botData.nameprompt}] Error handling callback query:`, error);
                await bot.answerCallbackQuery(query.id, {
                    text: 'Произошла ошибка. Попробуйте еще раз.',
                    show_alert: true
                }).catch(e => console.error('Failed to answer callback query:', e));
            }
        });

        bot.on('webhook_error', (error) => {
            console.error(`[Bot ${botData.nameprompt}] Webhook error:`, error.message);
        });
    }

    async callOpenAI(systemPrompt, chatHistory, context = {}) {
        try {
            const messages = [
                { role: 'system', content: systemPrompt },
                ...chatHistory.map(m => ({
                    role: m.role,
                    content: m.content
                }))
            ];

            const { apiKey, baseUrl } = getHydraConfig();
            const model = getBotModel();
            const payload = {
                model,
                messages,
                temperature: 0.8,
                max_tokens: 1000
            };
            const startedAt = Date.now();

            let response = null;
            let lastError = null;

            for (let attempt = 1; attempt <= 3; attempt += 1) {
                const timeoutMs = attempt === 1 ? 30000 : 90000;
                try {
                    response = await axios.post(
                        `${baseUrl.replace(/\/$/, '')}/chat/completions`,
                        payload,
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`
                            },
                            timeout: timeoutMs,
                            proxy: false,
                            maxRedirects: 0,
                            transformRequest: [(data) => JSON.stringify(data)],
                            transformResponse: [
                                (data) => {
                                    try {
                                        return JSON.parse(data as string);
                                    } catch {
                                        return data;
                                    }
                                }
                            ]
                        }
                    );
                    break;
                } catch (error) {
                    lastError = error;
                    if (!isRetryableHydraError(error) || attempt === 3) break;
                    await sleep(3000 * attempt);
                }
            }

            if (!response) {
                throw (lastError || new Error('Hydra request failed'));
            }

            try {
                logHydraRequest({
                    caller: 'botInstanceManager.callOpenAI',
                    context,
                    request: payload,
                    response: {
                        success: true,
                        data: response.data,
                        latencyMs: Date.now() - startedAt,
                        usage: response?.data?.usage
                    }
                });
            } catch (logError) {
                console.warn('[Hydra Logger] Failed to log request:', logError.message);
            }

            return response.data.choices[0].message.content;

        } catch (error) {
            try {
                logHydraRequest({
                    caller: 'botInstanceManager.callOpenAI',
                    context,
                    request: {
                        model: getBotModel(),
                        messages: [
                            { role: 'system', content: systemPrompt },
                            ...chatHistory.map(m => ({ role: m.role, content: m.content }))
                        ],
                        temperature: 0.8,
                        max_tokens: 1000
                    },
                    response: {
                        success: false,
                        error: error.message,
                        latencyMs: 0
                    }
                });
            } catch (logError) {
                console.warn('[Hydra Logger] Failed to log error:', logError.message);
            }
            console.error('[OpenAI] Error calling API:', error.message);
            throw new Error('Не удалось получить ответ от AI');
        }
    }

    buildChatMessageOptions(parsedResponse) {
        if (!parsedResponse || !Array.isArray(parsedResponse.inlineKeyboard) || parsedResponse.inlineKeyboard.length === 0) {
            return null;
        }
        return {
            reply_markup: {
                inline_keyboard: parsedResponse.inlineKeyboard
            }
        };
    }

    async stopBot(botId) {
        try {
            const instance = this.activeBots.get(botId);
            if (!instance) {
                return { success: false, error: 'Bot not running' };
            }

            console.log(`[BotInstance] Stopping bot ${botId}...`);

            await instance.bot.deleteWebHook();
            this.activeBots.delete(botId);

            console.log(`[BotInstance] ✅ Bot ${botId} stopped`);

            return { success: true };

        } catch (error) {
            console.error(`[BotInstance] Error stopping bot ${botId}:`, error);
            return { success: false, error: error.message };
        }
    }

    async restartBot(botId, botData) {
        await this.stopBot(botId);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await this.startBot(botData);
    }

    getBotStatus(botId) {
        const instance = this.activeBots.get(botId);
        if (!instance) {
            return { running: false };
        }

        return {
            running: true,
            startedAt: instance.startedAt,
            uptime: Date.now() - instance.startedAt.getTime()
        };
    }

    getAllActiveBots() {
        return Array.from(this.activeBots.keys());
    }

    getActiveBotsCount() {
        return this.activeBots.size;
    }

    // CHANGE: Helper method to count bot users
    // WHY: Need to track user count for first user notification
    // REF: User request - уведомление о первых пользователях
    countBotUsers(userDataDir) {
        try {
            if (!fs.existsSync(userDataDir)) return 0;
            const files = fs.readdirSync(userDataDir);
            // Count only user profile files (not chat_* files)
            return files.filter(f => !f.startsWith('chat_') && f.endsWith('.json')).length;
        } catch (error) {
            console.error('[BotInstance] Error counting users:', error);
            return 0;
        }
    }

    // CHANGE: Notify owner when bot gets first user
    // WHY: Important milestone for bot creators
    // REF: User request - уведомление о первых пользователях
    // CHANGE: Send notification from bot itself, not Saved Messages
    // WHY: User wants notifications from bot, not telegram_sender to Saved Messages
    // REF: User request - "почему приходят уведомления в Saved Message? а не от самого бота"
    notifyOwnerFirstUser(botData, user) {
        try {
            const botInstance = this.activeBots.get(botData.bot_id);
            if (!botInstance || !botInstance.bot) {
                console.error(`[BotInstance] Cannot notify owner - bot instance not found`);
                return;
            }

            const username = user.username ? `@${user.username}` : 'без username';
            const firstName = user.first_name || 'Пользователь';

            const message = `🎉 Поздравляем! Ваш бот получил первого пользователя!\n\n` +
                `👤 ${firstName} (${username})\n` +
                `🆔 ID: ${user.id}\n\n` +
                `Пользователь только что начал диалог с вашим ботом.`;

            botInstance.bot.sendMessage(botData.user_id, message)
                .then(() => {
                    console.log(`[BotInstance] Notified owner ${botData.user_id} about first user from bot`);
                })
                .catch((error) => {
                    console.error(`[BotInstance] Failed to notify owner:`, error.message);
                });
        } catch (error) {
            console.error('[BotInstance] Error notifying owner:', error);
        }
    }

    // CHANGE: Notify owner when user starts with referral parameter
    // WHY: Owner wants to know about every referral conversion
    // REF: User request - "уведомление не пришло админу этого бота"
    notifyOwnerReferralStart(botData, user, channelName) {
        try {
            const botInstance = this.activeBots.get(botData.bot_id);
            if (!botInstance || !botInstance.bot) {
                console.error(`[BotInstance] Cannot notify owner - bot instance not found`);
                return;
            }

            const username = user.username ? `@${user.username}` : 'без username';
            const firstName = user.first_name || 'Пользователь';
            const botUsername = botData.username ? `@${botData.username}` : botData.nameprompt;

            const message = `🔔 Новый пользователь нажал старт в ${botUsername}:\n\n` +
                `👤 Имя: ${firstName}\n` +
                `📝 Username: ${username}\n` +
                `🆔 User ID: ${user.id}\n` +
                `📍 Источник: Telegram канал @${channelName}`;

            botInstance.bot.sendMessage(botData.user_id, message)
                .then(() => {
                    console.log(`[BotInstance] Notified owner ${botData.user_id} about referral start from ${channelName}`);
                })
                .catch((error) => {
                    console.error(`[BotInstance] Failed to notify owner about referral:`, error.message);
                });
        } catch (error) {
            console.error('[BotInstance] Error notifying owner about referral:', error);
        }
    }

    // CHANGE: Collect statistics for a specific bot
    // WHY: Owners need personalized metrics for their bots
    // REF: User request - персональная аналитика для владельцев ботов
    collectBotStats(userDataDir, botData) {
        try {
            if (!fs.existsSync(userDataDir)) {
                return 'Статистика пока недоступна - нет данных.';
            }

            const files = fs.readdirSync(userDataDir);
            const userFiles = files.filter(f => !f.startsWith('chat_') && f.endsWith('.json'));
            const chatFiles = files.filter(f => f.startsWith('chat_') && f.endsWith('.json'));

            let totalMessages = 0;
            let activeUsers = 0;
            let lastActivity = null;
            let todayMessages = 0;
            const today = new Date().toISOString().split('T')[0];

            for (const file of chatFiles) {
                try {
                    const filePath = path.join(userDataDir, file);
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                    if (Array.isArray(data) && data.length > 0) {
                        activeUsers++;
                        totalMessages += data.length;

                        // Check for today's messages
                        data.forEach(msg => {
                            if (msg.timestamp && msg.timestamp.startsWith(today)) {
                                todayMessages++;
                            }
                        });

                        // Find last activity
                        const lastMsg = data[data.length - 1];
                        if (lastMsg && lastMsg.timestamp) {
                            if (!lastActivity || new Date(lastMsg.timestamp) > new Date(lastActivity)) {
                                lastActivity = lastMsg.timestamp;
                            }
                        }
                    }
                } catch (e) {
                    // Skip corrupted files
                }
            }

            const createdDate = new Date(botData.created_at).toLocaleDateString('ru-RU');
            const lastActivityStr = lastActivity
                ? new Date(lastActivity).toLocaleString('ru-RU')
                : 'нет активности';

            let stats = `📊 Статистика бота ${botData.nameprompt}\n\n`;
            stats += `Создан: ${createdDate}\n`;
            stats += `Статус: ${botData.status}\n\n`;
            stats += `👥 Пользователи:\n`;
            stats += `  Всего: ${userFiles.length}\n`;
            stats += `  Активных (писали): ${activeUsers}\n\n`;
            stats += `💬 Сообщения:\n`;
            stats += `  Всего: ${totalMessages}\n`;
            stats += `  За сегодня: ${todayMessages}\n`;
            stats += `  Среднее на пользователя: ${activeUsers > 0 ? (totalMessages / activeUsers).toFixed(1) : 0}\n\n`;
            stats += `🕐 Последняя активность:\n  ${lastActivityStr}`;

            return stats;
        } catch (error) {
            console.error('[BotInstance] Error collecting stats:', error);
            return 'Ошибка при сборе статистики.';
        }
    }

    // CHANGE: Get list of bot users
    // WHY: Owners want to see who uses their bot
    // REF: User request - список пользователей бота
    getBotUsersList(userDataDir) {
        try {
            if (!fs.existsSync(userDataDir)) {
                return 'Пользователей пока нет.';
            }

            const files = fs.readdirSync(userDataDir);
            const userFiles = files.filter(f => !f.startsWith('chat_') && f.endsWith('.json'));

            if (userFiles.length === 0) {
                return 'Пользователей пока нет.';
            }

            let usersList = `👥 Пользователи бота (${userFiles.length}):\n\n`;
            let shown = 0;

            for (const file of userFiles.slice(0, 20)) { // Max 20 users
                try {
                    const filePath = path.join(userDataDir, file);
                    const userData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                    const name = userData.firstName || 'Без имени';
                    const username = userData.username ? `@${userData.username}` : '';
                    const date = userData.firstVisit
                        ? new Date(userData.firstVisit).toLocaleDateString('ru-RU')
                        : '';

                    shown++;
                    usersList += `${shown}. ${name} ${username}\n`;
                    if (date) usersList += `   Первый визит: ${date}\n`;
                } catch (e) {
                    // Skip corrupted files
                }
            }

            if (userFiles.length > 20) {
                usersList += `\n... и еще ${userFiles.length - 20} пользователей`;
            }

            return usersList;
        } catch (error) {
            console.error('[BotInstance] Error getting users list:', error);
            return 'Ошибка при получении списка.';
        }
    }

    // CHANGE: Broadcast message to all bot users
    // WHY: Owners need to send announcements
    // REF: User request - рассылка по пользователям бота
    async broadcastMessage(bot, userDataDir, message, ownerUserId) {
        try {
            if (!fs.existsSync(userDataDir)) {
                return 'Нет пользователей для рассылки.';
            }

            const files = fs.readdirSync(userDataDir);
            const userFiles = files.filter(f => !f.startsWith('chat_') && f.endsWith('.json'));

            if (userFiles.length === 0) {
                return 'Нет пользователей для рассылки.';
            }

            let sent = 0;
            let failed = 0;
            let skipped = 0;

            for (const file of userFiles) {
                try {
                    const filePath = path.join(userDataDir, file);
                    const userData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    const chatId = userData.chatId;

                    // Skip owner
                    if (chatId === ownerUserId.toString()) {
                        skipped++;
                        continue;
                    }

                    await bot.sendMessage(chatId, message);
                    sent++;

                    // Rate limiting - wait 50ms between messages
                    await new Promise(resolve => setTimeout(resolve, 50));
                } catch (error) {
                    failed++;
                    console.error(`[Broadcast] Failed to send to user:`, error.message);
                }
            }

            return `Рассылка завершена!\n\nОтправлено: ${sent}\nОшибок: ${failed}\nПропущено (владелец): ${skipped}`;
        } catch (error) {
            console.error('[BotInstance] Error broadcasting:', error);
            return 'Ошибка при рассылке.';
        }
    }
}

export = BotInstanceManager;
