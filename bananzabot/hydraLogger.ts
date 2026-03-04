// CHANGE: Hydra API request logger with full context and feedback (inspired by salvio/claritycult)
// WHY: Track all LLM requests for debugging, quality monitoring, and user feedback
// REF: user request 2026-02-11, ~/salvio/backend/app/models/llm_request.py, ~/claritycult/backend/utils/hydra_logger.py

import * as fs from 'fs';
import * as path from 'path';

const LOGS_DIR = path.join(__dirname, 'user_data', 'hydra_logs');

export interface HydraLogEntry {
    id: string;
    timestamp: string;
    caller: string; // Function/module that made the request
    context: {
        userId?: string;
        chatId?: string;
        operation?: string; // 'chat', 'qualification', 'followup', etc.
    };
    request: {
        model: string;
        messages: any[];
        temperature?: number;
        max_tokens?: number;
        tools?: any[];
        [key: string]: any;
    };
    response: {
        success: boolean;
        data?: any;
        error?: string;
        latencyMs?: number;
        usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
        };
    };
    feedback?: {
        comment: string;
        addedAt: string;
    };
}

function ensureLogsDir(): void {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}

// CHANGE: Store each request as separate JSON file (claritycult approach)
// WHY: More scalable than single monolithic file, easier to manage
function getLogFilePath(id: string): string {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '-');
    return path.join(LOGS_DIR, `${safeId}.json`);
}

function writeLogFile(id: string, entry: HydraLogEntry): void {
    ensureLogsDir();
    const filePath = getLogFilePath(id);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
}

function readLogFile(id: string): HydraLogEntry | null {
    try {
        const filePath = getLogFilePath(id);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

export function logHydraRequest(entry: Omit<HydraLogEntry, 'id' | 'timestamp'>): string {
    const id = `hydra-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const logEntry: HydraLogEntry = {
        id,
        timestamp: new Date().toISOString(),
        ...entry
    };

    writeLogFile(id, logEntry);
    console.log(`✅ Hydra request logged: ${id}`);
    return id;
}

export function getAllLogs(limit: number = 100): HydraLogEntry[] {
    ensureLogsDir();
    const files = fs.readdirSync(LOGS_DIR)
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => {
            const statA = fs.statSync(path.join(LOGS_DIR, a));
            const statB = fs.statSync(path.join(LOGS_DIR, b));
            return statB.mtimeMs - statA.mtimeMs; // Newest first
        })
        .slice(0, limit);

    const logs: HydraLogEntry[] = [];
    for (const file of files) {
        try {
            const data = fs.readFileSync(path.join(LOGS_DIR, file), 'utf-8');
            logs.push(JSON.parse(data));
        } catch (err) {
            console.error(`Failed to read log file ${file}:`, err);
        }
    }
    return logs;
}

export function getLogById(id: string): HydraLogEntry | null {
    return readLogFile(id);
}

export function addFeedback(id: string, comment: string): boolean {
    const log = readLogFile(id);
    if (!log) {
        return false;
    }
    log.feedback = {
        comment,
        addedAt: new Date().toISOString()
    };
    writeLogFile(id, log);
    return true;
}

export function getLogStats(): {
    totalRequests: number;
    successRate: number;
    totalTokens: number;
    avgLatencyMs: number;
    withFeedback: number;
} {
    const logs = getAllLogs(1000); // Get recent 1000 for stats
    const totalRequests = logs.length;
    const successCount = logs.filter(log => log.response.success).length;
    const totalTokens = logs.reduce((sum, log) => {
        return sum + (log.response.usage?.total_tokens || 0);
    }, 0);
    const totalLatency = logs.reduce((sum, log) => {
        return sum + (log.response.latencyMs || 0);
    }, 0);
    const withFeedback = logs.filter(log => log.feedback).length;

    return {
        totalRequests,
        successRate: totalRequests > 0 ? (successCount / totalRequests) * 100 : 0,
        totalTokens,
        avgLatencyMs: totalRequests > 0 ? totalLatency / totalRequests : 0,
        withFeedback
    };
}
