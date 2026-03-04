import * as fs from 'fs';
import * as path from 'path';

import type BotsManager from './botsManager';
import type BotInstanceManager from './botInstanceManager';

function asErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

export default class BotDeployer {
    private botsManager: BotsManager;
    private botInstanceManager: BotInstanceManager;

    constructor(botsManager: BotsManager, botInstanceManager: BotInstanceManager) {
        this.botsManager = botsManager;
        this.botInstanceManager = botInstanceManager;
    }

    async deployBot(botId: string): Promise<{ success: boolean; botId: string; nameprompt?: string; message?: string; error?: string }> {
        try {
            const bot = this.botsManager.getBotById(botId);
            if (!bot) {
                throw new Error(`Bot ${botId} not found in database`);
            }

            console.log(`[Deploy] Starting deployment for bot ${botId} (${bot.nameprompt})`);

            // Update status
            this.botsManager.updateBotStatus(botId, 'deploying');

            // Start bot instance
            const result = await this.botInstanceManager.startBot(bot);

            if (result.success) {
                // Update status to active
                this.botsManager.updateBotStatus(botId, 'active');

                console.log(`[Deploy] ✅ Bot ${bot.nameprompt} deployed successfully!`);

                return {
                    success: true,
                    botId: botId,
                    nameprompt: bot.nameprompt,
                    message: `Bot ${bot.nameprompt} deployed and started successfully`
                };
            } else {
                throw new Error(result.error || 'Failed to start bot instance');
            }

        } catch (error) {
            console.error(`[Deploy] Error deploying bot ${botId}:`, error);

            // Update status to failed
            try {
                this.botsManager.updateBotStatus(botId, 'deploy_failed');
            } catch (e) {
                console.error(`[Deploy] Could not update bot status:`, e);
            }

            return {
                success: false,
                botId: botId,
                error: asErrorMessage(error)
            };
        }
    }

    async stopBot(botId: string): Promise<{ success: boolean; message?: string; error?: string }> {
        try {
            const bot = this.botsManager.getBotById(botId);
            if (!bot) {
                throw new Error(`Bot ${botId} not found`);
            }

            console.log(`[Deploy] Stopping bot ${bot.nameprompt}...`);

            const result = await this.botInstanceManager.stopBot(botId);

            if (result.success) {
                this.botsManager.updateBotStatus(botId, 'stopped');

                return {
                    success: true,
                    message: `Bot ${bot.nameprompt} stopped successfully`
                };
            } else {
                throw new Error(result.error || 'Failed to stop bot');
            }

        } catch (error) {
            console.error(`[Deploy] Error stopping bot ${botId}:`, error);
            return {
                success: false,
                error: asErrorMessage(error)
            };
        }
    }

    async restartBot(botId: string): Promise<{ success: boolean; message?: string; error?: string }> {
        try {
            const bot = this.botsManager.getBotById(botId);
            if (!bot) {
                throw new Error(`Bot ${botId} not found`);
            }

            console.log(`[Deploy] Restarting bot ${bot.nameprompt}...`);

            const result = await this.botInstanceManager.restartBot(botId, bot);

            if (result.success) {
                this.botsManager.updateBotStatus(botId, 'active');

                return {
                    success: true,
                    message: `Bot ${bot.nameprompt} restarted successfully`
                };
            } else {
                throw new Error(result.error || 'Failed to restart bot');
            }

        } catch (error) {
            console.error(`[Deploy] Error restarting bot ${botId}:`, error);
            return {
                success: false,
                error: asErrorMessage(error)
            };
        }
    }

    async deleteBot(botId: string): Promise<{ success: boolean; message?: string; error?: string }> {
        try {
            const bot = this.botsManager.getBotById(botId);
            if (!bot) {
                throw new Error(`Bot ${botId} not found`);
            }

            console.log(`[Deploy] Deleting bot ${bot.nameprompt}...`);

            // Stop bot if running
            await this.botInstanceManager.stopBot(botId);

            // Remove user data directory
            const userDataDir = path.join(__dirname, 'user_data', bot.nameprompt);
            if (fs.existsSync(userDataDir)) {
                fs.rmSync(userDataDir, { recursive: true, force: true });
            }

            // Remove from database
            this.botsManager.deleteBot(botId);

            console.log(`[Deploy] ✅ Bot ${bot.nameprompt} deleted successfully`);

            return {
                success: true,
                message: `Bot ${bot.nameprompt} deleted successfully`
            };

        } catch (error) {
            console.error(`[Deploy] Error deleting bot ${botId}:`, error);
            return {
                success: false,
                error: asErrorMessage(error)
            };
        }
    }

    getBotStatus(botId: string): unknown {
        return this.botInstanceManager.getBotStatus(botId);
    }

    getSystemStats(): { activeBotsCount: number; activeBots: unknown[] } {
        return {
            activeBotsCount: this.botInstanceManager.getActiveBotsCount(),
            activeBots: this.botInstanceManager.getAllActiveBots()
        };
    }
}
