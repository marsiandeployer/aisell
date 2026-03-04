// CHANGE: Admin server для просмотра лидов из onboarding
// WHY: User request - сохранять идеи юзеров в админке с белым списком IP
// QUOTE(ТЗ): "идеи юзера сохраняй в админке по аналогии с тем как работает bananzabot"
// REF: User request 2026-01-28

const http = require('http');
const fs = require('fs');
const path = require('path');

const {
    renderNoxonLeadsBody,
    renderNoxonMessagesBody,
    renderNoxonReferralsBody,
    renderNoxonOnboardingBody
} = require('../shared/admin/noxonPages');

const BASE_PATH = '/admin';
const DATA_DIR = path.join(__dirname, 'data');
const LEADS_PATH = path.join(DATA_DIR, 'onboarding', 'onboarding_leads.json');
const MESSAGE_HISTORY_PATH = path.join(DATA_DIR, 'history', 'message_history.json');
const REFERRALS_PATH = path.join(DATA_DIR, 'referrals', 'user_referrals.json');
const ONBOARDING_STATES_PATH = path.join(DATA_DIR, 'onboarding', 'onboarding_states.json');

// CHANGE: White list IP для доступа к админке
// WHY: Безопасность - только доверенные IP могут смотреть лиды
const allowedIps = new Set(['212.193.45.174', '89.185.84.184', '127.0.0.1', 'localhost', '::1']);

const portRaw = process.env.NOXONBOT_ADMIN_PORT || '8889';
const adminPort = Number(portRaw);
if (!Number.isInteger(adminPort) || adminPort <= 0) {
    throw new Error('NOXONBOT_ADMIN_PORT must be a valid port number');
}

// Инициализируем файлы если их нет (новая структура в data/)
for (const filePath of [LEADS_PATH, MESSAGE_HISTORY_PATH, REFERRALS_PATH]) {
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '[]', 'utf8');
    }
}
{
    const dirPath = path.dirname(ONBOARDING_STATES_PATH);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    if (!fs.existsSync(ONBOARDING_STATES_PATH)) {
        fs.writeFileSync(ONBOARDING_STATES_PATH, '{}', 'utf8');
    }
}

function readJsonFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
}

function renderLayout(title, bodyHtml) {
    return `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100">
    <div class="container mx-auto py-8 px-4">
        <div class="bg-white rounded-lg shadow-lg p-6">
            <h1 class="text-3xl font-bold mb-6 text-gray-800">🤖 Noxonbot Admin</h1>
            ${bodyHtml}
        </div>
    </div>
</body>
</html>
    `;
}

function normalizeIp(ip) {
    if (!ip) {
        return null;
    }
    const text = String(ip).trim();
    if (!text) {
        return null;
    }
    // IPv4-mapped IPv6 (common when running behind some proxies).
    if (text.startsWith('::ffff:')) {
        return text.slice('::ffff:'.length);
    }
    // Strip zone id if present (rare).
    const zoneIdx = text.indexOf('%');
    if (zoneIdx !== -1) {
        return text.slice(0, zoneIdx);
    }
    return text;
}

function getClientIp(req) {
    const remoteRaw = typeof req.socket.remoteAddress === 'string' ? req.socket.remoteAddress : null;
    const remote = normalizeIp(remoteRaw);

    // Security: only trust proxy headers when request comes from loopback (reverse proxy on same host).
    const isTrustedProxy = remote === '127.0.0.1' || remote === '::1';

    if (isTrustedProxy) {
        const xForwardedFor = req.headers['x-forwarded-for'];
        if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
            return xForwardedFor.split(',')[0].trim();
        }
        const xRealIp = req.headers['x-real-ip'];
        if (typeof xRealIp === 'string' && xRealIp.trim()) {
            return xRealIp.trim();
        }
        const cfConnectingIp = req.headers['cf-connecting-ip'];
        if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim()) {
            return cfConnectingIp.trim();
        }
    }

    return remote;
}

