import * as path from 'path';

export function getNamePrompt(): string {
  return process.env.NAMEPROMPT || 'calories';
}

function getBaseDir(): string {
  return path.join(__dirname, 'user_data');
}

export function getUserDataDir(): string {
  return path.join(getBaseDir(), getNamePrompt());
}

export function getChatHistoriesDir(): string {
  return path.join(getUserDataDir(), 'chat_histories');
}

export function getMaxHistory(): number {
  return 20;
}

export function getFreeMessageLimit(): number | null {
  const raw = process.env.FREE_MESSAGE_LIMIT;
  if (raw === undefined) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function getFreeDaysLimit(): number | null {
  const raw = process.env.FREE_DAYS_LIMIT;
  if (raw === undefined) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export let NAMEPROMPT: string = getNamePrompt();
export let BASE_DIR: string = getBaseDir();
export let USER_DATA_DIR: string = getUserDataDir();
export let CHAT_HISTORIES_DIR: string = getChatHistoriesDir();
export let MAX_HISTORY: number = getMaxHistory();
export let FREE_MESSAGE_LIMIT: number | null = getFreeMessageLimit();
export let FREE_DAYS_LIMIT: number | null = getFreeDaysLimit();

export function reloadConfig(): {
  NAMEPROMPT: string;
  USER_DATA_DIR: string;
  CHAT_HISTORIES_DIR: string;
  MAX_HISTORY: number;
  FREE_MESSAGE_LIMIT: number | null;
  FREE_DAYS_LIMIT: number | null;
} {
  NAMEPROMPT = getNamePrompt();
  BASE_DIR = getBaseDir();
  USER_DATA_DIR = getUserDataDir();
  CHAT_HISTORIES_DIR = getChatHistoriesDir();
  MAX_HISTORY = getMaxHistory();
  FREE_MESSAGE_LIMIT = getFreeMessageLimit();
  FREE_DAYS_LIMIT = getFreeDaysLimit();

  return {
    NAMEPROMPT,
    USER_DATA_DIR,
    CHAT_HISTORIES_DIR,
    MAX_HISTORY,
    FREE_MESSAGE_LIMIT,
    FREE_DAYS_LIMIT,
  };
}

export default {
  getNamePrompt,
  getUserDataDir,
  getChatHistoriesDir,
  getMaxHistory,
  getFreeMessageLimit,
  getFreeDaysLimit,
  NAMEPROMPT,
  USER_DATA_DIR,
  CHAT_HISTORIES_DIR,
  MAX_HISTORY,
  FREE_MESSAGE_LIMIT,
  FREE_DAYS_LIMIT,
  reloadConfig,
};

