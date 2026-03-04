#!/usr/bin/env node
/**
 * Renders a local HTML promo page into PNG via Puppeteer.
 *
 * Usage:
 *   node scripts/render_promo_preview.js \
 *     --html previews/promo-yoga-with-calendar.html \
 *     --out store_assets/previews/promo-yoga-nanabanana.png \
 *     --prompt-file previews/cases/yoga-studio-calendar/prompt.txt
 */

const fs = require('fs');
const path = require('path');
const { parseCliArgs } = require('./shared/cli_args');
const { escapeHtml } = require('./shared/html_escape');
const {
  ASSISTANT_BUBBLE_SELECTOR,
  ASSISTANT_TEXT_SELECTOR,
  PROGRESS_MARKERS,
  pickLatestCompletedAssistantText,
  extractHtmlFromAssistantText,
} = require('./render_promo_preview_text_utils');
const UNICODE_FONT_STACK = '"Segoe UI", "Helvetica Neue", Arial, "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", "Noto Emoji", "Symbola", sans-serif';

function resolvePuppeteer() {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'noxonbot', 'node_modules', 'puppeteer'),
    'puppeteer',
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate); // eslint-disable-line global-require, import/no-dynamic-require
    } catch (_e) {}
  }

  throw new Error('Puppeteer not found. Install it or run from monorepo with noxonbot/node_modules.');
}

