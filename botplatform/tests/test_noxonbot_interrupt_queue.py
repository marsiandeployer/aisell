#!/usr/bin/env python3
"""
Smoke test for interrupt + queue behavior:
1) first prompt starts
2) second prompt interrupts first
3) third prompt is queued
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

    app = build_client(session_name='noxonbot_interrupt_queue_test', creds=creds)
    await app.start()
    try:
        await app.send_message(BOT_USERNAME, '/new')
        await asyncio.sleep(1)

        first = await app.send_message(BOT_USERNAME, 'первый запрос')
        await asyncio.sleep(0.5)
        second = await app.send_message(BOT_USERNAME, 'второй запрос')
        await asyncio.sleep(0.5)
        third = await app.send_message(BOT_USERNAME, 'третий запрос')

        min_message_id = min(first.id, second.id, third.id)
        deadline = time.time() + TIMEOUT_SECONDS
        saw_interrupt = False
        saw_queue = False

        while time.time() < deadline:
            incoming = []
            async for msg in app.get_chat_history(BOT_USERNAME, limit=60):
                if msg.id <= min_message_id:
                    break
                incoming.append(msg)
            incoming.reverse()

            for msg in incoming:
                text = extract_text(msg).strip().lower()
                if not text:
                    continue
                if 'прерываю предыдущий запрос' in text or 'interrupting previous task' in text:
                    saw_interrupt = True
                if 'поставлена в очередь' in text or 'task queued' in text:
                    saw_queue = True

            if saw_interrupt and saw_queue:
                print('PASS: interrupt + queue behavior detected')
                return

            await asyncio.sleep(1)

        raise TimeoutError(
            f'Expected interrupt+queue messages not found (interrupt={saw_interrupt}, queue={saw_queue})'
        )
    finally:
        await app.stop()


if __name__ == '__main__':
    asyncio.run(main())

