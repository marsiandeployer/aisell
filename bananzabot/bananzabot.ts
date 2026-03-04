// @ts-nocheck
// NOTE: Large legacy file migrated from JS to TS to run under tsx in prod.
// Strict typing will be restored incrementally; `any` is avoided in new/refactored modules.

import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import * as crypto from 'crypto';
import * as http from 'http';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import BotsManager from './botsManager';
import ConversationManager from './conversationManager';
import BotInstanceManager = require('./botInstanceManager.ts');
import BotDeployer from './botDeployer';
import { getPromptModel, getBotModel, getHydraConfig } from './aiSettings';
// CHANGE: Import PromptBuilder for interactive prompt construction
// WHY: Enable guided bot creation with AI-assisted dialog
// REF: #16
import PromptBuilder from './promptBuilder';
import type { PromptBuilderHistoryItem } from './promptBuilder';
import { validateSingleMessageInputLength } from './inputLimits';
// CHANGE: Import analytics module for real activity tracking
// WHY: Need to understand how many users actually interact with created bots
// REF: User request - need metrics for real activity
import * as Analytics from './analytics';

type BotData = {
    bot_id: string;
    api_key: string;
    user_id: string;
    nameprompt: string;
    status: string;
    prompt?: string;
    username?: string | null;
    first_name?: string | null;
    telegram_id?: string | number | null;
    notifications?: unknown;
};

type GeneratedBotBranding = {
    name: string;
    about: string;
    description: string;
    commands: Array<{ command: string; description: string }>;
    botpicPrompt: string;
    descriptionPicture: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function asErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function asBotData(value: unknown): BotData | null {
    if (!isRecord(value)) return null;
    const bot_id = asString(value.bot_id);
    const api_key = asString(value.api_key);
    const user_id = asString(value.user_id);
    const nameprompt = asString(value.nameprompt);
    const status = asString(value.status);
    if (!bot_id || !api_key || !user_id || !nameprompt || !status) return null;
    return {
        bot_id,
        api_key,
        user_id,
        nameprompt,
        status,
        prompt: typeof value.prompt === 'string' ? value.prompt : undefined,
        username: value.username === null || typeof value.username === 'string' ? (value.username as string | null) : undefined,
        first_name: value.first_name === null || typeof value.first_name === 'string' ? (value.first_name as string | null) : undefined,
        telegram_id: value.telegram_id === null || typeof value.telegram_id === 'string' || typeof value.telegram_id === 'number'
            ? (value.telegram_id as string | number | null)
            : undefined,
        notifications: value.notifications,
    };
}

function coercePromptHistory(value: unknown): PromptBuilderHistoryItem[] {
    if (!Array.isArray(value)) return [];
    const out: PromptBuilderHistoryItem[] = [];
    for (const item of value) {
        if (!isRecord(item)) continue;
        const role = item.role;
        const content = item.content;
        if ((role === 'user' || role === 'assistant' || role === 'system') && typeof content === 'string') {
            out.push({ role, content });
        }
    }
    return out;
}

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const token = process.env.TELEGRAM_BOT_TOKEN;
const openaiApiKey = process.env.OPENAI_API_KEY;
const hydraApiKey = process.env.HYDRA_API_KEY;
// CHANGE: Add admin user ID for notifications
// WHY: Need to send notifications when users start bot or send first prompt
// REF: User request - присылай мне уведомления когда ктото жмет старт или пишет промпт первый
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '420074487'; // @sashanoxon
const BOT_NAME_MAX = 64;
const BOT_DESCRIPTION_MAX = 500;
const BOT_SHORT_DESCRIPTION_MAX = 120;
const BOT_COMMAND_MAX = 8;
const BOT_COMMAND_NAME_MAX = 32;
const BOT_COMMAND_DESCRIPTION_MAX = 256;

if (!token) {
    console.error('Error: TELEGRAM_BOT_TOKEN not defined in .env file');
    process.exit(1);
}

if (!hydraApiKey) {
    console.error('Error: HYDRA_API_KEY not defined in .env file');
    process.exit(1);
}

const bot = new TelegramBot(token, {
    polling: {
        interval: 500,
        autoStart: true,
        params: { timeout: 30 }
    }
});
const botsManager = new BotsManager();
const conversationManager = new ConversationManager();
const botInstanceManager = new BotInstanceManager();
const botDeployer = new BotDeployer(botsManager, botInstanceManager);
// CHANGE: Initialize PromptBuilder instance
// WHY: Enable interactive prompt construction dialogs
// REF: #16
const promptBuilder = new PromptBuilder();

console.log('🤖 Bananzabot Constructor started successfully!');

// Webhook HTTP server for created bots — Telegram pushes updates here
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3183', 10);
const webhookServer = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/webhook/')) {
        res.writeHead(404);
        res.end();
        return;
    }

    const botId = req.url.slice('/webhook/'.length);
    const instance = botInstanceManager.activeBots.get(botId);
    if (!instance) {
        res.writeHead(404);
        res.end();
        return;
    }

    // Verify secret token
    const headerToken = req.headers['x-telegram-bot-api-secret-token'];
    if (headerToken !== instance.secretToken) {
        res.writeHead(403);
        res.end();
        return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
        res.writeHead(200);
        res.end();

        try {
            const update = JSON.parse(body);
            instance.bot.processUpdate(update);
            console.log(`[Webhook] Update received for bot ${botId}`);
        } catch (err) {
            console.error(`[Webhook] Failed to parse update for bot ${botId}:`, err.message);
        }
    });
});
webhookServer.listen(WEBHOOK_PORT, '127.0.0.1', () => {
    console.log(`[Webhook] Server listening on 127.0.0.1:${WEBHOOK_PORT}`);
});

// CHANGE: Update bot metadata on startup using direct API calls
// WHY: Автоматическое обновление описаний, команд, меню при рестарте бота
// REF: User request - обновлять все доступные метаданные при рестарте
async function updateBotMetadata() {
    try {
        const baseUrl = `https://api.telegram.org/bot${token}`;

        // Name (About)
        const nameResponse = await axios.post(`${baseUrl}/setMyName`, {
            name: 'Bananza - Создатель телеграм ботов',
            language_code: 'ru'
        });

        if (!nameResponse.data.ok) {
            console.error('[Startup] Failed to set name:', nameResponse.data);
        } else {
            console.log('[Startup] ✅ Name (About) updated');
        }

        // Description
        const descResponse = await axios.post(`${baseUrl}/setMyDescription`, {
            description: 'Конструктор Telegram ботов с автоворонками. Создайте своего AI-бота бесплатно за 5 минут! Просто опишите свой бизнес голосом или текстом.',
            language_code: 'ru'
        });

        if (!descResponse.data.ok) {
            console.error('[Startup] Failed to set description:', descResponse.data);
        } else {
            console.log('[Startup] ✅ Description updated');
        }

        // Short description
        const shortDescResponse = await axios.post(`${baseUrl}/setMyShortDescription`, {
            short_description: 'Создайте своего AI-бота с автоворонками за 5 минут. Бесплатно!',
            language_code: 'ru'
        });

        if (!shortDescResponse.data.ok) {
            console.error('[Startup] Failed to set short description:', shortDescResponse.data);
        } else {
            console.log('[Startup] ✅ Short description updated');
        }

        // Commands
        const commandsResponse = await axios.post(`${baseUrl}/setMyCommands`, {
            commands: [
                { command: 'start', description: 'Создать нового бота' },
                { command: 'mybots', description: 'Мои боты' },
                { command: 'stats', description: 'Статистика системы' },
                { command: 'cancel', description: 'Отменить создание бота' }
            ]
        });

        if (!commandsResponse.data.ok) {
            console.error('[Startup] Failed to set commands:', commandsResponse.data);
        } else {
            console.log('[Startup] ✅ Commands updated');
        }

        console.log('[Startup] ✅ Bot metadata updated successfully');
    } catch (error) {
        console.error('[Startup] ❌ Error updating bot metadata:', asErrorMessage(error));
    }
}

// Load and start all existing active bots on startup
(async () => {
    try {
        // CHANGE: Disabled automatic metadata update for main bot
        // WHY: User request - bananzabot он при перезапуске pm2 пытается заменить собственное описание в апи так нельзя
        // REF: User request
        // await updateBotMetadata();

        const dedupeSummary = botsManager.ensureUniqueActiveBotsByApiKey();
        if (dedupeSummary.changed) {
            console.log(
                `[Startup] Deduplicated active bots by api_key: groups=${dedupeSummary.duplicateGroups}, stopped=${dedupeSummary.stoppedBotIds.length}`
            );
        }

        const allBots = botsManager.loadBots();
        const activeBots = allBots.map(asBotData).filter((b): b is BotData => Boolean(b) && b.status === 'active');

        if (activeBots.length > 0) {
            console.log(`[Startup] Found ${activeBots.length} active bots, starting them...`);

            for (const botData of activeBots) {
                const result = await botInstanceManager.startBot(botData);
                if (result.success) {
                    console.log(`[Startup] ✅ Started bot ${botData.nameprompt}`);
                } else {
                    console.error(`[Startup] ❌ Failed to start bot ${botData.nameprompt}:`, result.error);
                }
            }
        }
    } catch (error) {
        console.error('[Startup] Error loading active bots:', asErrorMessage(error));
    }
})();

// Welcome message
// CHANGE: Updated welcome message to reflect interactive approach
// WHY: New interactive dialog guides users to create realistic prompts
// REF: #16
const WELCOME_MESSAGE = `👋 Привет! Я помогу создать вашего AI-бота для Telegram за 5 минут!

🤖 Что умеют созданные боты:
• Общаются с клиентами 24/7
• Собирают заявки и контакты
• Отвечают на частые вопросы
• Присылают вам уведомления о новых клиентах

📊 Популярные ниши (уже работают):
• Салоны красоты, мастера (маникюр, парикмахер)
• Ремонт техники (телефоны, ноутбуки)
• Консультации и услуги
• Образование (репетиторы, курсы)

💬 Расскажите о вашем бизнесе:
Можете голосом или текстом!

Примеры:
"Салон красоты, делаем маникюр и педикюр"
"Ремонтирую телефоны, средний чек 2000₽"
"Репетитор по математике, онлайн и офлайн"

Чем подробнее опишете — тем лучше бот!
Укажите:
✅ Услуги/продукты
✅ Цены (если есть)
✅ График работы

Я задам уточняющие вопросы и создам идеальный промпт 🎯`;


