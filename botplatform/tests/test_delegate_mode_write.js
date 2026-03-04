#!/usr/bin/env node
/**
 * E2E test for delegate permission mode with file write.
 *
 * What it verifies:
 * 1) Claude CLI with --permission-mode delegate connects to SDK bridge
 * 2) Receives user prompt to create a file
 * 3) Sends control_request (can_use_tool for Write)
 * 4) SDK bridge responds with allow
 * 5) Claude creates the file successfully
 * 6) Returns result with success message
 *
 * Usage:
 *   timeout 30s node tests/test_delegate_mode_write.js
 */

const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_TIMEOUT_MS = 25000;
const TEST_FILE_PATH = path.join(os.tmpdir(), `test_delegate_${Date.now()}.txt`);
const TEST_CONTENT = 'Delegate mode test file';

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
  let gotControlRequest = false;
  let gotResult = false;
  let finalResultText = '';
  let cliExited = false;
  let finished = false;
  let wsClient = null;
  let wsBuffer = '';
  let gotConnection = false;

  // Cleanup test file if exists
  try {
    fs.unlinkSync(TEST_FILE_PATH);
  } catch {}

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

  const cleanup = () => {
    try {
      fs.unlinkSync(TEST_FILE_PATH);
    } catch {}
  };

  const fail = async (msg, code = 1) => {
    if (finished) return;
    finished = true;
    cleanup();
    await closeServer();
    process.stderr.write(`${msg}\n`);
    process.exit(code);
  };

  const pass = async (msg) => {
    if (finished) return;
    finished = true;
    cleanup();
    await closeServer();
    process.stdout.write(`${msg}\n`);
    process.exit(0);
  };

  wss.on('connection', (ws, req) => {
    gotConnection = true;
    process.stdout.write(`[debug] ws connected\n`);
    wsClient = ws;

    // Send bootstrap prompt to trigger system/init
    const bootstrapUser = {
      type: 'user',
      message: { role: 'user', content: `Create file ${TEST_FILE_PATH} with content "${TEST_CONTENT}"` },
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
        // Debug: log all incoming messages
        if (msg?.type) {
          const preview = JSON.stringify(msg).slice(0, 200);
          process.stdout.write(`[debug] incoming: type=${msg.type} subtype=${msg.subtype || 'n/a'} preview=${preview}\n`);
        }

        if (msg?.type === 'system' && msg?.subtype === 'init') {
          gotInit = true;
          process.stdout.write(`[debug] system/init session_id=${msg.session_id || 'empty'}\n`);
          const userPrompt = {
            type: 'user',
            message: {
              role: 'user',
              content: `Create file ${TEST_FILE_PATH} with content "${TEST_CONTENT}"`,
            },
            parent_tool_use_id: null,
            session_id: typeof msg.session_id === 'string' ? msg.session_id : '',
          };
          ws.send(`${JSON.stringify(userPrompt)}\n`);
          continue;
        }

        if (msg?.type === 'control_request') {
          gotControlRequest = true;
          const req = msg.request || {};
          // request_id is at msg level, not msg.request level
          let requestId = typeof msg.request_id === 'string' ? msg.request_id : '';
          // Fallback: try tool_use_id from content if available
          if (!requestId && msg.message?.content) {
            const toolUse = Array.isArray(msg.message.content)
              ? msg.message.content.find(c => c?.type === 'tool_use')
              : null;
            if (toolUse?.id) {
              requestId = toolUse.id;
            }
          }
          const subtype = typeof req.subtype === 'string' ? req.subtype : '';
          const toolName = typeof req.tool_name === 'string' ? req.tool_name : '';

          process.stdout.write(`[debug] control_request: ${subtype} tool=${toolName} request_id=${requestId}\n`);

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
          process.stdout.write(`[debug] sending control_response: ${JSON.stringify(response).slice(0, 150)}\n`);
          ws.send(`${JSON.stringify(response)}\n`);
          continue;
        }

        if (msg?.type === 'result') {
          gotResult = true;
          finalResultText = typeof msg.result === 'string' ? msg.result : '';
          process.stdout.write(`[debug] result received, chars=${finalResultText.length}\n`);

          // Verify file was created
          if (!fs.existsSync(TEST_FILE_PATH)) {
            void fail(`FAIL: file ${TEST_FILE_PATH} was not created`);
            return;
          }

          const fileContent = fs.readFileSync(TEST_FILE_PATH, 'utf8');
          if (!fileContent.includes(TEST_CONTENT)) {
            void fail(`FAIL: file content mismatch. Expected "${TEST_CONTENT}", got "${fileContent}"`);
            return;
          }

          process.stdout.write(`[debug] ✅ file created successfully with correct content\n`);
          void pass('PASS: delegate mode file write test completed');
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
      '--permission-mode', 'delegate',
      '--no-session-persistence',
      '-p', '',
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    }
  );
  process.stdout.write(`[debug] spawned claude pid=${child.pid} --permission-mode delegate\n`);

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
    const text = d.toString('utf8');
    stderrTail += text;
    if (stderrTail.length > 2000) {
      stderrTail = stderrTail.slice(-2000);
    }
    // Print stderr in real-time for debugging
    process.stderr.write(`[claude stderr] ${text}`);
  });

  child.on('close', async (code) => {
    cliExited = true;
    if (!gotInit) {
      return fail(`FAIL: no system/init from claude (exit=${String(code)}) connected=${gotConnection}\nstdout:\n${stdoutTail}\nstderr:\n${stderrTail}`);
    }
    if (!gotControlRequest) {
      return fail(`FAIL: no control_request received (exit=${String(code)})\nstdout:\n${stdoutTail}\nstderr:\n${stderrTail}`);
    }
    if (!gotResult) {
      return fail(`FAIL: no result from claude (exit=${String(code)}) connected=${gotConnection}\nstdout:\n${stdoutTail}\nstderr:\n${stderrTail}`);
    }
  });

  setTimeout(async () => {
    try { child.kill('SIGTERM'); } catch {}
    if (wsClient) {
      try { wsClient.close(); } catch {}
    }
    if (!cliExited && !finished) {
      await fail(`FAIL: timeout after ${TEST_TIMEOUT_MS}ms (connected=${gotConnection}, init=${gotInit}, control_request=${gotControlRequest}, result=${gotResult})\nstdout:\n${stdoutTail}\nstderr:\n${stderrTail}`);
    }
  }, TEST_TIMEOUT_MS);
}

main().catch(async (err) => {
  process.stderr.write(`FAIL: ${err?.stack || String(err)}\n`);
  process.exit(1);
});