function checkIpAccess(req) {
    const rawIp = getClientIp(req);
    const clientIp = normalizeIp(rawIp);

    console.log(`[Admin] Request from IP: ${clientIp || rawIp}`);

    if (!clientIp) {
        return false;
    }

    if (allowedIps.has(clientIp)) {
        return true;
    }

    // Extra safety: allow localhost variants even if allowlist is misconfigured.
    if (clientIp === '::1' || clientIp === '127.0.0.1') {
        return true;
    }

    return false;
}

const server = http.createServer(async (req, res) => {
    try {
        // Проверка IP
        if (!checkIpAccess(req)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('доступ по ip заперщен.');
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;

        // Главная страница - список лидов
        if (pathname === BASE_PATH || pathname === BASE_PATH + '/') {
            const leads = readJsonFile(LEADS_PATH);
            const messages = readJsonFile(MESSAGE_HISTORY_PATH);
            const body = renderNoxonLeadsBody(BASE_PATH, leads, messages);
            const html = renderLayout('Noxonbot Admin - Leads', body);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }

        // Страница сообщений конкретного пользователя
        const messagesMatch = pathname.match(new RegExp(`^${BASE_PATH}/messages/(\\d+)$`));
        if (messagesMatch) {
            const userId = messagesMatch[1];
            const messages = readJsonFile(MESSAGE_HISTORY_PATH);
            const body = renderNoxonMessagesBody(BASE_PATH, userId, messages);
            const html = renderLayout(`Noxonbot Admin - Messages ${userId}`, body);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }

        // Страница диалога автора (алиас для /messages/:id)
        const authorMatch = pathname.match(new RegExp(`^${BASE_PATH}/authors/(\\d+)$`));
        if (authorMatch) {
            const userId = authorMatch[1];
            const messages = readJsonFile(MESSAGE_HISTORY_PATH);
            const body = renderNoxonMessagesBody(BASE_PATH, userId, messages);
            const html = renderLayout(`Noxonbot Admin - Author ${userId}`, body);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }

        if (pathname === `${BASE_PATH}/referrals`) {
            const entries = readJsonFile(REFERRALS_PATH);
            const body = renderNoxonReferralsBody(BASE_PATH, entries);
            const html = renderLayout('Noxonbot Admin - Referrals', body);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }

        if (pathname === `${BASE_PATH}/onboarding`) {
            const states = readJsonFile(ONBOARDING_STATES_PATH);
            const body = renderNoxonOnboardingBody(BASE_PATH, states);
            const html = renderLayout('Noxonbot Admin - Onboarding', body);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }

        // API для получения лидов
        if (pathname === BASE_PATH + '/api/leads') {
            const leads = readJsonFile(LEADS_PATH);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(leads));
            return;
        }

        // API для получения сообщений
        if (pathname === BASE_PATH + '/api/messages') {
            const messages = readJsonFile(MESSAGE_HISTORY_PATH);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(messages));
            return;
        }

        if (pathname === BASE_PATH + '/api/referrals') {
            const entries = readJsonFile(REFERRALS_PATH);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(entries));
            return;
        }

        if (pathname === BASE_PATH + '/api/onboarding') {
            const states = readJsonFile(ONBOARDING_STATES_PATH);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(states));
            return;
        }

        // 404
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');

    } catch (error) {
        console.error('[Admin] Server error:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
    }
});

server.listen(adminPort, '0.0.0.0', () => {
    console.log(`✅ Noxonbot Admin Server запущен на http://0.0.0.0:${adminPort}${BASE_PATH}`);
    console.log(`🔒 Доступ разрешен с IP: ${Array.from(allowedIps).join(', ')}`);
    console.log(`🌐 Доступ извне: http://78.47.125.10:${adminPort}${BASE_PATH}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Остановка Admin Server...');
    server.close(() => {
        console.log('✅ Admin Server остановлен');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Получен SIGTERM, остановка...');
    server.close(() => {
        console.log('✅ Admin Server остановлен');
        process.exit(0);
    });
});