// Generate example question for test bot based on business description
async function generateExampleQuestion(description: string): Promise<string | null> {
    try {
        const { apiKey, baseUrl } = getHydraConfig();
        const model = getBotModel();
        const response = await axios.post(
            `${baseUrl.replace(/\/$/, '')}/chat/completions`,
            {
                model,
                messages: [
                    { role: 'system', content: 'Ты помощник. Напиши ОДИН короткий пример вопроса (до 10 слов), который клиент мог бы задать боту с таким описанием бизнеса. Без кавычек, без пояснений — только сам вопрос.' },
                    { role: 'user', content: description },
                ],
                temperature: 0.7,
                max_tokens: 50,
            },
            {
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                timeout: 10000,
            }
        );
        const content = response.data?.choices?.[0]?.message?.content?.trim();
        return content || null;
    } catch {
        return null;
    }
}

// Test mode welcome message
async function buildTestModeWelcome(botData: { product_description?: string }): Promise<string> {
    const description = botData.product_description || 'Тестовый бот';

    let msg = `🤖 Это ваш бот! Посмотрите, как он работает.

📋 ${description}

Напишите ему сообщение так, как написал бы ваш клиент — и посмотрите, как бот ответит.`;

    const exampleQuestion = await generateExampleQuestion(description);
    if (exampleQuestion) {
        msg += `\n\n💬 Например, попробуйте спросить:\n«${exampleQuestion}»`;
    }

    msg += `\n\n✏️ Если что-то не нравится в ответах — вернитесь в @bananza_bot и напишите, что поменять.`;
    return msg;
}

// Prompt preview helper
const buildPromptPreviewMessage = (userId: string | number, generatedPrompt: string) => `Промпт сгенерирован!

Превью промпта:

${generatedPrompt.substring(0, 500)}...

---

Протестируйте бота прямо сейчас (БЕСПЛАТНО)!

Вот ссылка для тестирования:
https://t.me/bananzatestbot?start=test_${userId}

Перейдите по ней (можно с другого аккаунта или поделитесь с друзьями) и попробуйте пообщаться с ботом!

Бот уже готов к работе - просто нажмите на ссылку!

---

Хотите что-то поменять?
Просто напишите сюда, что нужно исправить в ответах бота — я перегенерирую промпт и обновлю тест. Токен можно прислать позже, когда все будет готово.

Если все устраивает и хотите создать отдельного бота:

1. Откройте @BotFather в Telegram
2. Отправьте /newbot
3. Следуйте инструкциям
4. Скопируйте токен (формат: 123456:ABC-DEF...)
5. Отправьте мне токен

Или отправьте /cancel чтобы отменить.`;

// CHANGE: Log outgoing bot messages to conversation history when needed
// WHY: Admin wants to see bot-to-user messages (e.g., waiting for API token, bot created)
// REF: user request 2026-02-04
async function sendAndLogBotMessage(chatId: number | string, userId: string | number, text: string): Promise<void> {
    if (!text) {
        return;
    }
    await bot.sendMessage(chatId, text);
    conversationManager.addMessage(userId, 'assistant', text);
}

// Generate prompt using OpenAI
// CHANGE: Detect user's language from conversation history
// WHY: Users want to create bots in Ukrainian and other languages
// REF: User request - "пользователи жалуются что нельзя создать бота на другом языке (украинский)"
function detectLanguage(conversationHistory: PromptBuilderHistoryItem[]): 'uk' | 'ru' {
    // Check last 3 user messages for language indicators
    const userMessages = conversationHistory
        .filter(m => m.role === 'user')
        .slice(-3)
        .map(m => m.content.toLowerCase());

    const allText = userMessages.join(' ');

    // Ukrainian-specific indicators
    const ukrainianIndicators = [
        'є', 'і', 'ї', 'ґ', // Ukrainian letters
        'хочу', 'потрібно', 'можна', 'треба', // Common words
        'вітаю', 'дякую', 'будь ласка'
    ];

    const ukrainianScore = ukrainianIndicators.filter(word => allText.includes(word)).length;

    // If found 2+ Ukrainian indicators, use Ukrainian
    return ukrainianScore >= 2 ? 'uk' : 'ru';
}

async function generatePromptFromDescription(description: string, conversationHistory: PromptBuilderHistoryItem[]): Promise<string> {
    try {
        const language = detectLanguage(conversationHistory);

        const systemPromptRU = `Ты эксперт по созданию промптов для Telegram ботов с глубоким пониманием бизнес-процессов. На основе описания бизнеса пользователя создай детальный системный промпт для бота.

СТРУКТУРА ИДЕАЛЬНОГО ПРОМПТА (обязательно включи все разделы):

1. РОЛЬ И КОНТЕКСТ
   - Четко опиши роль бота (например: "Ты - Telegram бот для салона красоты 'Название'")
   - Укажи специализацию бизнеса
   - Определи главную цель бота

2. УСЛУГИ И ЦЕНЫ (критично!)
   - Перечисли конкретные услуги/продукты
   - Укажи цены, если пользователь их упомянул
   - Если цен нет - попроси бота уточнять у клиентов бюджет

3. WORKFLOW СБОРА ЗАЯВКИ
   Четко опиши, какие данные собирать:
   - Имя клиента
   - Номер телефона (обязательно!)
   - Желаемая услуга/продукт
   - Предпочтительное время (если применимо)
   - Дополнительные детали по контексту

4. СИСТЕМА УВЕДОМЛЕНИЙ (обязательно!)
   После сбора всех данных бот должен:
   a) Ответить в чате: "Заявка принята! Мы свяжемся с вами в течение часа."
   b) Отправить уведомление клиенту:
      [NOTIFY_USER] Ваша заявка на [УСЛУГА] принята. Мы свяжемся с вами по телефону [ТЕЛЕФОН] для подтверждения.
   c) Уведомить владельца бота:
      [NOTIFY_ADMIN] Новая заявка от @username:
      • Имя: [ИМЯ]
      • Телефон: [ТЕЛЕФОН]
      • Услуга: [УСЛУГА]
      • Время: [ВРЕМЯ]

5. FAQ (если применимо)
   - Добавь 3-5 частых вопросов с ответами
   - Адрес, график работы, способы оплаты

6. СТИЛЬ ОБЩЕНИЯ
   - Дружелюбный для B2C (салоны, кафе)
   - Профессиональный для B2B
   - Всегда вежливый и уважительный
   - БЕЗ markdown форматирования (без звездочек, эмодзи, спецсимволов)

ВАЖНЫЕ ПРАВИЛА:
✅ ВСЕГДА собирай номер телефона (иначе невозможно связаться)
✅ ВСЕГДА используй [NOTIFY_USER] и [NOTIFY_ADMIN]
✅ Будь конкретным - никаких общих фраз типа "предоставь информацию о продуктах"
✅ НЕ придумывай услуги/цены - используй только то, что сказал пользователь
❌ НЕ делай бота агрессивным или настойчивым
❌ НЕ запрещай сбор телефонов (это легально для бизнеса)

МЯГКИЕ ПОДСКАЗКИ (добавь в конце промпта):
Если пользователь НЕ указал услуги/цены, добавь:
"💡 Подсказка: Вы можете улучшить промпт, указав конкретные услуги и цены. Это повысит доверие клиентов."

Если пользователь НЕ указал график работы, добавь:
"💡 Подсказка: Укажите график работы и адрес, чтобы бот мог отвечать на эти вопросы."

История разговора с пользователем:
${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}

Описание бизнеса: ${description}

Создай ТОЛЬКО системный промпт по структуре выше, БЕЗ дополнительных комментариев.`;

        const systemPromptUA = `Ти експерт зі створення промптів для Telegram ботів з глибоким розумінням бізнес-процесів. На основі опису бізнесу користувача створи детальний системний промпт для бота.

СТРУКТУРА ІДЕАЛЬНОГО ПРОМПТА (обов'язково включи всі розділи):

1. РОЛЬ І КОНТЕКСТ
   - Чітко опиши роль бота (наприклад: "Ти - Telegram бот для салону краси 'Назва'")
   - Вкажи спеціалізацію бізнесу
   - Визнач головну мету бота

2. ПОСЛУГИ І ЦІНИ (критично!)
   - Перелічи конкретні послуги/продукти
   - Вкажи ціни, якщо користувач їх згадав
   - Якщо цін немає - попроси бота уточнювати у клієнтів бюджет

3. WORKFLOW ЗБОРУ ЗАЯВКИ
   Чітко опиши, які дані збирати:
   - Ім'я клієнта
   - Номер телефону (обов'язково!)
   - Бажана послуга/продукт
   - Бажаний час (якщо застосовно)
   - Додаткові деталі за контекстом

4. СИСТЕМА ПОВІДОМЛЕНЬ (обов'язково!)
   Після збору всіх даних бот повинен:
   a) Відповісти в чаті: "Заявку прийнято! Ми зв'яжемося з вами протягом години."
   b) Надіслати повідомлення клієнту:
      [NOTIFY_USER] Вашу заявку на [ПОСЛУГА] прийнято. Ми зв'яжемося з вами по телефону [ТЕЛЕФОН] для підтвердження.
   c) Повідомити власника бота:
      [NOTIFY_ADMIN] Нова заявка від @username:
      • Ім'я: [ІМ'Я]
      • Телефон: [ТЕЛЕФОН]
      • Послуга: [ПОСЛУГА]
      • Час: [ЧАС]

5. FAQ (якщо застосовно)
   - Додай 3-5 частих питань з відповідями
   - Адреса, графік роботи, способи оплати

6. СТИЛЬ СПІЛКУВАННЯ
   - Дружелюбний для B2C (салони, кафе)
   - Професійний для B2B
   - Завжди ввічливий та поважний
   - БЕЗ markdown форматування (без зірочок, емодзі, спецсимволів)

ВАЖЛИВІ ПРАВИЛА:
✅ ЗАВЖДИ збирай номер телефону (інакше неможливо зв'язатися)
✅ ЗАВЖДИ використовуй [NOTIFY_USER] і [NOTIFY_ADMIN]
✅ Будь конкретним - ніяких загальних фраз типу "надай інформацію про продукти"
✅ НЕ вигадуй послуги/ціни - використовуй тільки те, що сказав користувач
❌ НЕ роби бота агресивним або наполегливим
❌ НЕ забороняй збір телефонів (це легально для бізнесу)

М'ЯКІ ПІДКАЗКИ (додай в кінці промпта):
Якщо користувач НЕ вказав послуги/ціни, додай:
"💡 Підказка: Ви можете покращити промпт, вказавши конкретні послуги та ціни. Це підвищить довіру клієнтів."

Якщо користувач НЕ вказав графік роботи, додай:
"💡 Підказка: Вкажіть графік роботи та адресу, щоб бот міг відповідати на ці питання."

Історія розмови з користувачем:
${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}

Опис бізнесу: ${description}

Створи ТІЛЬКИ системний промпт за структурою вище, БЕЗ додаткових коментарів.`;

        const systemPrompt = language === 'uk' ? systemPromptUA : systemPromptRU;

        const { apiKey, baseUrl } = getHydraConfig();
        const model = getPromptModel();
        const response = await axios.post(
            `${baseUrl.replace(/\/$/, '')}/chat/completions`,
            {
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: description }
                ],
                temperature: 0.7,
                max_tokens: 4000
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 45000
            }
        );

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Error generating prompt:', error.message);
        throw new Error('Не удалось сгенерировать промпт. Попробуйте еще раз.');
    }
}

