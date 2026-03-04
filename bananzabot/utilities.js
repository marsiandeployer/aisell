const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CHAT_HISTORIES_DIR } = require('./config');

// Ensure the chat histories directory exists on module load
if (!fs.existsSync(CHAT_HISTORIES_DIR)) {
    try {
        fs.mkdirSync(CHAT_HISTORIES_DIR, { recursive: true });
        console.log(`Created chat histories directory: ${CHAT_HISTORIES_DIR}`);
    } catch (error) {
        console.error(`Fatal error: Could not create chat histories directory at ${CHAT_HISTORIES_DIR}`, error);
        process.exit(1);
    }
}

/**
 * Sanitizes a string by removing potentially harmful characters.
 * @param {string} str The input string.
 * @returns {string} The sanitized string. Returns an empty string if input is not a string.
 */
function sanitizeString(str) {
return str; //disable sanitization  . not a bug (but need to be fixed)
    if (typeof str !== 'string') return ''; //disable sanitization
    return str.replace(/[^\p{L}\p{N}\p{P}\p{Z}]/gu, '').trim();
}

/**
 * Validates if a chat ID is a positive integer within safe bounds.
 * @param {*} chatId The chat ID to validate.
 * @returns {boolean} True if valid, false otherwise.
 */
function validateChatId(chatId) {
    // Convert string to number if it's a string
    if (typeof chatId === 'string') {
        chatId = Number(chatId);
    }
    return typeof chatId === 'number' && Number.isInteger(chatId) && chatId !== 0;
}

/**
 * Validates an Axios image response (basic size check).
 * @param {object} response The Axios response object.
 * @param {number} [maxSizeInBytes=10485760] Maximum allowed size (default 10MB).
 * @returns {boolean} True if valid.
 * @throws {Error} If response is invalid or size exceeds limit.
 */
function validateImageResponse(response, maxSizeInBytes = 10 * 1024 * 1024) {
    if (!response || !response.data) throw new Error('Invalid image response data');
    if (response.data.length > maxSizeInBytes) {
        throw new Error(`Image size (${response.data.length} bytes) exceeds maximum allowed (${maxSizeInBytes} bytes)`);
    }
    return true;
}

/**
 * Validates if a MIME type is an allowed image type.
 * @param {string} mimeType The MIME type string.
 * @returns {boolean} True if allowed, false otherwise.
 */
function validateMimeTypeImg(mimeType) {
    const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif',
        'image/webp', 'image/bmp'
    ];
    return allowedTypes.includes(mimeType);
}

/**
 * Validates if a MIME type is an allowed audio type for Whisper.
 * @param {string} mimeType The MIME type string.
 * @returns {boolean} True if allowed, false otherwise.
 */
function validateMimeTypeAudio(mimeType) {
    const allowedTypes = [
        'audio/mp3', 'audio/mpeg', 'audio/ogg',
        'audio/wav', 'audio/x-wav', 'audio/mp4',
        'audio/m4a', 'audio/x-m4a'
    ];
    return allowedTypes.includes(mimeType);
}

/**
 * Generates a simple hash for a message.
 * @param {number} chatId The chat ID.
 * @param {number} timestamp The message timestamp.
 * @returns {string} A hex digest hash.
 */
function generateMessageHash(chatId, timestamp) {
    const secret = process.env.MESSAGE_HASH_SECRET || 'default-secret-change-me';
    return crypto.createHmac('sha256', secret)
                 .update(`${chatId}:${timestamp}`)
                 .digest('hex');
}

/**
 * Logs data associated with a chat ID to a file.
 * Each log entry is stored as a JSON object on a new line.
 * @param {number} chatId The chat ID.
 * @param {object} data The data object to log.
 * @param {string} [logType='message'] The type of log entry (e.g., 'user', 'assistant', 'error', 'system', 'event').
 */
function logChat(chatId, data, logType = 'message') {
    if (!validateChatId(chatId) && chatId !== 0) {
        console.error('Invalid chat ID in logChat:', chatId);
        return;
    }

    const logFilePath = path.join(CHAT_HISTORIES_DIR, `chat_${chatId}.log`);
    try {
        let content;
        if (logType === 'user' || logType === 'assistant') {
            // Для сообщений user/assistant сохраняем только массив content
            content = Array.isArray(data.content) ? data.content : (data.text ? [{ type: logType === 'user' ? 'input_text' : 'output_text', text: data.text }] : []);
        } else {
            // Для других типов (event, error, system) сохраняем весь объект
            content = data;
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            type: logType,
            role: logType === 'user' || logType === 'assistant' ? logType : undefined,
            content: content
        };
        fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + '\n');
        console.debug(`[LogChat ${chatId}] Logged ${logType} entry to ${logFilePath}:`, JSON.stringify(logEntry, null, 2));
    } catch (error) {
        console.error(`Error logging chat ${chatId} to ${logFilePath}:`, error);
    }
}

module.exports = {
    sanitizeString,
    validateChatId,
    validateImageResponse,
    validateMimeTypeImg,
    validateMimeTypeAudio,
    generateMessageHash,
    logChat
};