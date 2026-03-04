"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeSegment = sanitizeSegment;
exports.ensureDir = ensureDir;
exports.readJsonIfExists = readJsonIfExists;
exports.writeJsonAtomic = writeJsonAtomic;
exports.getBaseDir = getBaseDir;
exports.getUserDir = getUserDir;
exports.getMainConversationPath = getMainConversationPath;
exports.getTestDir = getTestDir;
exports.getTestSessionPath = getTestSessionPath;
exports.listUserDirs = listUserDirs;
exports.readAllMainConversations = readAllMainConversations;
exports.listTestSessions = listTestSessions;
exports.migrateLegacyConversationsIfNeeded = migrateLegacyConversationsIfNeeded;
var fs = require("fs");
var path = require("path");
function sanitizeSegment(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}
function readJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    var raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
}
function writeJsonAtomic(filePath, data) {
    var dir = path.dirname(filePath);
    ensureDir(dir);
    var tmpPath = "".concat(filePath, ".tmp");
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, filePath);
}
function getBaseDir() {
    return path.join(__dirname, 'user_data', 'conversations');
}
function getUserDir(userId) {
    return path.join(getBaseDir(), sanitizeSegment(userId));
}
function getMainConversationPath(userId) {
    return path.join(getUserDir(userId), 'conversation.json');
}
function getTestDir(originalUserId) {
    return path.join(getUserDir(originalUserId), 'tests');
}
function getTestSessionPath(originalUserId, testerUserId) {
    return path.join(getTestDir(originalUserId), "".concat(sanitizeSegment(testerUserId), ".json"));
}
function listUserDirs() {
    var baseDir = getBaseDir();
    if (!fs.existsSync(baseDir)) {
        return [];
    }
    return fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter(function (entry) { return entry.isDirectory(); })
        .map(function (entry) { return entry.name; });
}
function readAllMainConversations() {
    var conversations = {};
    for (var _i = 0, _a = listUserDirs(); _i < _a.length; _i++) {
        var userId = _a[_i];
        var convoPath = getMainConversationPath(userId);
        if (!fs.existsSync(convoPath)) {
            continue;
        }
        try {
            var convo = readJsonIfExists(convoPath);
            if (convo && typeof convo === 'object' && !Array.isArray(convo)) {
                conversations[userId] = convo;
            }
        }
        catch (error) {
            var msg = error instanceof Error ? error.message : String(error);
            // Keep admin UI resilient: skip broken entries rather than crashing all.
            // eslint-disable-next-line no-console
            console.error("[ConversationStore] Failed to parse ".concat(convoPath, ":"), msg);
        }
    }
    return conversations;
}
function listTestSessions(originalUserId) {
    var testDir = getTestDir(originalUserId);
    if (!fs.existsSync(testDir)) {
        return [];
    }
    var entries = fs
        .readdirSync(testDir, { withFileTypes: true })
        .filter(function (entry) { return entry.isFile() && entry.name.endsWith('.json'); })
        .map(function (entry) { return entry.name; });
    var sessions = [];
    for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
        var fileName = entries_1[_i];
        var testerId = fileName.replace(/\.json$/, '');
        var filePath = path.join(testDir, fileName);
        try {
            var payload = readJsonIfExists(filePath);
            var obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
            var rawMsgs = obj.test_messages;
            sessions.push({
                testerId: testerId,
                filePath: filePath,
                test_messages: Array.isArray(rawMsgs) ? rawMsgs : [],
            });
        }
        catch (error) {
            var msg = error instanceof Error ? error.message : String(error);
            // eslint-disable-next-line no-console
            console.error("[ConversationStore] Failed to parse ".concat(filePath, ":"), msg);
        }
    }
    // Most recent first (based on last message timestamp).
    sessions.sort(function (a, b) {
        var _a, _b, _c, _d;
        var aLast = a.test_messages.length
            ? Date.parse(String((_b = (_a = a.test_messages[a.test_messages.length - 1]) === null || _a === void 0 ? void 0 : _a.timestamp) !== null && _b !== void 0 ? _b : ''))
            : 0;
        var bLast = b.test_messages.length
            ? Date.parse(String((_d = (_c = b.test_messages[b.test_messages.length - 1]) === null || _c === void 0 ? void 0 : _c.timestamp) !== null && _d !== void 0 ? _d : ''))
            : 0;
        return bLast - aLast;
    });
    return sessions;
}
function migrateLegacyConversationsIfNeeded(options) {
    var _a, _b;
    if (options === void 0) { options = {}; }
    var legacyPath = options.legacyPath || path.join(__dirname, 'user_data', 'conversations.json');
    var baseDir = getBaseDir();
    var shouldArchiveLegacy = options.archiveLegacy !== false;
    if (!fs.existsSync(legacyPath)) {
        return { migrated: false, reason: 'legacy_missing' };
    }
    // If we already have per-user conversations, do not auto-migrate again.
    if (fs.existsSync(baseDir)) {
        var hasAny = listUserDirs().length > 0;
        if (hasAny) {
            return { migrated: false, reason: 'already_migrated' };
        }
    }
    var legacyRaw = fs.readFileSync(legacyPath, 'utf8');
    var legacy;
    try {
        legacy = JSON.parse(legacyRaw);
    }
    catch (error) {
        var msg = error instanceof Error ? error.message : String(error);
        return { migrated: false, reason: "legacy_invalid_json:".concat(msg) };
    }
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
        return { migrated: false, reason: 'legacy_not_object' };
    }
    ensureDir(baseDir);
    var entries = Object.entries(legacy);
    var mainCount = 0;
    var testCount = 0;
    var miscCount = 0;
    for (var _i = 0, entries_2 = entries; _i < entries_2.length; _i++) {
        var _c = entries_2[_i], key = _c[0], value = _c[1];
        if (!value || typeof value !== 'object') {
            continue;
        }
        // Main conversation: key is a numeric Telegram userId.
        if (/^\d+$/.test(key)) {
            var outPath_1 = getMainConversationPath(key);
            writeJsonAtomic(outPath_1, value);
            mainCount += 1;
            continue;
        }
        // Test conversation session (legacy): "<testerId>_test_<originalUserId>"
        var match = key.match(/^(\d+)_test_(\d+)$/);
        if (match) {
            var testerId = (_a = match[1]) !== null && _a !== void 0 ? _a : '';
            var originalUserId = (_b = match[2]) !== null && _b !== void 0 ? _b : '';
            if (!testerId || !originalUserId)
                continue;
            var outPath_2 = getTestSessionPath(originalUserId, testerId);
            var v = value;
            writeJsonAtomic(outPath_2, {
                test_messages: Array.isArray(v.test_messages) ? v.test_messages : [],
            });
            testCount += 1;
            continue;
        }
        // Anything else goes to a dedicated bucket to avoid losing data.
        var miscDir = path.join(baseDir, '_misc');
        ensureDir(miscDir);
        var outPath = path.join(miscDir, "".concat(sanitizeSegment(key), ".json"));
        writeJsonAtomic(outPath, value);
        miscCount += 1;
    }
    if (shouldArchiveLegacy) {
        var archivePath = legacyPath.replace(/\.json$/, ".legacy.".concat(Date.now(), ".json"));
        try {
            fs.renameSync(legacyPath, archivePath);
        }
        catch (error) {
            var msg = error instanceof Error ? error.message : String(error);
            // eslint-disable-next-line no-console
            console.error('[ConversationStore] Failed to archive legacy conversations.json:', msg);
        }
    }
    return { migrated: true, mainCount: mainCount, testCount: testCount, miscCount: miscCount };
}
exports.default = {
    sanitizeSegment: sanitizeSegment,
    ensureDir: ensureDir,
    readJsonIfExists: readJsonIfExists,
    writeJsonAtomic: writeJsonAtomic,
    getBaseDir: getBaseDir,
    getUserDir: getUserDir,
    getMainConversationPath: getMainConversationPath,
    getTestDir: getTestDir,
    getTestSessionPath: getTestSessionPath,
    listUserDirs: listUserDirs,
    readAllMainConversations: readAllMainConversations,
    listTestSessions: listTestSessions,
    migrateLegacyConversationsIfNeeded: migrateLegacyConversationsIfNeeded,
};