// Validate Telegram bot token
// CHANGE: Return bot info instead of just boolean
// WHY: Need to get bot username for display and link generation
// REF: User request - показывать username вместо bot_id
async function validateBotToken(token: string): Promise<{ valid: boolean; username?: string; first_name?: string; id?: string | number }> {
    try {
        const tokenStr = String(token || '').trim();
        // Basic sanity check: real BotFather tokens are much longer than 20 chars.
        // This also makes pyrogram E2E tests deterministic (reject obvious fake tokens).
        const tokenPattern = /^\d+:[A-Za-z0-9_-]{30,}$/;
        if (!tokenPattern.test(tokenStr)) {
            return { valid: false };
        }

        const response = await axios.get(`https://api.telegram.org/bot${tokenStr}/getMe`, {
            timeout: 10000,
            proxy: false,
            maxRedirects: 0
        });
        if (response.data.ok) {
            return {
                valid: true,
                username: response.data.result.username,
                first_name: response.data.result.first_name,
                id: response.data.result.id
            };
        }
        return { valid: false };
    } catch (_error) {
        return { valid: false };
    }
}

function normalizeSingleLineText(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.replace(/\r\n/g, '\n').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function clampText(value: unknown, maxLength: number, fallback: string): string {
    let text = normalizeSingleLineText(value);
    if (!text) {
        text = fallback;
    }
    if (text.length <= maxLength) {
        return text;
    }
    return text.slice(0, maxLength).trimEnd();
}

function sanitizeBotCommands(commands: unknown): Array<{ command: string; description: string }> {
    const defaults: Array<{ command: string; description: string }> = [
        { command: 'start', description: 'Начать диалог' },
        { command: 'help', description: 'Помощь по боту' },
        { command: 'clear', description: 'Очистить историю' }
    ];
    if (!Array.isArray(commands)) {
        return defaults;
    }

    const used = new Set<string>();
    const out: Array<{ command: string; description: string }> = [];
    for (const item of commands) {
        if (!item || typeof item !== 'object') continue;
        const candidate = (item as Record<string, unknown>).command;
        const description = (item as Record<string, unknown>).description;
        const command = String(candidate || '')
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '')
            .slice(0, BOT_COMMAND_NAME_MAX);
        if (!command || used.has(command)) continue;
        const descriptionText = clampText(description, BOT_COMMAND_DESCRIPTION_MAX, 'Команда бота');
        used.add(command);
        out.push({ command, description: descriptionText });
        if (out.length >= BOT_COMMAND_MAX) break;
    }

    if (out.length === 0) {
        return defaults;
    }

    if (!used.has('start')) {
        out.unshift(defaults[0]);
    }
    if (!used.has('help') && out.length < BOT_COMMAND_MAX) {
        out.push(defaults[1]);
    }
    return out.slice(0, BOT_COMMAND_MAX);
}

function extractJsonObject(rawText: string): Record<string, unknown> | null {
    if (!rawText || typeof rawText !== 'string') {
        return null;
    }
    try {
        const parsed = JSON.parse(rawText);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        const match = rawText.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            const parsed = JSON.parse(match[0]);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : null;
        } catch {
            return null;
        }
    }
}

function buildFallbackBotBranding(input: {
    botUsername?: string | null;
    botFirstName?: string | null;
    productDescription?: string | null;
}): GeneratedBotBranding {
    const idea = clampText(input.productDescription || '', 220, 'AI-помощник для автоматизации общения с клиентами');
    const fallbackName = input.botFirstName || (input.botUsername ? `@${input.botUsername}` : 'AI Business Assistant');
    const name = clampText(fallbackName, BOT_NAME_MAX, 'AI Business Assistant');
    const about = clampText(
        `Бот для клиентов: заявки, ответы на вопросы и помощь 24/7. ${idea}`,
        BOT_SHORT_DESCRIPTION_MAX,
        'Умный бот для общения с клиентами и заявок'
    );
    const description = clampText(
        `Этот бот автоматизирует диалог с клиентами: отвечает на частые вопросы, помогает с заявками и собирает контакты для владельца бизнеса. Сценарий: ${idea}`,
        BOT_DESCRIPTION_MAX,
        'Бот автоматизирует общение с клиентами и сбор заявок.'
    );
    return {
        name,
        about,
        description,
        commands: sanitizeBotCommands(null),
        botpicPrompt: clampText(
            `Круглый аватар для Telegram-бота. Минималистичный логотип, отражающий тему: ${idea}. Чистый фон, высокий контраст, читабельность на маленьком размере.`,
            700,
            'Круглый минималистичный аватар Telegram-бота с высоким контрастом.'
        ),
        descriptionPicture: clampText(
            `Изображение для шапки/описания Telegram-бота: ${idea}. Покажи, как бот помогает клиенту в чате, современный стиль, без мелкого текста.`,
            700,
            'Иллюстрация для описания Telegram-бота: клиент и бот в диалоге, современный стиль.'
        )
    };
}

// CHANGE: Generate editable Telegram bot metadata after user sends bot token.
// WHY: User asked to auto-generate Name/About/Description and visual prompts.
async function generateBotBrandingProfile(input: {
    botUsername?: string | null;
    botFirstName?: string | null;
    productDescription?: string | null;
    generatedPrompt?: string | null;
}): Promise<GeneratedBotBranding> {
    const fallback = buildFallbackBotBranding(input);
    try {
        const { apiKey, baseUrl } = getHydraConfig();
        const model = getPromptModel();
        const prompt = `Сгенерируй JSON профиля Telegram-бота по ТЗ.
Верни ТОЛЬКО JSON, без markdown.

Поля JSON:
{
  "name": "до ${BOT_NAME_MAX} символов",
  "about": "до ${BOT_SHORT_DESCRIPTION_MAX} символов",
  "description": "до ${BOT_DESCRIPTION_MAX} символов",
  "commands": [{"command":"start","description":"..."}, ... максимум ${BOT_COMMAND_MAX}],
  "botpicPrompt": "подробный промпт для генерации аватарки (что изобразить)",
  "descriptionPicture": "подробное описание изображения над описанием бота (что изобразить)"
}

Ограничения:
- command: только [a-z0-9_], до ${BOT_COMMAND_NAME_MAX} символов.
- description command: до ${BOT_COMMAND_DESCRIPTION_MAX} символов.
- Тон и формулировки соответствуют бизнес-описанию.
- Без эмодзи в командах.

Контекст:
username: ${input.botUsername || 'unknown'}
first_name: ${input.botFirstName || 'unknown'}
product_description: ${input.productDescription || 'unknown'}
generated_prompt_snippet: ${(input.generatedPrompt || '').slice(0, 2000)}`;

        const response = await axios.post(
            `${baseUrl.replace(/\/$/, '')}/chat/completions`,
            {
                model,
                messages: [
                    { role: 'system', content: 'Ты senior product copywriter для Telegram-ботов. Возвращай только JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.5,
                max_tokens: 1200
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 30000
            }
        );

        const content = response?.data?.choices?.[0]?.message?.content || '';
        const parsed = extractJsonObject(content);
        if (!parsed) {
            return fallback;
        }

        return {
            name: clampText(parsed.name, BOT_NAME_MAX, fallback.name),
            about: clampText(parsed.about, BOT_SHORT_DESCRIPTION_MAX, fallback.about),
            description: clampText(parsed.description, BOT_DESCRIPTION_MAX, fallback.description),
            commands: sanitizeBotCommands(parsed.commands),
            botpicPrompt: clampText(parsed.botpicPrompt, 700, fallback.botpicPrompt),
            descriptionPicture: clampText(parsed.descriptionPicture, 700, fallback.descriptionPicture)
        };
    } catch (error) {
        console.error('[Branding] Failed to generate branding profile:', asErrorMessage(error));
        return fallback;
    }
}

async function applyGeneratedBotMetadata(
    botToken: string,
    branding: GeneratedBotBranding
): Promise<{ applied: string[]; errors: string[] }> {
    const baseUrl = `https://api.telegram.org/bot${botToken}`;
    const applied: string[] = [];
    const errors: string[] = [];

    const callMethod = async (method: string, payload: Record<string, unknown>, successLabel: string): Promise<void> => {
        try {
            const response = await axios.post(`${baseUrl}/${method}`, payload, { timeout: 20000 });
            if (response?.data?.ok) {
                applied.push(successLabel);
            } else {
                errors.push(`${method}: ${response?.data?.description || 'unknown_error'}`);
            }
        } catch (error) {
            errors.push(`${method}: ${asErrorMessage(error)}`);
        }
    };

    await callMethod('setMyName', { name: branding.name }, 'name');
    await callMethod('setMyShortDescription', { short_description: branding.about }, 'about');
    await callMethod('setMyDescription', { description: branding.description }, 'description');
    await callMethod('setMyCommands', { commands: branding.commands }, 'commands');

    return { applied, errors };
}

// Call OpenAI for test mode
async function callOpenAIForTest(systemPrompt: string, chatHistory: Array<{ role: string; content: string }>, userMessage: string): Promise<string> {
    try {
        const messages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage }
        ];

        const { apiKey, baseUrl } = getHydraConfig();
        const model = getBotModel();
        const response = await axios.post(
            `${baseUrl.replace(/\/$/, '')}/chat/completions`,
            {
                model,
                messages,
                temperature: 0.8,
                max_tokens: 1000
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 30000
            }
        );

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Error calling OpenAI for test:', asErrorMessage(error));
        throw new Error('Не удалось получить ответ от AI');
    }
}

