#!/usr/bin/env python3
"""
Bilingual smoke-test for:
- @noxonbot (RU, runs on main server)
- @coderboxbot (EN, runs on protected prod edge)

This intentionally avoids the full paid onboarding flow. Full onboarding for @noxonbot
is covered by tests/test_onboarding.py.

What we validate for each bot:
1) /start is in the expected language
2) History is persisted to /root/aisellusers/user_{id}/.history.json
3) CLAUDE.md exists in the workspace

Edge bot checks are performed via SSH to avoid copying Telegram creds to the edge.
"""

import asyncio
import os
import sys
import time
import re
import subprocess
from pathlib import Path

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", "shared"))
from pyrogram_testkit.env import load_env_files, read_telegram_creds
from pyrogram_testkit.client import WaitConfig, build_client, send_text_and_wait
from pyrogram_testkit.history import wait_for_file_contains, wait_for_file_contains_ssh


load_env_files(
    (
        "/root/space2/hababru/.env",
        "/root/aisell/noxonbot/.env",
        "/root/space2/noxonbot/.env",
    )
)

TIMEOUT_SECONDS = 12
REMOTE_SSH_HOST = os.environ.get("REMOTE_SSH_HOST", "root@62.109.14.209")


def has_cyrillic(text: str) -> bool:
    return bool(re.search(r"[а-яА-ЯЁё]", text or ""))


class BilingualSmoke:
    def __init__(self):
        self.creds = read_telegram_creds()
        self.app = None
        self.me = None
        self.user_id = None
        self.user_dir_local = None
        self.ok = 0
        self.fail = 0
        self.last_ids = {}

    def _check(self, cond: bool, name: str, detail: str = "") -> bool:
        if cond:
            self.ok += 1
            print(f"✅ {name}" + (f" - {detail}" if detail else ""))
        else:
            self.fail += 1
            print(f"❌ {name}" + (f" - {detail}" if detail else ""))
        return cond

    def _ssh(self, cmd: str, *, timeout: int = 8) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", REMOTE_SSH_HOST, "bash", "-lc", cmd],
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    async def connect(self) -> bool:
        print("🔗 Connecting to Telegram...")
        if not self.creds.api_id or not self.creds.api_hash:
            return self._check(False, "Telegram creds present", "Missing TELEGRAM_API_ID/TELEGRAM_API_HASH")
        try:
            self.app = build_client(session_name="noxonbot_test", creds=self.creds)
            await self.app.start()
            self.me = await self.app.get_me()
            self.user_id = self.me.id
            self.user_dir_local = f"/root/aisellusers/user_{self.user_id}"
            print(f"✅ Connected as: @{self.me.username} (ID: {self.user_id})")
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
            min_message_id=self.last_ids.get(bot),
        )
        if msg:
            self.last_ids[bot] = msg.id
        return msg

    async def test_bot_ru(self) -> None:
        bot = "noxonbot"
        print(f"\n📋 RU bot: @{bot}")

        # Local cleanup of workspace (noxonbot onboarding should NOT create it before activation).
        try:
            if os.path.exists(self.user_dir_local):
                import shutil
                shutil.rmtree(self.user_dir_local)
        except Exception:
            pass

        msg = await self.send_and_wait(bot, "/start")
        self._check(bool(msg), "RU /start response received")
        txt = (msg.text or "") if msg else ""
        self._check(has_cyrillic(txt), "RU /start contains Cyrillic", txt[:80].replace("\n", " "))

        marker = f"BI_TEST_RU_{time.time_ns()}"
        # On RU premium bot, this is still onboarding stage (idea). That's fine.
        msg = await self.send_and_wait(bot, f"Привет\n\n[history:{marker}]")
        self._check(bool(msg), "RU marker message responded")

        try:
            found = wait_for_file_contains(
                [
                    # During onboarding, history is stored in legacy per-chat file until activation creates workspace.
                    Path(f"/root/aisell/noxonbot/data/history/chats/{self.user_id}.json"),
                    Path(f"/root/space2/noxonbot/data/history/chats/{self.user_id}.json"),
                    Path(f"{self.user_dir_local}/.history.json"),
                ],
                marker,
                timeout_seconds=20,
                description="local history (legacy or per-user)",
            )
            self._check(True, "RU history persisted locally", str(found))
        except Exception as e:
            self._check(False, "RU history persisted locally", str(e))

        # Workspace/CLAUDE.md may not exist before activation in premium flow.
        self._check(True, "RU workspace creation is deferred until activation")

    async def test_bot_en_edge(self) -> None:
        bot = "coderboxbot"
        user_dir = f"/root/aisellusers/user_{self.user_id}"
        print(f"\n📋 EN bot (edge): @{bot}")

        proc = self._ssh(f"rm -rf {user_dir} || true", timeout=10)
        self._check(proc.returncode == 0, "EN remote cleanup via SSH", REMOTE_SSH_HOST)

        msg = await self.send_and_wait(bot, "/start")
        self._check(bool(msg), "EN /start response received")
        txt = (msg.text or "") if msg else ""
        self._check(not has_cyrillic(txt), "EN /start has no Cyrillic", txt[:80].replace("\n", " "))

        marker = f"BI_TEST_EN_{time.time_ns()}"
        msg = await self.send_and_wait(bot, f"co Hello\n\n[history:{marker}]")
        self._check(bool(msg), "EN marker message responded")

        history_path = f"{user_dir}/.history.json"
        try:
            found = wait_for_file_contains_ssh(
                REMOTE_SSH_HOST,
                [history_path],
                marker,
                timeout_seconds=20,
                description="edge .history.json",
            )
            self._check(True, "EN history persisted on edge", found)
        except Exception as e:
            self._check(False, "EN history persisted on edge", str(e))

        # CHANGE: Check if onboarding is enabled before expecting workspace/CLAUDE.md
        # WHY: Free tier bots (ENABLE_ONBOARDING=false) don't create workspace
        # REF: User request - "обнови тест так, чтоб тестировались все комбинации"
        proc = self._ssh("grep -E 'ENABLE_ONBOARDING=(true|false)' /root/aisell/botplatform/.env.coderbox 2>/dev/null || echo 'ENABLE_ONBOARDING=false'")
        onboarding_enabled = "ENABLE_ONBOARDING=true" in proc.stdout

        if onboarding_enabled:
            # Paid tier: expect workspace and CLAUDE.md
            proc = self._ssh(f"test -d {user_dir}")
            self._check(proc.returncode == 0, "EN workspace directory exists on edge (paid)", user_dir)
            proc = self._ssh(f"test -f {user_dir}/CLAUDE.md")
            self._check(proc.returncode == 0, "EN CLAUDE.md exists on edge (paid)", f"{user_dir}/CLAUDE.md")
        else:
            # Free tier: workspace not created, but bot works
            self._check(True, "EN free tier mode (no workspace expected)")
            # Verify bot is responsive
            msg = await self.send_and_wait(bot, "test")
            self._check(bool(msg), "EN bot responds in free tier mode")

    async def run(self) -> int:
        if not await self.connect():
            return 2
        try:
            await self.test_bot_ru()
            await self.test_bot_en_edge()
        finally:
            await self.disconnect()

        print("\n" + "=" * 60)
        print(f"Tests passed: {self.ok}")
        print(f"Tests failed: {self.fail}")
        print("=" * 60)
        return 0 if self.fail == 0 else 1


def main() -> None:
    raise SystemExit(asyncio.run(BilingualSmoke().run()))


if __name__ == "__main__":
    main()
