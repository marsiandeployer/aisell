#!/usr/bin/env python3
"""
Universal Telegram Bot Testing Agent

Reads pyrogram.test.md from bot project directory and executes tests.
Can be used for ANY Telegram bot testing with Pyrogram.

Usage:
    python3 telegram_bot_tester.py /path/to/bot/project [test_name]

Examples:
    python3 telegram_bot_tester.py /root/aisell/noxonbot
    python3 telegram_bot_tester.py /root/aisell/bananzabot onboarding
"""

import asyncio
import os
import sys
import json
import yaml
import shutil
import time
import re
from pathlib import Path
from typing import Dict, List, Optional, Any
from dotenv import load_dotenv
from pyrogram import Client
from pyrogram.types import Message
from pyrogram.errors import RPCError


class TelegramBotTester:
    """Universal agent for testing Telegram bots via Pyrogram."""

    def __init__(self, project_path: str):
        self.project_path = Path(project_path)
        self.test_config = None
        self.app = None
        self.me = None
        self.test_user_id = None
        self.test_passed = 0
        self.test_failed = 0
        self.last_message_id = None
        self.session_vars = {}  # Runtime variables (user_id, folder paths, etc.)

    def load_test_config(self) -> bool:
        """Load pyrogram.test.md from project directory."""
        config_path = self.project_path / "pyrogram.test.md"

        if not config_path.exists():
            print(f"❌ Test config not found: {config_path}")
            return False

        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Parse YAML front-matter
            if content.startswith('---'):
                parts = content.split('---', 2)
                if len(parts) >= 3:
                    yaml_content = parts[1]
                    self.test_config = yaml.safe_load(yaml_content)
                    print(f"✅ Loaded test config from {config_path}")
                    return True

            print(f"❌ Invalid test config format in {config_path}")
            return False

        except Exception as e:
            print(f"❌ Failed to load test config: {e}")
            import traceback
            traceback.print_exc()
            return False

    async def connect(self) -> bool:
        """Connect to Telegram via Pyrogram."""
        print("🔗 Connecting to Telegram...")

        # Load environment variables
        env_path = self.test_config.get('env_file', '/root/space2/hababru/.env')
        if isinstance(env_path, list):
            for env in env_path:
                load_dotenv(env)
        else:
            load_dotenv(env_path)

        api_id = int(os.getenv('TELEGRAM_API_ID', '0'))
        api_hash = os.getenv('TELEGRAM_API_HASH', '')
        session_string = os.getenv('TELEGRAM_SESSION_STRING', '')

        if not api_id or not api_hash:
            print("❌ Telegram credentials not found in .env")
            return False

        try:
            session_name = self.test_config.get('session_name', 'bot_test_session')
            self.app = Client(
                session_name,
                api_id=api_id,
                api_hash=api_hash,
                session_string=session_string
            )
            await self.app.start()
            self.me = await self.app.get_me()
            self.test_user_id = self.me.id

            # Set runtime variables
            self.session_vars['user_id'] = self.test_user_id
            self.session_vars['username'] = self.me.username or "unknown"

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

    async def send_message(self, bot_username: str, message: str, wait_time: float = 2.0) -> Optional[Message]:
        """Send message to bot and get response."""
        try:
            # Replace variables in message
            message = self._replace_vars(message)

            await self.app.send_message(bot_username, message)
            await asyncio.sleep(wait_time)

            # Get last message from bot
            last_msg = None
            async for msg in self.app.get_chat_history(bot_username, limit=1):
                if msg.from_user and msg.from_user.is_bot:
                    last_msg = msg
                    self.last_message_id = msg.id
                    break

            return last_msg

        except Exception as e:
            print(f"   ⚠️  Failed to send message: {e}")
            return None

    async def click_button(self, bot_username: str, callback_data: str, wait_time: float = 2.0) -> Optional[Message]:
        """Click inline button via callback."""
        try:
            # Replace variables in callback_data
            callback_data = self._replace_vars(callback_data)

            await self.app.request_callback_answer(
                chat_id=bot_username,
                message_id=self.last_message_id,
                callback_data=callback_data
            )
            await asyncio.sleep(wait_time)

            # Get bot response after button click
            last_msg = None
            async for msg in self.app.get_chat_history(bot_username, limit=1):
                if msg.from_user and msg.from_user.is_bot:
                    last_msg = msg
                    self.last_message_id = msg.id
                    break

            return last_msg

        except Exception as e:
            print(f"   ⚠️  Button click failed: {e}")
            return None

    def check_condition(self, condition: bool, test_name: str, detail: str = "") -> bool:
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

    def _replace_vars(self, text: str) -> str:
        """Replace {var} placeholders with runtime values."""
        for key, value in self.session_vars.items():
            text = text.replace(f"{{{key}}}", str(value))
        return text

    async def run_test_step(self, step: Dict[str, Any], bot_username: str) -> bool:
        """Execute a single test step."""
        step_type = step.get('type')
        name = step.get('name', 'Unnamed step')

        print(f"\n📋 {name}")

        if step_type == 'send':
            # Send message to bot
            message = step.get('message', '')
            wait = step.get('wait', 2.0)
            response = await self.send_message(bot_username, message, wait)

            if not response:
                self.check_condition(False, "Receive response from bot")
                return False

            # Store response in session vars
            if 'save_as' in step:
                self.session_vars[step['save_as']] = response.text or ""

            # Run checks
            return await self._run_checks(response, step.get('checks', []))

        elif step_type == 'click':
            # Click inline button
            callback_data = step.get('callback_data', '')
            wait = step.get('wait', 2.0)
            response = await self.click_button(bot_username, callback_data, wait)

            if not response:
                self.check_condition(False, "Receive response after button click")
                return False

            # Store response in session vars
            if 'save_as' in step:
                self.session_vars[step['save_as']] = response.text or ""

            # Run checks
            return await self._run_checks(response, step.get('checks', []))

        elif step_type == 'file_check':
            # Check file existence and content
            path = step.get('path', '')
            path = self._replace_vars(path)

            exists = step.get('exists', True)
            contains = step.get('contains', [])

            # Check existence
            file_exists = os.path.exists(path)
            self.check_condition(
                file_exists == exists,
                f"File {'exists' if exists else 'does not exist'}: {path}"
            )

            if not file_exists:
                return exists == False

            # Check content
            if contains:
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        content = f.read()

                    for pattern in contains:
                        pattern = self._replace_vars(pattern)
                        has_pattern = pattern.lower() in content.lower()
                        self.check_condition(
                            has_pattern,
                            f"File contains: {pattern[:50]}"
                        )

                except Exception as e:
                    self.check_condition(False, f"Read file content: {e}")
                    return False

            return True

        elif step_type == 'cleanup':
            # Cleanup files/folders
            paths = step.get('paths', [])

            for path in paths:
                path = self._replace_vars(path)

                if os.path.exists(path):
                    try:
                        if os.path.isdir(path):
                            shutil.rmtree(path)
                        else:
                            os.remove(path)
                        print(f"✅ Cleaned up: {path}")
                    except Exception as e:
                        print(f"⚠️  Failed to cleanup {path}: {e}")

            return True

        elif step_type == 'delay':
            # Wait for specified time
            seconds = step.get('seconds', 1.0)
            print(f"   ⏳ Waiting {seconds} seconds...")
            await asyncio.sleep(seconds)
            return True

        else:
            print(f"❌ Unknown step type: {step_type}")
            return False

    async def _run_checks(self, message: Message, checks: List[Dict[str, Any]]) -> bool:
        """Run checks on message response."""
        all_passed = True
        text = message.text or ""

        for check in checks:
            check_type = check.get('type')

            if check_type == 'contains':
                # Check if text contains keywords
                keywords = check.get('keywords', [])
                mode = check.get('mode', 'any')  # 'any' or 'all'

                matches = []
                for keyword in keywords:
                    keyword = self._replace_vars(keyword)
                    if keyword.lower() in text.lower():
                        matches.append(keyword)

                if mode == 'any':
                    passed = len(matches) > 0
                else:  # mode == 'all'
                    passed = len(matches) == len(keywords)

                self.check_condition(
                    passed,
                    check.get('name', 'Text contains keywords'),
                    f"Found: {matches}" if matches else "No matches"
                )

                all_passed = all_passed and passed

            elif check_type == 'has_buttons':
                # Check if message has inline keyboard
                has_buttons = message.reply_markup is not None
                self.check_condition(
                    has_buttons,
                    check.get('name', 'Message has inline buttons')
                )

                all_passed = all_passed and has_buttons

            elif check_type == 'button_exists':
                # Check if specific button exists
                button_data = check.get('callback_data', '')
                button_found = False

                if message.reply_markup:
                    for row in message.reply_markup.inline_keyboard:
                        for btn in row:
                            if getattr(btn, 'callback_data', None) == button_data:
                                button_found = True
                                break

                self.check_condition(
                    button_found,
                    check.get('name', f'Button exists: {button_data}')
                )

                all_passed = all_passed and button_found

        return all_passed

    async def run_all_tests(self) -> bool:
        """Run all tests from config."""
        print("=" * 60)
        print(f"🤖 {self.test_config.get('bot_name', 'Bot')} Testing Suite")
        print("=" * 60)

        if not await self.connect():
            return False

        try:
            bot_username = self.test_config.get('bot_username')
            tests = self.test_config.get('tests', [])

            for test in tests:
                test_name = test.get('name', 'Unnamed test')
                print(f"\n{'='*60}")
                print(f"🧪 Running: {test_name}")
                print(f"{'='*60}")

                steps = test.get('steps', [])

                for step in steps:
                    await self.run_test_step(step, bot_username)

        except Exception as e:
            print(f"\n❌ Test suite error: {e}")
            import traceback
            traceback.print_exc()
            self.test_failed += 1

        finally:
            await self.disconnect()

        # Print summary
        print("\n" + "=" * 60)
        print("📊 Test Summary")
        print("=" * 60)
        print(f"✅ Passed: {self.test_passed}")
        print(f"❌ Failed: {self.test_failed}")
        print(f"📈 Total: {self.test_passed + self.test_failed}")

        if self.test_passed + self.test_failed > 0:
            success_rate = (self.test_passed / (self.test_passed + self.test_failed)) * 100
            print(f"🎯 Success rate: {success_rate:.1f}%")
        print("=" * 60)

        return self.test_failed == 0


async def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python3 telegram_bot_tester.py <project_path> [test_name]")
        print("\nExamples:")
        print("  python3 telegram_bot_tester.py /root/aisell/noxonbot")
        print("  python3 telegram_bot_tester.py /root/aisell/bananzabot onboarding")
        sys.exit(1)

    project_path = sys.argv[1]
    test_name = sys.argv[2] if len(sys.argv) > 2 else None

    tester = TelegramBotTester(project_path)

    if not tester.load_test_config():
        sys.exit(1)

    success = await tester.run_all_tests()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
