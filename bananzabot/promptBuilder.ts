import axios, { AxiosInstance } from 'axios';
import { getPromptModel, getHydraConfig } from './aiSettings';

type HydraChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type HydraChatCompletionResponse = { choices: Array<{ message: { content: string } }> };

function asHydraCompletionContent(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null;
  const msg = (first as Record<string, unknown>).message;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const content = (msg as Record<string, unknown>).content;
  return typeof content === 'string' ? content : null;
}

function createHydraAxiosClient(apiKey: string, timeoutMs: number): AxiosInstance {
  return axios.create({
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: timeoutMs,
    proxy: false,
    maxRedirects: 0,
    // Hydra nginx is picky about request serialization in some environments (400 otherwise).
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

export type PromptBuilderInteractiveResult =
  | { success: true; response: string; readyToGenerate: boolean }
  | { success: false; error: string };

export type PromptBuilderFinalResult =
  | { success: true; prompt: string }
  | { success: false; error: string };

export type PromptBuilderHistoryItem = { role: 'user' | 'assistant' | 'system'; content: string };

export default class PromptBuilder {
  // Kept for backward compatibility; not used by Hydra flow.
  private openaiApiKey: string | null = null;

  public getInteractiveSystemPrompt(): string {
    return `Ты - AI-помощник для создания промптов для Telegram ботов с глубоким пониманием бизнес-процессов.

ТВОЯ ЗАДАЧА: Помочь клиенту создать промпт для бота, собрав информацию которую он ХОЧЕТ указать.
ВАЖНО: Ничего не является обязательным — это только рекомендации.

🎯 ЧТО МОЖНО УЗНАТЬ (все поля ОПЦИОНАЛЬНЫЕ - спрашивай аккуратно):

1. УСЛУГИ/ПРОДУКТЫ (рекомендуется)
   - Что конкретно предлагает бизнес?
   - Можно перечислить 3-5 основных услуг/продуктов
   - НО если клиент не хочет детализировать - не настаивай!

2. ЦЕНЫ (желательно, но не обязательно)
   - ТОЛЬКО если клиент сам упомянул или хочет указать
   - Примеры: "Маникюр - 1500₽, Педикюр - 2000₽"
   - Если клиент говорит "без цен" или "не важно" - НЕ настаивай!

3. ДАННЫЕ ДЛЯ ЗАЯВКИ
   Telegram username АВТОМАТИЧЕСКИЙ - НЕ спрашивай!
   Можешь ОДИН РАЗ предложить:
   - Номер телефона? (если клиент отказался - не спрашивай повторно)
   - Желаемая дата/время?
   - Детали заказа/проблемы?

4. FAQ (опционально)
   - Адрес/локация?
   - График работы?
   - Способы оплаты?

📋 ВОЗМОЖНОСТИ БОТОВ:
✅ Общаются 24/7
✅ Собирают заявки с уведомлениями владельцу
✅ Отправляют подтверждения клиентам
✅ Отвечают на FAQ

❌ ОГРАНИЧЕНИЯ (ОБЯЗАТЕЛЬНО сообщай если пользователь просит невозможное):
❌ Нет интеграции с CRM/календарями
❌ Нет онлайн-оплаты (только информация о ценах)
❌ Нет внешних API и баз данных
❌ Нет динамического контента (курсы валют, наличие товаров в реальном времени)

Если пользователь просит что-то из списка — ОБЯЗАТЕЛЬНО скажи:
"К сожалению, [функция] пока недоступна. Но я могу создать бота который [альтернатива в рамках возможностей]."
НЕ молчи об ограничениях — пользователь должен знать ДО генерации.

💡 МЯГКИЕ ПОДСКАЗКИ (ТОЛЬКО если клиент сам заинтересован):

Если клиент сам спрашивает про цены:
"💡 Можете указать примерные цены - это повышает доверие клиентов"

Если клиент упомянул адрес/график:
"💡 Отлично! Бот сможет автоматически отвечать на вопросы про адрес и график"

КРИТИЧНО - НЕ НАВЯЗЫВАЙ:
- Если клиент сказал "не важно", "пофигу", "не надо" - НЕ переспрашивай!
- Если клиент отказался один раз - ХВАТИТ!
- Если минимальная информация есть (хотя бы описание услуги) - ГОТОВ к генерации!

🎭 ПРИМЕРЫ ДИАЛОГА:

Клиент: "Хочу бота для салона красоты"
Ты: "Отлично! Создам бота для салона. Можете рассказать подробнее: какие услуги оказываете, есть ли цены которые хотите указать?"

Клиент: "Ремонт телефонов, замена экрана 2500₽"
Ты: "Супер! Есть услуга и цена. Хотите добавить другие услуги или этого достаточно?"

Клиент: "пофигу на остальное просто перекидывай сообщения"
Ты: "Понял! Буду просто пересылать сообщения. Если всё верно - готов сгенерировать промпт. READY_TO_GENERATE"

Клиент: "веб разработка, просто присылай их сообщения"
Ты: "Отлично! Бот для веб-разработки, пересылка сообщений. Готов к генерации! READY_TO_GENERATE"

Клиент: [длинная спецификация 500+ символов с описанием функций, меню, оплаты, реферальной системы]
Ты: "Отличная спецификация! Вижу: каталог товаров, FAQ, поддержка. Хочу уточнить: онлайн-оплата и внешние API пока недоступны — но бот сможет показывать каталог через кнопки, отвечать на вопросы и собирать заявки с уведомлениями вам. Создаю промпт! READY_TO_GENERATE"

КОГДА ГОТОВ:
Когда есть МИНИМУМ: хотя бы краткое описание услуги/продукта ИЛИ назначение бота
→ Всегда добавляй понятный текст и в конце READY_TO_GENERATE (например: "Отлично! Все данные собраны. READY_TO_GENERATE")
→ НИКОГДА не отвечай только READY_TO_GENERATE
→ НЕ проси пользователя писать пустые кавычки или "".

ДЕТАЛЬНОЕ ОПИСАНИЕ:
Если пользователь отправил подробную спецификацию (больше 300 символов) с функциями, структурой меню, сценариями:
→ НЕ задавай уточняющих вопросов — информации достаточно!
→ Подтверди что понял концепцию, кратко перечисли ключевые функции
→ Если есть невозможные функции (оплата, внешние API, базы данных) — объясни что доступно и предложи адаптацию
→ Заверши ответ READY_TO_GENERATE

ВАЖНО - НЕ ПУТАЙ:
❌ НЕ создавай приветственное сообщение для пользователей бота (типа "👋 Привет! Я бот...")
❌ НЕ пиши сам промпт в ответе пользователю
✅ ТОЛЬКО собирай информацию и отправляй "READY_TO_GENERATE" когда все данные собраны
✅ Промпт будет сгенерирован автоматически ПОСЛЕ того как ты отправишь READY_TO_GENERATE

СТИЛЬ: Дружелюбный, но деловой. Помогай, не давай. Задавай конкретные вопросы.`;
  }

  public async processInteractiveMessage(conversationHistory: PromptBuilderHistoryItem[], userMessage: string): Promise<PromptBuilderInteractiveResult> {
    try {
      const messages: HydraChatMessage[] = [
        { role: 'system', content: this.getInteractiveSystemPrompt() },
        ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
      ];
      // Avoid duplicating the user message if it's already the last entry in history
      const lastMsg = conversationHistory[conversationHistory.length - 1];
      if (!(lastMsg && lastMsg.role === 'user' && lastMsg.content === userMessage)) {
        messages.push({ role: 'user', content: userMessage });
      }

      const { apiKey, baseUrl } = getHydraConfig();
      const model = getPromptModel();
      const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
      const payload = {
        model,
        messages,
        temperature: 0.7,
        max_tokens: 1500,
      };
      let response: { data: HydraChatCompletionResponse } | null = null;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const timeoutMs = attempt === 1 ? 45000 : 90000;
        const axiosClient = createHydraAxiosClient(apiKey, timeoutMs);
        try {
          response = await axiosClient.post<HydraChatCompletionResponse>(endpoint, payload);
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

      const content = asHydraCompletionContent(response.data) ?? '';
      const isReady = content.includes('READY_TO_GENERATE');
      const cleanResponse = content.replace('READY_TO_GENERATE', '').trim();
      const finalResponse = cleanResponse || 'Отлично! Все данные собраны. Сейчас сгенерирую промпт для вашего бота...';

      return { success: true, response: finalResponse, readyToGenerate: isReady };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error('[PromptBuilder] Error processing message:', msg);
      return { success: false, error: 'Не удалось обработать сообщение. Попробуйте еще раз.' };
    }
  }

  public async generateFinalPrompt(conversationHistory: PromptBuilderHistoryItem[]): Promise<PromptBuilderFinalResult> {
    try {
      const historyText = conversationHistory.map((m) => `${m.role}: ${m.content}`).join('\n');

      const systemPrompt = `На основе диалога с клиентом создай детальный системный промпт для Telegram бота.

Промпт должен:
1. Быть на русском языке
2. Содержать минимум 500 слов
3. Четко описывать роль бота и его цель
4. Включать инструкции по сбору информации
5. Содержать примеры ответов на частые вопросы
6. Указывать, когда использовать команды уведомлений [NOTIFY_USER] и [NOTIFY_ADMIN]
7. Указывать, когда использовать inline-кнопки через команду [BUTTONS]

КРИТИЧЕСКИ ВАЖНО - РАБОТА С КОНТАКТАМИ ПОЛЬЗОВАТЕЛЯ:
- Система автоматически предоставляет тебе данные пользователя: имя, @username и ID
- Эти данные передаются в конце промпта в формате: "Текущий пользователь - Имя (Telegram: @username)"
- НЕ СПРАШИВАЙ у пользователя его имя или телеграм - ты уже знаешь их!
- При отправке уведомления админу ВСЕГДА используй предоставленный @username или ID
- Если клиент хочет "сохранять телеграм" - ты УЖЕ его знаешь автоматически

ВАЖНО: Если клиент хочет уведомления:
- Укажи в промпте, когда бот должен использовать [NOTIFY_USER] текст для отправки в личку пользователю
- Укажи в промпте, когда бот должен использовать [NOTIFY_ADMIN] текст для отправки в канал администраторов

Пример использования команд уведомлений:
"Когда пользователь заинтересован в услуге, ответь в чате: 'Отлично! Я передам вашу заявку менеджеру.', затем добавь:
[NOTIFY_ADMIN] Новая заявка на создание сайта!
Клиент: {имя пользователя из контекста}
Telegram: {username из контекста}
Что интересует: {краткое описание запроса}"

ВАЖНО: Если клиент хочет кнопки/меню/варианты выбора:
- Укажи в промпте, что бот должен сначала дать обычный текстовый ответ, а затем (в новой строке) добавить блок [BUTTONS]
- Формат блока [BUTTONS]: валидный JSON-массив строк inline_keyboard
- Пример:
[BUTTONS]
[[{"text":"Каталог","callback_data":"catalog"}],[{"text":"Связаться с менеджером","url":"https://t.me/example"}]]
- Допускаются только кнопки с полем text и одним действием (url, callback_data, switch_inline_query, switch_inline_query_current_chat, web_app, pay)
- Если кнопки не нужны, [BUTTONS] не добавлять

ВАЖНО:
- В промпте обязательно укажи, что бот должен отвечать ПРОСТЫМ ТЕКСТОМ без markdown форматирования
- Бот НЕ должен спрашивать имя или контакт - они уже известны из системы
- Бот может спрашивать только БИЗНЕС-информацию: что нужно, какой бюджет, сроки и т.д.

История диалога с клиентом:
${historyText}

Создай ТОЛЬКО системный промпт, без дополнительных комментариев.`;

      const { apiKey, baseUrl } = getHydraConfig();
      const model = getPromptModel();
      const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
      const payload = {
        model,
        messages: [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: 'Создай финальный промпт для бота на основе нашего диалога' },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      };

      let response: { data: HydraChatCompletionResponse } | null = null;
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const timeoutMs = attempt === 1 ? 60000 : 120000;
        const axiosClient = createHydraAxiosClient(apiKey, timeoutMs);
        try {
          response = await axiosClient.post<HydraChatCompletionResponse>(endpoint, payload);
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

      const generatedPrompt = asHydraCompletionContent(response.data);
      if (!generatedPrompt) {
        throw new Error('Hydra returned empty prompt');
      }

      return { success: true, prompt: generatedPrompt };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error('[PromptBuilder] Error generating final prompt:', msg);
      return { success: false, error: 'Не удалось сгенерировать финальный промпт. Попробуйте еще раз.' };
    }
  }
}
