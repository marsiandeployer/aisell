declare module './conversationManager' {
  import TelegramBot from 'node-telegram-bot-api';

  export type ParsedNotificationCommands = {
    chatMessage: string;
    userNotification: string | null;
    adminNotification: string | null;
  };

  export type NotificationResults = {
    userNotificationSent: boolean;
    adminNotificationSent: boolean;
    errors: string[];
  };

  export default class ConversationManager {
    getUserConversation(userId: string | number): unknown;
    parseNotificationCommands(aiResponse: string): ParsedNotificationCommands;
    sendNotifications(
      bot: TelegramBot,
      userId: string,
      chatId: number,
      notifications: { userNotification: string | null; adminNotification: string | null },
      notificationConfig: { sendPrivateMessages: boolean; notificationChannel: string | null }
    ): Promise<NotificationResults>;
  }
}

declare module './conversationStore' {
  export type StoredJson = unknown;

  export function ensureDir(dirPath: string): void;
  export function readJsonIfExists(filePath: string): StoredJson | null;
  export function writeJsonAtomic(filePath: string, data: unknown): void;
  export function getTestSessionPath(originalUserId: string, testerUserId: string): string;

  const _default: {
    ensureDir: typeof ensureDir;
    readJsonIfExists: typeof readJsonIfExists;
    writeJsonAtomic: typeof writeJsonAtomic;
    getTestSessionPath: typeof getTestSessionPath;
  };
  export default _default;
}

declare module './aiSettings' {
  export function getBotModel(): string;
  export function getHydraConfig(): { apiKey: string; baseUrl: string };
}

