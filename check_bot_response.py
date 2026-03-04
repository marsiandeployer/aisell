#!/usr/bin/env python3
"""Check final bot response"""
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

client = Client("check_response", api_id=api_id, api_hash=api_hash, session_string=session_string)

with client:
    print(f"📥 Checking latest messages from {BOT_USERNAME}...")
    print("=" * 60)

    messages = list(client.get_chat_history(BOT_USERNAME, limit=5))

    for i, msg in enumerate(messages):
        if msg.from_user and msg.from_user.is_bot:
            timestamp = msg.date.strftime("%Y-%m-%d %H:%M:%S")
            text = msg.text or "[media/other]"
            print(f"\n[{i+1}] {timestamp}")
            print("-" * 60)
            print(text[:500])  # First 500 chars
            if len(text) > 500:
                print("...[truncated]...")
            print("-" * 60)

    print("\n✅ Done")
