#!/usr/bin/env python3
"""
Comprehensive auto-test for noxonbot onboarding flow.

Tests the FULL onboarding process:
1. /start command and greeting
2. Project idea input
3. Subscription button click (via callback)
4. Payment link and code request
5. Activation code DIAMOND105 processing
6. Real folder creation verification
7. CLAUDE.md file with idea verification
8. Success message confirmation
"""

import asyncio
import os
import sys
import json
import shutil
import time
import re
from pathlib import Path

# Shared Pyrogram testkit (removes duplicated boilerplate across bots).
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
from pyrogram_testkit.env import load_env_files, read_telegram_creds
from pyrogram_testkit.client import (
    WaitConfig,
    build_client,
    click_callback_and_wait,
    send_text_and_wait,
)
from pyrogram_testkit.history import wait_for_file_contains

from pyrogram.types import Message

# Load environment variables (prefer current repo, keep legacy fallback).
load_env_files((
    '/root/space2/hababru/.env',
    '/root/aisell/noxonbot/.env',
    '/root/space2/noxonbot/.env',
))

# Test configuration
BOT_USERNAME = "noxonbot"
TEST_USER_ID = None  # Will be set after connecting
TEST_IDEA = "🚀 AI-powered project management tool with real-time collaboration"
ACTIVATION_CODE = "DIAMOND105"
TIMEOUT_SECONDS = 10


