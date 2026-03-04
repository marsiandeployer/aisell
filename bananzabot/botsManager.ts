import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Polyfill __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type BotInfo = {
    username?: string;
    first_name?: string;
    id?: string | number;
};

type BotRecord = {
    bot_id: string;
    api_key: string;
    created_at: string;
    user_id: string;
    conversation_history: unknown[];
    prompt: string;
    status: string;
    nameprompt: string;
    username: string | null;
    first_name: string | null;
    telegram_id: string | number | null;
    notifications: {
        sendPrivateMessages: boolean;
        notificationChannel: string;
        [key: string]: unknown;
    };
    updated_at?: string;
};

type DedupeSummary = {
    changed: boolean;
    duplicateGroups: number;
    keptBotIds: string[];
    stoppedBotIds: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toTimestamp(value: unknown): number {
    if (typeof value !== 'string' || !value) return 0;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : 0;
}

function botRecency(bot: BotRecord): number {
    return Math.max(toTimestamp(bot.updated_at), toTimestamp(bot.created_at));
}

function findNewestBotIndexByApiKey(bots: BotRecord[], apiKey: string): number {
    let bestIdx = -1;
    let bestTs = -1;
    for (let i = 0; i < bots.length; i += 1) {
        const bot = bots[i];
        if (!bot || bot.api_key !== apiKey) continue;
        const ts = botRecency(bot);
        if (bestIdx === -1 || ts >= bestTs) {
            bestIdx = i;
            bestTs = ts;
        }
    }
    return bestIdx;
}

function readBotsArray(value: unknown): BotRecord[] {
    if (!Array.isArray(value)) return [];
    const out: BotRecord[] = [];
    for (const item of value) {
        if (!isRecord(item)) continue;
        const bot_id = typeof item.bot_id === 'string' ? item.bot_id : null;
        const api_key = typeof item.api_key === 'string' ? item.api_key : null;
        const user_id = typeof item.user_id === 'string' ? item.user_id : null;
        const created_at = typeof item.created_at === 'string' ? item.created_at : new Date().toISOString();
        const prompt = typeof item.prompt === 'string' ? item.prompt : '';
        const status = typeof item.status === 'string' ? item.status : 'pending_deploy';
        const nameprompt = typeof item.nameprompt === 'string' ? item.nameprompt : `bot_${Date.now()}`;
        if (!bot_id || !api_key || !user_id) continue;
        const normalized: BotRecord = {
            bot_id,
            api_key,
            created_at,
            user_id,
            conversation_history: Array.isArray(item.conversation_history) ? item.conversation_history : [],
            prompt,
            status,
            nameprompt,
            username: item.username === null || typeof item.username === 'string' ? (item.username as string | null) : null,
            first_name: item.first_name === null || typeof item.first_name === 'string' ? (item.first_name as string | null) : null,
            telegram_id: item.telegram_id === null || typeof item.telegram_id === 'string' || typeof item.telegram_id === 'number'
                ? (item.telegram_id as string | number | null)
                : null,
            notifications: isRecord(item.notifications)
                ? ({ sendPrivateMessages: item.notifications.sendPrivateMessages !== false, notificationChannel: String(item.notifications.notificationChannel ?? user_id), ...item.notifications } as BotRecord['notifications'])
                : { sendPrivateMessages: true, notificationChannel: user_id },
        };
        if (typeof item.updated_at === 'string') {
            normalized.updated_at = item.updated_at;
        }
        out.push(normalized);
    }
    return out;
}

export default class BotsManager {
    private botsDbPath: string;

    constructor() {
        this.botsDbPath = path.join(__dirname, 'bots_database', 'bots.json');
        this.ensureDatabase();
    }

    ensureDatabase() {
        const dir = path.dirname(this.botsDbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.botsDbPath)) {
            fs.writeFileSync(this.botsDbPath, JSON.stringify([], null, 2));
        }
    }

    loadBots(): BotRecord[] {
        try {
            const data = fs.readFileSync(this.botsDbPath, 'utf8');
            return readBotsArray(JSON.parse(data) as unknown);
        } catch (error) {
            console.error('Error loading bots database:', error);
            return [];
        }
    }

    saveBots(bots: BotRecord[]): void {
        try {
            fs.writeFileSync(this.botsDbPath, JSON.stringify(bots, null, 2));
        } catch (error) {
            console.error('Error saving bots database:', error);
            throw error;
        }
    }

    // CHANGE: Added notifications parameter to bot configuration
    // WHY: Support sending notifications to user's DM and admin channels
    // REF: #17
    // CHANGE: Added botInfo parameter to save username and other metadata
    // WHY: Need to display username instead of bot_id and generate links
    // REF: User request - показывать username вместо bot_id
    createBot(
        userId: string | number,
        apiKey: string,
        prompt: string,
        conversationHistory: unknown[],
        notifications: Record<string, unknown> | null = null,
        botInfo: BotInfo | null = null
    ): BotRecord {
        const bots = this.loadBots();
        const existingIdx = findNewestBotIndexByApiKey(bots, apiKey);
        const now = new Date().toISOString();

        const defaultNotifications = {
            sendPrivateMessages: true,
            notificationChannel: userId.toString()
        };

        if (existingIdx >= 0) {
            const existing = bots[existingIdx];
            if (!existing) {
                throw new Error('Inconsistent bots database state: existing bot index not found');
            }
            existing.user_id = userId.toString();
            existing.prompt = prompt;
            existing.conversation_history = conversationHistory;
            existing.status = 'pending_deploy';
            existing.updated_at = now;

            if (botInfo && typeof botInfo.username === 'string') existing.username = botInfo.username;
            if (botInfo && typeof botInfo.first_name === 'string') existing.first_name = botInfo.first_name;
            if (botInfo && (typeof botInfo.id === 'string' || typeof botInfo.id === 'number')) existing.telegram_id = botInfo.id;

            const baseNotifications = isRecord(existing.notifications)
                ? { ...defaultNotifications, ...existing.notifications }
                : { ...defaultNotifications };
            existing.notifications = notifications ? { ...baseNotifications, ...notifications } : baseNotifications;

            bots[existingIdx] = existing;
            this.saveBots(bots);
            return existing;
        }

        const botId = Date.now().toString();
        const nameprompt = `bot_${botId}`;

        const newBot = {
            bot_id: botId,
            api_key: apiKey,
            created_at: now,
            user_id: userId.toString(),
            conversation_history: conversationHistory,
            prompt: prompt,
            status: 'pending_deploy',
            nameprompt: nameprompt,
            // CHANGE: Add bot metadata from Telegram API
            // WHY: Store username, first_name, telegram_id for display
            // REF: User request - показывать username
            username: botInfo && typeof botInfo.username === 'string' ? botInfo.username : null,
            first_name: botInfo && typeof botInfo.first_name === 'string' ? botInfo.first_name : null,
            telegram_id: botInfo && (typeof botInfo.id === 'string' || typeof botInfo.id === 'number') ? botInfo.id : null,
            // CHANGE: Add notifications config
            // WHY: Store notification settings for each bot
            // REF: #17
            notifications: notifications ? { ...defaultNotifications, ...notifications } : defaultNotifications
        };

        bots.push(newBot);
        this.saveBots(bots);

        return newBot;
    }

    getBotById(botId: string): BotRecord | undefined {
        const bots = this.loadBots();
        return bots.find(bot => bot.bot_id === botId);
    }

    getBotsByUserId(userId: string | number): BotRecord[] {
        const bots = this.loadBots();
        return bots.filter(bot => bot.user_id === userId.toString());
    }

    // CHANGE: Added method to find bot by API key
    // WHY: Need to check if bot with same API token already exists to prevent conflicts
    // QUOTE(ТЗ): "Хм так это от наших кл клиентов токены? Надо тогда отключать старых ботов если кидают тот же апи ключ"
    // REF: #15
    getBotByApiKey(apiKey: string): BotRecord | undefined {
        const bots = this.loadBots();
        const idx = findNewestBotIndexByApiKey(bots, apiKey);
        return idx >= 0 ? bots[idx] : undefined;
    }

    ensureUniqueActiveBotsByApiKey(): DedupeSummary {
        const bots = this.loadBots();
        const activeByApi = new Map<string, BotRecord[]>();

        for (const bot of bots) {
            if (bot.status !== 'active') continue;
            const list = activeByApi.get(bot.api_key) || [];
            list.push(bot);
            activeByApi.set(bot.api_key, list);
        }

        const now = new Date().toISOString();
        const keptBotIds: string[] = [];
        const stoppedBotIds: string[] = [];
        let duplicateGroups = 0;
        let changed = false;

        for (const list of activeByApi.values()) {
            if (list.length <= 1) {
                const only = list[0];
                if (only) keptBotIds.push(only.bot_id);
                continue;
            }
            duplicateGroups += 1;
            const sorted = [...list].sort((a, b) => botRecency(b) - botRecency(a));
            const keeper = sorted[0];
            if (!keeper) continue;
            keptBotIds.push(keeper.bot_id);

            for (let i = 1; i < sorted.length; i += 1) {
                const dup = sorted[i];
                if (!dup) continue;
                dup.status = 'stopped';
                dup.updated_at = now;
                stoppedBotIds.push(dup.bot_id);
                changed = true;
            }
        }

        if (changed) {
            this.saveBots(bots);
        }

        return {
            changed,
            duplicateGroups,
            keptBotIds,
            stoppedBotIds
        };
    }

    updateBotStatus(botId: string, status: string): boolean {
        const bots = this.loadBots();
        const bot = bots.find(b => b.bot_id === botId);
        if (bot) {
            bot.status = status;
            bot.updated_at = new Date().toISOString();
            this.saveBots(bots);
            return true;
        }
        return false;
    }

    deleteBot(botId: string): boolean {
        const bots = this.loadBots();
        const filteredBots = bots.filter(bot => bot.bot_id !== botId);
        this.saveBots(filteredBots);
        return bots.length !== filteredBots.length;
    }
}
