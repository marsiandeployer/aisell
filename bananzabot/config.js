"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_DAYS_LIMIT = exports.FREE_MESSAGE_LIMIT = exports.MAX_HISTORY = exports.CHAT_HISTORIES_DIR = exports.USER_DATA_DIR = exports.BASE_DIR = exports.NAMEPROMPT = void 0;
exports.getNamePrompt = getNamePrompt;
exports.getUserDataDir = getUserDataDir;
exports.getChatHistoriesDir = getChatHistoriesDir;
exports.getMaxHistory = getMaxHistory;
exports.getFreeMessageLimit = getFreeMessageLimit;
exports.getFreeDaysLimit = getFreeDaysLimit;
exports.reloadConfig = reloadConfig;
var path = require("path");
function getNamePrompt() {
    return process.env.NAMEPROMPT || 'calories';
}
function getBaseDir() {
    return path.join(__dirname, 'user_data');
}
function getUserDataDir() {
    return path.join(getBaseDir(), getNamePrompt());
}
function getChatHistoriesDir() {
    return path.join(getUserDataDir(), 'chat_histories');
}
function getMaxHistory() {
    return 20;
}
function getFreeMessageLimit() {
    var raw = process.env.FREE_MESSAGE_LIMIT;
    if (raw === undefined)
        return null;
    var parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0)
        return null;
    return parsed;
}
function getFreeDaysLimit() {
    var raw = process.env.FREE_DAYS_LIMIT;
    if (raw === undefined)
        return null;
    var parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0)
        return null;
    return parsed;
}
exports.NAMEPROMPT = getNamePrompt();
exports.BASE_DIR = getBaseDir();
exports.USER_DATA_DIR = getUserDataDir();
exports.CHAT_HISTORIES_DIR = getChatHistoriesDir();
exports.MAX_HISTORY = getMaxHistory();
exports.FREE_MESSAGE_LIMIT = getFreeMessageLimit();
exports.FREE_DAYS_LIMIT = getFreeDaysLimit();
function reloadConfig() {
    exports.NAMEPROMPT = getNamePrompt();
    exports.BASE_DIR = getBaseDir();
    exports.USER_DATA_DIR = getUserDataDir();
    exports.CHAT_HISTORIES_DIR = getChatHistoriesDir();
    exports.MAX_HISTORY = getMaxHistory();
    exports.FREE_MESSAGE_LIMIT = getFreeMessageLimit();
    exports.FREE_DAYS_LIMIT = getFreeDaysLimit();
    return {
        NAMEPROMPT: exports.NAMEPROMPT,
        USER_DATA_DIR: exports.USER_DATA_DIR,
        CHAT_HISTORIES_DIR: exports.CHAT_HISTORIES_DIR,
        MAX_HISTORY: exports.MAX_HISTORY,
        FREE_MESSAGE_LIMIT: exports.FREE_MESSAGE_LIMIT,
        FREE_DAYS_LIMIT: exports.FREE_DAYS_LIMIT,
    };
}
exports.default = {
    getNamePrompt: getNamePrompt,
    getUserDataDir: getUserDataDir,
    getChatHistoriesDir: getChatHistoriesDir,
    getMaxHistory: getMaxHistory,
    getFreeMessageLimit: getFreeMessageLimit,
    getFreeDaysLimit: getFreeDaysLimit,
    NAMEPROMPT: exports.NAMEPROMPT,
    USER_DATA_DIR: exports.USER_DATA_DIR,
    CHAT_HISTORIES_DIR: exports.CHAT_HISTORIES_DIR,
    MAX_HISTORY: exports.MAX_HISTORY,
    FREE_MESSAGE_LIMIT: exports.FREE_MESSAGE_LIMIT,
    FREE_DAYS_LIMIT: exports.FREE_DAYS_LIMIT,
    reloadConfig: reloadConfig,
};