// Transcribe audio using OpenAI Whisper
async function transcribeAudio(fileUrl: string): Promise<string> {
    try {
        if (!openaiApiKey) {
            throw new Error('OPENAI_API_KEY not configured for audio transcription');
        }
        const FormData = require('form-data');
        const formData = new FormData();

        const audioResponse = await axios.get(fileUrl, {
            responseType: 'stream',
            timeout: 20000
        });

        formData.append('file', audioResponse.data, 'audio.ogg');
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'text');
        formData.append('language', 'ru');

        const response = await axios.post(
            'https://api.openai.com/v1/audio/transcriptions',
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': `Bearer ${openaiApiKey}`
                },
                timeout: 60000
            }
        );

        return response.data;
    } catch (error) {
        console.error('Error transcribing audio:', asErrorMessage(error));
        throw new Error('Не удалось распознать аудио');
    }
}

// Handle /start command
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!msg.from) return;
    const userId = msg.from.id;
    const startParam = match?.[1];

    console.log(`[Start] User ${userId} started conversation${startParam ? ` with param: ${startParam}` : ''}`);

    // CHANGE: Send notification to admin when user starts bot
    // WHY: Admin wants to know when new users start using the bot
    // REF: User request - присылай мне уведомления когда ктото жмет старт
    // CHANGE: Add Telegram channel info and user ID to notifications
    // WHY: User request - если в главный бот идет через start t_* это значит что юзер зашел с тг канала и надо писать что за тг канал в уведомлении и id юзера
    // REF: User request
    try {
        const userInfo = msg.from;
        const username = userInfo.username ? `@${userInfo.username}` : 'No username';
        const firstName = userInfo.first_name || 'No name';
        const lastName = userInfo.last_name || '';

        const { exec } = require('child_process');

        // CHANGE: Parse referral source from t_* parameter
        // WHY: Track Telegram channel referrals
        let referralInfo = '';
        if (startParam && startParam.startsWith('t_')) {
            const channelName = startParam.substring(2); // Remove "t_" prefix
            referralInfo = `, Источник: Telegram канал @${channelName}`;
        } else if (startParam) {
            referralInfo = `, Start параметр: ${startParam}`;
        }

        const notificationMsg = `Новый пользователь нажал старт в bananzabot: User ID: ${userId}, Имя: ${firstName} ${lastName}, Username: ${username}${referralInfo}`;
        exec(`python3 /root/space2/hababru/telegram_sender.py "напиши @sashanoxon ${notificationMsg}"`, (error) => {
            if (error) {
                console.error(`[Start] Failed to send admin notification:`, error.message);
            }
        });
    } catch (notifError) {
        console.error(`[Start] Failed to send admin notification:`, notifError.message);
    }

    // Test mode: start parameter is conversation ID
    if (startParam && startParam.startsWith('test_')) {
        const conversationId = startParam.replace('test_', '');

        try {
            // Load test conversation data
            const testConversation = conversationManager.getUserConversation(conversationId);

            if (!testConversation || !testConversation.generated_prompt) {
                // Fallback: this is a test bot without prompt
                await bot.sendMessage(
                    chatId,
                    'Это тестовый бот!\n\nНастроить своего бота можно здесь:\nhttps://t.me/bananza_bot\n\nОтправьте /start и следуйте инструкциям. Это бесплатно!'
                );
                return;
            }

            // Set user in test mode
            conversationManager.updateUserConversation(userId, {
                stage: 'test_mode',
                test_conversation_id: conversationId,
                test_prompt: testConversation.generated_prompt,
                test_description: testConversation.product_description || null,
                messages: []
            });

            const welcomeMsg = await buildTestModeWelcome({
                product_description: testConversation.product_description
            });
            await bot.sendMessage(chatId, welcomeMsg);

            return;
        } catch (error) {
            console.error(`Error entering test mode for user ${userId}:`, error);
            await bot.sendMessage(chatId, 'Ошибка входа в тестовый режим. Попробуйте еще раз.');
            return;
        }
    }

    // Normal mode
    // CHANGE: Save referral source BEFORE clearing conversation
    // WHY: Need to preserve referral data even if user restarts
    // REF: User request - в профиль юзеру писать откуда он пришел
    // CHANGE: Save referralParam and referralDate for ALL start params, not just t_*
    // WHY: Admin needs to see /start command with params on messages page
    // REF: User request - я тут должен видеть саму команду /start потому что она может быть с параметрами
    if (startParam) {
        if (startParam.startsWith('t_')) {
            const channelName = startParam.substring(2); // Remove "t_" prefix
            conversationManager.updateUserConversation(userId, {
                referralSource: `telegram_channel:${channelName}`,
                referralParam: startParam,
                referralDate: new Date().toISOString()
            });
            console.log(`[Start] User ${userId} referral source saved: telegram_channel:${channelName}`);
        } else {
            conversationManager.updateUserConversation(userId, {
                referralSource: `start_param:${startParam}`,
                referralParam: startParam,
                referralDate: new Date().toISOString()
            });
            console.log(`[Start] User ${userId} referral param saved: ${startParam}`);
        }
    } else {
        // Save referralDate even without param so we know when user started
        conversationManager.updateUserConversation(userId, {
            referralDate: new Date().toISOString()
        });
    }

    // CHANGE: Save user info (username, first_name, last_name) in conversation
    // WHY: Admin needs to see username on author pages, not just in notifications
    // REF: User request - username missing on /admin/authors/<userId>
    const userInfo = {
        username: msg.from.username || undefined,
        firstName: msg.from.first_name || undefined,
        lastName: msg.from.last_name || undefined,
        fullName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || undefined
    };
    conversationManager.updateUserConversation(userId, { userInfo });

    conversationManager.clearUserConversation(userId);
    conversationManager.setUserStage(userId, 'awaiting_description');

    // CHANGE: Log /start command in messages history
    // WHY: Admin needs to see /start command (with params) on messages page
    // REF: User request - должен видеть саму команду /start потому что она может быть с параметрами
    const startCommand = startParam ? `/start ${startParam}` : '/start';
    conversationManager.addMessage(userId, 'user', startCommand);

    try {
        await bot.sendMessage(chatId, WELCOME_MESSAGE);
        // CHANGE: Log bot's welcome message in messages history
        // WHY: Admin needs to see what bot wrote after /start
        // REF: User request - должен видеть что наш бот написал ему после /start
        conversationManager.addMessage(userId, 'assistant', WELCOME_MESSAGE);
    } catch (error) {
        console.error(`Error sending welcome message to ${chatId}:`, error);
    }
});

// Handle /mybots command
bot.onText(/\/mybots/, async (msg) => {
    const chatId = msg.chat.id;
    if (!msg.from) return;
    const userId = msg.from.id;

    console.log(`[MyBots] User ${userId} requested bot list`);

    try {
        const userBots = botsManager.getBotsByUserId(userId);

        if (userBots.length === 0) {
            await bot.sendMessage(chatId, 'У вас пока нет созданных ботов.\n\nИспользуйте /start чтобы создать первого бота!');
            return;
        }

        // CHANGE: Show username instead of bot_id and add bot link
        // WHY: User wants to see bot username and have clickable links
        // REF: User request - "в админке ботов показывай не по айди а по их никнейму"
        let message = `Ваши боты (${userBots.length}):\n\n`;
        userBots.forEach((botData, index) => {
            const statusText = botData.status === 'active' ? '[активен]' : '[ожидает]';
            const displayName = botData.username ? `@${botData.username}` : botData.nameprompt;
            const botLink = botData.username ? `https://t.me/${botData.username}` : '';

            message += `${index + 1}. ${statusText} ${displayName}\n`;
            if (botLink) {
                message += `   ${botLink}\n`;
            }
            message += `   Создан: ${new Date(botData.created_at).toLocaleDateString('ru-RU')}\n`;
            message += `   Статус: ${botData.status}\n\n`;
        });

        await bot.sendMessage(chatId, message);
    } catch (error) {
        console.error(`Error listing bots for ${userId}:`, error);
        await bot.sendMessage(chatId, 'Ошибка при получении списка ботов.');
    }
});

// Handle /cancel command
bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    if (!msg.from) return;
    const userId = msg.from.id;

    console.log(`[Cancel] User ${userId} cancelled conversation`);

    conversationManager.clearUserConversation(userId);

    try {
        await bot.sendMessage(chatId, 'Создание бота отменено.\n\nИспользуйте /start чтобы начать заново.');
    } catch (error) {
        console.error(`Error sending cancel message to ${chatId}:`, error);
    }
});

