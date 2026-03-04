import * as fs from 'fs';
import * as path from 'path';

export function sanitizeSegment(value: string | number): string {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function readJsonIfExists(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as unknown;
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

export function getBaseDir(): string {
  return path.join(__dirname, 'user_data', 'conversations');
}

export function getUserDir(userId: string | number): string {
  return path.join(getBaseDir(), sanitizeSegment(userId));
}

export function getMainConversationPath(userId: string | number): string {
  return path.join(getUserDir(userId), 'conversation.json');
}

export function getTestDir(originalUserId: string | number): string {
  return path.join(getUserDir(originalUserId), 'tests');
}

export function getTestSessionPath(originalUserId: string | number, testerUserId: string | number): string {
  return path.join(getTestDir(originalUserId), `${sanitizeSegment(testerUserId)}.json`);
}

export function listUserDirs(): string[] {
  const baseDir = getBaseDir();
  if (!fs.existsSync(baseDir)) {
    return [];
  }
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function readAllMainConversations(): Record<string, unknown> {
  const conversations: Record<string, unknown> = {};
  for (const userId of listUserDirs()) {
    const convoPath = getMainConversationPath(userId);
    if (!fs.existsSync(convoPath)) {
      continue;
    }
    try {
      const convo = readJsonIfExists(convoPath);
      if (convo && typeof convo === 'object' && !Array.isArray(convo)) {
        conversations[userId] = convo;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Keep admin UI resilient: skip broken entries rather than crashing all.
      // eslint-disable-next-line no-console
      console.error(`[ConversationStore] Failed to parse ${convoPath}:`, msg);
    }
  }
  return conversations;
}

export type ListedTestSession = {
  testerId: string;
  filePath: string;
  test_messages: unknown[];
};

export function listTestSessions(originalUserId: string | number): ListedTestSession[] {
  const testDir = getTestDir(originalUserId);
  if (!fs.existsSync(testDir)) {
    return [];
  }
  const entries = fs
    .readdirSync(testDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name);

  const sessions: ListedTestSession[] = [];
  for (const fileName of entries) {
    const testerId = fileName.replace(/\.json$/, '');
    const filePath = path.join(testDir, fileName);
    try {
      const payload = readJsonIfExists(filePath);
      const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
      const rawMsgs = obj.test_messages;
      sessions.push({
        testerId,
        filePath,
        test_messages: Array.isArray(rawMsgs) ? rawMsgs : [],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error(`[ConversationStore] Failed to parse ${filePath}:`, msg);
    }
  }

  // Most recent first (based on last message timestamp).
  sessions.sort((a, b) => {
    const aLast = a.test_messages.length
      ? Date.parse(String((a.test_messages[a.test_messages.length - 1] as Record<string, unknown> | undefined)?.timestamp ?? ''))
      : 0;
    const bLast = b.test_messages.length
      ? Date.parse(String((b.test_messages[b.test_messages.length - 1] as Record<string, unknown> | undefined)?.timestamp ?? ''))
      : 0;
    return bLast - aLast;
  });
  return sessions;
}

export type MigrationResult =
  | { migrated: false; reason: string }
  | { migrated: true; mainCount: number; testCount: number; miscCount: number };

export function migrateLegacyConversationsIfNeeded(options: { legacyPath?: string; archiveLegacy?: boolean } = {}): MigrationResult {
  const legacyPath = options.legacyPath || path.join(__dirname, 'user_data', 'conversations.json');
  const baseDir = getBaseDir();
  const shouldArchiveLegacy = options.archiveLegacy !== false;

  if (!fs.existsSync(legacyPath)) {
    return { migrated: false, reason: 'legacy_missing' };
  }

  // If we already have per-user conversations, do not auto-migrate again.
  if (fs.existsSync(baseDir)) {
    const hasAny = listUserDirs().length > 0;
    if (hasAny) {
      return { migrated: false, reason: 'already_migrated' };
    }
  }

  const legacyRaw = fs.readFileSync(legacyPath, 'utf8');
  let legacy: unknown;
  try {
    legacy = JSON.parse(legacyRaw) as unknown;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { migrated: false, reason: `legacy_invalid_json:${msg}` };
  }

  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
    return { migrated: false, reason: 'legacy_not_object' };
  }

  ensureDir(baseDir);

  const entries = Object.entries(legacy as Record<string, unknown>);
  let mainCount = 0;
  let testCount = 0;
  let miscCount = 0;

  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    // Main conversation: key is a numeric Telegram userId.
    if (/^\d+$/.test(key)) {
      const outPath = getMainConversationPath(key);
      writeJsonAtomic(outPath, value);
      mainCount += 1;
      continue;
    }

    // Test conversation session (legacy): "<testerId>_test_<originalUserId>"
    const match = key.match(/^(\d+)_test_(\d+)$/);
    if (match) {
      const testerId = match[1] ?? '';
      const originalUserId = match[2] ?? '';
      if (!testerId || !originalUserId) continue;
      const outPath = getTestSessionPath(originalUserId, testerId);
      const v = value as Record<string, unknown>;
      writeJsonAtomic(outPath, {
        test_messages: Array.isArray(v.test_messages) ? v.test_messages : [],
      });
      testCount += 1;
      continue;
    }

    // Anything else goes to a dedicated bucket to avoid losing data.
    const miscDir = path.join(baseDir, '_misc');
    ensureDir(miscDir);
    const outPath = path.join(miscDir, `${sanitizeSegment(key)}.json`);
    writeJsonAtomic(outPath, value);
    miscCount += 1;
  }

  if (shouldArchiveLegacy) {
    const archivePath = legacyPath.replace(/\.json$/, `.legacy.${Date.now()}.json`);
    try {
      fs.renameSync(legacyPath, archivePath);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error('[ConversationStore] Failed to archive legacy conversations.json:', msg);
    }
  }

  return { migrated: true, mainCount, testCount, miscCount };
}

export default {
  sanitizeSegment,
  ensureDir,
  readJsonIfExists,
  writeJsonAtomic,
  getBaseDir,
  getUserDir,
  getMainConversationPath,
  getTestDir,
  getTestSessionPath,
  listUserDirs,
  readAllMainConversations,
  listTestSessions,
  migrateLegacyConversationsIfNeeded,
};
