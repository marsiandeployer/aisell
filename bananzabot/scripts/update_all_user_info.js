#!/usr/bin/env node
// CHANGE: Script to update userInfo for all existing users
// WHY: Backfill userInfo for users who registered before the feature was added
// REF: User request - "давай пройдись по всем лидам и пропиши"

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const CONVERSATIONS_DIR = path.join(__dirname, '..', 'user_data', 'conversations');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getUserInfo(userId, retryCount = 0) {
  try {
    const chat = await bot.getChat(userId);
    return {
      username: chat.username || undefined,
      firstName: chat.first_name || undefined,
      lastName: chat.last_name || undefined,
      fullName: [chat.first_name, chat.last_name].filter(Boolean).join(' ') || undefined
    };
  } catch (error) {
    // Handle rate limiting (429 Too Many Requests)
    if (error.response && error.response.statusCode === 429) {
      const retryAfter = error.response.body?.parameters?.retry_after || 30;
      console.log(`  ⏳ Rate limit hit for ${userId}, waiting ${retryAfter} seconds...`);
      await sleep(retryAfter * 1000);
      if (retryCount < 3) {
        return getUserInfo(userId, retryCount + 1);
      }
    }
    console.error(`  ❌ Failed to get info for ${userId}: ${error.message}`);
    return null;
  }
}

async function updateUserConversation(userId, userInfo) {
  const conversationPath = path.join(CONVERSATIONS_DIR, String(userId), 'conversation.json');

  if (!fs.existsSync(conversationPath)) {
    console.log(`  ⚠️  Conversation file not found for ${userId}`);
    return false;
  }

  try {
    const data = JSON.parse(fs.readFileSync(conversationPath, 'utf8'));

    // Check if userInfo already exists and is complete
    if (data.userInfo && data.userInfo.username) {
      console.log(`  ℹ️  User ${userId} already has userInfo, skipping`);
      return false;
    }

    // Update with new userInfo
    data.userInfo = userInfo;
    fs.writeFileSync(conversationPath, JSON.stringify(data, null, 2));
    console.log(`  ✅ Updated ${userId}: @${userInfo.username || 'no_username'} - ${userInfo.fullName || 'no_name'}`);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed to update ${userId}: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting user info update for all leads...\n');

  if (!fs.existsSync(CONVERSATIONS_DIR)) {
    console.error('❌ Conversations directory not found:', CONVERSATIONS_DIR);
    process.exit(1);
  }

  const userDirs = fs.readdirSync(CONVERSATIONS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map(entry => entry.name);

  console.log(`📊 Found ${userDirs.length} users\n`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < userDirs.length; i++) {
    const userId = userDirs[i];
    console.log(`[${i + 1}/${userDirs.length}] Processing user ${userId}...`);

    const userInfo = await getUserInfo(userId);
    if (!userInfo) {
      failed++;
      await sleep(100); // Small delay even on failure
      continue;
    }

    const success = await updateUserConversation(userId, userInfo);
    if (success) {
      updated++;
    } else {
      skipped++;
    }

    // Rate limit: No official limit for getChat, but using 1 req/sec to be safe
    // REF: https://core.telegram.org/bots/faq - no specific limits documented
    await sleep(1000);
  }

  console.log('\n' + '='.repeat(50));
  console.log('📈 Summary:');
  console.log(`  Total users: ${userDirs.length}`);
  console.log(`  ✅ Updated: ${updated}`);
  console.log(`  ℹ️  Skipped: ${skipped}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log('='.repeat(50));
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