// CHANGE: Add /help command with FAQ about buttons and features
// WHY: Users ask "how to add buttons" and need clear explanation
// REF: User request - "что если человек спросит - как добавить кнопки?"
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    if (!msg.from) return;

    const helpMessage = `📚 Справка по Bananzabot

🤖 КОМАНДЫ СОЗДАНИЯ БОТА:
/start - Начать создание нового бота
/mybots - Посмотреть список своих ботов
/editbot - Редактировать промпт бота
/stopbot - Остановить работающего бота
/startbot - Запустить остановленного бота
/cancel - Отменить текущую операцию

📊 АНАЛИТИКА:
/stats - Статистика системы
/analytics - Детальная аналитика активности

❓ ЧАСТЫЕ ВОПРОСЫ:

1️⃣ КАК ДОБАВИТЬ КНОПКИ В МОЕГО БОТА?
Ваш бот может автоматически создавать кнопки! Просто попросите его в промпте предлагать варианты выбора. Например:

"Когда клиент спрашивает про услуги, предложи кнопки: Маникюр, Педикюр, Массаж"

AI автоматически добавит кнопки в нужный момент. Технический формат (команда [BUTTONS]) уже встроен в систему - вам не нужно его знать!

2️⃣ КАК ПОЛУЧАТЬ УВЕДОМЛЕНИЯ О НОВЫХ ЗАЯВКАХ?
При создании бота укажите: "Отправляй мне уведомления о каждой заявке с контактом клиента". Система автоматически настроит уведомления в личку.

3️⃣ МОЖНО ЛИ ИЗМЕНИТЬ ПОВЕДЕНИЕ БОТА?
Да! Используйте /editbot и опишите что хотите изменить. AI обновит промпт, сохранив остальные настройки.

4️⃣ ПОЧЕМУ БОТ НЕ ОТВЕЧАЕТ?
Проверьте статус через /mybots. Если бот остановлен - запустите через /startbot. Если проблема сохраняется - пересоздайте бота через /start.

💡 СОВЕТ: При создании бота указывайте конкретные услуги, цены и график работы - это повысит качество ответов!`;

    await bot.sendMessage(chatId, helpMessage);
    console.log(`[Help] Sent help message to user ${msg.from.id}`);
});

// CHANGE: Add /editbot command to edit existing bot's prompt
// WHY: Users want to modify their bot's behavior without recreating
// REF: User request - редактирование промпта существующего бота
bot.onText(/\/editbot(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!msg.from) return;
    const userId = msg.from.id;
    const botIdParam = match?.[1];

    console.log(`[EditBot] User ${userId} wants to edit bot: ${botIdParam || 'not specified'}`);

    try {
        const userBots = botsManager.getBotsByUserId(userId);

        if (userBots.length === 0) {
            await bot.sendMessage(chatId, 'У вас пока нет созданных ботов.\n\nИспользуйте /start чтобы создать первого бота!');
            return;
        }

        // If bot ID not specified, show list of bots
        if (!botIdParam) {
            let message = 'Выберите бота для редактирования:\n\n';
            userBots.forEach((botData, index) => {
                const statusText = botData.status === 'active' ? '[активен]' : '[ожидает]';
                message += `${index + 1}. ${statusText} ${botData.nameprompt}\n`;
                message += `   /editbot ${botData.bot_id}\n\n`;
            });
            await bot.sendMessage(chatId, message);
            return;
        }

        // Find bot by ID
        const targetBot = userBots.find(b => b.bot_id === botIdParam || b.nameprompt === botIdParam);

        if (!targetBot) {
            await bot.sendMessage(chatId, `Бот не найден. Используйте /editbot чтобы увидеть список ваших ботов.`);
            return;
        }

        // Set stage for editing
        conversationManager.updateUserConversation(userId, {
            stage: 'editing_bot',
            editing_bot_id: targetBot.bot_id,
            messages: []
        });

        const currentPromptPreview = targetBot.prompt ? targetBot.prompt.substring(0, 500) + '...' : 'Нет промпта';

        await bot.sendMessage(chatId, `Редактирование бота: ${targetBot.nameprompt}\n\nТекущий промпт:\n${currentPromptPreview}\n\n---\n\nОпишите, что нужно изменить в поведении бота. Например:\n- "Добавь приветствие с именем клиента"\n- "Бот должен быть более формальным"\n- "Добавь информацию о новой услуге: ..."\n\nИли отправьте /cancel для отмены.`);

    } catch (error) {
        console.error(`Error in /editbot for ${userId}:`, error);
        await bot.sendMessage(chatId, 'Ошибка при получении списка ботов.');
    }
});

// CHANGE: Add /stopbot command to stop a running bot
// WHY: Users need ability to stop their bots
// REF: User request - управление ботами
bot.onText(/\/stopbot(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!msg.from) return;
    const userId = msg.from.id;
    const botIdParam = match?.[1];

    console.log(`[StopBot] User ${userId} wants to stop bot: ${botIdParam || 'not specified'}`);

    try {
        const userBots = botsManager.getBotsByUserId(userId);
        const activeBots = userBots.filter(b => b.status === 'active');

        if (activeBots.length === 0) {
            await bot.sendMessage(chatId, 'У вас нет активных ботов.');
            return;
        }

        if (!botIdParam) {
            let message = 'Выберите бота для остановки:\n\n';
            activeBots.forEach((botData, index) => {
                message += `${index + 1}. ${botData.nameprompt}\n`;
                message += `   /stopbot ${botData.bot_id}\n\n`;
            });
            await bot.sendMessage(chatId, message);
            return;
        }

        const targetBot = activeBots.find(b => b.bot_id === botIdParam || b.nameprompt === botIdParam);

        if (!targetBot) {
            await bot.sendMessage(chatId, `Активный бот не найден. Используйте /stopbot чтобы увидеть список.`);
            return;
        }

        await bot.sendMessage(chatId, `Останавливаю бот ${targetBot.nameprompt}...`);

        const result = await botDeployer.stopBot(targetBot.bot_id);

        if (result.success) {
            await bot.sendMessage(chatId, `Бот ${targetBot.nameprompt} остановлен.\n\nДля перезапуска используйте /startbot ${targetBot.bot_id}`);
        } else {
            await bot.sendMessage(chatId, `Ошибка при остановке бота: ${result.error}`);
        }

    } catch (error) {
        console.error(`Error in /stopbot for ${userId}:`, error);
        await bot.sendMessage(chatId, 'Ошибка при остановке бота.');
    }
});

// CHANGE: Add /startbot command to start a stopped bot
// WHY: Users need ability to restart their bots
// REF: User request - управление ботами
bot.onText(/\/startbot(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!msg.from) return;
    const userId = msg.from.id;
    const botIdParam = match?.[1];

    console.log(`[StartBot] User ${userId} wants to start bot: ${botIdParam || 'not specified'}`);

    try {
        const userBots = botsManager.getBotsByUserId(userId);
        const stoppedBots = userBots.filter(b => b.status === 'stopped');

        if (stoppedBots.length === 0) {
            await bot.sendMessage(chatId, 'У вас нет остановленных ботов.');
            return;
        }

        if (!botIdParam) {
            let message = 'Выберите бота для запуска:\n\n';
            stoppedBots.forEach((botData, index) => {
                message += `${index + 1}. ${botData.nameprompt}\n`;
                message += `   /startbot ${botData.bot_id}\n\n`;
            });
            await bot.sendMessage(chatId, message);
            return;
        }

        const targetBot = stoppedBots.find(b => b.bot_id === botIdParam || b.nameprompt === botIdParam);

        if (!targetBot) {
            await bot.sendMessage(chatId, `Остановленный бот не найден. Используйте /startbot чтобы увидеть список.`);
            return;
        }

        await bot.sendMessage(chatId, `Запускаю бот ${targetBot.nameprompt}...`);

        const result = await botDeployer.deployBot(targetBot.bot_id);

        if (result.success) {
            await bot.sendMessage(chatId, `Бот ${targetBot.nameprompt} запущен и готов к работе!`);
        } else {
            await bot.sendMessage(chatId, `Ошибка при запуске бота: ${result.error}`);
        }

    } catch (error) {
        console.error(`Error in /startbot for ${userId}:`, error);
        await bot.sendMessage(chatId, 'Ошибка при запуске бота.');
    }
});

// Handle /stats command (admin only)
// CHANGE: Update /stats to show basic system stats
// WHY: Keep /stats for simple system overview
// REF: User request - add detailed analytics
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    if (!msg.from) return;
    const userId = msg.from.id;

    console.log(`[Stats] User ${userId} requested stats`);

    try {
        const stats = botDeployer.getSystemStats();
        const allBots = botsManager.loadBots();

        let message = `Статистика системы\n\n`;
        message += `Всего ботов в базе: ${allBots.length}\n`;
        message += `Активных ботов: ${stats.activeBotsCount}\n`;
        message += `Использование памяти: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n\n`;

        if (stats.activeBots.length > 0) {
            message += `Активные боты:\n`;
            stats.activeBots.forEach(botId => {
                const bot = botsManager.getBotById(botId);
                if (bot) {
                    message += `- ${bot.nameprompt}\n`;
                }
            });
        }

        message += `\n💡 Используйте /analytics для детальной аналитики активности`;

        await bot.sendMessage(chatId, message);
    } catch (error) {
        console.error(`Error sending stats to ${chatId}:`, error);
        await bot.sendMessage(chatId, 'Ошибка при получении статистики.');
    }
});

// CHANGE: Add /analytics command for detailed activity metrics
// WHY: Need to track how many users actually use created bots
// QUOTE(ТЗ): "люди начинают создавать бота но метрики не показаны сколько из них реально что то делают"
// REF: User request - need detailed metrics
bot.onText(/\/analytics/, async (msg) => {
    const chatId = msg.chat.id;
    if (!msg.from) return;
    const userId = msg.from.id;

    console.log(`[Analytics] User ${userId} requested detailed analytics`);

    try {
        await bot.sendChatAction(chatId, 'typing');

        // Собираем метрики
        const metrics = Analytics.collectBotMetrics();

        if (!metrics) {
            await bot.sendMessage(chatId, '❌ Ошибка при сборе аналитики');
            return;
        }

        // Форматируем для отправки
        const message = Analytics.formatMetricsForTelegram(metrics);

        // Сохраняем snapshot для истории
        Analytics.saveMetricsSnapshot(metrics);

        await bot.sendMessage(chatId, message);
    } catch (error) {
        console.error(`Error sending analytics to ${chatId}:`, error);
        await bot.sendMessage(chatId, 'Ошибка при получении аналитики.');
    }
});

// CHANGE: Add message debouncing for concatenating sequential messages
// WHY: Users may send long prompts in multiple messages
// REF: User request - "если пришло сразу два сообщения то конкатинируй их"
type MessageBuffer = {
    messages: string[];
    timer: NodeJS.Timeout | null;
};
const messageBuffers = new Map<number, MessageBuffer>();
const DEBOUNCE_DELAY_MS = 3000; // Wait 3 seconds for more messages

