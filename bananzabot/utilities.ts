import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { CHAT_HISTORIES_DIR } from './config';

if (!fs.existsSync(CHAT_HISTORIES_DIR)) {
  try {
    fs.mkdirSync(CHAT_HISTORIES_DIR, { recursive: true });
    // eslint-disable-next-line no-console
    console.log(`Created chat histories directory: ${CHAT_HISTORIES_DIR}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Fatal error: Could not create chat histories directory at ${CHAT_HISTORIES_DIR}`, error);
    process.exit(1);
  }
}

export function sanitizeString(str: string): string {
  // Preserve current behavior (sanitization disabled).
  return str;
}

export function validateChatId(chatId: unknown): boolean {
  let id: unknown = chatId;
  if (typeof id === 'string') {
    id = Number(id);
  }
  return typeof id === 'number' && Number.isInteger(id) && id !== 0;
}

export function validateImageResponse(response: unknown, maxSizeInBytes: number = 10 * 1024 * 1024): true {
  if (!response || typeof response !== 'object') throw new Error('Invalid image response data');
  const obj = response as Record<string, unknown>;
  const data = obj.data;
  if (!data) throw new Error('Invalid image response data');

  const length =
    typeof (data as { length?: unknown }).length === 'number'
      ? (data as { length: number }).length
      : null;
  if (length == null) throw new Error('Invalid image response data');
  if (length > maxSizeInBytes) {
    throw new Error(`Image size (${length} bytes) exceeds maximum allowed (${maxSizeInBytes} bytes)`);
  }
  return true;
}

export function validateMimeTypeImg(mimeType: string): boolean {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
  return allowedTypes.includes(mimeType);
}

export function validateMimeTypeAudio(mimeType: string): boolean {
  const allowedTypes = ['audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/x-m4a'];
  return allowedTypes.includes(mimeType);
}

export function generateMessageHash(chatId: number, timestamp: number): string {
  const secret = process.env.MESSAGE_HASH_SECRET || 'default-secret-change-me';
  return crypto.createHmac('sha256', secret).update(`${chatId}:${timestamp}`).digest('hex');
}

type LogType = 'message' | 'user' | 'assistant' | 'error' | 'system' | 'event';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function logChat(chatId: number, data: unknown, logType: LogType = 'message'): void {
  if (!validateChatId(chatId) && chatId !== 0) {
    // eslint-disable-next-line no-console
    console.error('Invalid chat ID in logChat:', chatId);
    return;
  }

  const logFilePath = path.join(CHAT_HISTORIES_DIR, `chat_${chatId}.log`);
  try {
    let content: unknown;
    if (logType === 'user' || logType === 'assistant') {
      const obj = isRecord(data) ? data : {};
      const rawContent = obj.content;
      const text = typeof obj.text === 'string' ? obj.text : '';
      if (Array.isArray(rawContent)) {
        content = rawContent;
      } else if (text) {
        content = [
          {
            type: logType === 'user' ? 'input_text' : 'output_text',
            text,
          },
        ];
      } else {
        content = [];
      }
    } else {
      content = data;
    }

    const logEntry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      type: logType,
      content,
    };
    if (logType === 'user' || logType === 'assistant') {
      logEntry.role = logType;
    }

    fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + '\n');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Error logging chat ${chatId} to ${logFilePath}:`, error);
  }
}

export default {
  sanitizeString,
  validateChatId,
  validateImageResponse,
  validateMimeTypeImg,
  validateMimeTypeAudio,
  generateMessageHash,
  logChat,
};

