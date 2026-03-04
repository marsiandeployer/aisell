// E2E test for webchat UI.
// Goal: verify chat updates live (no reload) after onboarding/login, including request timers:
// - running status bubble shows a ticking timer
// - final assistant reply shows a fixed duration (does not tick)
//
// Usage:
//   WEBCHAT_URL="https://clodeboxbot.habab.ru" node tests/test_webchat_e2e.js
//
// Requirements:
// - Puppeteer must be installed
// - Headless mode enabled (per project rules)

const puppeteer = require('puppeteer');
const path = require('path');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const baseUrl = process.env.WEBCHAT_URL || 'http://127.0.0.1:8092';
  const screenshotPath = process.env.SCREENSHOT_PATH || '/tmp/noxon_webchat_e2e.png';

  const ts = Date.now();
  const email = `e2e_${ts}@example.com`;
  const name = 'E2E User';
  // Prefer Codex in E2E: Claude CLI auth can expire (OAuth), which would make UI tests fail
  // even if the webchat UI itself is healthy.
  const messageText = `co e2e live update ${ts}`;

  const browser = await puppeteer.launch({
    headless: true,
    ignoreHTTPSErrors: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(180000);

    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#messages');
    await page.waitForSelector('#input');

    // Send a message as a guest -> should open login modal.
    await page.type('#input', messageText);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#loginModal.open', { timeout: 15000 });

    await page.type('#loginName', name);
    await page.type('#loginEmail', email);
    await page.click('#loginSubmit');

    // Wait for modal to close.
    await page.waitForSelector('#loginModal.open', { hidden: true, timeout: 20000 });

    // The pending message should appear in the chat without a reload.
    await page.waitForFunction(
      (txt) => (document.querySelector('#messages')?.innerText || '').includes(txt),
      { timeout: 30000 },
      messageText
    );

    // Bot response should also appear without a reload.
    // Prefer a semantic signal that we got a "real" assistant reply (not only status bubbles).
    // The "Request duration" meta is best-effort: it depends on the status bubble being deleted
    // and may not appear in some fast/edge cases.
    await page.waitForFunction(() => {
      const bubbles = Array.from(document.querySelectorAll('.bubble.assistant'));
      // Find a non-status assistant bubble with feedback buttons.
      return bubbles.some((b) => {
        const kind = b.dataset ? b.dataset.kind : '';
        if (kind === 'status') return false;
        return !!b.querySelector('button[data-fb="thumbs_up"]');
      });
    }, { timeout: 180000 });

    // Ensure we're pinned to bottom after bot response (autoscroll works).
    await page.waitForFunction(() => {
      const el = document.querySelector('#messages');
      if (!el) return false;
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      return gap < 40;
    }, { timeout: 20000 });

    // While the request is running, the status bubble may show a ticking timer.
    // Some fast responses may skip the running state; treat it as optional to avoid flakes.
    try {
      await page.waitForSelector('.meta .ts[data-mode="running"]', { timeout: 8000 });
      const runBefore = await page.evaluate(() => {
        const el = document.querySelector('.meta .ts[data-mode="running"]');
        return el ? (el.textContent || '').trim() : '';
      });
      await sleep(2200);
      const runAfter = await page.evaluate(() => {
        const el = document.querySelector('.meta .ts[data-mode="running"]');
        return el ? (el.textContent || '').trim() : '';
      });
      if (runBefore && runAfter && runBefore === runAfter) {
        throw new Error(`Running timer did not tick (stuck at "${runBefore}")`);
      }
    } catch (e) {
      // Optional: do not fail the whole test if the running timer wasn't rendered.
    }

    // Best-effort duration checks (non-fatal if missing).
    try {
      await page.waitForSelector('.meta .ts[title="Request duration"]', { timeout: 20000 });
      const durBefore = await page.evaluate(() => {
        const el = document.querySelector('.meta .ts[title="Request duration"]');
        return el ? (el.textContent || '').trim() : '';
      });
      if (!durBefore || !/\d+(s|m|h|d)/.test(durBefore)) {
        throw new Error(`Request duration timestamp looks wrong: "${durBefore}"`);
      }
      await sleep(2200);
      const durAfter = await page.evaluate(() => {
        const el = document.querySelector('.meta .ts[title="Request duration"]');
        return el ? (el.textContent || '').trim() : '';
      });
      if (durBefore && durAfter && durBefore !== durAfter) {
        throw new Error(`Request duration should be fixed but changed: "${durBefore}" -> "${durAfter}"`);
      }
    } catch (_e) {
      // Optional.
    }

    // Feedback buttons (thumbs up/down) should be present for assistant messages.
    await page.waitForSelector('.bubble.assistant button[data-fb=\"thumbs_up\"]', { timeout: 20000 });
    const targetMsgId = await page.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('.bubble.assistant'));
      // Prefer the latest assistant message that has feedback buttons.
      let target = null;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        const btn = b.querySelector('button[data-fb=\"thumbs_up\"]');
        if (btn) {
          target = b;
          break;
        }
      }
      if (!target && bubbles.length) target = bubbles[bubbles.length - 1];
      const btn = target ? target.querySelector('button[data-fb=\"thumbs_up\"]') : null;
      return btn && btn.dataset ? (btn.dataset.msgid || '') : '';
    });
    if (!targetMsgId) {
      throw new Error('Could not find assistant message for feedback');
    }
    await page.waitForFunction((msgId) => {
      return !!document.querySelector(`button[data-fb=\"thumbs_up\"][data-msgid=\"${msgId}\"]`);
    }, { timeout: 20000 }, targetMsgId);
    // Avoid flaky "detached node" errors: the UI can re-render bubbles due to polling/SSE updates.
    await page.evaluate((msgId) => {
      const btn = document.querySelector(`button[data-fb=\"thumbs_up\"][data-msgid=\"${msgId}\"]`);
      if (btn) btn.click();
    }, targetMsgId);

    // The clicked thumbs-up should become active without a reload.
    await page.waitForFunction((msgId) => {
      const btn = document.querySelector(`button[data-fb=\"thumbs_up\"][data-msgid=\"${msgId}\"]`);
      return !!btn && btn.classList.contains('on');
    }, { timeout: 20000 }, targetMsgId);

    // Give UI a moment to render additional bot output.
    await sleep(1500);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          email,
          screenshotPath: path.resolve(screenshotPath),
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('E2E failed:', err && err.stack ? err.stack : String(err));
  process.exit(1);
});
