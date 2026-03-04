#!/usr/bin/env python3
"""Test 'ко' command on production bots"""
import os
import sys
from pyrogram import Client
from dotenv import load_dotenv
import time

# Load env from hababru (where Telegram credentials are stored)
load_dotenv('/root/space2/hababru/.env')

# Get credentials
api_id = int(os.getenv('TELEGRAM_API_ID'))
api_hash = os.getenv('TELEGRAM_API_HASH')
session_string = os.getenv('TELEGRAM_SESSION_STRING')

if not all([api_id, api_hash, session_string]):
    print("❌ Missing Telegram credentials in .env")
    sys.exit(1)

# Target bot - test with clodeboxbot on production
BOT_USERNAME = "@clodeboxbot"
TEST_MESSAGE = "ко привет"

print(f"🤖 Testing '{TEST_MESSAGE}' command on {BOT_USERNAME}")
print("=" * 60)

# Create client with session string
client = Client("test_ko", api_id=api_id, api_hash=api_hash, session_string=session_string)

with client:
    print(f"✅ Connected as: {client.get_me().first_name}")

    # Send test message
    print(f"📤 Sending: {TEST_MESSAGE}")
    sent_msg = client.send_message(BOT_USERNAME, TEST_MESSAGE)

    print(f"✅ Message sent, waiting for response...")

    # Wait for response (check messages for 30 seconds)
    start_time = time.time()
    timeout = 30

    while time.time() - start_time < timeout:
        time.sleep(2)

        # Get chat history
        messages = list(client.get_chat_history(BOT_USERNAME, limit=5))

        # Find bot's response (after our message)
        for msg in messages:
            if msg.date > sent_msg.date and msg.from_user and msg.from_user.is_bot:
                print(f"\n✅ Bot responded:")
                print(f"{'=' * 60}")
                print(msg.text or "[media/other content]")
                print(f"{'=' * 60}")
                print(f"\n✅ Test PASSED - Bot is working with 'ко' command!")
                sys.exit(0)

    print(f"\n⏰ Timeout waiting for response (waited {timeout}s)")
    print("⚠️ Bot may still be processing, check manually")
    sys.exit(1)
