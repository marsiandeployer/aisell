#!/usr/bin/env node

/**
 * Migration script: Split message_history.json into per-chat files
 *
 * Old structure:
 *   data/history/message_history.json
 *
 * New structure:
 *   data/history/chats/{chat_id}.json
 *
 * CHANGE: Split monolithic message history into per-chat files
 * WHY: Better organization, easier to manage, smaller file sizes
 * REF: User request "message_history.json разбей по папочкам юзеров"
 */

const fs = require('fs');
const path = require('path');

const OLD_HISTORY_PATH = path.join(__dirname, '../data/history/message_history.json');
const CHATS_DIR = path.join(__dirname, '../data/history/chats');

console.log('🔄 Starting message history migration...\n');

// Read old history file
if (!fs.existsSync(OLD_HISTORY_PATH)) {
  console.error('❌ Old history file not found:', OLD_HISTORY_PATH);
  process.exit(1);
}

const oldHistory = JSON.parse(fs.readFileSync(OLD_HISTORY_PATH, 'utf8'));
const chatIds = Object.keys(oldHistory);

console.log(`📊 Found ${chatIds.length} chats in old history file`);

// Create chats directory if not exists
if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR, { recursive: true });
  console.log('✅ Created chats directory');
}

// Split into per-chat files
let migratedChats = 0;
for (const chatId of chatIds) {
  const chatHistory = oldHistory[chatId];
  const chatFilePath = path.join(CHATS_DIR, `${chatId}.json`);

  fs.writeFileSync(chatFilePath, JSON.stringify(chatHistory, null, 2));
  console.log(`✅ Migrated chat ${chatId}: ${chatHistory.length} messages`);
  migratedChats++;
}

// Backup old file
const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
const backupPath = path.join(__dirname, '../data/history', `message_history_backup${timestamp}.json`);
fs.renameSync(OLD_HISTORY_PATH, backupPath);
console.log(`\n📦 Backed up old history to: ${path.basename(backupPath)}`);

console.log(`\n✅ Migration complete: ${migratedChats}/${chatIds.length} chats migrated`);
console.log(`📁 New structure: data/history/chats/{chat_id}.json`);