async function main() {
  const args = parseCliArgs(process.argv);
  const rootDir = path.resolve(__dirname, '..');
  const htmlPath = path.resolve(rootDir, String(args.html || 'previews/promo-yoga-with-calendar.html'));
  const htmlUrl = String(args['html-url'] || '').trim();
  const outPath = path.resolve(rootDir, String(args.out || 'store_assets/previews/promo-yoga-nanabanana.png'));
  const promptFilePath = args['prompt-file']
    ? path.resolve(rootDir, String(args['prompt-file']))
    : null;
  const frameSelector = String(args['frame-selector'] || 'iframe.chat-frame');
  const resultFrameSelector = String(args['result-frame-selector'] || 'iframe.result-frame');
  const deriveLeftFromChatHtml = String(args['derive-left-from-chat-html'] || 'false') === 'true';
  const webchatSessionId = String(args['webchat-session-id'] || '').trim();
  const webchatSessionUrl = String(args['webchat-session-url'] || '').trim();
  const userName = String(args['user-name'] || 'admin');
  const userEmail = String(args['user-email'] || 'admin@example.com');
  const postSendWaitMsRaw = Number(args['post-send-wait-ms'] || 2500);
  const waitBotResponse = String(args['wait-bot-response'] || 'true') !== 'false';
  const sendViaApi = String(args['send-via-api'] || 'false') === 'true';
  const botResponseTimeoutMsRaw = Number(args['bot-response-timeout-ms'] || 180000);
  const apiPollIntervalMsRaw = Number(args['api-poll-interval-ms'] || 22000);
  const chatZoomStepsRaw = Number(args['chat-zoom-steps'] || 1);
  const postSendWaitMs = Number.isFinite(postSendWaitMsRaw) && postSendWaitMsRaw >= 0
    ? Math.floor(postSendWaitMsRaw)
    : 2500;
  const botResponseTimeoutMs = Number.isFinite(botResponseTimeoutMsRaw) && botResponseTimeoutMsRaw > 0
    ? Math.floor(botResponseTimeoutMsRaw)
    : 90000;
  const apiPollIntervalMs = Number.isFinite(apiPollIntervalMsRaw) && apiPollIntervalMsRaw > 0
    ? Math.floor(apiPollIntervalMsRaw)
    : 22000;
  const chatZoomSteps = Number.isFinite(chatZoomStepsRaw) && chatZoomStepsRaw > 0
    ? Math.floor(chatZoomStepsRaw)
    : 0;
  const assistantTextOutPath = args['assistant-text-out']
    ? path.resolve(rootDir, String(args['assistant-text-out']))
    : null;

  if (!htmlUrl && !fs.existsSync(htmlPath)) {
    throw new Error(`HTML file not found: ${htmlPath}`);
  }
  if (promptFilePath && !fs.existsSync(promptFilePath)) {
    throw new Error(`Prompt file not found: ${promptFilePath}`);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const puppeteer = resolvePuppeteer();

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    if (webchatSessionId && webchatSessionUrl) {
      try {
        await page.setCookie({
          name: 'webchat_session',
          value: webchatSessionId,
          url: webchatSessionUrl,
          path: '/',
          httpOnly: true,
        });
      } catch (_e) {}
    }
    const targetUrl = htmlUrl || `file://${htmlPath}`;
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    await applyUnicodeFontFallback(page);

    if (promptFilePath) {
      const promptText = fs.readFileSync(promptFilePath, 'utf8').trim();
      if (promptText) {
        const interaction = await sendPromptIntoChatIframe(page, {
          frameSelector,
          promptText,
          userName,
          userEmail,
          postSendWaitMs,
          waitBotResponse,
          sendViaApi,
          botResponseTimeoutMs,
          apiPollIntervalMs,
          chatZoomSteps,
        });

        const assistantText = (interaction && interaction.assistantCombinedText) || (interaction && interaction.lastAssistantText) || '';

        if (assistantTextOutPath) {
          fs.mkdirSync(path.dirname(assistantTextOutPath), { recursive: true });
          fs.writeFileSync(assistantTextOutPath, assistantText, 'utf8');
        }

        if (deriveLeftFromChatHtml) {
          const htmlFromChat = extractHtmlFromAssistantText(assistantText);
          if (htmlFromChat) {
            await renderHtmlIntoResultFrame(page, resultFrameSelector, htmlFromChat);
          } else if (assistantText.trim()) {
            await renderTextIntoResultFrame(page, resultFrameSelector, assistantText);
          } else {
            process.stderr.write('Warning: assistant response does not contain an HTML code block\n');
          }
        }
      }
    }

    await page.screenshot({ path: outPath, fullPage: false });
  } finally {
    await browser.close();
  }

  process.stdout.write(`${outPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
  process.exit(1);
});

async function sendPromptIntoChatIframe(page, options) {
  const {
    frameSelector,
    promptText,
    userName,
    userEmail,
    postSendWaitMs,
    waitBotResponse,
    sendViaApi,
    botResponseTimeoutMs,
    apiPollIntervalMs,
    chatZoomSteps,
  } = options;

  await page.waitForSelector(frameSelector, { timeout: 30000 });
  const iframeHandle = await page.$(frameSelector);
  if (!iframeHandle) return;
  const frame = await iframeHandle.contentFrame();
  if (!frame) return;

  await frame.waitForSelector('body', { timeout: 30000 });
  await applyUnicodeFontFallback(frame);
  await frame.waitForSelector('#input', { timeout: 30000 });
  await zoomChatFrame(page, frame, chatZoomSteps);
  let assistantCountBefore = await readAssistantCount(frame);

  if (sendViaApi) {
    const interaction = await sendPromptViaApi(frame, {
      promptText,
      waitBotResponse,
      botResponseTimeoutMs,
      apiPollIntervalMs,
    });
    try {
      await frame.evaluate(() => window.location.reload());
      await frame.waitForSelector('body', { timeout: 30000 });
      await applyUnicodeFontFallback(frame);
      await zoomChatFrame(page, frame, chatZoomSteps);
      await wait(900);
    } catch (_e) {}
    return interaction;
  }

  await submitPromptText(frame, promptText);
  const didLogin = await maybeLoginAfterSubmit(frame, userName, userEmail);

  const visibleFragment = promptText.slice(0, Math.min(48, promptText.length));
  let promptIsVisible = await waitForPromptVisible(frame, visibleFragment, 15000);
  if (!promptIsVisible) {
    assistantCountBefore = await readAssistantCount(frame);
    await submitPromptText(frame, promptText);
    promptIsVisible = await waitForPromptVisible(frame, visibleFragment, 10000);
    if (!promptIsVisible && didLogin) {
      await wait(800);
      await submitPromptText(frame, promptText);
      promptIsVisible = await waitForPromptVisible(frame, visibleFragment, 10000);
    }
  }

  if (waitBotResponse) {
    await waitForNewAssistantResponse(frame, assistantCountBefore, botResponseTimeoutMs);
  }

  if (postSendWaitMs > 0) {
    await wait(postSendWaitMs);
  }

  const lastAssistantText = await readLastAssistantMessageText(frame);
  const assistantTextsSincePrompt = await readAssistantMessagesSince(frame, assistantCountBefore);
  const assistantCombinedText = assistantTextsSincePrompt.join('\n\n').trim();
  return { lastAssistantText, assistantCombinedText };
}

async function zoomChatFrame(page, frame, steps) {
  if (!steps || steps <= 0) return;
  try {
    await frame.focus('body');
  } catch (_e) {}

  for (let i = 0; i < steps; i += 1) {
    try {
      await page.keyboard.down('Control');
      await page.keyboard.press('Equal');
      await page.keyboard.up('Control');
    } catch (_e) {}
    await wait(120);
  }

  try {
    await frame.evaluate((zoomSteps) => {
      const zoomPercent = 100 + (zoomSteps * 50);
      const zoomValue = `${zoomPercent}%`;
      document.documentElement.style.zoom = zoomValue;
      if (document.body) {
        document.body.style.zoom = zoomValue;
      }
    }, steps);
  } catch (_e) {}
}

async function applyUnicodeFontFallback(target) {
  const css = `
    html, body, input, textarea, button, select, option, [contenteditable="true"] {
      font-family: ${UNICODE_FONT_STACK} !important;
    }
    /* Увеличить шрифт сообщений для скриншотов */
    .bubble, .message, .message-text, .assistant-text, .user-text {
      font-size: 24px !important;
      line-height: 1.4 !important;
    }
    .bubble p, .message p {
      font-size: 24px !important;
    }
    .bubble pre, .message pre, .bubble code, .message code {
      font-size: 22px !important;
    }
  `;
  try {
    if (typeof target.addStyleTag === 'function') {
      await target.addStyleTag({ content: css });
      return;
    }
  } catch (_e) {}
  try {
    if (typeof target.evaluate === 'function') {
      await target.evaluate((styleText) => {
        const style = document.createElement('style');
        style.textContent = styleText;
        document.head.appendChild(style);
      }, css);
    }
  } catch (_e) {}
}

async function maybeLoginAfterSubmit(frame, userName, userEmail) {
  const isModalOpen = await frame.waitForFunction(
    () => {
      const modal = document.querySelector('#loginModal');
      return !!(modal && modal.classList.contains('open'));
    },
    { timeout: 8000 }
  ).then(() => true).catch(() => false);
  if (!isModalOpen) return false;

  await frame.$eval('#loginName', (el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, userName);
  await frame.$eval('#loginEmail', (el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, userEmail);

  try {
    await frame.click('#loginSubmit');
  } catch (_e) {
    await frame.$eval('#loginForm', (form) => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
        return;
      }
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  }

  let closed = false;
  try {
    await frame.waitForFunction(
      () => {
        const modal = document.querySelector('#loginModal');
        return !modal || !modal.classList.contains('open');
      },
      { timeout: 15000 }
    );
    closed = true;
  } catch (_e) {}

  if (!closed) {
    const statusText = await frame.$eval('#loginStatus', (el) => (el && el.textContent ? el.textContent.trim() : '')).catch(() => '');
    if (statusText) {
      process.stderr.write(`Warning: login modal is still open (${statusText})\n`);
    } else {
      process.stderr.write('Warning: login modal is still open after submit\n');
    }
  }

  // CHANGE: Create user workspace folder after successful login to bypass onboarding
  // WHY: Onboarding modal shows if /root/aisellusers/user_{userId} doesn't exist
  // REF: Preview screenshots should show chat UI, not onboarding prompts
  if (closed) {
    await createUserWorkspaceAfterLogin(frame);
    // Wait a bit for workspace creation to complete
    await wait(500);
  }

  return closed;
}

async function createUserWorkspaceAfterLogin(frame) {
  try {
    const userData = await frame.evaluate(async () => {
      try {
        const resp = await fetch('/api/user');
        if (!resp.ok) return null;
        return await resp.json();
      } catch (_e) {
        return null;
      }
    });

    if (!userData || !userData.userId) {
      return;
    }

    const userId = userData.userId;
    const userFolder = `/root/aisellusers/user_${userId}`;

    const fs = require('fs');
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
      const claudeMd = `# Preview Workspace\n\nAuto-generated workspace for preview screenshots.\n`;
      fs.writeFileSync(`${userFolder}/CLAUDE.md`, claudeMd, 'utf8');
      process.stdout.write(`✅ Created user workspace: ${userFolder}\n`);
    }

    // CHANGE: Clear ALL history files after creating workspace
    // WHY: Old onboarding messages appear from multiple sources (.history.json, chat_log.json)
    // REF: User message "очищай историю сообщений когда создаешь превью"

    // Clear API transcript
    const historyCleared = await frame.evaluate(async () => {
      try {
        const resp = await fetch('/api/history/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        return resp.ok;
      } catch (_e) {
        return false;
      }
    });

    // Clear workspace history files
    const historyJsonPath = path.join(userFolder, '.history.json');
    const chatLogPath = path.join(userFolder, 'chat_log.json');

    try {
      if (fs.existsSync(historyJsonPath)) {
        fs.unlinkSync(historyJsonPath);
        process.stdout.write(`✅ Deleted ${historyJsonPath}\n`);
      }
    } catch (e) {
      process.stderr.write(`Warning: Failed to delete .history.json: ${e}\n`);
    }

    try {
      if (fs.existsSync(chatLogPath)) {
        fs.unlinkSync(chatLogPath);
        process.stdout.write(`✅ Deleted ${chatLogPath}\n`);
      }
    } catch (e) {
      process.stderr.write(`Warning: Failed to delete chat_log.json: ${e}\n`);
    }

    if (historyCleared) {
      process.stdout.write(`✅ Cleared chat history for user ${userId}\n`);
    } else {
      process.stderr.write(`Warning: Failed to clear API history\n`);
    }
  } catch (error) {
    process.stderr.write(`Warning: Failed to create user workspace: ${error}\n`);
  }
}

