const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function request(port, method, pathname, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? Buffer.from(body, 'utf8') : null;
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: pathname,
            method,
            headers: payload
                ? {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': String(payload.length)
                }
                : undefined
        }, res => {
            let raw = '';
            res.on('data', chunk => {
                raw += chunk.toString('utf8');
            });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode || 0,
                    headers: res.headers,
                    body: raw
                });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function waitForServer(port, timeoutMs = 20000) {
    const started = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            const resp = await request(port, 'GET', '/admin');
            if (resp.statusCode === 200) return;
        } catch {
            // wait
        }
        if (Date.now() - started > timeoutMs) {
            throw new Error('admin server did not become ready');
        }
        await wait(400);
    }
}

async function run() {
    console.log('\n🧪 Running CRM Follow-up E2E Test...\n');

    const projectDir = '/root/aisell/bananzabot';
    const dataDir = path.join(projectDir, 'user_data');
    const convoUserId = `991${Date.now().toString().slice(-7)}`;
    const convoDir = path.join(dataDir, 'conversations', convoUserId);
    const convoFile = path.join(convoDir, 'conversation.json');
    const botDir = path.join(dataDir, 'bot_crm_e2e_test');
    const profileFile = path.join(botDir, `${convoUserId}.json`);
    const crmPath = path.join(dataDir, 'crm_followups.json');
    const crmBackup = fs.existsSync(crmPath) ? fs.readFileSync(crmPath, 'utf8') : null;
    const port = 32911;
    const tsxCli = path.join(projectDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

    let server = null;
    let passed = 0;
    let failed = 0;

    function ok(name, condition, details = '') {
        if (condition) {
            console.log(`✅ ${name}`);
            passed += 1;
        } else {
            console.log(`❌ ${name}${details ? `: ${details}` : ''}`);
            failed += 1;
        }
    }

    try {
        fs.mkdirSync(convoDir, { recursive: true });
        fs.mkdirSync(botDir, { recursive: true });

        fs.writeFileSync(convoFile, JSON.stringify({
            stage: 'awaiting_description',
            messages: [
                {
                    role: 'user',
                    content: 'Хочу бота для записи клиентов в салон',
                    timestamp: new Date().toISOString()
                }
            ],
            product_description: 'Хочу бота для записи клиентов в салон'
        }, null, 2));

        fs.writeFileSync(profileFile, JSON.stringify({
            chatId: convoUserId,
            username: 'sashanoxon',
            firstName: 'Sasha'
        }, null, 2));

        server = spawn('node', [tsxCli, 'adminServer.ts'], {
            cwd: projectDir,
            env: {
                ...process.env,
                BANANZABOT_ADMIN_PORT: String(port),
                BANANZABOT_CRM_DRY_RUN: '1',
                BANANZABOT_CRM_FAKE_AI: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        await waitForServer(port, 25000);

        const crmPage = await request(port, 'GET', '/admin/crm');
        ok('CRM page should open', crmPage.statusCode === 200, `status=${crmPage.statusCode}`);
        ok('CRM page should include lead user id', crmPage.body.includes(convoUserId));

        const genResp = await request(
            port,
            'POST',
            '/admin/crm/followup/generate',
            `user_id=${encodeURIComponent(convoUserId)}&return_to=${encodeURIComponent(`/admin/authors/${convoUserId}`)}`
        );
        ok('Generate follow-up should redirect', genResp.statusCode === 302, `status=${genResp.statusCode}`);
        ok(
            'Generate follow-up should redirect to author page',
            String(genResp.headers.location || '').includes(`/admin/authors/${convoUserId}`)
        );

        const crmStateAfterGenerate = JSON.parse(fs.readFileSync(crmPath, 'utf8'));
        const generatedLeadState = crmStateAfterGenerate[convoUserId];
        ok(
            'Generated follow-up should include sender context',
            generatedLeadState &&
            typeof generatedLeadState.followupText === 'string' &&
            (generatedLeadState.followupText.toLowerCase().includes('создатель bananzabot') ||
             generatedLeadState.followupText.toLowerCase().includes('команда @bananza_bot'))
        );
        ok(
            'Generated follow-up should include bananzabot link',
            generatedLeadState &&
            typeof generatedLeadState.followupText === 'string' &&
            generatedLeadState.followupText.includes('https://t.me/bananza_bot')
        );

        const sendText = 'Привет! Вижу вы начали настройку в Bananzabot. Если хотите, помогу завершить за 5 минут.';
        const sendResp = await request(
            port,
            'POST',
            '/admin/crm/followup/send',
            `user_id=${encodeURIComponent(convoUserId)}&return_to=${encodeURIComponent(`/admin/authors/${convoUserId}`)}&followup_text=${encodeURIComponent(sendText)}`
        );
        ok('Send follow-up should redirect', sendResp.statusCode === 302, `status=${sendResp.statusCode}`);
        ok(
            'Send follow-up should redirect to author page',
            String(sendResp.headers.location || '').includes(`/admin/authors/${convoUserId}`)
        );

        const crmStateRaw = fs.readFileSync(crmPath, 'utf8');
        const crmState = JSON.parse(crmStateRaw);
        const leadState = crmState[convoUserId];
        ok('CRM state should be saved', Boolean(leadState));
        ok('Lead status should become contacted', leadState && leadState.status === 'contacted');
        ok('Lead sentCount should be 1', leadState && leadState.sentCount === 1);
        ok('Folder add timestamp should be set in dry-run', leadState && typeof leadState.folderAddedAt === 'string');
        ok('Delivery channel should be personal for lead with username', leadState && leadState.lastDeliveryVia === 'personal');

        const convoAfterSend = JSON.parse(fs.readFileSync(convoFile, 'utf8'));
        const messagesAfterSend = Array.isArray(convoAfterSend.messages) ? convoAfterSend.messages : [];
        ok(
            'Author history should include CRM sent marker',
            messagesAfterSend.some(m =>
                m &&
                typeof m.content === 'string' &&
                (m.content.includes('[CRM follow-up sent to @sashanoxon]') ||
                 m.content.includes('[CRM follow-up sent to @bananza_bot ->'))
            )
        );
    } finally {
        if (server && !server.killed) {
            server.kill('SIGTERM');
            await wait(800);
            if (!server.killed) {
                server.kill('SIGKILL');
            }
        }
        try {
            fs.rmSync(convoDir, { recursive: true, force: true });
            if (fs.existsSync(profileFile)) fs.rmSync(profileFile, { force: true });
            if (fs.existsSync(botDir) && fs.readdirSync(botDir).length === 0) fs.rmSync(botDir, { recursive: true, force: true });
        } catch {
            // no-op
        }
        try {
            if (crmBackup === null) {
                if (fs.existsSync(crmPath)) fs.rmSync(crmPath, { force: true });
            } else {
                fs.writeFileSync(crmPath, crmBackup);
            }
        } catch {
            // no-op
        }
    }

    console.log('\n============================================================');
    console.log('📊 CRM Follow-up E2E Summary');
    console.log('============================================================');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Total: ${passed + failed}`);
    console.log('============================================================\n');

    process.exit(failed === 0 ? 0 : 1);
}

run().catch(error => {
    console.error('❌ CRM E2E crashed:', error);
    process.exit(1);
});
