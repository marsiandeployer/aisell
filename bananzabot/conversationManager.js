const fs = require('fs');
const path = require('path');
const conversationStore = require('./conversationStore');

class ConversationManager {
    constructor() {
        this.conversationsPath = path.join(__dirname, 'user_data', 'conversations.json'); // legacy (archived after migration)
        this.conversationsBaseDir = conversationStore.getBaseDir();
        this.ensureConversationsStorage();
    }

    ensureConversationsStorage() {
        const dir = path.dirname(this.conversationsPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // One-time migration from monolithic file to per-user folders.
        // Keep legacy file in place (read-only fallback) to avoid breaking external tools.
        conversationStore.migrateLegacyConversationsIfNeeded({ legacyPath: this.conversationsPath, archiveLegacy: false });
        conversationStore.ensureDir(this.conversationsBaseDir);
    }

    loadUserConversationFromLegacy(userId) {
        try {
            if (!fs.existsSync(this.conversationsPath)) {
                return null;
            }
            const raw = fs.readFileSync(this.conversationsPath, 'utf8');
            const conversations = JSON.parse(raw);
            if (!conversations || typeof conversations !== 'object' || Array.isArray(conversations)) {
                return null;
            }
            return conversations[userId] || null;
        } catch (error) {
            console.error('Error loading legacy conversations:', error.message);
            return null;
        }
    }

    loadUserConversation(userId) {
        const filePath = conversationStore.getMainConversationPath(userId);
        try {
            const convo = conversationStore.readJsonIfExists(filePath);
            if (convo && typeof convo === 'object') {
                return convo;
            }
        } catch (error) {
            console.error('Error loading conversation:', error.message);
        }
        // Fallback: legacy monolithic file, but do not keep writing to it.
        const legacy = this.loadUserConversationFromLegacy(String(userId));
        if (legacy && typeof legacy === 'object') {
            try {
                conversationStore.writeJsonAtomic(filePath, legacy);
            } catch (error) {
                console.error('Error persisting legacy conversation into per-user file:', error.message);
            }
            return legacy;
        }
        return null;
    }

    saveUserConversation(userId, conversation) {
        const filePath = conversationStore.getMainConversationPath(userId);
        conversationStore.writeJsonAtomic(filePath, conversation);
    }

    getUserConversation(userId) {
        const userKey = String(userId);
        const existing = this.loadUserConversation(userKey);
        return existing || {
            stage: 'start',
            messages: [],
            product_description: null,
            generated_prompt: null
        };
    }

    updateUserConversation(userId, updates) {
        const userKey = String(userId);
        const next = {
            ...this.getUserConversation(userKey),
            ...updates
        };
        this.saveUserConversation(userKey, next);
    }

    addMessage(userId, role, content) {
        const userKey = String(userId);
        const conversation = this.getUserConversation(userKey);
        conversation.messages.push({
            role,
            content,
            timestamp: new Date().toISOString()
        });
        this.saveUserConversation(userKey, conversation);

        // CHANGE: Reset qualification when user sends a new message
        // WHY: Re-qualify lead after conversation continues
        // REF: user request - "если человек пишет еще что то то обнуляй квалификацию"
        if (role === 'user') {
            this.resetCrmQualification(userKey);
        }
    }

    resetCrmQualification(userId) {
        const crmStatePath = path.join(__dirname, 'user_data', 'crm_followups.json');
        try {
            if (!fs.existsSync(crmStatePath)) {
                return;
            }
            const raw = fs.readFileSync(crmStatePath, 'utf8');
            const crmState = JSON.parse(raw);

            if (crmState[userId] && crmState[userId].qualification) {
                delete crmState[userId].qualification;
                fs.writeFileSync(crmStatePath, JSON.stringify(crmState, null, 2));
                console.log(`[CRM] Reset qualification for user ${userId} due to new message`);
            }
        } catch (error) {
            console.error('[CRM] Error resetting qualification:', error.message);
        }
    }

    clearUserConversation(userId) {
        // CHANGE: Preserve referral data when clearing conversation
        // WHY: User request - в профиль юзеру писать откуда он пришел (не удалять при /start)
        // REF: User request
        const userKey = String(userId);
        const existingUser = this.loadUserConversation(userKey);

        // Save referral data if exists
        const referralData = existingUser ? {
            referralSource: existingUser.referralSource,
            referralParam: existingUser.referralParam,
            referralDate: existingUser.referralDate
        } : {};

        // Delete per-user file.
        const convoPath = conversationStore.getMainConversationPath(userKey);
        try {
            if (fs.existsSync(convoPath)) {
                fs.unlinkSync(convoPath);
            }
        } catch (error) {
            console.error('Error deleting conversation file:', error.message);
        }

        // Recreate base structure only if we have referral data to preserve.
        // This keeps storage minimal while still honoring "do not delete referral source".
        if (referralData.referralSource) {
            this.saveUserConversation(userKey, {
                stage: 'start',
                messages: [],
                product_description: null,
                generated_prompt: null,
                ...referralData
            });
        }
    }

    getUserStage(userId) {
        return this.getUserConversation(userId).stage;
    }

    setUserStage(userId, stage) {
        this.updateUserConversation(userId, { stage });
    }

    // CHANGE: Added method to parse notification commands from AI responses
    // WHY: Extract [NOTIFY_USER] and [NOTIFY_ADMIN] commands from bot responses
    // REF: #17
    parseNotificationCommands(aiResponse) {
        // CHANGE: Fixed regex to properly extract and remove notification blocks
        // WHY: Previous regex failed when [NOTIFY_ADMIN] was at start or had multiline content
        // REF: User complaint - [NOTIFY_ADMIN] text shown to end users

        // Extract notification content (everything after tag until next tag or end)
        const notifyUserMatch = aiResponse.match(/\[NOTIFY_USER\]([\s\S]*?)(?=\[NOTIFY_ADMIN\]|\[NOTIFY_USER\]|$)/);
        const notifyAdminMatch = aiResponse.match(/\[NOTIFY_ADMIN\]([\s\S]*?)(?=\[NOTIFY_USER\]|\[NOTIFY_ADMIN\]|$)/);

        // Remove ALL notification blocks completely (including tags and content)
        // Use [\s\S] instead of . to match newlines
        let chatMessage = aiResponse
            .replace(/\[NOTIFY_USER\][\s\S]*?(?=\[NOTIFY_ADMIN\]|\[NOTIFY_USER\]|$)/g, '')
            .replace(/\[NOTIFY_ADMIN\][\s\S]*?(?=\[NOTIFY_USER\]|\[NOTIFY_ADMIN\]|$)/g, '')
            .trim();

        // If nothing left after removing notifications, extract the last line(s) that are not part of notifications
        if (!chatMessage) {
            // Split by notification tags and take the last non-empty part
            const parts = aiResponse.split(/\[NOTIFY_(?:USER|ADMIN)\]/);
            chatMessage = parts[0].trim() || 'Сообщение отправлено администратору.';
        }

        return {
            chatMessage: chatMessage,
            userNotification: notifyUserMatch ? notifyUserMatch[1].trim() : null,
            adminNotification: notifyAdminMatch ? notifyAdminMatch[1].trim() : null
        };
    }

    // CHANGE: Added method to send notifications via bot instance
    // WHY: Send notifications to user DM and admin channel based on bot config
    // REF: #17
    async sendNotifications(bot, userId, chatId, notifications, notificationConfig) {
        const results = {
            userNotificationSent: false,
            adminNotificationSent: false,
            errors: []
        };

        // Send private message to user
        if (notificationConfig.sendPrivateMessages && notifications.userNotification) {
            try {
                await bot.sendMessage(userId, notifications.userNotification);
                results.userNotificationSent = true;
                console.log(`[Notification] Sent private message to user ${userId}`);
            } catch (error) {
                // User has not started bot - can't send private message
                if (error.response && error.response.body && error.response.body.description) {
                    const errorDesc = error.response.body.description;
                    if (errorDesc.includes('bot was blocked') || errorDesc.includes('user is deactivated') || errorDesc.includes("can't initiate conversation")) {
                        console.log(`[Notification] Cannot send private message to user ${userId}: ${errorDesc}`);
                        results.errors.push('Для получения уведомлений напишите боту в личку');
                    } else {
                        console.error(`[Notification] Error sending private message to user ${userId}:`, errorDesc);
                        results.errors.push(errorDesc);
                    }
                } else {
                    console.error(`[Notification] Error sending private message to user ${userId}:`, error.message);
                    results.errors.push(error.message);
                }
            }
        }

        // Send notification to admin channel
        if (notificationConfig.notificationChannel && notifications.adminNotification) {
            try {
                // CHANGE: Add user ID to admin notification for reply forwarding
                // WHY: Admin needs to see user ID to forward replies back to specific user
                // REF: Reply forwarding feature - need to extract user ID from notification
                const notificationWithUserId = `${notifications.adminNotification}\n\n👤 User ID: ${userId}`;

                await bot.sendMessage(
                    notificationConfig.notificationChannel,
                    notificationWithUserId
                );
                results.adminNotificationSent = true;
                console.log(`[Notification] Sent notification to channel ${notificationConfig.notificationChannel}`);
            } catch (error) {
                const errorDesc = error.response && error.response.body && error.response.body.description
                    ? error.response.body.description
                    : error.message;
                console.error(`[Notification] Error sending to channel ${notificationConfig.notificationChannel}:`, errorDesc);
                results.errors.push(`Ошибка отправки в канал: ${errorDesc}`);
            }
        }

        return results;
    }
}

module.exports = ConversationManager;
