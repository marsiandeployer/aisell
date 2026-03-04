#!/usr/bin/env python3
"""
Pyrogram smoke test for @noxonbot flow.

Scenario:
1) Send text prompt to bot
2) Verify bot responds
3) Verify bot does not return SDK bridge startup error
4) Optional strict mode: require final response to include "OK"

Usage:
  timeout 120s python3 tests/test_noxonbot_claude_ok.py
  EXPECT_OK=true TEST_PROMPT="Ответь ровно OK" timeout 120s python3 tests/test_noxonbot_claude_ok.py
"""

import asyncio
import os
import re
import sys
import time
from typing import Optional

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
from pyrogram_testkit.env import load_env_files, read_telegram_creds
from pyrogram_testkit.client import build_client

load_env_files((
    '/root/space2/hababru/.env',
    '/root/aisell/noxonbot/.env',
    '/root/space2/noxonbot/.env',
))

BOT_USERNAME = os.environ.get('TEST_BOT_USERNAME', 'noxonbot')
PROMPT = os.environ.get('TEST_PROMPT', 'Ответь ровно OK')
TIMEOUT_SECONDS = int(os.environ.get('TEST_TIMEOUT_SECONDS', '10'))
EXPECT_OK = os.environ.get('EXPECT_OK', 'true').lower() == 'true'
ALLOW_STATUS_ONLY = os.environ.get('ALLOW_STATUS_ONLY', 'false').lower() == 'true'

BRIDGE_ERROR = 'Failed to start Claude SDK bridge on localhost'


def extract_text(msg) -> str:
    if not msg:
        return ''
    if getattr(msg, 'text', None):
        return str(msg.text)
    if getattr(msg, 'caption', None):
        return str(msg.caption)
    return ''

def is_status_message(text: str) -> bool:
    low = text.lower()
    return (
        'запускаю claude' in low
        or 'launching claude' in low
        or '⏳' in text
        or '📝 промпт:' in low
        or '📚 история:' in low
    )


async def wait_for_response(app, bot_username: str, min_message_id: int, timeout_seconds: int) -> Optional[str]:
    deadline = time.time() + timeout_seconds
    last_seen = min_message_id

    while time.time() < deadline:
        incoming = []
        async for msg in app.get_chat_history(bot_username, limit=20):
            if msg.id <= min_message_id:
                break
            incoming.append(msg)

        incoming.reverse()
        for msg in incoming:
            if msg.id <= last_seen:
                continue
            last_seen = max(last_seen, msg.id)

            text = extract_text(msg).strip()
            if not text:
                continue

            print(f"[bot] {text[:300]}")
            low = text.lower()

            if BRIDGE_ERROR.lower() in low:
                raise RuntimeError(f'Bridge startup error returned by bot: {text}')

            if 'ошибка выполнения' in low or 'error' in low:
                # If bot explicitly reports execution error, fail fast.
                if 'запускаю' not in low and 'launching' not in low:
                    raise RuntimeError(f'Execution error returned by bot: {text}')

            if is_status_message(text):
                if ALLOW_STATUS_ONLY and not EXPECT_OK:
                    return text
                continue

            if re.search(r'\bOK\b', text, re.IGNORECASE):
                return text

        await asyncio.sleep(1)

    return None


async def main():
    creds = read_telegram_creds()
    if not creds.api_id or not creds.api_hash:
        raise RuntimeError('Telegram credentials are missing in env files')

    app = build_client(session_name='noxonbot_ok_test', creds=creds)
    await app.start()
    try:
        me = await app.get_me()
        print(f'[info] Connected as @{me.username or me.id}')
        await app.send_message(BOT_USERNAME, '/new')
        await asyncio.sleep(1)
        print(f'[info] Sending to @{BOT_USERNAME}: {PROMPT}')

        sent = await app.send_message(BOT_USERNAME, PROMPT)
        reply = await wait_for_response(app, BOT_USERNAME, sent.id, TIMEOUT_SECONDS)

        if not reply:
            raise TimeoutError(f'No bot response within {TIMEOUT_SECONDS}s')

        if EXPECT_OK and not re.search(r'\bOK\b', reply, re.IGNORECASE):
            raise AssertionError(f'EXPECT_OK=true but final visible response does not contain OK: {reply[:300]}')

        print('PASS: bot responded and no SDK bridge startup error')
    finally:
        await app.stop()


if __name__ == '__main__':
    asyncio.run(main())
