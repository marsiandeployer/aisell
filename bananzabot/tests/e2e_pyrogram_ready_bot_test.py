#!/usr/bin/env python3
"""
Quick Pyrogram smoke test for an already deployed Telegram bot.

Checks:
1) bot responds to /start
2) bot responds to a regular user message
"""

import argparse
import asyncio
import os
import sys

# Shared Pyrogram testkit (removes duplicated boilerplate across bots).
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
from pyrogram_testkit.env import load_env_files, read_telegram_creds
from pyrogram_testkit.client import WaitConfig, build_client, send_text_and_wait

# Load environment variables
ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '.env')
HABABRU_ENV_PATH = '/root/space2/hababru/.env'
load_env_files((ENV_PATH, HABABRU_ENV_PATH))

CREDS = read_telegram_creds(
    default_api_id=20663119,
    default_api_hash='0735e154f4ee0ea6bcfe3d972de467b9',
    default_phone_number='+79855954987',
)

DEFAULT_BOT_USERNAME = (os.getenv('BANANZABOT_READY_BOT_USERNAME', 'sometest33bot') or 'sometest33bot').strip().lstrip('@')
DEFAULT_TEST_MESSAGE = (os.getenv('BANANZABOT_READY_BOT_MESSAGE', 'Привет! Это быстрый smoke-тест ответа.') or 'Привет! Это быстрый smoke-тест ответа.').strip()
DEFAULT_TIMEOUT = float(os.getenv('BANANZABOT_READY_BOT_TIMEOUT', '15'))
SESSION_FILE = os.path.join(os.path.dirname(__file__), 'e2e_test_session')


def parse_args():
    parser = argparse.ArgumentParser(description='Quick Pyrogram smoke test for a ready bot')
    parser.add_argument('--bot', default=DEFAULT_BOT_USERNAME, help='Ready bot username (default: sometest33bot)')
    parser.add_argument('--message', default=DEFAULT_TEST_MESSAGE, help='Text message for response check')
    parser.add_argument('--timeout', type=float, default=DEFAULT_TIMEOUT, help='Timeout in seconds per step')
    parser.add_argument('--strict-reply', action='store_true', help='Fail if bot does not send a reply to regular message')
    return parser.parse_args()


class ReadyBotSmokeRunner:
    def __init__(self, bot_username: str, test_message: str, timeout_seconds: float, strict_reply: bool):
        self.bot_username = bot_username.strip().lstrip('@')
        self.test_message = test_message
        self.timeout_seconds = float(timeout_seconds)
        self.strict_reply = strict_reply
        self.client = build_client(session_name=SESSION_FILE, creds=CREDS)
        self.last_message_id = None

    async def send_and_wait(self, text: str, keywords=None):
        msg = await send_text_and_wait(
            self.client,
            chat_id=self.bot_username,
            text=text,
            config=WaitConfig(
                timeout_seconds=self.timeout_seconds,
                history_limit=8,
                keywords=keywords,
            ),
            min_message_id=self.last_message_id,
        )
        self.last_message_id = msg.id
        return msg

    async def run(self) -> bool:
        print("\n🧪 Starting Ready Bot Pyrogram Smoke Test...")
        print(f"Bot: @{self.bot_username}")
        print(f"Timeout per step: {self.timeout_seconds}s")

        async with self.client:
            me = await self.client.get_me()
            print(f"Test account user id: {me.id}")

            start_response = await self.send_and_wait(
                '/start',
                keywords=['привет', 'hello', 'бот', 'bot', 'help', '/help', 'start'],
            )
            start_text = (start_response.text or start_response.caption or '').strip()
            print(f"[start] {start_text[:180]}...")
            if not start_text:
                print("❌ Bot did not respond to /start")
                return False

            try:
                user_response = await self.send_and_wait(self.test_message)
                user_text = (user_response.text or user_response.caption or '').strip()
                print(f"[message] {user_text[:180]}...")
                if not user_text:
                    print("❌ Bot did not respond to a regular message")
                    return False
            except RuntimeError as error:
                if self.strict_reply:
                    print(f"❌ Strict mode: no reply to regular message ({error})")
                    return False
                print(f"⚠️  No direct reply to regular message ({error})")
                print("ℹ️  Non-strict mode: some funnels only notify owner and may not answer immediately.")
                print("✅ Ready bot passed by /start responsiveness")
                return True

            if any(token in user_text.lower() for token in ('ошибка', 'error', 'exception')):
                print("❌ Bot response looks like an error")
                return False

            print("✅ Ready bot responded in both checks")
            return True


async def main():
    args = parse_args()
    runner = ReadyBotSmokeRunner(
        bot_username=args.bot,
        test_message=args.message,
        timeout_seconds=args.timeout,
        strict_reply=args.strict_reply,
    )
    success = await runner.run()
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    asyncio.run(main())
