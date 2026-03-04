import * as fs from 'fs';
import * as path from 'path';
import conversationStore from './conversationStore';

type StoredConversation = {
  stage?: string;
  messages?: unknown[];
  product_description?: string | null;
  generated_prompt?: string | null;
  test_prompt?: string | null;
  test_description?: string | null;
  referralSource?: string;
  referralParam?: string;
  referralDate?: string;
  userInfo?: {
    username?: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
  };
  [key: string]: unknown;
};

export type ParsedNotificationCommands = {
  chatMessage: string;
  userNotification: string | null;
  adminNotification: string | null;
  inlineKeyboard: Array<Array<Record<string, unknown>>> | null;
};

export type NotificationResults = {
  userNotificationSent: boolean;
  adminNotificationSent: boolean;
  errors: string[];
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function extractJsonCandidate(raw: string): string | null {
  const match = raw.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  const candidate = match?.[1];
  return typeof candidate === 'string' ? candidate : null;
}

export default class ConversationManager {
  private conversationsPath: string;
  private conversationsBaseDir: string;

  constructor() {
    this.conversationsPath = path.join(__dirname, 'user_data', 'conversations.json'); // legacy
    this.conversationsBaseDir = conversationStore.getBaseDir();
    this.ensureConversationsStorage();
  }

  private ensureConversationsStorage(): void {
    const dir = path.dirname(this.conversationsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    conversationStore.migrateLegacyConversationsIfNeeded({ legacyPath: this.conversationsPath, archiveLegacy: false });
    conversationStore.ensureDir(this.conversationsBaseDir);
  }

  private loadUserConversationFromLegacy(userId: string): StoredConversation | null {
    try {
      if (!fs.existsSync(this.conversationsPath)) {
        return null;
      }
      const raw = fs.readFileSync(this.conversationsPath, 'utf8');
      const conversationsUnknown = JSON.parse(raw) as unknown;
      const conversations = asObject(conversationsUnknown);
      if (!conversations) return null;
      const found = conversations[userId];
      const obj = asObject(found);
      return obj ? (obj as StoredConversation) : null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error('Error loading legacy conversations:', msg);
      return null;
    }
  }

  private loadUserConversation(userId: string): StoredConversation | null {
    const filePath = conversationStore.getMainConversationPath(userId);
    try {
      const convoUnknown = conversationStore.readJsonIfExists(filePath);
      const convo = asObject(convoUnknown);
      if (convo) return convo as StoredConversation;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error('Error loading conversation:', msg);
    }

    const legacy = this.loadUserConversationFromLegacy(String(userId));
    if (legacy) {
      try {
        conversationStore.writeJsonAtomic(filePath, legacy);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error('Error persisting legacy conversation into per-user file:', msg);
      }
      return legacy;
    }
    return null;
  }

  private saveUserConversation(userId: string, conversation: StoredConversation): void {
    const filePath = conversationStore.getMainConversationPath(userId);
    conversationStore.writeJsonAtomic(filePath, conversation);
  }

  public getUserConversation(userId: string | number): StoredConversation {
    const userKey = String(userId);
    const existing = this.loadUserConversation(userKey);
    return (
      existing || {
        stage: 'start',
        messages: [],
        product_description: null,
        generated_prompt: null,
      }
    );
  }

  public updateUserConversation(userId: string | number, updates: Partial<StoredConversation>): void {
    const userKey = String(userId);
    const next: StoredConversation = {
      ...this.getUserConversation(userKey),
      ...updates,
    };
    this.saveUserConversation(userKey, next);
  }

  public addMessage(userId: string | number, role: string, content: string): void {
    const userKey = String(userId);
    const conversation = this.getUserConversation(userKey);
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    messages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
    conversation.messages = messages;
    this.saveUserConversation(userKey, conversation);
  }

  public clearUserConversation(userId: string | number): void {
    const userKey = String(userId);
    const existingUser = this.loadUserConversation(userKey);

    const referralSource = asOptionalString(existingUser?.referralSource);
    const referralParam = asOptionalString(existingUser?.referralParam);
    const referralDate = asOptionalString(existingUser?.referralDate);
    const userInfo = existingUser?.userInfo && typeof existingUser.userInfo === 'object' ? existingUser.userInfo : undefined;

    const convoPath = conversationStore.getMainConversationPath(userKey);
    try {
      if (fs.existsSync(convoPath)) {
        fs.unlinkSync(convoPath);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error('Error deleting conversation file:', msg);
    }

    if (referralSource || userInfo) {
      this.saveUserConversation(userKey, {
        stage: 'start',
        messages: [],
        product_description: null,
        generated_prompt: null,
        ...(referralSource ? { referralSource } : {}),
        ...(referralParam ? { referralParam } : {}),
        ...(referralDate ? { referralDate } : {}),
        ...(userInfo ? { userInfo } : {}),
      });
    }
  }

  public getUserStage(userId: string | number): string {
    const stage = this.getUserConversation(userId).stage;
    return typeof stage === 'string' && stage ? stage : 'start';
  }

  public setUserStage(userId: string | number, stage: string): void {
    this.updateUserConversation(userId, { stage });
  }

  public parseNotificationCommands(aiResponse: string): ParsedNotificationCommands {
    const buttonsMatch = aiResponse.match(/\[BUTTONS\]([\s\S]*?)(?=\[NOTIFY_ADMIN\]|\[NOTIFY_USER\]|\[BUTTONS\]|$)/);
    const notifyUserMatch = aiResponse.match(/\[NOTIFY_USER\]([\s\S]*?)(?=\[NOTIFY_ADMIN\]|\[NOTIFY_USER\]|$)/);
    const notifyAdminMatch = aiResponse.match(/\[NOTIFY_ADMIN\]([\s\S]*?)(?=\[NOTIFY_USER\]|\[NOTIFY_ADMIN\]|$)/);

    let chatMessage = aiResponse
      .replace(/\[BUTTONS\][\s\S]*?(?=\[NOTIFY_ADMIN\]|\[NOTIFY_USER\]|\[BUTTONS\]|$)/g, '')
      .replace(/\[NOTIFY_USER\][\s\S]*?(?=\[NOTIFY_ADMIN\]|\[NOTIFY_USER\]|$)/g, '')
      .replace(/\[NOTIFY_ADMIN\][\s\S]*?(?=\[NOTIFY_USER\]|\[NOTIFY_ADMIN\]|$)/g, '')
      .trim();

    if (!chatMessage) {
      const parts = aiResponse.split(/\[(?:NOTIFY_USER|NOTIFY_ADMIN|BUTTONS)\]/);
      const first = (parts.length ? (parts[0] ?? '') : '').trim();
      chatMessage = first || 'Сообщение отправлено администратору.';
    }

    return {
      chatMessage,
      userNotification: notifyUserMatch?.[1] ? notifyUserMatch[1].trim() : null,
      adminNotification: notifyAdminMatch?.[1] ? notifyAdminMatch[1].trim() : null,
      inlineKeyboard: this.parseInlineKeyboard(buttonsMatch?.[1]),
    };
  }

  private parseInlineKeyboard(rawButtonsBlock: string | undefined): Array<Array<Record<string, unknown>>> | null {
    if (!rawButtonsBlock) return null;
    const source = rawButtonsBlock.trim();
    if (!source) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      const extracted = extractJsonCandidate(source);
      if (!extracted) return null;
      try {
        parsed = JSON.parse(extracted);
      } catch {
        return null;
      }
    }

    const asKeyboard = asObject(parsed);
    const rawKeyboard = asKeyboard && Array.isArray(asKeyboard.inline_keyboard) ? asKeyboard.inline_keyboard : parsed;
    if (!Array.isArray(rawKeyboard)) return null;

    const keyboard: Array<Array<Record<string, unknown>>> = [];
    for (const rowCandidate of rawKeyboard.slice(0, 6)) {
      if (!Array.isArray(rowCandidate)) continue;
      const row: Array<Record<string, unknown>> = [];

      for (const buttonCandidate of rowCandidate.slice(0, 6)) {
        const button = this.sanitizeInlineButton(buttonCandidate);
        if (button) row.push(button);
      }

      if (row.length > 0) keyboard.push(row);
    }

    return keyboard.length > 0 ? keyboard : null;
  }

  private sanitizeInlineButton(rawButton: unknown): Record<string, unknown> | null {
    const button = asObject(rawButton);
    if (!button) return null;

    const text = asOptionalString(button.text)?.trim();
    if (!text) return null;

    const url = asOptionalString(button.url)?.trim();
    if (url) return { text, url };

    const callbackData = asOptionalString(button.callback_data)?.trim();
    if (callbackData) return { text, callback_data: callbackData.slice(0, 64) };

    const switchInlineQuery = asOptionalString(button.switch_inline_query);
    if (typeof switchInlineQuery === 'string') return { text, switch_inline_query: switchInlineQuery };

    const switchInlineQueryCurrent = asOptionalString(button.switch_inline_query_current_chat);
    if (typeof switchInlineQueryCurrent === 'string') return { text, switch_inline_query_current_chat: switchInlineQueryCurrent };

    const webApp = asObject(button.web_app);
    const webAppUrl = webApp ? asOptionalString(webApp.url)?.trim() : undefined;
    if (webAppUrl) return { text, web_app: { url: webAppUrl } };

    const pay = asOptionalBoolean(button.pay);
    if (pay === true) return { text, pay: true };

    return null;
  }

  public async sendNotifications(
    bot: { sendMessage: (chatId: string | number, text: string) => Promise<unknown> },
    userId: string,
    _chatId: number,
    notifications: { userNotification: string | null; adminNotification: string | null },
    notificationConfig: { sendPrivateMessages: boolean; notificationChannel: string | null }
  ): Promise<NotificationResults> {
    const results: NotificationResults = {
      userNotificationSent: false,
      adminNotificationSent: false,
      errors: [],
    };

    if (notificationConfig.sendPrivateMessages && notifications.userNotification) {
      try {
        await bot.sendMessage(userId, notifications.userNotification);
        results.userNotificationSent = true;
        // eslint-disable-next-line no-console
        console.log(`[Notification] Sent private message to user ${userId}`);
      } catch (error) {
        const errObj = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
        const resp = errObj.response && typeof errObj.response === 'object' ? (errObj.response as Record<string, unknown>) : {};
        const body = resp.body && typeof resp.body === 'object' ? (resp.body as Record<string, unknown>) : {};
        const desc = typeof body.description === 'string' ? body.description : '';
        if (
          desc.includes('bot was blocked') ||
          desc.includes('user is deactivated') ||
          desc.includes("can't initiate conversation")
        ) {
          // eslint-disable-next-line no-console
          console.log(`[Notification] Cannot send private message to user ${userId}: ${desc}`);
          results.errors.push('Для получения уведомлений напишите боту в личку');
        } else if (desc) {
          results.errors.push(desc);
        } else {
          const msg = error instanceof Error ? error.message : String(error);
          results.errors.push(msg);
        }
      }
    }

    if (notificationConfig.notificationChannel && notifications.adminNotification) {
      try {
        await bot.sendMessage(notificationConfig.notificationChannel, notifications.adminNotification);
        results.adminNotificationSent = true;
        // eslint-disable-next-line no-console
        console.log(`[Notification] Sent notification to channel ${notificationConfig.notificationChannel}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        results.errors.push(msg);
      }
    }

    return results;
  }
}