function processBufferedMessages(userId: number, chatId: number): void {
    const buffer = messageBuffers.get(userId);
    if (!buffer || buffer.messages.length === 0) return;

    const concatenatedText = buffer.messages.join('\n\n');
    messageBuffers.delete(userId);

    // Process the concatenated message
    handleUserMessage(chatId, userId, concatenatedText);
}

// Handle regular messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!msg.from) return;
    const userId = msg.from.id;
    const text = msg.text;

    // Ignore commands
    if (!text || text.startsWith('/')) {
        return;
    }

    // CHANGE: Save/update user info on every message
    // WHY: Capture username changes and ensure userInfo is always available in admin
    // REF: User report - username missing on /admin/authors/<userId>
    const userInfo = {
        username: msg.from.username || undefined,
        firstName: msg.from.first_name || undefined,
        lastName: msg.from.last_name || undefined,
        fullName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || undefined
    };
    conversationManager.updateUserConversation(userId, { userInfo });

    // CHANGE: Buffer messages and debounce
    // WHY: Concatenate sequential messages sent within 3 seconds
    let buffer = messageBuffers.get(userId);
    if (!buffer) {
        buffer = { messages: [], timer: null };
        messageBuffers.set(userId, buffer);
    }

    // Clear existing timer
    if (buffer.timer) {
        clearTimeout(buffer.timer);
    }

    // Add message to buffer
    buffer.messages.push(text);

    // Set new timer
    buffer.timer = setTimeout(() => {
        processBufferedMessages(userId, chatId);
    }, DEBOUNCE_DELAY_MS);

    // Show typing indicator while waiting
    await bot.sendChatAction(chatId, 'typing');

    return; // Exit early, actual processing happens in timer callback
});