async function submitPromptText(frame, promptText) {
  await frame.$eval('#input', (input, text) => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, promptText);
  try {
    await frame.click('#sendBtn');
    return;
  } catch (_e) {}
  await frame.$eval('#form', (form) => {
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function sendPromptViaApi(frame, options) {
  const { promptText, waitBotResponse, botResponseTimeoutMs, apiPollIntervalMs } = options;
  const assistantCountBefore = await readAssistantCount(frame);

  const sendResult = await frame.evaluate(async (text) => {
    try {
      const resp = await fetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      let data = null;
      try { data = await resp.json(); } catch (_e) {}
      return { ok: resp.ok, status: resp.status, data };
    } catch (error) {
      return { ok: false, status: 0, error: String(error || 'Network error') };
    }
  }, promptText);

  if (!sendResult || !sendResult.ok) {
    const err = sendResult && sendResult.data && sendResult.data.error
      ? sendResult.data.error
      : (sendResult && sendResult.error) || `Request failed (${sendResult ? sendResult.status : 'unknown'})`;
    process.stderr.write(`Warning: /api/message failed: ${err}\n`);
  }

  if (waitBotResponse) {
    await waitForAssistantViaApi(frame, assistantCountBefore, botResponseTimeoutMs, apiPollIntervalMs);
  } else {
    await wait(1000);
  }

  const historyAfter = await readHistoryMessages(frame);
  const assistants = historyAfter
    .filter((msg) => msg.role === 'assistant' && !msg.deletedAt && typeof msg.text === 'string' && msg.text.trim())
    .map((msg) => String(msg.text).trim());
  const assistantsSincePrompt = assistants.slice(Math.max(0, assistantCountBefore));
  let assistantCombinedText = pickLatestCompletedAssistantText(assistantsSincePrompt);
  if (!assistantCombinedText) {
    const domAssistantsSincePrompt = await readAssistantMessagesSince(frame, assistantCountBefore);
    assistantCombinedText = pickLatestCompletedAssistantText(domAssistantsSincePrompt);
  }
  return { lastAssistantText: assistantCombinedText, assistantCombinedText };
}

async function waitForAssistantViaApi(frame, previousAssistantCount, timeoutMs, pollIntervalMs) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const history = await readHistoryMessages(frame);
    const assistants = history
      .filter((msg) => msg.role === 'assistant' && !msg.deletedAt && typeof msg.text === 'string')
      .map((msg) => String(msg.text).trim());
    const assistantsSincePrompt = assistants.slice(Math.max(0, previousAssistantCount));
    const finalText = pickLatestCompletedAssistantText(assistantsSincePrompt);
    if (finalText) {
      return;
    }
    await wait(pollIntervalMs);
  }
  process.stderr.write(`Warning: assistant response was not observed within ${timeoutMs} ms\n`);
}

async function readHistoryMessages(frame) {
  return frame.evaluate(async () => {
    try {
      const resp = await fetch('/api/history');
      if (!resp.ok) return [];
      const data = await resp.json();
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.messages)) return data.messages;
      return [];
    } catch (_e) {
      return [];
    }
  }).catch(() => []);
}

