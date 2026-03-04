#!/usr/bin/env node
/**
 * Smoke test for hidden Claude CLI --sdk-url transport.
 *
 * What it verifies:
 * 1) Claude connects to local WS endpoint
 * 2) Sends system/init
 * 3) Accepts user prompt via NDJSON
 * 4) Produces final result that contains "OK"
 *
 * Usage:
 *   timeout 30s node tests/test_claude_sdk_say_ok.js
 */

const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

const TEST_TIMEOUT_MS = 25000;

function parseNdjsonLines(buffered) {
  const lines = buffered.split('\n');
  const rest = lines.pop() || '';
  const parsed = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      parsed.push(JSON.parse(t));
    } catch {
      // ignore malformed partial lines
    }
  }
  return { parsed, rest };
}

function parseSingleJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  let gotInit = false;
  let gotResult = false;
  let finalResultText = '';
  let cliExited = false;
  let finished = false;
  let wsClient = null;
  let wsBuffer = '';
  let gotConnection = false;

  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/ws/test' });
  await new Promise((resolve) => wss.once('listening', resolve));
  const addr = wss.address();
  if (!addr || typeof addr !== 'object' || !addr.port) {
    throw new Error('Could not start local WebSocket test server');
  }
  const sdkUrl = `ws://127.0.0.1:${addr.port}/ws/test`;

  const closeServer = async () => {
    await new Promise((resolve) => {
      try {
        for (const c of wss.clients) {
          try { c.close(); } catch {}
        }
        wss.close(() => resolve());
      } catch {
        resolve();
      }
    });
  };

  const fail = async (msg, code = 1) => {
    if (finished) return;
    finished = true;
    await closeServer();
    process.stderr.write(`${msg}\n`);
    process.exit(code);
  };

  const pass = async (msg) => {
    if (finished) return;
    finished = true;
    await closeServer();
    process.stdout.write(`${msg}\n`);
    process.exit(0);
  };

  wss.on('connection', (ws, req) => {
    gotConnection = true;
    const auth = req?.headers?.authorization || '';
    process.stdout.write(`[debug] ws connected auth=${auth ? 'present' : 'missing'}\n`);
    wsClient = ws;
    // Some Claude builds start emitting only after first user message in sdk-url mode.
    const bootstrapUser = {
      type: 'user',
      message: { role: 'user', content: 'Reply with exactly OK' },
      parent_tool_use_id: null,
      session_id: '',
    };
    ws.send(`${JSON.stringify(bootstrapUser)}\n`);
    ws.on('message', (raw) => {
      const chunk = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      const single = parseSingleJson(chunk.trim());
      if (single && typeof single === 'object') {
        handleMessages([single]);
        return;
      }

      wsBuffer += chunk;
      const { parsed, rest } = parseNdjsonLines(wsBuffer);
      wsBuffer = rest;
      handleMessages(parsed);
    });

    const handleMessages = (messages) => {
      for (const msg of messages) {
        if (msg?.type === 'system' && msg?.subtype === 'init') {
          gotInit = true;
          const userPrompt = {
            type: 'user',
            message: {
              role: 'user',
              content: 'Reply with exactly OK',
            },
            parent_tool_use_id: null,
            session_id: typeof msg.session_id === 'string' ? msg.session_id : '',
          };
          ws.send(`${JSON.stringify(userPrompt)}\n`);
          continue;
        }

        if (msg?.type === 'control_request') {
          const req = msg.request || {};
          const requestId = typeof req.request_id === 'string' ? req.request_id : '';
          const subtype = typeof req.subtype === 'string' ? req.subtype : '';
          const response = {
            type: 'control_response',
            response: {
              subtype: 'success',
              request_id: requestId,
              response: subtype === 'can_use_tool'
                ? { behavior: 'allow', updatedInput: req.input }
                : {},
            },
          };
          ws.send(`${JSON.stringify(response)}\n`);
          continue;
        }

        if (msg?.type === 'result') {
          gotResult = true;
          finalResultText = typeof msg.result === 'string' ? msg.result : '';
          if (/\bOK\b/i.test(finalResultText)) {
            void pass('PASS: Claude sdk-url responded with OK');
          }
        }
      }
    };
  });

  const child = spawn(
    'claude',
    [
      '--sdk-url', sdkUrl,
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '-p', '',
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    }
  );
  process.stdout.write(`[debug] spawned claude pid=${child.pid} sdkUrl=${sdkUrl}\n`);

  child.on('error', async (err) => {
    await fail(`FAIL: spawn error: ${err?.message || String(err)}`);
  });

  let stdoutTail = '';
  child.stdout.on('data', (d) => {
    stdoutTail += d.toString('utf8');
    if (stdoutTail.length > 2000) {
      stdoutTail = stdoutTail.slice(-2000);
    }
  });

  let stderrTail = '';
  child.stderr.on('data', (d) => {
    stderrTail += d.toString('utf8');
    if (stderrTail.length > 2000) {
      stderrTail = stderrTail.slice(-2000);
    }
  });

  child.on('close', async (code) => {
    cliExited = true;
    if (!gotInit) {
      return fail(`FAIL: no system/init from claude (exit=${String(code)}) connected=${gotConnection}\nstdout:\n${stdoutTail}\nstderr:\n${stderrTail}`);
    }
    if (!gotResult) {
      return fail(`FAIL: no result from claude (exit=${String(code)}) connected=${gotConnection}\nstdout:\n${stdoutTail}\nstderr:\n${stderrTail}`);
    }
    if (!/\bOK\b/i.test(finalResultText || '')) {
      return fail(`FAIL: result does not contain OK. result="${finalResultText.slice(0, 300)}"`);
    }
    await pass('PASS: Claude sdk-url responded with OK');
  });

  setTimeout(async () => {
    try { child.kill('SIGTERM'); } catch {}
    if (wsClient) {
      try { wsClient.close(); } catch {}
    }
    if (!cliExited && !finished) {
      await fail(`FAIL: timeout after ${TEST_TIMEOUT_MS}ms (connected=${gotConnection}, init=${gotInit}, result=${gotResult})\nstdout:\n${stdoutTail}\nstderr:\n${stderrTail}`);
    }
  }, TEST_TIMEOUT_MS);
}

main().catch(async (err) => {
  process.stderr.write(`FAIL: ${err?.stack || String(err)}\n`);
  process.exit(1);
});
