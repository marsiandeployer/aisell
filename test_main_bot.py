#!/usr/bin/env python3
"""Test bot on main server (noxonbot)"""
import os
import sys
from pyrogram import Client
from dotenv import load_dotenv
import time

load_dotenv('/root/space2/hababru/.env')

api_id = int(os.getenv('TELEGRAM_API_ID'))
api_hash = os.getenv('TELEGRAM_API_HASH')
session_string = os.getenv('TELEGRAM_SESSION_STRING')

BOT_USERNAME = "@noxonbot"
TEST_MESSAGE = "ко hello"

print(f"🤖 Testing '{TEST_MESSAGE}' on {BOT_USERNAME} (main server)")
print("=" * 60)

client = Client("test_main", api_id=api_id, api_hash=api_hash, session_string=session_string)

with client:
    print(f"✅ Connected as: {client.get_me().first_name}")

    print(f"📤 Sending: {TEST_MESSAGE}")
    sent_msg = client.send_message(BOT_USERNAME, TEST_MESSAGE)

    print(f"✅ Message sent, waiting for response...")

    start_time = time.time()
    timeout = 35

    while time.time() - start_time < timeout:
        time.sleep(2)

        messages = list(client.get_chat_history(BOT_USERNAME, limit=5))

        for msg in messages:
            if msg.date > sent_msg.date and msg.from_user and msg.from_user.is_bot:
                text = msg.text or "[media]"
                print(f"\n✅ Bot responded:")
                print(f"{'=' * 60}")
                print(text[:500])
                if len(text) > 500:
                    print("...[truncated]")
                print(f"{'=' * 60}")

                if "Ошибка авторизации" in text or "authentication error" in text.lower():
                    print("\n❌ AUTH ERROR on main server too!")
                    sys.exit(1)
                else:
                    print(f"\n✅ Test PASSED - Main server Codex is working!")
                    sys.exit(0)

    print(f"\n⏰ Timeout (waited {timeout}s)")
    sys.exit(1)