async function waitForPromptVisible(frame, snippet, timeoutMs) {
  if (!snippet) return false;
  return frame.waitForFunction(
    (textSnippet) => {
      const body = document.body;
      return !!body && body.innerText.includes(textSnippet);
    },
    { timeout: timeoutMs },
    snippet
  ).then(() => true).catch(() => false);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readAssistantCount(frame) {
  return frame.$$eval(ASSISTANT_BUBBLE_SELECTOR, (nodes) => nodes.length).catch(() => 0);
}

async function readLastAssistantMessageText(frame) {
  return frame.$$eval(ASSISTANT_TEXT_SELECTOR, (nodes) => {
    const values = nodes.map((node) => (node && node.innerText ? node.innerText.trim() : '')).filter(Boolean);
    return values.length > 0 ? values[values.length - 1] : '';
  }).catch(() => '');
}

async function readAssistantMessagesSince(frame, previousAssistantCount) {
  return frame.$$eval(ASSISTANT_TEXT_SELECTOR, (nodes, prev) => {
    const start = Number.isFinite(prev) ? Math.max(0, Number(prev)) : 0;
    return nodes
      .slice(start)
      .map((node) => (node && node.innerText ? node.innerText.trim() : ''))
      .filter(Boolean);
  }, previousAssistantCount).catch(() => []);
}

async function renderHtmlIntoResultFrame(page, selector, html) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.$eval(
    selector,
    (el, value) => {
      if (el instanceof HTMLIFrameElement) {
        el.srcdoc = value;
        return;
      }
      el.innerHTML = value;
    },
    html
  );
  await page.$$eval('.placeholder', (nodes) => {
    nodes.forEach((node) => {
      node.style.display = 'none';
    });
  }).catch(() => {});
  await wait(1200);
}

