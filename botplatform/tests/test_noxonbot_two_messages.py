#!/usr/bin/env python3
"""
Smoke test: send two prompts quickly and ensure second is not blocked by
"already running task" guard.

Usage:
  timeout 120s python3 tests/test_noxonbot_two_messages.py
"""

import asyncio
import os
import sys
import time

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
from pyrogram_testkit.env import load_env_files, read_telegram_creds
from pyrogram_testkit.client import build_client

load_env_files((
    '/root/space2/hababru/.env',
    '/root/aisell/noxonbot/.env',
    '/root/space2/noxonbot/.env',
))

BOT_USERNAME = os.environ.get('TEST_BOT_USERNAME', 'noxonbot')
TIMEOUT_SECONDS = int(os.environ.get('TEST_TIMEOUT_SECONDS', '25'))
PROMPT_1 = os.environ.get('TEST_PROMPT_1', 'Ответь ровно OK')
PROMPT_2 = os.environ.get('TEST_PROMPT_2', 'Снова ответь ровно OK')

BLOCK_PATTERNS = (
    'у вас уже выполняется',
    'already have a task running',
)


def extract_text(msg) -> str:
    if getattr(msg, 'text', None):
        return str(msg.text)
    if getattr(msg, 'caption', None):
        return str(msg.caption)
    return ''


async def main() -> None:
    creds = read_telegram_creds()
    if not creds.api_id or not creds.api_hash:
        raise RuntimeError('Telegram credentials are missing in env files')

    app = build_client(session_name='noxonbot_two_messages_test', creds=creds)
    await app.start()
    try:
        await app.send_message(BOT_USERNAME, '/new')
        await asyncio.sleep(1)
        first = await app.send_message(BOT_USERNAME, PROMPT_1)
        await asyncio.sleep(0.7)
        second = await app.send_message(BOT_USERNAME, PROMPT_2)

        min_message_id = min(first.id, second.id)
        deadline = time.time() + TIMEOUT_SECONDS
        got_any_status = False

        while time.time() < deadline:
            incoming = []
            async for msg in app.get_chat_history(BOT_USERNAME, limit=40):
                if msg.id <= min_message_id:
                    break
                incoming.append(msg)

            incoming.reverse()
            for msg in incoming:
                text = extract_text(msg).strip()
                if not text:
                    continue
                low = text.lower()
                if any(pat in low for pat in BLOCK_PATTERNS):
                    raise AssertionError(f'Second message was blocked: {text[:300]}')
                if 'запускаю claude' in low or 'launching claude' in low:
                    got_any_status = True

            if got_any_status:
                print('PASS: no running-task block detected for second message')
                return

            await asyncio.sleep(1)

        raise TimeoutError('No status messages received in time')
    finally:
        await app.stop()


if __name__ == '__main__':
    asyncio.run(main())