// CHANGE: Extract message handling logic to separate function
// WHY: Called from debounce timer, not directly from event handler
async function handleUserMessage(chatId: number, userId: number, text: string): Promise<void> {

    // CHANGE: Removed per-message length check
    // WHY: With debouncing, concatenated multi-message input can legitimately exceed 3500 chars.
    //      Telegram caps a single message at 4096 chars; Claude API handles far more.
    console.log(`[Message] User ${userId}: ${text.substring(0, 50)}...`);

    try {
        const conversation = conversationManager.getUserConversation(userId);
        const stage = conversation.stage;

        await bot.sendChatAction(chatId, 'typing');

        // Stage: Test mode - user is testing the bot
        if (stage === 'test_mode') {
            const testPrompt = conversation.test_prompt;

            // Call OpenAI with test prompt
            try {
                const response = await callOpenAIForTest(testPrompt, conversation.messages, text);

                conversationManager.addMessage(userId, 'user', text);
                conversationManager.addMessage(userId, 'assistant', response);

                await bot.sendMessage(chatId, response);
            } catch (error) {
                console.error(`Error in test mode for user ${userId}:`, error);
                await sendAndLogBotMessage(chatId, userId, 'Произошла ошибка. Попробуйте еще раз или начните заново с /start');
            }
            return;
        }

        // CHANGE: Stage - Awaiting business description (now uses interactive dialog)
        // WHY: Guide user through interactive Q&A instead of immediate prompt generation
        // REF: #16
        if (stage === 'awaiting_description' || stage === 'interactive_dialog') {
            conversationManager.addMessage(userId, 'user', text);
            // Use fresh history that includes the just-added user message.
            const freshConversation = conversationManager.getUserConversation(userId);

            // CHANGE: Send notification to admin on first message only
            // WHY: Admin wants to know when users send their first prompt
            // REF: User request - присылай мне уведомления когда ктото пишет промпт первый
            if (stage === 'awaiting_description') {
                conversationManager.updateUserConversation(userId, {
                    product_description: text,
                    stage: 'interactive_dialog'
                });

                try {
                    const storedInfo = conversationManager.getUserConversation(userId).userInfo;
                    const username = storedInfo?.username ? `@${storedInfo.username}` : 'No username';
                    const firstName = storedInfo?.firstName || 'No name';
                    const textPreview = text.substring(0, 200).replace(/"/g, '\\"');

                    const { exec } = require('child_process');
                    const notificationMsg = `Пользователь отправил описание бизнеса в bananzabot: User ID: ${userId}, Имя: ${firstName}, Username: ${username}, Описание: ${textPreview}${text.length > 200 ? '...' : ''}`;
                    exec(`python3 /root/space2/hababru/telegram_sender.py "напиши @sashanoxon ${notificationMsg}"`, (error) => {
                        if (error) {
                            console.error(`[Message] Failed to send admin notification:`, error.message);
                        }
                    });
                } catch (notifError) {
                    console.error(`[Message] Failed to send admin notification:`, notifError.message);
                }
            }

            // CHANGE: Process message through interactive prompt builder
            // WHY: AI asks clarifying questions and helps formulate proper requirements
            // REF: #16
            try {
                const result = await promptBuilder.processInteractiveMessage(coercePromptHistory(freshConversation.messages), text);

                if (!result.success) {
                    await sendAndLogBotMessage(chatId, userId, result.error);
                    return;
                }

                const responseText = result.response ? result.response.trim() : '';
                if (responseText) {
                    conversationManager.addMessage(userId, 'assistant', responseText);
                }

	                // Check if ready to generate final prompt
	                if (result.readyToGenerate) {
	                    if (responseText) {
	                        await bot.sendMessage(chatId, responseText);
	                    }
	                    // IMPORTANT: Use fresh conversation history (includes last user + assistant messages)
	                    // so prompt generation is based on the actual business description.
                    const historyForPrompt = coercePromptHistory(conversationManager.getUserConversation(userId).messages);
	                    await sendAndLogBotMessage(chatId, userId, 'Отлично! Теперь генерирую финальный промпт для вашего бота...');

	                    // Generate final prompt
                    const promptResult = await promptBuilder.generateFinalPrompt(historyForPrompt);

                    if (!promptResult.success) {
                        await sendAndLogBotMessage(chatId, userId, 'Произошла ошибка при генерации промпта. Попробуйте еще раз или используйте /cancel для отмены.');
                        return;
                    }

                    conversationManager.updateUserConversation(userId, {
                        generated_prompt: promptResult.prompt,
                        stage: 'prompt_generated'
                    });

                    const previewMessage = buildPromptPreviewMessage(userId, promptResult.prompt);
                    await sendAndLogBotMessage(chatId, userId, previewMessage);
                    conversationManager.setUserStage(userId, 'testing');

                } else {
                    // Continue interactive dialog
                    const safeResponse = responseText || 'Понял! Если есть дополнительные детали — напишите, и я учту их в промпте.';
                    if (!responseText) {
                        conversationManager.addMessage(userId, 'assistant', safeResponse);
                    }
                    await bot.sendMessage(chatId, safeResponse);
                }

            } catch (error) {
                console.error(`Error in interactive dialog for user ${userId}:`, error);
                await sendAndLogBotMessage(chatId, userId, 'Произошла ошибка. Попробуйте еще раз или используйте /cancel для отмены.');
            }
        }
        // Stage: Awaiting bot token / testing
        else if (stage === 'awaiting_token' || stage === 'awaiting_token_or_test' || stage === 'testing') {
            // Check if message looks like a bot token
            const tokenAttemptPattern = /^\d+:[A-Za-z0-9_-]+$/;
            const tokenPattern = /^\d+:[A-Za-z0-9_-]{30,}$/;

            // CHANGE: If not a token in awaiting_token_or_test stage, treat as prompt refinement request
            // WHY: User wants to modify prompt without needing to type token first
            // REF: User request - "он просит апи ключ но не дает изменить промпт надо что если это не апи ключ то продолжаем мастер создания промптов"
            const trimmed = text.trim();
            if (!tokenPattern.test(trimmed)) {
                // If it *looks like* a token but is too short/invalid, fail fast with a clear message.
                if (tokenAttemptPattern.test(trimmed)) {
                    await sendAndLogBotMessage(
                        chatId,
                        userId,
                        'Это не похоже на токен бота.\n\n' +
                        'Токен должен быть в формате: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz\n\n' +
                        'Проверьте токен и попробуйте еще раз, или используйте /cancel для отмены.'
                    );
                    return;
                }

                if (stage === 'awaiting_token_or_test' || stage === 'testing') {
                    // User wants to refine the prompt - restart interactive dialog
                    conversationManager.addMessage(userId, 'user', text);
                    conversationManager.setUserStage(userId, 'interactive_dialog');

                    await sendAndLogBotMessage(chatId, userId, 'Понял! Давайте доработаем промпт. Обрабатываю ваш запрос...');

                    try {
                        // Use fresh history (includes the just-added user message).
                        const refinementConversation = conversationManager.getUserConversation(userId);
                        const result = await promptBuilder.processInteractiveMessage(coercePromptHistory(refinementConversation.messages), text);

                        if (!result.success) {
                            await sendAndLogBotMessage(chatId, userId, result.error);
                            return;
                        }

                        const responseText = result.response ? result.response.trim() : '';
                        if (responseText) {
                            conversationManager.addMessage(userId, 'assistant', responseText);
                        }

	                        // Check if ready to generate final prompt
	                        if (result.readyToGenerate) {
	                            if (responseText) {
	                                await bot.sendMessage(chatId, responseText);
	                            }
	                            // IMPORTANT: Use fresh conversation history (includes last user + assistant messages)
	                            // so prompt regeneration reflects the latest refinements.
	                            const historyForPrompt = coercePromptHistory(conversationManager.getUserConversation(userId).messages);
	                            await sendAndLogBotMessage(chatId, userId, 'Отлично! Теперь генерирую обновленный промпт для вашего бота...');

	                            // Generate final prompt
	                            const promptResult = await promptBuilder.generateFinalPrompt(historyForPrompt);

                            if (!promptResult.success) {
                                await sendAndLogBotMessage(chatId, userId, 'Произошла ошибка при генерации промпта. Попробуйте еще раз или используйте /cancel для отмены.');
                                return;
                            }

                            conversationManager.updateUserConversation(userId, {
                                generated_prompt: promptResult.prompt,
                                stage: 'prompt_generated'
                            });

                            const previewMessage = buildPromptPreviewMessage(userId, promptResult.prompt);
                            await sendAndLogBotMessage(chatId, userId, previewMessage);
                            conversationManager.setUserStage(userId, 'testing');

                        } else {
                            // Continue interactive dialog
                            const safeResponse = responseText || 'Понял! Если есть дополнительные детали — напишите, и я учту их в промпте.';
                            if (!responseText) {
                                conversationManager.addMessage(userId, 'assistant', safeResponse);
                            }
                            await bot.sendMessage(chatId, safeResponse);
                        }

                    } catch (error) {
                        console.error(`Error refining prompt for user ${userId}:`, error);
                        await sendAndLogBotMessage(chatId, userId, 'Произошла ошибка. Попробуйте еще раз или используйте /cancel для отмены.');
                    }
                    return;
                }

                // For awaiting_token stage, show error
                await sendAndLogBotMessage(
                    chatId,
                    userId,
                    'Это не похоже на токен бота.\n\nТокен должен быть в формате: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz\n\nПопробуйте еще раз или используйте /cancel для отмены.'
                );
                return;
            }

            // CHANGE: Save user's token message to conversation history
            // WHY: Admin needs to see in admin panel that user sent token
            // REF: User report - "не вижу что пользователь прислал API токен"
            conversationManager.addMessage(userId, 'user', `[API Token: ${trimmed.substring(0, 15)}...${trimmed.substring(trimmed.length - 5)}]`);

            await sendAndLogBotMessage(chatId, userId, 'Проверяю токен...');

            // Validate token and get bot info
            // CHANGE: Get bot info (username, first_name) from validation
            // WHY: Need username to display and generate bot link
            // REF: User request - показывать username и ссылку на бота
            const botInfo = await validateBotToken(trimmed);

            if (!botInfo.valid) {
                await sendAndLogBotMessage(
                    chatId,
                    userId,
                    'Токен недействителен или бот не найден.\n\nПроверьте токен и попробуйте еще раз, или используйте /cancel для отмены.'
                );
                return;
            }

            // CHANGE: Check if bot with same API token already exists
            // WHY: Prevent 409 Conflict errors when multiple bots use same Telegram API token
            // QUOTE(ТЗ): "Хм так это от наших кл клиентов токены? Надо тогда отключать старых ботов если кидают тот же апи ключ"
            // REF: #15
            const existingBot = botsManager.getBotByApiKey(text.trim());

            if (existingBot) {
                console.log(`[Warning] Bot with same API key already exists: ${existingBot.bot_id}`);

                await sendAndLogBotMessage(
                    chatId,
                    userId,
                    `Обнаружен существующий бот с таким же API токеном.\n\nОбновлю настройки бота ${existingBot.nameprompt} и перезапущу его.`
                );
            }

            await sendAndLogBotMessage(
                chatId,
                userId,
                'Токен валиден. Генерирую профиль бота: Name, About, Description, команды и визуальные промпты...'
            );

            const brandingProfile = await generateBotBrandingProfile({
                botUsername: botInfo.username || null,
                botFirstName: botInfo.first_name || null,
                productDescription: typeof conversation.product_description === 'string' ? conversation.product_description : null,
                generatedPrompt: typeof conversation.generated_prompt === 'string' ? conversation.generated_prompt : null
            });

            const metadataApplyResult = await applyGeneratedBotMetadata(trimmed, brandingProfile);
            if (metadataApplyResult.errors.length) {
                await sendAndLogBotMessage(
                    chatId,
                    userId,
                    `Профиль бота применён частично через Telegram API.\nУспешно: ${metadataApplyResult.applied.join(', ') || 'ничего'}\nОшибки: ${metadataApplyResult.errors.join(' | ')}`
                );
            } else {
                await sendAndLogBotMessage(
                    chatId,
                    userId,
                    `Профиль бота успешно применён через Telegram API: ${metadataApplyResult.applied.join(', ')}`
                );
            }

            // Create bot in database
            try {
                // CHANGE: Pass botInfo to createBot to save username
                // WHY: Need to display username and generate bot link
                // REF: User request - показывать username вместо bot_id
                const newBot = botsManager.createBot(
                    userId,
                    text.trim(),
                    conversation.generated_prompt,
                    conversation.messages,
                    null, // notifications
                    botInfo // bot metadata from Telegram
                );

                conversationManager.setUserStage(userId, 'bot_created');

                // CHANGE: Add system message about bot creation for admin history
                // WHY: Admin needs to see in admin panel when bot was created
                // REF: User report - "не вижу что создан бот был"
                const botUsername = botInfo.username ? `@${botInfo.username}` : newBot.nameprompt;
                conversationManager.addMessage(userId, 'system', `[System] Bot created: ${botUsername} (ID: ${newBot.bot_id})`);

                // CHANGE: Show username and link instead of bot_id
                // WHY: User wants to see bot username and have clickable link
                // REF: User request - "пиши ссылку на созданного бота"
                const botLink = botInfo.username ? `https://t.me/${botInfo.username}` : 'Ссылка будет доступна после деплоя';
                const botDisplayName = botInfo.username ? `@${botInfo.username}` : newBot.nameprompt;

                await sendAndLogBotMessage(
                    chatId,
                    userId,
                    `Бот успешно создан!\n\n🤖 ${botDisplayName}\n${botLink}\n\nСтатус: Ожидает деплоя\n\nСкоро бот будет автоматически задеплоен и начнет работать.\n\nВы можете:\n- /mybots - посмотреть все свои боты\n- /start - создать нового бота`
                );

                console.log(`[Success] Bot ${newBot.bot_id} created for user ${userId}`);

                // Auto-deploy bot
                setTimeout(async () => {
                    await sendAndLogBotMessage(chatId, userId, 'Начинаю деплой вашего бота...');
                    const shouldRestart = Boolean(
                        existingBot &&
                        existingBot.bot_id === newBot.bot_id &&
                        existingBot.status === 'active'
                    );
                    const deployResult = shouldRestart
                        ? await botDeployer.restartBot(newBot.bot_id)
                        : await botDeployer.deployBot(newBot.bot_id);

                    if (deployResult.success) {
                        // CHANGE: Add bot link to deploy success message
                        // WHY: User wants clickable link to bot
                        // REF: User request - "пиши ссылку на созданного бота"
                        const botLink = botInfo.username ? `https://t.me/${botInfo.username}` : '';
                        const linkText = botLink ? `\n\n🔗 Ссылка на бота:\n${botLink}` : '';

                        // CHANGE: Add referral tracking instruction
                        // WHY: Admins need to track where users come from
                        // REF: User request - "задеплоенные боты должны отправлять инфу о том откуда приходят люди"
                        const referralInstruction = botLink
                            ? `\n\n📊 Реферальные ссылки:\n\nЧтобы отслеживать источники пользователей, добавляйте к ссылке параметр ?start=\n\n• Реферальные источники: ?start=r_НАЗВАНИЕ\n  Пример: ${botLink}?start=r_telegram\n  Пример: ${botLink}?start=r_website\n\n• Отслеживание кампаний: ?start=t_НАЗВАНИЕ\n  Пример: ${botLink}?start=t_ad1\n  Пример: ${botLink}?start=t_campaign2\n\nБот автоматически сообщит вам откуда пришел пользователь.`
                            : '';
                        const metadataStatus = metadataApplyResult.errors.length
                            ? `\n\n⚠️ Metadata API: частично применено (${metadataApplyResult.applied.join(', ') || 'ничего'}). Ошибки: ${metadataApplyResult.errors.join(' | ')}`
                            : `\n\n✅ Metadata API: применено (${metadataApplyResult.applied.join(', ')})`;
                        const generatedProfileBlock = `\n\nName: ${brandingProfile.name}\nAbout: ${brandingProfile.about}\nDescription: ${brandingProfile.description}\nBotpic: ${brandingProfile.botpicPrompt}\nDescription picture: ${brandingProfile.descriptionPicture}`;

                        await sendAndLogBotMessage(
                            chatId,
                            userId,
                            `Деплой успешно завершен!\n\nВаш бот запущен и готов к работе.${linkText}${generatedProfileBlock}${metadataStatus}${referralInstruction}\n\nТеперь вы можете найти вашего бота в Telegram и начать с ним работу.`
                        );
                    } else {
                        await sendAndLogBotMessage(
                            chatId,
                            userId,
                            `Ошибка при деплое: ${deployResult.error}\n\nСвяжитесь с администратором для решения проблемы.`
                        );
                    }
                }, 2000);

            } catch (error) {
                console.error(`Error creating bot for user ${userId}:`, error);
                await sendAndLogBotMessage(chatId, userId, 'Произошла ошибка при создании бота. Попробуйте еще раз или обратитесь к администратору.');
            }
        }
        // CHANGE: Stage - Editing existing bot's prompt
        // WHY: Allow users to modify their bot's behavior
        // REF: User request - редактирование промпта существующего бота
        else if (stage === 'editing_bot') {
            const editingBotId = conversation.editing_bot_id;
            const targetBot = botsManager.getBotById(editingBotId);

            if (!targetBot) {
                await sendAndLogBotMessage(chatId, userId, 'Бот не найден. Используйте /editbot чтобы выбрать бота заново.');
                conversationManager.clearUserConversation(userId);
                return;
            }

            conversationManager.addMessage(userId, 'user', text);

            try {
                await sendAndLogBotMessage(chatId, userId, 'Обновляю промпт бота на основе ваших изменений...');

                // Generate updated prompt based on modification request
                const updatePrompt = `Текущий промпт бота:\n\n${targetBot.prompt}\n\n---\n\nЗапрос на изменение от пользователя:\n${text}\n\n---\n\nОбнови промпт с учетом запроса. Сохрани все существующие инструкции, но примени изменения. Верни ТОЛЬКО обновленный промпт без комментариев.`;

                const { apiKey, baseUrl } = getHydraConfig();
                const model = getPromptModel();
                const response = await axios.post(
                    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
                    {
                        model,
                        messages: [
                            { role: 'system', content: 'Ты помощник для редактирования промптов ботов. Твоя задача - обновить существующий промпт с учетом запроса пользователя, сохранив структуру и ключевые инструкции.' },
                            { role: 'user', content: updatePrompt }
                        ],
                        temperature: 0.7,
                        max_tokens: 4000
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        timeout: 60000
                    }
                );

                const updatedPrompt = response.data.choices[0].message.content;

                // Update bot in database
                const bots = botsManager.loadBots();
                const botIndex = bots.findIndex(b => b.bot_id === editingBotId);
                if (botIndex !== -1) {
                    bots[botIndex].prompt = updatedPrompt;
                    bots[botIndex].updated_at = new Date().toISOString();
                    botsManager.saveBots(bots);
                }

                // Restart bot with new prompt if active
                if (targetBot.status === 'active') {
                    await botDeployer.stopBot(editingBotId);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await botDeployer.deployBot(editingBotId);
                }

                conversationManager.clearUserConversation(userId);

                await sendAndLogBotMessage(chatId, userId, `Промпт бота ${targetBot.nameprompt} успешно обновлен!\n\nПревью нового промпта:\n${updatedPrompt.substring(0, 300)}...\n\n${targetBot.status === 'active' ? 'Бот перезапущен с новыми настройками.' : 'Запустите бота командой /startbot ' + editingBotId}`);

            } catch (error) {
                console.error(`Error updating bot prompt for user ${userId}:`, error);
                await sendAndLogBotMessage(chatId, userId, 'Ошибка при обновлении промпта. Попробуйте еще раз или используйте /cancel.');
            }
        }
        // Unknown stage
        else {
            await sendAndLogBotMessage(chatId, userId, 'Я не понимаю, что делать на этом этапе.\n\nИспользуйте /start чтобы начать создание бота заново.');
        }

    } catch (error) {
        console.error(`Error handling message from user ${userId}:`, error);
        await sendAndLogBotMessage(chatId, userId, 'Произошла непредвиденная ошибка. Попробуйте еще раз или используйте /start.');
    }
}

// Handle voice messages
bot.on('voice', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const voice = msg.voice;

    console.log(`[Voice] User ${userId} sent voice message`);

    try {
        await bot.sendChatAction(chatId, 'typing');
        await bot.sendMessage(chatId, 'Распознаю голосовое сообщение...');

        // Get file URL
        const file = await bot.getFile(voice.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

        // Transcribe audio
        const transcribedText = await transcribeAudio(fileUrl);

        console.log(`[Voice] Transcribed text: ${transcribedText.substring(0, 50)}...`);

        // Process as regular text message
        const conversation = conversationManager.getUserConversation(userId);
        const stage = conversation.stage;

        // Test mode
        if (stage === 'test_mode') {
            const testPrompt = conversation.test_prompt;

            const response = await callOpenAIForTest(testPrompt, conversation.messages, transcribedText);

            conversationManager.addMessage(userId, 'user', transcribedText);
            conversationManager.addMessage(userId, 'assistant', response);

            await bot.sendMessage(chatId, `Вы сказали: "${transcribedText}"\n\n${response}`);
            return;
        }

        // CHANGE: Awaiting description (voice) - now uses interactive dialog
        // WHY: Apply same interactive approach to voice messages
        // REF: #16
        if (stage === 'awaiting_description' || stage === 'interactive_dialog') {
            conversationManager.addMessage(userId, 'user', transcribedText);
            const voiceFreshConversation = conversationManager.getUserConversation(userId);

            // Send notification on first message only
            if (stage === 'awaiting_description') {
                conversationManager.updateUserConversation(userId, {
                    product_description: transcribedText,
                    stage: 'interactive_dialog'
                });

                try {
                    const userInfo = msg.from;
                    const username = userInfo.username ? `@${userInfo.username}` : 'No username';
                    const firstName = userInfo.first_name || 'No name';
                    const textPreview = transcribedText.substring(0, 200).replace(/"/g, '\\"');

                    const { exec } = require('child_process');
                    const notificationMsg = `Пользователь отправил голосовое описание бизнеса в bananzabot: User ID: ${userId}, Имя: ${firstName}, Username: ${username}, Описание: ${textPreview}${transcribedText.length > 200 ? '...' : ''}`;
                    exec(`python3 /root/space2/hababru/telegram_sender.py "напиши @sashanoxon ${notificationMsg}"`, (error) => {
                        if (error) {
                            console.error(`[Voice] Failed to send admin notification:`, error.message);
                        }
                    });
                } catch (notifError) {
                    console.error(`[Voice] Failed to send admin notification:`, notifError.message);
                }
            }

            await bot.sendMessage(chatId, `Вы сказали: "${transcribedText}"\n\nОбрабатываю...`);

            // Process through interactive dialog
            try {
                const result = await promptBuilder.processInteractiveMessage(coercePromptHistory(voiceFreshConversation.messages), transcribedText);

                if (!result.success) {
                    await sendAndLogBotMessage(chatId, userId, result.error);
                    return;
                }

                const responseText = result.response ? result.response.trim() : '';
                if (responseText) {
                    conversationManager.addMessage(userId, 'assistant', responseText);
                }

	                if (result.readyToGenerate) {
	                    if (responseText) {
	                        await bot.sendMessage(chatId, responseText);
	                    }
	                    // IMPORTANT: Use fresh conversation history (includes last user + assistant messages)
	                    // so prompt generation is based on the transcribed business description.
	                    const historyForPrompt = coercePromptHistory(conversationManager.getUserConversation(userId).messages);
	                    await sendAndLogBotMessage(chatId, userId, 'Отлично! Теперь генерирую финальный промпт для вашего бота...');

	                    const promptResult = await promptBuilder.generateFinalPrompt(historyForPrompt);

                    if (!promptResult.success) {
                        await sendAndLogBotMessage(chatId, userId, 'Произошла ошибка при генерации промпта. Попробуйте еще раз или используйте /cancel для отмены.');
                        return;
                    }

                    conversationManager.updateUserConversation(userId, {
                        generated_prompt: promptResult.prompt,
                        stage: 'prompt_generated'
                    });

                    const previewMessage = buildPromptPreviewMessage(userId, promptResult.prompt);
                    await sendAndLogBotMessage(chatId, userId, previewMessage);
                    conversationManager.setUserStage(userId, 'testing');

                } else {
                    const safeResponse = responseText || 'Понял! Если есть дополнительные детали — напишите, и я учту их в промпте.';
                    if (!responseText) {
                        conversationManager.addMessage(userId, 'assistant', safeResponse);
                    }
                    await bot.sendMessage(chatId, safeResponse);
                }

            } catch (error) {
                console.error(`Error in voice interactive dialog for user ${userId}:`, error);
                await sendAndLogBotMessage(chatId, userId, 'Произошла ошибка. Попробуйте еще раз или используйте /cancel для отмены.');
            }
            return;
        }

        // Other stages
        await bot.sendMessage(
            chatId,
            `Вы сказали: "${transcribedText}"\n\nОтправьте текстовое сообщение или используйте /start`
        );

    } catch (error) {
        console.error(`Error handling voice from user ${userId}:`, error);
        await bot.sendMessage(
            chatId,
            'Не удалось распознать голосовое сообщение. Попробуйте еще раз или напишите текстом.'
        );
    }
});

// Error handlers — main bot polling
let mainBotPollingErrorCount = 0;
let mainBotLastPollingErrorTime = 0;

bot.on('polling_error', (error) => {
    const errorCode = error.code || '';
    const errorMessage = error.message || '';
    const now = Date.now();

    // 401 Unauthorized — token is invalid, fatal
    if (errorCode === 'ETELEGRAM' && errorMessage.includes('401')) {
        console.error('[MainBot] FATAL: 401 Unauthorized — bot token is invalid. Exiting.');
        process.exit(1);
    }

    // 409 Conflict — another instance running
    if (errorCode === 'ETELEGRAM' && errorMessage.includes('409')) {
        console.error('[MainBot] FATAL: 409 Conflict — duplicate instance detected. Exiting.');
        process.exit(1);
    }

    // Transient errors (502, ECONNRESET, ETIMEDOUT) — suppress spam, log once per 60s
    if (
        errorCode === 'EFATAL' ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('502') ||
        errorMessage.includes('Bad Gateway') ||
        errorMessage.includes('ECONNABORTED')
    ) {
        mainBotPollingErrorCount++;
        if (now - mainBotLastPollingErrorTime > 60000) {
            console.log(`[MainBot] Network errors (auto-recovering): ${mainBotPollingErrorCount} in last period. Latest: ${errorCode} ${errorMessage.substring(0, 100)}`);
            mainBotPollingErrorCount = 0;
            mainBotLastPollingErrorTime = now;
        }
        return;
    }

    // Other errors — always log
    console.error('[MainBot] Polling error:', errorCode, '-', errorMessage);
});

bot.on('webhook_error', (error) => {
    console.error('[MainBot] Webhook error:', error.code, '-', error.message);
});

// Process-level error handlers — prevent crashes from unhandled errors
process.on('uncaughtException', (error) => {
    console.error('[CRITICAL] Uncaught Exception:', error.message);
    console.error(error.stack);
    // Don't exit — PM2 will restart, but let current requests finish
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection:', reason);
});

// Graceful shutdown — stop ALL bot instances before exiting
async function gracefulShutdown(signal) {
    console.log(`Received ${signal}. Stopping all bots...`);

    // Prevent double-shutdown
    if (gracefulShutdown['_running']) return;
    gracefulShutdown['_running'] = true;

    try {
        // Stop all created bot instances first
        const activeBots = botInstanceManager.getAllActiveBots();
        console.log(`[Shutdown] Stopping ${activeBots.length} active bot instances...`);

        // Stop bots in parallel with timeout
        const stopPromises = activeBots.map(async (botId) => {
            try {
                await Promise.race([
                    botInstanceManager.stopBot(botId),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
                ]);
                console.log(`[Shutdown] Stopped bot ${botId}`);
            } catch (err) {
                console.error(`[Shutdown] Error stopping bot ${botId}:`, err.message);
            }
        });
        await Promise.all(stopPromises);

        // Close webhook server
        webhookServer.close();
        console.log('[Shutdown] Webhook server closed.');

        // Then stop main bot
        await bot.stopPolling();
        console.log('[Shutdown] Main bot stopped.');

        console.log('[Shutdown] All bots stopped. Exiting...');
        process.exit(0);
    } catch (error) {
        console.error('[Shutdown] Error during shutdown:', error.message);
        process.exit(1);
    }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
