#!/usr/bin/env python3
"""
Test referral tracking for bananzabot deployed bots.

Tests:
1. Deploy a bot via @bananza_bot with token @sometest33bot
2. Test /start with r_ parameter (referral source)
3. Test /start with t_ parameter (tracking campaign)
4. Verify admin receives notifications with user info
"""

import asyncio
import os
import sys
import time
from pathlib import Path

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", "shared"))
from pyrogram_testkit.env import load_env_files, read_telegram_creds
from pyrogram_testkit.client import WaitConfig, build_client, send_text_and_wait

load_env_files(
    (
        "/root/space2/hababru/.env",
        "/root/aisell/bananzabot/.env",
    )
)

BANANZA_BOT = "bananza_bot"
TEST_BOT_TOKEN = "6494215218:AAF8thv5S_S0OxDgyJ-k2D93HrRUtoURmFQ"
TEST_BOT_USERNAME = "sometest33bot"
ADMIN_ID = 6119567381
TIMEOUT_SECONDS = 15


class ReferralTest:
    def __init__(self):
        self.creds = read_telegram_creds()
        self.app = None
        self.me = None
        self.last_message_id = {}
        self.ok = 0
        self.fail = 0

    def _check(self, cond: bool, name: str, detail: str = "") -> bool:
        if cond:
            self.ok += 1
            print(f"✅ {name}" + (f" - {detail}" if detail else ""))
        else:
            self.fail += 1
            print(f"❌ {name}" + (f" - {detail}" if detail else ""))
        return cond

    async def connect(self) -> bool:
        print("🔗 Connecting to Telegram...")
        try:
            self.app = build_client(session_name="bananza_ref_test", creds=self.creds)
            await self.app.start()
            self.me = await self.app.get_me()
            print(f"✅ Connected as: @{self.me.username} (ID: {self.me.id})")
            return True
        except Exception as e:
            return self._check(False, "Telegram connect", str(e))

    async def disconnect(self) -> None:
        if self.app:
            await self.app.stop()
            print("✅ Disconnected from Telegram")

    async def send_and_wait(self, bot: str, text: str):
        msg = await send_text_and_wait(
            self.app,
            chat_id=bot,
            text=text,
            config=WaitConfig(timeout_seconds=TIMEOUT_SECONDS),
            min_message_id=self.last_message_id.get(bot),
        )
        if msg:
            self.last_message_id[bot] = msg.id
        return msg

    async def test_deploy_bot(self) -> bool:
        """Deploy test bot via @bananza_bot"""
        print("\n📋 Test 1: Deploy bot via @bananza_bot")

        # Start bananzabot
        msg = await self.send_and_wait(BANANZA_BOT, "/start")
        self._check(bool(msg), "Bananzabot /start response")

        # Send bot description
        msg = await self.send_and_wait(BANANZA_BOT, "Тестовый бот для проверки реферальных ссылок")
        self._check(bool(msg), "Bot description sent")

        # Wait for token request
        await asyncio.sleep(2)

        # Send token
        msg = await self.send_and_wait(BANANZA_BOT, TEST_BOT_TOKEN)
        self._check(bool(msg), "Token sent")

        # Wait for deployment (up to 60 seconds)
        print("⏳ Waiting for deployment (up to 60s)...")
        for i in range(12):
            await asyncio.sleep(5)
            # Check if deployment message arrived
            async for message in self.app.get_chat_history(BANANZA_BOT, limit=5):
                if message.text and "Деплой успешно завершен" in message.text:
                    self._check(True, "Bot deployed successfully")
                    # Check if referral instructions are present
                    has_referral = "Реферальные ссылки" in message.text and "?start=r_" in message.text
                    self._check(has_referral, "Referral instructions present", "Found in deployment message")
                    return True

        return self._check(False, "Deployment timed out", "No success message within 60s")

    async def test_referral_parameters(self) -> bool:
        """Test r_ and t_ parameters"""
        print("\n📋 Test 2: Test referral parameters")

        # Test r_ parameter (referral source)
        print(f"📤 Testing /start with r_telegram parameter...")
        msg = await self.send_and_wait(TEST_BOT_USERNAME, "/start r_telegram")
        self._check(bool(msg), "Bot responds to /start with r_ parameter")

        # Wait for admin notification
        await asyncio.sleep(2)
        admin_notified_r = False
        async for message in self.app.get_chat_history("me", limit=10):
            if message.text and "Реферальный источник: telegram" in message.text:
                admin_notified_r = True
                break

        self._check(admin_notified_r, "Admin notified about r_ referral", "Found notification in admin chat")

        # Test t_ parameter (tracking campaign)
        print(f"📤 Testing /start with t_campaign1 parameter...")
        msg = await self.send_and_wait(TEST_BOT_USERNAME, "/start t_campaign1")
        self._check(bool(msg), "Bot responds to /start with t_ parameter")

        # Wait for admin notification
        await asyncio.sleep(2)
        admin_notified_t = False
        async for message in self.app.get_chat_history("me", limit=10):
            if message.text and "Tracking кампания: campaign1" in message.text:
                admin_notified_t = True
                break

        self._check(admin_notified_t, "Admin notified about t_ tracking", "Found notification in admin chat")

        return True

    async def run(self) -> int:
        if not await self.connect():
            return 2

        try:
            await self.test_deploy_bot()
            await self.test_referral_parameters()
        finally:
            await self.disconnect()

        print("\n" + "=" * 60)
        print(f"📊 Referral Tracking Test Summary")
        print("=" * 60)
        print(f"✅ Passed: {self.ok}")
        print(f"❌ Failed: {self.fail}")
        print(f"📈 Total: {self.ok + self.fail}")
        print(f"🎯 Success rate: {self.ok/(self.ok + self.fail)*100:.1f}%")
        print("=" * 60)

        return 0 if self.fail == 0 else 1


def main() -> None:
    code = asyncio.run(ReferralTest().run())
    raise SystemExit(code)


if __name__ == "__main__":
    main()