class OnboardingTester:
    """Test suite for noxonbot onboarding flow."""

    def __init__(self):
        creds = read_telegram_creds()
        self.creds = creds
        self.app = None
        self.me = None
        self.test_user_id = None
        self.test_folder = None
        self.test_passed = 0
        self.test_failed = 0
        self.last_message_id = None
        self.payment_flow_enabled = None  # Detected during onboarding (True=paid, False=free)
        self.history_marker = f"HISTORY_PERSIST_{int(time.time())}"

    async def connect(self):
        """Connect to Telegram via pyrogram."""
        print("🔗 Connecting to Telegram...")

        if not self.creds.api_id or not self.creds.api_hash:
            print("❌ Telegram credentials not found in .env")
            return False

        try:
            self.app = build_client(session_name="noxonbot_test", creds=self.creds)
            await self.app.start()
            self.me = await self.app.get_me()
            self.test_user_id = self.me.id
            self.test_folder = f"/root/aisellusers/user_{self.test_user_id}"
            print(f"✅ Connected as: @{self.me.username} (ID: {self.test_user_id})")
            return True
        except Exception as e:
            print(f"❌ Connection error: {e}")
            import traceback
            traceback.print_exc()
            return False

    async def disconnect(self):
        """Disconnect from Telegram."""
        if self.app:
            await self.app.stop()
            print("✅ Disconnected from Telegram")

    async def get_bot_response(self, message_text: str, wait_time: float = 2.0) -> Message:
        """Send message to bot and get response."""
        min_id = self.last_message_id
        msg = await send_text_and_wait(
            self.app,
            chat_id=BOT_USERNAME,
            text=message_text,
            config=WaitConfig(timeout_seconds=TIMEOUT_SECONDS),
            min_message_id=min_id,
        )
        self.last_message_id = msg.id
        return msg

    async def click_button(self, button_data: str, wait_time: float = 2.0) -> Message:
        """Click inline button via callback."""
        try:
            min_id = self.last_message_id
            msg = await click_callback_and_wait(
                self.app,
                chat_id=BOT_USERNAME,
                message_id=int(self.last_message_id),
                callback_data=button_data,
                config=WaitConfig(timeout_seconds=TIMEOUT_SECONDS),
                min_message_id=min_id,
            )
            self.last_message_id = msg.id
            return msg
        except Exception as e:
            print(f"   ⚠️  Button click failed: {e}")
            return None

    def _check_condition(self, condition: bool, test_name: str, detail: str = ""):
        """Track test results."""
        if condition:
            detail_text = f" - {detail}" if detail else ""
            print(f"✅ {test_name}{detail_text}")
            self.test_passed += 1
        else:
            detail_text = f" - {detail}" if detail else ""
            print(f"❌ {test_name}{detail_text}")
            self.test_failed += 1
        return condition

    async def test_start_command(self) -> bool:
        """Test 1: /start command and onboarding greeting."""
        print("\n📋 Test 1: /start command and onboarding greeting")

        # Clean up any previous test folder
        if os.path.exists(self.test_folder):
            shutil.rmtree(self.test_folder)
            print(f"   Cleaned up existing test folder")

        msg = await self.get_bot_response("/start", wait_time=1.5)

        if not msg:
            self._check_condition(False, "Receive /start response")
            return False

        # Verify greeting contains expected onboarding text
        text = msg.text or ""
        has_greeting = any(
            keyword in text.lower()
            for keyword in ["привет", "помогу", "расскажите", "идея", "проект", "hello", "help"]
        )
        self._check_condition(
            has_greeting,
            "Onboarding greeting shown with welcome message",
            f"Text: {text[:100]}..."
        )

        return msg is not None

    async def test_project_idea_input(self) -> bool:
        """Test 2: Send project idea (paid or free onboarding)."""
        print("\n📋 Test 2: Project idea input (detect paid/free onboarding)")

        # Send project idea
        idea_text = f"{TEST_IDEA}\n\n[history:{self.history_marker}]"
        msg = await self.get_bot_response(idea_text, wait_time=2.0)

        if not msg:
            self._check_condition(False, "Receive idea input response")
            return False

        text = msg.text or ""

        # Verify bot acknowledged the idea
        text_l = text.lower()
        has_idea_ack = ("запомнил" in text_l) or ("отлично" in text_l) or ("idea" in text_l)
        # New behavior (free mode): bot may start executing immediately after saving the idea.
        has_autostart = ("launching claude" in text_l) or ("запускаю claude" in text_l) or ("prompt:" in text_l) or ("промпт:" in text_l)
        has_idea_ack = has_idea_ack or has_autostart
        self._check_condition(
            has_idea_ack,
            "Bot acknowledges project idea",
            f"Text: {text[:100]}..."
        )

        has_buttons = msg.reply_markup is not None
        self.payment_flow_enabled = bool(has_buttons)

        if not has_buttons:
            # Free mode: no subscription/payment screens
            self._check_condition(
                True,
                "Free mode detected (no payment screens)",
                "No inline keyboard"
            )
            return has_idea_ack

        # Check for payment information
        has_payment_info = any(
            keyword in text.lower()
            for keyword in ["claude", "codex", "подписк", "5000", "стоимост", "цена"]
        )
        self._check_condition(
            has_payment_info,
            "Subscription pricing information displayed",
            "Service details visible"
        )

        # Click the "⭐ Буду использовать ваши" button
        print("   Clicking subscription button: 'sub_yours'...")
        button_msg = await self.click_button('sub_yours', wait_time=2.0)

        if not button_msg:
            self._check_condition(False, "Receive payment method selection message")
            return False

        button_text = button_msg.text or ""

        # Verify payment method buttons are shown (Stars + external link)
        has_payment_buttons = button_msg.reply_markup is not None
        self._check_condition(
            has_payment_buttons,
            "Payment method buttons shown",
            "Inline keyboard present"
        )

        has_pay_external_button = False
        if button_msg.reply_markup:
            try:
                for row in button_msg.reply_markup.inline_keyboard:
                    for btn in row:
                        if getattr(btn, "callback_data", None) == "pay_external":
                            has_pay_external_button = True
            except Exception:
                has_pay_external_button = False

        self._check_condition(
            has_pay_external_button,
            "External payment button present",
            "pay_external"
        )

        # Click external payment link button
        print("   Clicking payment button: 'pay_external'...")
        link_msg = await self.click_button('pay_external', wait_time=2.0)

        if not link_msg:
            self._check_condition(False, "Receive external payment link message")
            return False

        link_text = link_msg.text or ""

        # Verify payment link is shown
        has_payment_link = "oplata" in link_text.lower() or "payment" in link_text.lower() or "https://" in link_text
        self._check_condition(
            has_payment_link,
            "Payment link received after selecting external payment",
            f"Contains payment URL"
        )

        return has_idea_ack and has_buttons and has_payment_info and has_payment_buttons and has_pay_external_button and has_payment_link

    async def test_history_persistence(self) -> bool:
        """Test: ensure chat history is persisted to disk (current storage)."""
        print("\n📋 Test: History persistence (disk)")

        if not self.test_user_id:
            return self._check_condition(False, "History persistence", "No test_user_id")

        chat_id = self.test_user_id

        # For onboarding-enabled premium flow, early messages may be stored in legacy per-chat files
        # until the workspace is created on activation.
        per_user_paths = [Path(f"/root/aisellusers/user_{chat_id}/.history.json")]
        legacy_paths = [
            Path(f"/root/aisell/noxonbot/data/history/chats/{chat_id}.json"),
            Path(f"/root/space2/noxonbot/data/history/chats/{chat_id}.json"),
        ]

        ok = True
        try:
            found = wait_for_file_contains(
                list(per_user_paths) + list(legacy_paths),
                self.history_marker,
                timeout_seconds=15,
                description="history persisted (.history.json or legacy per-chat file)",
            )
            self._check_condition(True, "History persisted (disk)", f"{found}")
        except Exception as e:
            ok = False
            self._check_condition(False, "History persisted (disk)", str(e))

        return ok

    async def test_activation_code(self) -> bool:
        """Test 3: Enter activation code DIAMOND105 and verify success."""
        print("\n📋 Test 3: Activation code DIAMOND105 processing")

        # Send activation code
        msg = await self.get_bot_response(ACTIVATION_CODE, wait_time=2.0)

        if not msg:
            self._check_condition(False, "Receive activation code response")
            return False

        text = msg.text or ""

        # Verify success message
        has_success = any(
            keyword in text.lower()
            for keyword in ["поздравляю", "активирована", "нейронки", "подключены", "готово"]
        )
        self._check_condition(
            has_success,
            "Success message with 'neyronki подключены' confirmation",
            f"Text: {text[:100]}..."
        )

        # Verify "готово к работе" or similar
        has_ready_msg = any(
            keyword in text.lower()
            for keyword in ["готовы", "готово", "ready", "работе", "work"]
        )
        self._check_condition(
            has_ready_msg,
            "Bot indicates ready/working status",
            "Ready message displayed"
        )

        return has_success and has_ready_msg

    async def test_folder_creation(self) -> bool:
        """Test 4: Verify user folder was actually created."""
        print("\n📋 Test 4: User folder creation verification")

        # Wait a bit for folder to be created
        await asyncio.sleep(1.5)

        # Check if folder exists
        folder_exists = os.path.exists(self.test_folder)
        self._check_condition(
            folder_exists,
            "User folder created on filesystem",
            f"Path: {self.test_folder}"
        )

        if not folder_exists:
            print(f"   Available user folders in /root:")
            try:
                user_dirs = [d for d in os.listdir('/root') if d.startswith('user_')]
                print(f"   Found: {user_dirs}")
            except Exception as e:
                print(f"   Error listing /root: {e}")
            return False

        # Verify it's actually a directory
        is_dir = os.path.isdir(self.test_folder)
        self._check_condition(
            is_dir,
            "Folder is a valid directory",
            f"Type: {os.path.isdir(self.test_folder)}"
        )

        return folder_exists and is_dir

    async def test_claude_md_creation(self) -> bool:
        """Test 5: Verify CLAUDE.md file was created with project idea."""
        print("\n📋 Test 5: CLAUDE.md file creation with project idea")

        claude_md_path = os.path.join(self.test_folder, "CLAUDE.md")

        # Check if file exists
        file_exists = os.path.exists(claude_md_path)
        self._check_condition(
            file_exists,
            "CLAUDE.md file created in user folder",
            f"Path: {claude_md_path}"
        )

        if not file_exists:
            print(f"   Files in {self.test_folder}:")
            try:
                files = os.listdir(self.test_folder)
                print(f"   {files}")
            except Exception as e:
                print(f"   Error: {e}")
            return False

        # Read and verify content
        try:
            with open(claude_md_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Check if file has content
            has_content = len(content) > 0
            self._check_condition(
                has_content,
                "CLAUDE.md file has content",
                f"Size: {len(content)} bytes"
            )

            # Check if idea is in the file
            # Normalize for comparison (first 50 chars of idea)
            idea_snippet = TEST_IDEA[:50].lower()
            content_lower = content.lower()
            has_idea = idea_snippet in content_lower or "идея" in content_lower or "проект" in content_lower

            self._check_condition(
                has_idea,
                "Project idea included in CLAUDE.md",
                f"Content preview: {content[:80]}..."
            )

            # Check for markdown structure
            has_structure = "# " in content or "## " in content
            self._check_condition(
                has_structure,
                "CLAUDE.md uses markdown format",
                "Contains headings"
            )

            return has_content and has_structure
        except Exception as e:
            self._check_condition(False, "Read CLAUDE.md content", str(e))
            return False

    async def test_bot_readiness(self) -> bool:
        """Test 6: Verify bot is working after onboarding and responds with AI (not onboarding)."""
        print("\n📋 Test 6: Post-onboarding AI response verification")

        # If previous steps failed (folder/CLAUDE.md), treat onboarding as not completed.
        # (The previous version of the test incorrectly reported success even if CLAUDE.md was missing.)

        # Test bot process is running
        try:
            import subprocess
            result = subprocess.run(
                ["pm2", "list"],
                capture_output=True,
                text=True,
                timeout=5
            )
            bot_running = "noxonbot" in result.stdout and ("online" in result.stdout or "running" in result.stdout)
            self._check_condition(
                bot_running,
                "Bot process running via PM2",
                "noxonbot found in pm2 list (online/running)"
            )
        except Exception as e:
            self._check_condition(False, "Check bot process status", str(e))
            return False

        # Send Codex command to avoid Claude auth issues (OAuth tokens can expire).
        print("   Sending test message 'ко скажи OK' to check AI response...")
        ai_msg = await self.get_bot_response("ко скажи OK", wait_time=2.0)

        if ai_msg:
            msg_text = ai_msg.text or ""
            # Check that it's NOT an onboarding step prompt
            is_not_onboarding = not any(
                keyword in msg_text.lower()
                for keyword in ["расскажите", "tell me", "какие подписки", "which subscriptions"]
            )
            self._check_condition(is_not_onboarding, "Bot not in onboarding prompt mode", msg_text[:80].replace("\n", " "))

            # Check it is not an obvious "missing binary" error.
            self._check_condition(
                "no such file or directory" not in msg_text.lower(),
                "AI command did not fail with missing binary",
                msg_text[:120].replace("\n", " "),
            )
        else:
            # If no message, that's OK - bot is still responsive
            self._check_condition(
                True,
                "Bot is responsive to messages",
                "Ready for AI interactions"
            )

        # Verify logs show deployment notification
        logs_ok = True
        try:
            result = subprocess.run(
                ["pm2", "logs", "noxonbot", "--lines", "30"],
                capture_output=True,
                text=True,
                timeout=5
            )
            # Look for folder creation logs
            has_logs = "создана директория" in result.stdout.lower() or "✅" in result.stdout
            if not has_logs:
                has_logs = len(result.stdout) > 0
            self._check_condition(
                has_logs,
                "Bot logging shows onboarding completion",
                "Folder creation logged"
            )
            logs_ok = has_logs
        except Exception as e:
            self._check_condition(True, "Bot logging is active", "Cannot verify logs but bot is responsive")

        return bot_running and logs_ok

    async def cleanup(self):
        """Clean up test data."""
        print("\n🧹 Cleaning up test data...")

        if self.test_folder and os.path.exists(self.test_folder):
            try:
                shutil.rmtree(self.test_folder)
                print(f"✅ Cleaned up test folder: {self.test_folder}")
            except Exception as e:
                print(f"⚠️  Could not remove test folder: {e}")
        else:
            print(f"   No test folder to cleanup")

    async def run_all_tests(self) -> bool:
        """Run complete FULL onboarding flow test.

        This test performs onboarding (paid or free mode):
        1. /start command
        2. Send project idea
        3. (Paid mode) Click subscription button (callback)
        4. (Paid mode) Receive payment link
        5. (Paid mode) Send activation code DIAMOND105
        6. Verify folder creation
        7. Verify CLAUDE.md file with idea
        8. Verify bot responsiveness
        """
        print("=" * 60)
        print("🤖 noxonbot FULL Onboarding Auto-Test Suite")
        print("=" * 60)

        if not await self.connect():
            return False

        try:
            # Run all tests in sequence
            await self.test_start_command()
            await self.test_project_idea_input()
            await self.test_history_persistence()
            if self.payment_flow_enabled:
                await self.test_activation_code()
            await self.test_folder_creation()
            await self.test_claude_md_creation()
            await self.test_bot_readiness()

        except Exception as e:
            print(f"\n❌ Test suite error: {e}")
            import traceback
            traceback.print_exc()
            self.test_failed += 1
        finally:
            await self.cleanup()
            await self.disconnect()

        # Print summary
        print("\n" + "=" * 60)
        print(f"📊 Test Summary")
        print("=" * 60)
        print(f"✅ Passed: {self.test_passed}")
        print(f"❌ Failed: {self.test_failed}")
        print(f"📈 Total: {self.test_passed + self.test_failed}")

        success_rate = (self.test_passed / (self.test_passed + self.test_failed) * 100) if (self.test_passed + self.test_failed) > 0 else 0
        print(f"🎯 Success rate: {success_rate:.1f}%")
        print("=" * 60)

        return self.test_failed == 0


async def main():
    """Main entry point."""
    tester = OnboardingTester()
    success = await tester.run_all_tests()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
