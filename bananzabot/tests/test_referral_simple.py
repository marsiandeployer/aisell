#!/usr/bin/env python3
"""
Simple test of referral tracking on existing @bananzatestbot.

Tests /start with r_ and t_ parameters and checks if admin notifications arrive.
"""

import asyncio
import os
import sys
import time

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", "shared"))
from pyrogram_testkit.env import load_env_files, read_telegram_creds
from pyrogram_testkit.client import WaitConfig, build_client, send_text_and_wait

load_env_files(("/root/space2/hababru/.env",))

TEST_BOT = "bananzatestbot"
ADMIN_ID = 6119567381


async def main():
    print("=" * 60)
    print("🧪 Referral Tracking Test on @bananzatestbot")
    print("=" * 60)

    creds = read_telegram_creds()
    app = build_client(session_name="ref_test", creds=creds)

    try:
        await app.start()
        me = await app.get_me()
        print(f"✅ Connected as: @{me.username} (ID: {me.id})")

        # Test 1: r_ parameter (referral source)
        print("\n📋 Test 1: /start with r_telegram")
        msg = await send_text_and_wait(
            app,
            chat_id=TEST_BOT,
            text="/start r_telegram",
            config=WaitConfig(timeout_seconds=10),
        )
        print(f"✅ Bot response: {msg.text[:100] if msg else 'No response'}...")

        # Check admin notification (in own saved messages)
        await asyncio.sleep(3)
        print("\n🔍 Checking for admin notification...")
        found_r = False
        async for message in app.get_chat_history("me", limit=20):
            if message.text and "Реферальный источник" in message.text and "telegram" in message.text:
                found_r = True
                print(f"✅ Admin notification found (r_): {message.text[:200]}...")
                break

        if not found_r:
            print("❌ Admin notification NOT found for r_ parameter")

        # Test 2: t_ parameter (tracking campaign)
        print("\n📋 Test 2: /start with t_test_campaign")
        msg = await send_text_and_wait(
            app,
            chat_id=TEST_BOT,
            text="/start t_test_campaign",
            config=WaitConfig(timeout_seconds=10),
        )
        print(f"✅ Bot response: {msg.text[:100] if msg else 'No response'}...")

        # Check admin notification
        await asyncio.sleep(3)
        print("\n🔍 Checking for admin notification...")
        found_t = False
        async for message in app.get_chat_history("me", limit=20):
            if message.text and "Tracking кампания" in message.text and "test_campaign" in message.text:
                found_t = True
                print(f"✅ Admin notification found (t_): {message.text[:200]}...")
                break

        if not found_t:
            print("❌ Admin notification NOT found for t_ parameter")

        print("\n" + "=" * 60)
        print(f"📊 Summary:")
        print(f"r_ parameter: {'✅ PASS' if found_r else '❌ FAIL'}")
        print(f"t_ parameter: {'✅ PASS' if found_t else '❌ FAIL'}")
        print("=" * 60)

        success = found_r and found_t
        await app.stop()
        return 0 if success else 1

    except Exception as e:
        print(f"❌ Error: {e}")
        if app:
            await app.stop()
        return 2


if __name__ == "__main__":
    code = asyncio.run(main())
    raise SystemExit(code)
