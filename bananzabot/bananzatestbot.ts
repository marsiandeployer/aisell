import TelegramBot from 'node-telegram-bot-api';
import axios, { AxiosResponse } from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import ConversationManager from './conversationManager';
import conversationStore from './conversationStore';
import { getBotModel, getHydraConfig } from './aiSettings';

dotenv.config({ path: path.join(__dirname, '.env') });

type HydraChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type HydraChatCompletionRequest = {
  model: string;
  messages: HydraChatMessage[];
  temperature?: number;
  max_tokens?: number;
};
type HydraChatCompletionResponse = {
  choices: Array<{ message: { role: string; content: string } }>;
};

type TestSessionPayload = {
  testUserId: string;
  started_at: string;
};

type StoredTestMessage = { role: 'user' | 'assistant'; content: string; timestamp: string };
type StoredTestMessagesPayload = { test_messages: StoredTestMessage[] };
type TestUserContext = {
  id: number | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
};

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHydraError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status === 408 || status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (error.code === 'ECONNABORTED') return true;
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return message.includes('timeout') || message.includes('socket hang up');
}

function readTestSessionPayload(value: unknown): TestSessionPayload | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const testUserId = typeof obj.testUserId === 'string' ? obj.testUserId : null;
  const started_at = typeof obj.started_at === 'string' ? obj.started_at : null;
  if (!testUserId || !started_at) return null;
  return { testUserId, started_at };
}

function readStoredTestMessagesPayload(value: unknown): StoredTestMessagesPayload {
  if (!value || typeof value !== 'object') return { test_messages: [] };
  const obj = value as Record<string, unknown>;
  const raw = obj.test_messages;
  const arr = Array.isArray(raw) ? raw : [];
  const parsed: StoredTestMessage[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const role = it.role === 'user' || it.role === 'assistant' ? it.role : null;
    const content = typeof it.content === 'string' ? it.content : null;
    const timestamp = typeof it.timestamp === 'string' ? it.timestamp : null;
    if (!role || !content || !timestamp) continue;
    parsed.push({ role, content, timestamp });
  }
  return { test_messages: parsed };
}

// Test bot token is hardcoded as before (current behavior).
const token = '8287304369:AAFZUZvnV-Qg9ayUIix8xe8CTS4s3tZMx_Y';