async function renderTextIntoResultFrame(page, selector, text) {
  const escaped = escapeHtml(text).replace(/\n/g, '<br />');
  const html = `<!doctype html><html><head><meta charset="UTF-8"><style>
    html,body{margin:0;padding:0;width:100%;height:100%;background:#0f1b2b;color:#e9f2ff;font-family:"Segoe UI","Helvetica Neue",Arial,sans-serif;}
    .wrap{padding:24px;}
    .title{font-size:22px;font-weight:800;letter-spacing:.01em;margin:0 0 12px;color:#9cc7ff;}
    .box{border:1px solid rgba(156,199,255,.35);background:rgba(255,255,255,.05);border-radius:12px;padding:14px;font-size:19px;line-height:1.35;white-space:normal;word-wrap:break-word;}
  </style></head><body><div class="wrap"><h1 class="title">Chat Output</h1><div class="box">${escaped}</div></div></body></html>`;
  await renderHtmlIntoResultFrame(page, selector, html);
}

async function waitForNewAssistantResponse(frame, previousAssistantCount, timeoutMs) {
  try {
    await frame.waitForFunction(
      (selector, markers, prev) => {
        const assistants = Array.from(document.querySelectorAll(selector));
        if (assistants.length <= prev) return false;
        const last = assistants[assistants.length - 1];
        const text = (last && last.textContent ? last.textContent : '').trim();
        if (!text) return false;
        if (text.startsWith('⏳') || text.startsWith('⌛')) return false;
        const lower = text.toLowerCase();
        return !markers.some((marker) => lower.includes(marker));
      },
      { timeout: timeoutMs },
      ASSISTANT_TEXT_SELECTOR,
      PROGRESS_MARKERS,
      previousAssistantCount
    );
  } catch (_e) {
    process.stderr.write(`Warning: assistant response was not observed within ${timeoutMs} ms\n`);
  }
}
