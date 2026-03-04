import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '.env') });

export const SETTINGS_PATH = path.join(__dirname, 'ai_settings.json');
const HYDRA_BASE_URL = 'https://api.hydraai.ru/v1';

export type AiSettings = {
  prompt_model: string;
  bot_model: string;
  provider?: string;
  updated_at?: string;
  test_model?: string;
};

export function readAiSettings(): AiSettings {
  if (!fs.existsSync(SETTINGS_PATH)) {
    throw new Error(`Missing AI settings file: ${SETTINGS_PATH}`);
  }
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
  const settingsUnknown = JSON.parse(raw) as unknown;
  if (!settingsUnknown || typeof settingsUnknown !== 'object' || Array.isArray(settingsUnknown)) {
    throw new Error('ai_settings.json must be an object');
  }
  const settings = settingsUnknown as Partial<AiSettings>;
  const promptModel = settings.prompt_model;
  const botModel = settings.bot_model;
  if (!promptModel || !botModel) {
    throw new Error('ai_settings.json must include prompt_model and bot_model');
  }
  return {
    prompt_model: String(promptModel),
    bot_model: String(botModel),
    ...(settings.provider ? { provider: String(settings.provider) } : {}),
    ...(settings.updated_at ? { updated_at: String(settings.updated_at) } : {}),
    ...(settings.test_model ? { test_model: String(settings.test_model) } : {}),
  };
}

export function writeAiSettings(nextSettings: AiSettings): AiSettings {
  const promptModel = nextSettings.prompt_model;
  const botModel = nextSettings.bot_model;
  if (!promptModel || !botModel) {
    throw new Error('prompt_model and bot_model are required');
  }
  const payload: AiSettings = {
    prompt_model: String(promptModel),
    bot_model: String(botModel),
    provider: nextSettings.provider || 'hydra',
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

export function getPromptModel(): string {
  return readAiSettings().prompt_model;
}

export function getBotModel(): string {
  return readAiSettings().bot_model;
}

export function getHydraConfig(): { apiKey: string; baseUrl: string } {
  const apiKey = process.env.HYDRA_API_KEY;
  if (!apiKey) {
    throw new Error('HYDRA_API_KEY not configured');
  }
  const baseUrl = process.env.HYDRA_BASE_URL || HYDRA_BASE_URL;
  return { apiKey, baseUrl };
}

export default {
  SETTINGS_PATH,
  readAiSettings,
  writeAiSettings,
  getPromptModel,
  getBotModel,
  getHydraConfig,
};