const hydraApiKey = process.env.HYDRA_API_KEY;
if (!hydraApiKey) {
  // Keep message identical to JS version.
  // eslint-disable-next-line no-console
  console.error('Error: HYDRA_API_KEY not defined in .env file');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const conversationManager = new ConversationManager();

// eslint-disable-next-line no-console
console.log('🤖 Bananzatest bot started!');

async function updateBotMetadata(): Promise<void> {
  try {
    const baseUrl = `https://api.telegram.org/bot${token}`;

    const nameResponse: AxiosResponse<{ ok: boolean }> = await axios.post(`${baseUrl}/setMyName`, {
      name: 'Тестовый бот',
      language_code: 'ru',
    });
    if (!nameResponse.data.ok) {
      // eslint-disable-next-line no-console
      console.error('[TestBot] Failed to set name:', nameResponse.data);
    } else {
      // eslint-disable-next-line no-console
      console.log('[TestBot] ✅ Name (About) updated');
    }

    const descResponse: AxiosResponse<{ ok: boolean }> = await axios.post(`${baseUrl}/setMyDescription`, {
      description:
        'Тестовый бот для проверки AI-ботов перед деплоем. Здесь вы можете протестировать поведение вашего бота совершенно бесплатно!',
      language_code: 'ru',
    });
    if (!descResponse.data.ok) {
      // eslint-disable-next-line no-console
      console.error('[TestBot] Failed to set description:', descResponse.data);
    } else {
      // eslint-disable-next-line no-console
      console.log('[TestBot] ✅ Description updated');
    }

    const shortDescResponse: AxiosResponse<{ ok: boolean }> = await axios.post(`${baseUrl}/setMyShortDescription`, {
      short_description: 'Тестовая площадка для AI-ботов. Создайте своего бота через @bananza_bot',
      language_code: 'ru',
    });
    if (!shortDescResponse.data.ok) {
      // eslint-disable-next-line no-console
      console.error('[TestBot] Failed to set short description:', shortDescResponse.data);
    } else {
      // eslint-disable-next-line no-console
      console.log('[TestBot] ✅ Short description updated');
    }

    const commandsResponse: AxiosResponse<{ ok: boolean }> = await axios.post(`${baseUrl}/setMyCommands`, {
      commands: [{ command: 'start', description: 'Начать тестирование бота' }],
    });
    if (!commandsResponse.data.ok) {
      // eslint-disable-next-line no-console
      console.error('[TestBot] Failed to set commands:', commandsResponse.data);
    } else {
      // eslint-disable-next-line no-console
      console.log('[TestBot] ✅ Commands updated');
    }

    // eslint-disable-next-line no-console
    console.log('[TestBot] ✅ Bot metadata updated successfully');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[TestBot] ❌ Error updating bot metadata:', asErrorMessage(error));
  }
}

void updateBotMetadata();

const USER_DATA_DIR = path.join(__dirname, 'user_data');
const ACTIVE_TEST_SESSIONS_DIR = path.join(USER_DATA_DIR, 'test_sessions');

function getActiveSessionPath(testerUserId: string): string {
  return path.join(ACTIVE_TEST_SESSIONS_DIR, `${String(testerUserId)}.json`);
}

function setActiveTestSession(testerUserId: string, testUserId: string): void {
  conversationStore.ensureDir(ACTIVE_TEST_SESSIONS_DIR);
  conversationStore.writeJsonAtomic(getActiveSessionPath(testerUserId), {
    testUserId: String(testUserId),
    started_at: new Date().toISOString(),
  });
}

function clearActiveTestSession(testerUserId: string): void {
  try {
    const filePath = getActiveSessionPath(testerUserId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[TestBot] Error clearing active test session:', asErrorMessage(error));
  }
}

function getActiveTestSession(testerUserId: string): { testUserId: string } | null {
  try {
    const payloadUnknown = conversationStore.readJsonIfExists(getActiveSessionPath(testerUserId));
    const payload = readTestSessionPayload(payloadUnknown);
    return payload ? { testUserId: payload.testUserId } : null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[TestBot] Error reading active test session:', asErrorMessage(error));
    return null;
  }
}

function loadTestMessages(originalUserId: string, testerUserId: string): StoredTestMessage[] {
  try {
    const payloadUnknown = conversationStore.readJsonIfExists(conversationStore.getTestSessionPath(originalUserId, testerUserId));
    const payload = readStoredTestMessagesPayload(payloadUnknown);
    return payload.test_messages;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[TestBot] Error loading test messages:', asErrorMessage(error));
    return [];
  }
}

function saveTestMessages(originalUserId: string, testerUserId: string, testMessages: StoredTestMessage[]): void {
  try {
    conversationStore.writeJsonAtomic(conversationStore.getTestSessionPath(originalUserId, testerUserId), {
      test_messages: Array.isArray(testMessages) ? testMessages : [],
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `[TestBot] Error saving test messages for original user ${originalUserId}, tester ${testerUserId}:`,
      asErrorMessage(error)
    );
  }
}

const WELCOME_MESSAGE = `🤖 Это тестовый бот!

Настроить своего бота можно здесь:
https://t.me/bananza_bot

Отправьте /start и следуйте инструкциям. Это бесплатно!

Если ответы покажутся неподходящими, вернитесь в @bananza_bot и просто напишите, что нужно исправить — там сразу перегенерируем промпт.`;

async function generateExampleQuestion(description: string): Promise<string | null> {
  try {
    const { apiKey, baseUrl } = getHydraConfig();
    const model = getBotModel();
    const response = await axios.post<HydraChatCompletionResponse>(
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

function buildTestUserContext(msg: TelegramBot.Message): TestUserContext {
  const id = typeof msg.from?.id === 'number' ? msg.from.id : null;
  const username = typeof msg.from?.username === 'string' && msg.from.username.trim()
    ? `@${msg.from.username.trim()}`
    : null;
  const firstName = typeof msg.from?.first_name === 'string' && msg.from.first_name.trim()
    ? msg.from.first_name.trim()
    : null;
  const lastName = typeof msg.from?.last_name === 'string' && msg.from.last_name.trim()
    ? msg.from.last_name.trim()
    : null;
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Пользователь';

  return { id, username, firstName, lastName, fullName };
}

function buildEnhancedTestPrompt(basePrompt: string, userContext: TestUserContext): string {
  const fallbackContact = userContext.id !== null ? `ID:${userContext.id}` : 'контакт не указан';
  const contact = userContext.username || fallbackContact;

  return `${basePrompt}

---
ВАЖНО: Текущий пользователь - ${userContext.fullName} (Telegram: ${contact}).
Используй это имя в обращении и НЕ используй шаблонные слова вроде "Имя".
Если нужно уточнение, спроси пользователя напрямую.`;
}

function replaceNamePlaceholders(text: string, userContext: TestUserContext): string {
  const replacement = (userContext.firstName || userContext.fullName || '').trim();
  if (!replacement || replacement.toLowerCase() === 'пользователь') {
    return text;
  }

  return text
    .replace(/\{\{\s*name\s*\}\}/gi, replacement)
    .replace(/\{\s*name\s*\}/gi, replacement)
    .replace(/\[\s*name\s*\]/gi, replacement)
    .replace(/\bИмя\b/g, replacement)
    .replace(/\bname\b/gi, replacement);
}

async function callHydraChatCompletion(systemPrompt: string, chatHistory: StoredTestMessage[], userMessage: string): Promise<string> {
  const messages: HydraChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const { apiKey, baseUrl } = getHydraConfig();
  const model = getBotModel();

  const payload: HydraChatCompletionRequest = {
    model,
    messages,
    temperature: 0.8,
    max_tokens: 1000,
  };

  let response: AxiosResponse<HydraChatCompletionResponse> | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const timeoutMs = attempt === 1 ? 30000 : 90000;
    try {
      response = await axios.post<HydraChatCompletionResponse>(`${baseUrl.replace(/\/$/, '')}/chat/completions`, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: timeoutMs,
        proxy: false,
        maxRedirects: 0,
        transformRequest: [(data) => JSON.stringify(data)],
        transformResponse: [
          (data) => {
            try {
              return JSON.parse(data as string) as unknown;
            } catch {
              return data as unknown;
            }
          },
        ],
      });
      break;
    } catch (error) {
      lastError = error;
      if (!isRetryableHydraError(error) || attempt === 2) break;
      await sleep(1500 * attempt);
    }
  }

  if (!response) {
    throw (lastError ?? new Error('Hydra request failed'));
  }

  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Hydra returned empty completion');
  }
  return content;
}

// CHANGE: Add admin notification for referral tracking
// WHY: Track where users come from (r_ and t_ parameters)
// REF: User request - "задеплоенные боты должны отправлять инфу о том откуда приходят люди"
const ADMIN_TELEGRAM_ID = 6119567381;

bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from?.id ?? '');
  const startParam = (match?.[1] || '').trim();

  // eslint-disable-next-line no-console
  console.log(`[TestBot] User ${userId} started with param: "${startParam}"`);

  // CHANGE: Handle referral tracking parameters (r_ and t_)
  // WHY: Admins need to know where users come from
  if (startParam && (startParam.startsWith('r_') || startParam.startsWith('t_'))) {
    const referralType = startParam.startsWith('r_') ? 'Реферальный источник' : 'Tracking кампания';
    const referralValue = startParam.replace(/^(r_|t_)/, '');
    const userInfo = msg.from;
    const username = userInfo?.username ? `@${userInfo.username}` : 'нет username';
    const fullName = [userInfo?.first_name, userInfo?.last_name].filter(Boolean).join(' ') || 'Неизвестно';

    // eslint-disable-next-line no-console
    console.log(`[TestBot] Referral tracking: ${referralType} = ${referralValue} from user ${userId}`);

    // Send notification to admin
    try {
      await bot.sendMessage(
        ADMIN_TELEGRAM_ID,
        `📊 Новый пользователь по реферальной ссылке!\n\n` +
        `👤 Пользователь:\n` +
        `• ID: ${userId}\n` +
        `• Username: ${username}\n` +
        `• Имя: ${fullName}\n\n` +
        `🔗 ${referralType}: ${referralValue}\n\n` +
        `📝 Параметр: ?start=${startParam}`
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[TestBot] Failed to send admin notification:`, error);
    }
  }

  if (startParam && startParam.startsWith('test_')) {
    const testUserId = startParam.replace('test_', '');
    // eslint-disable-next-line no-console
    console.log(`[TestBot] Test mode for user ID: ${testUserId}`);

    const userConversation = conversationManager.getUserConversation(testUserId) as unknown;
    const convo = userConversation && typeof userConversation === 'object' ? (userConversation as Record<string, unknown>) : null;

    const testPrompt =
      (typeof convo?.test_prompt === 'string' && convo.test_prompt) ||
      (typeof convo?.generated_prompt === 'string' && convo.generated_prompt) ||
      null;

    if (testPrompt) {
      const description =
        (typeof convo?.test_description === 'string' && convo.test_description) ||
        (typeof convo?.product_description === 'string' && convo.product_description) ||
        'Тестовый бот';

      // eslint-disable-next-line no-console
      console.log(`[TestBot] Found test prompt for user ${testUserId}`);

      // Generate example question in background while composing welcome
      const examplePromise = generateExampleQuestion(description);

      let welcomeMsg = `🤖 Это ваш бот! Посмотрите, как он работает.

📋 ${description}

Напишите ему сообщение так, как написал бы ваш клиент — и посмотрите, как бот ответит.`;

      const exampleQuestion = await examplePromise;
      if (exampleQuestion) {
        welcomeMsg += `\n\n💬 Например, попробуйте спросить:\n«${exampleQuestion}»`;
      }

      welcomeMsg += `\n\n✏️ Если что-то не нравится в ответах — вернитесь в @bananza_bot и напишите, что поменять.`;

      await bot.sendMessage(chatId, welcomeMsg);

      setActiveTestSession(userId, testUserId);
      saveTestMessages(testUserId, userId, []);
      return;
    }

    clearActiveTestSession(userId);
    // eslint-disable-next-line no-console
    console.log(`[TestBot] No test prompt found for user ${testUserId}`);
    await bot.sendMessage(
      chatId,
      'Тестовая ссылка устарела или еще не готова. Вернитесь в @bananza_bot и нажмите «Тестировать бота» заново.'
    );
    return;
  }

  await bot.sendMessage(chatId, WELCOME_MESSAGE);
});

bot.on('message', async (msg) => {
  const text = msg.text;
  if (text && text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const userId = String(msg.from?.id ?? '');
  const userMessage = typeof text === 'string' ? text : '';
  if (!userMessage) return;

  // eslint-disable-next-line no-console
  console.log(`[TestBot] Message from user ${userId}: ${userMessage.substring(0, 50)}...`);

  try {
    const active = getActiveTestSession(userId);
    const testUserId = active ? active.testUserId : null;

    if (!testUserId) {
      await bot.sendMessage(chatId, WELCOME_MESSAGE);
      return;
    }

    const originalUserConversation = conversationManager.getUserConversation(testUserId) as unknown;
    const convo = originalUserConversation && typeof originalUserConversation === 'object'
      ? (originalUserConversation as Record<string, unknown>)
      : null;
    const testPrompt =
      (typeof convo?.test_prompt === 'string' && convo.test_prompt) ||
      (typeof convo?.generated_prompt === 'string' && convo.generated_prompt) ||
      null;

    const chatHistory = loadTestMessages(testUserId, userId);

    if (!testPrompt) {
      clearActiveTestSession(userId);
      await bot.sendMessage(chatId, WELCOME_MESSAGE);
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`[TestBot] Processing message for test session ${testUserId}`);

    await bot.sendChatAction(chatId, 'typing');

    const userContext = buildTestUserContext(msg);
    const enhancedPrompt = buildEnhancedTestPrompt(testPrompt, userContext);
    const aiResponseRaw = await callHydraChatCompletion(enhancedPrompt, chatHistory, userMessage);
    const aiResponse = replaceNamePlaceholders(aiResponseRaw, userContext);
    const parsedResponse = conversationManager.parseNotificationCommands(aiResponse) as unknown;
    const parsed = parsedResponse && typeof parsedResponse === 'object' ? (parsedResponse as Record<string, unknown>) : {};
    const chatMessage = typeof parsed.chatMessage === 'string' ? parsed.chatMessage : aiResponse;
    const userNotification = typeof parsed.userNotification === 'string' ? parsed.userNotification : null;
    const adminNotification = typeof parsed.adminNotification === 'string' ? parsed.adminNotification : null;

    chatHistory.push(
      { role: 'user', content: userMessage, timestamp: new Date().toISOString() },
      { role: 'assistant', content: aiResponse, timestamp: new Date().toISOString() }
    );
    saveTestMessages(testUserId, userId, chatHistory);

    // Telegram limit is 4096 chars — split long messages
    const MAX_MSG_LEN = 4096;
    if (chatMessage.length > MAX_MSG_LEN) {
      for (let i = 0; i < chatMessage.length; i += MAX_MSG_LEN) {
        await bot.sendMessage(chatId, chatMessage.slice(i, i + MAX_MSG_LEN));
      }
    } else {
      await bot.sendMessage(chatId, chatMessage);
    }

    if (userNotification || adminNotification) {
      const notificationResults = (await conversationManager.sendNotifications(
        bot,
        userId,
        chatId,
        { userNotification, adminNotification },
        { sendPrivateMessages: true, notificationChannel: testUserId || null }
      )) as unknown;

      const results = notificationResults && typeof notificationResults === 'object'
        ? (notificationResults as Record<string, unknown>)
        : {};
      const userNotificationSent = results.userNotificationSent === true;
      const errors = Array.isArray(results.errors) ? results.errors.filter((e): e is string => typeof e === 'string') : [];

      if (userNotification && !userNotificationSent && errors.length > 0) {
        const errorMsg = errors.find((e) => e.includes('личку')) || null;
        if (errorMsg) {
          await bot.sendMessage(chatId, `\n\n${errorMsg}`).catch(() => undefined);
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[TestBot] Response sent to user ${userId}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[TestBot] Error processing message from ${userId}:`, error);
    await bot.sendMessage(chatId, 'Извините, произошла ошибка при обработке вашего сообщения. Попробуйте еще раз.').catch(() => undefined);
  }
});

let testBotPollingErrorCount = 0;
let testBotLastPollingErrorLog = 0;

bot.on('polling_error', (error) => {
  const errorCode = (error as { code?: string }).code || '';
  const errorMessage = asErrorMessage(error);
  const now = Date.now();

  // Transient network errors — throttle logs
  if (
    errorCode === 'EFATAL' ||
    errorMessage.includes('ECONNRESET') ||
    errorMessage.includes('ETIMEDOUT') ||
    errorMessage.includes('502') ||
    errorMessage.includes('Bad Gateway') ||
    errorMessage.includes('socket hang up')
  ) {
    testBotPollingErrorCount++;
    if (now - testBotLastPollingErrorLog > 60000) {
      // eslint-disable-next-line no-console
      console.log(`[TestBot] Network errors (auto-recovering): ${testBotPollingErrorCount} in last period`);
      testBotPollingErrorCount = 0;
      testBotLastPollingErrorLog = now;
    }
    return;
  }

  // eslint-disable-next-line no-console
  console.error('[TestBot] Polling error:', errorCode, '-', errorMessage);
});

// Prevent crash on unhandled Bluebird promise rejections (node-telegram-bot-api uses Bluebird)
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[TestBot] Unhandled rejection (caught):', reason instanceof Error ? reason.message : reason);
});

process.on('uncaughtException', (error) => {
  // eslint-disable-next-line no-console
  console.error('[TestBot] Uncaught exception (caught):', error.message);
  // eslint-disable-next-line no-console
  console.error(error.stack);
});

process.on('SIGINT', () => {
  // eslint-disable-next-line no-console
  console.log('[TestBot] Received SIGINT. Stopping bot...');
  void bot.stopPolling().then(() => {
    // eslint-disable-next-line no-console
    console.log('[TestBot] Bot stopped.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  // eslint-disable-next-line no-console
  console.log('[TestBot] Received SIGTERM. Stopping bot...');
  void bot.stopPolling().then(() => {
    // eslint-disable-next-line no-console
    console.log('[TestBot] Bot stopped.');
    process.exit(0);
  });
});
