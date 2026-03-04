#!/usr/bin/env python3
"""Test 'кл' (Claude) command on production bots"""
import os
import sys
from pyrogram import Client
from dotenv import load_dotenv
import time

load_dotenv('/root/space2/hababru/.env')

api_id = int(os.getenv('TELEGRAM_API_ID'))
api_hash = os.getenv('TELEGRAM_API_HASH')
session_string = os.getenv('TELEGRAM_SESSION_STRING')

BOT_USERNAME = "@clodeboxbot"
TEST_MESSAGE = "кл привет"

print(f"🤖 Testing '{TEST_MESSAGE}' command on {BOT_USERNAME}")
print("=" * 60)

client = Client("test_claude", api_id=api_id, api_hash=api_hash, session_string=session_string)

with client:
    print(f"✅ Connected as: {client.get_me().first_name}")

    print(f"📤 Sending: {TEST_MESSAGE}")
    sent_msg = client.send_message(BOT_USERNAME, TEST_MESSAGE)

    print(f"✅ Message sent, waiting for response...")

    start_time = time.time()
    timeout = 30

    while time.time() - start_time < timeout:
        time.sleep(2)

        messages = list(client.get_chat_history(BOT_USERNAME, limit=5))

        for msg in messages:
            if msg.date > sent_msg.date and msg.from_user and msg.from_user.is_bot:
                print(f"\n✅ Bot responded:")
                print(f"{'=' * 60}")
                print(msg.text or "[media/other content]")
                print(f"{'=' * 60}")
                print(f"\n✅ Test PASSED - Claude is working!")
                sys.exit(0)

    print(f"\n⏰ Timeout (waited {timeout}s)")
    sys.exit(1)
