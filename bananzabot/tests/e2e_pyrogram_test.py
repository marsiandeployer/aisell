#!/usr/bin/env python3
"""
E2E Test with Pyrogram - Real Telegram bot creation test

CHANGE: Create E2E test that uses Pyrogram to test bot creation via real Telegram
WHY: Need to test full flow including invalid/valid API token validation
REF: User request to test with wrong token and correct token via env/CLI
"""

import argparse
import os
import sys
import asyncio
import time
import re
import json
from datetime import datetime
from pathlib import Path

# Shared Pyrogram testkit (removes duplicated boilerplate across bots).
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
from pyrogram_testkit.env import load_env_files, read_telegram_creds
from pyrogram_testkit.client import WaitConfig, build_client, send_text_and_wait, wait_for_bot_message
from pyrogram_testkit.history import wait_for_file_contains

from pyrogram.types import Message

# Load environment variables
ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '.env')
HABABRU_ENV_PATH = '/root/space2/hababru/.env'
load_env_files((ENV_PATH, HABABRU_ENV_PATH))

CREDS = read_telegram_creds(
    default_api_id=20663119,
    default_api_hash='0735e154f4ee0ea6bcfe3d972de467b9',
    default_phone_number='+79855954987',
)

# Test configuration
BOT_USERNAME = (os.getenv('BANANZABOT_MAIN_BOT_USERNAME', 'bananza_bot') or 'bananza_bot').strip().lstrip('@')
TEST_BUSINESS_NAME = (os.getenv('BANANZABOT_E2E_BUSINESS_NAME', 'бот пересылки сообщений админу') or 'бот пересылки сообщений админу').strip()
INVALID_TOKEN = (os.getenv('BANANZABOT_E2E_INVALID_TOKEN', '123456:INVALID_TOKEN_FORMAT') or '123456:INVALID_TOKEN_FORMAT').strip()
VALID_TOKEN = (os.getenv('BANANZABOT_E2E_VALID_TOKEN', '') or '').strip()

# Session file / string
SESSION_FILE = os.path.join(os.path.dirname(__file__), 'e2e_test_session')


def parse_args():
    parser = argparse.ArgumentParser(description='Bananzabot Pyrogram E2E: creation + created bot checks')
    parser.add_argument('--main-bot', default=BOT_USERNAME, help='Main constructor bot username (default: bananza_bot)')
    parser.add_argument('--business-name', default=TEST_BUSINESS_NAME, help='Business idea text for prompt generation')
    parser.add_argument('--invalid-token', default=INVALID_TOKEN, help='Invalid token used in negative test')
    parser.add_argument('--valid-token', default=VALID_TOKEN, help='Valid token for deployment test')
    return parser.parse_args()


class E2ETestRunner:
    """E2E test runner using Pyrogram"""

    def __init__(self):
        self.client = build_client(session_name=SESSION_FILE, creds=CREDS)
        self.test_results = []
        self.conversation_log = []
        self.deployed_bot_username = None
        self.last_message_id_by_chat = {}
        self.test_user_id = None
        self.history_marker = f"HISTORY_PERSIST_{time.time_ns()}"

    @staticmethod
    def sanitize_for_log(message: str) -> str:
        text = (message or '').strip()
        if re.match(r'^\d{6,}:[A-Za-z0-9_-]{20,}$', text):
            token_prefix = text.split(':', 1)[0]
            return f'{token_prefix}:***'
        return text

    def assert_history_persisted(self) -> None:
        if not self.test_user_id:
            raise RuntimeError("Missing test_user_id (call get_me first)")
        paths = [
            Path(f"/root/aisell/bananzabot/user_data/conversations/{self.test_user_id}/conversation.json"),
            Path(f"/root/space2/bananzabot/user_data/conversations/{self.test_user_id}/conversation.json"),
        ]
        found = wait_for_file_contains(
            paths,
            self.history_marker,
            timeout_seconds=10,
            description="bananzabot conversation.json",
        )
        print(f"[✓] History persisted: {found}")

    @staticmethod
    def parse_timestamp(value: str) -> float:
        raw = (value or '').strip()
        if not raw:
            return 0.0
        try:
            return datetime.fromisoformat(raw.replace('Z', '+00:00')).timestamp()
        except Exception:
            return 0.0

    def get_latest_bot_record_by_token(self, token: str):
        db_paths = (
            Path('/root/aisell/bananzabot/bots_database/bots.json'),
            Path('/root/space2/bananzabot/bots_database/bots.json'),
        )
        latest = None
        latest_ts = 0.0

        for db_path in db_paths:
            if not db_path.exists():
                continue
            try:
                payload = json.loads(db_path.read_text(encoding='utf-8', errors='ignore'))
            except Exception:
                continue
            if not isinstance(payload, list):
                continue
            for item in payload:
                if not isinstance(item, dict):
                    continue
                if (item.get('api_key') or '').strip() != token:
                    continue
                ts = self.parse_timestamp(item.get('updated_at') or item.get('created_at') or '')
                if ts >= latest_ts:
                    latest = item
                    latest_ts = ts

        return latest, latest_ts

    def wait_for_bot_record_update(self, token: str, baseline_ts: float, timeout_seconds: int = 120):
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            record, record_ts = self.get_latest_bot_record_by_token(token)
            if record is not None and record_ts >= baseline_ts:
                return record
            time.sleep(2)
        return None

    async def send_and_wait(self, chat_id: str, message: str, wait_seconds: int = 3, wait_for_keywords: list = None) -> Message:
        """Send message and wait for response (optionally until keywords appear)"""
        print(f"[→ USER] {self.sanitize_for_log(message)}")
        self.conversation_log.append({'role': 'user', 'content': message})
        min_id = self.last_message_id_by_chat.get(chat_id)
        msg = await send_text_and_wait(
            self.client,
            chat_id=chat_id,
            text=message,
            config=WaitConfig(
                timeout_seconds=float(wait_seconds),
                history_limit=5,
                keywords=wait_for_keywords,
            ),
            min_message_id=min_id,
        )

        self.last_message_id_by_chat[chat_id] = msg.id

        response_text = msg.text or msg.caption or ''
        print(f"[← BOT] {response_text[:200]}...")
        self.conversation_log.append({'role': 'assistant', 'content': response_text})
        return msg

    async def test_invalid_token(self) -> dict:
        """Test scenario: Invalid API token"""
        print("\n" + "=" * 60)
        print("TEST 1: Invalid API Token")
        print("=" * 60)

        try:
            # Start conversation
            await self.send_and_wait(BOT_USERNAME, '/start', wait_seconds=2)

            preview_keywords = ['промпт сгенерирован', 'превью промпта']

            # Send business name (interactive dialog might ask clarifying questions first)
            prompt_request = await self.send_and_wait(
                BOT_USERNAME,
                f"{TEST_BUSINESS_NAME} [history:{self.history_marker}]",
                wait_seconds=90
            )
            self.assert_history_persisted()

            prompt_text = (prompt_request.text or '').lower()
            for _ in range(4):
                if any(k in prompt_text for k in preview_keywords):
                    break

                if (
                    'username администратора' in prompt_text
                    or 'telegram username' in prompt_text
                    or 'какому именно администратору' in prompt_text
                ):
                    follow_up = await self.send_and_wait(
                        BOT_USERNAME,
                        '@sashanoxon',
                        wait_seconds=90
                    )
                else:
                    # Force prompt generation if bot asked for additional details.
                    follow_up = await self.send_and_wait(
                        BOT_USERNAME,
                        'пофигу на остальное просто перекидывай сообщения',
                        wait_seconds=90
                    )

                prompt_text = (follow_up.text or '').lower()

            # Wait until prompt preview message is delivered (stage: testing).
            # Without this, a token sent too early can be treated as regular dialog text.
            min_id = self.last_message_id_by_chat.get(BOT_USERNAME)
            preview_msg = await wait_for_bot_message(
                self.client,
                chat_id=BOT_USERNAME,
                config=WaitConfig(timeout_seconds=70, history_limit=10, keywords=preview_keywords),
                min_message_id=min_id,
            )
            self.last_message_id_by_chat[BOT_USERNAME] = preview_msg.id

            # Send invalid token
            response = await self.send_and_wait(BOT_USERNAME, INVALID_TOKEN, wait_seconds=5)

            # Check if bot detected invalid token
            response_text = response.text.lower() if response.text else ''
            detected_error = any(keyword in response_text for keyword in [
                'неверн', 'ошибк', 'invalid', 'error', 'некорректн', 'проверьте'
            ])

            if detected_error:
                print("✅ Bot correctly detected invalid token!")
                return {
                    'test': 'invalid_token',
                    'passed': True,
                    'message': 'Bot detected invalid token',
                    'response': response_text
                }
            else:
                print("❌ Bot did not detect invalid token")
                return {
                    'test': 'invalid_token',
                    'passed': False,
                    'message': 'Bot should reject invalid token',
                    'response': response_text
                }

        except Exception as error:
            print(f"❌ Test failed with error: {error}")
            return {
                'test': 'invalid_token',
                'passed': False,
                'message': f'Error: {error}',
                'response': None
            }

    async def test_valid_token(self) -> dict:
        """Test scenario: Valid API token"""
        print("\n" + "=" * 60)
        print("TEST 2: Valid API Token")
        print("=" * 60)

        try:
            if not VALID_TOKEN:
                return {
                    'test': 'valid_token',
                    'passed': False,
                    'message': 'Missing valid token: pass --valid-token or BANANZABOT_E2E_VALID_TOKEN',
                    'response': None
                }

            _, before_ts = self.get_latest_bot_record_by_token(VALID_TOKEN)
            baseline_ts = max(before_ts + 0.001, time.time() - 1.0)

            # Send valid token and wait for immediate response.
            # Final deployment confirmation is validated by bots_database update.
            response = await self.send_and_wait(
                BOT_USERNAME,
                VALID_TOKEN,
                wait_seconds=25,
                wait_for_keywords=['бот успешно создан', 'токен валиден', 'генерирую профиль бота']
            )
            response_text = response.text.lower() if response.text else ''

            updated_record = self.wait_for_bot_record_update(VALID_TOKEN, baseline_ts, timeout_seconds=120)
            token_accepted = updated_record is not None

            if token_accepted:
                print("✅ Bot accepted valid token!")

                db_username = (updated_record.get('username') or '').strip().lstrip('@') if updated_record else ''
                if db_username:
                    self.deployed_bot_username = db_username
                else:
                    bot_username_match = re.search(r't\.me/([a-zA-Z0-9_]+)', response.text or '')
                    self.deployed_bot_username = bot_username_match.group(1) if bot_username_match else None

                if self.deployed_bot_username:
                    print(f"   Deployed bot username: @{self.deployed_bot_username}")

                return {
                    'test': 'valid_token',
                    'passed': True,
                    'message': 'Bot accepted valid token',
                    'response': response_text,
                    'deployed_bot': self.deployed_bot_username
                }
            else:
                print("❌ Bot did not accept valid token")
                return {
                    'test': 'valid_token',
                    'passed': False,
                    'message': 'Bot should accept valid token (no bots_database update detected)',
                    'response': response_text
                }

        except Exception as error:
            print(f"❌ Test failed with error: {error}")
            return {
                'test': 'valid_token',
                'passed': False,
                'message': f'Error: {error}',
                'response': None
            }

    async def test_created_bot_functionality(self) -> dict:
        """Test scenario: Check admin /start, notifications, and reply functionality"""
        print("\n" + "=" * 60)
        print("TEST 3: Created Bot Functionality & Reply")
        print("=" * 60)

        if not self.deployed_bot_username:
            print("⚠️  Skipping: No deployed bot from previous test")
            return {
                'test': 'bot_functionality',
                'passed': False,
                'message': 'No deployed bot found',
                'response': None
            }

        try:
            # CHANGE: Wait longer for bot to start after stopping duplicate
            # WHY: Bot needs time to stop old instance and start new one (logs show up to 44 seconds)
            # REF: Duplicate token detection requires restart time, real data shows 44+ seconds
            print("   ⏳ Waiting 50 seconds for bot to start (stopping duplicate + starting new)...")
            await asyncio.sleep(50)

            me = await self.client.get_me()
            print(f"   Admin user ID: {me.id}")
            print(f"   Testing bot: @{self.deployed_bot_username}")

            # STEP 1: Test admin /start message
            print("\n   📋 Step 1: Testing admin /start message")
            start_response = await self.send_and_wait(
                self.deployed_bot_username,
                '/start',
                wait_seconds=10
            )

            # Retry once if no response (bot might still be starting)
            if not start_response or not start_response.text:
                print("   ⏳ No response, waiting 15 more seconds and retrying...")
                await asyncio.sleep(15)
                start_response = await self.send_and_wait(
                    self.deployed_bot_username,
                    '/start',
                    wait_seconds=10
                )

            if not start_response or not start_response.text:
                print("   ❌ No response to /start")
                return {
                    'test': 'bot_functionality',
                    'passed': False,
                    'message': 'Bot did not respond to /start',
                    'response': None
                }

            # Check if admin gets special message
            is_admin_message = any(keyword in start_response.text.lower() for keyword in [
                'владелец', 'admin', 'пересылаться', 'reply', 'ответить'
            ])

            if is_admin_message:
                print(f"   ✅ Admin received special /start message")
            else:
                print(f"   ⚠️  Generic message: {start_response.text[:80]}...")

            # STEP 2: Send test message
            print("\n   📋 Step 2: Sending test message to bot")
            test_message = "Тест уведомления от пользователя"
            test_response = await self.send_and_wait(
                self.deployed_bot_username,
                test_message,
                wait_seconds=10
            )
            print(f"   ✅ Bot responded to user message")

            # STEP 3: Check for admin notification
            # CHANGE: Check notifications from bot chat (not Saved Messages)
            # WHY: Notifications now come from bot directly, not via telegram_sender.py
            # REF: User fix - notifications should come from bot itself
            print("\n   📋 Step 3: Checking for admin notification")
            await asyncio.sleep(8)

            notification_message = None
            notification_message_id = None
            async for message in self.client.get_chat_history(self.deployed_bot_username, limit=20):
                # CHANGE: Look for notification message (with user ID or username mention)
                # WHY: Admin gets notifications about user messages from their bot
                # REF: Fix notification source - should be from bot, not Saved Messages
                if message.from_user and message.from_user.is_bot:
                    msg_text = message.text or ''
                    # Check if this is a notification (contains user ID or mentions user)
                    if ('id:' in msg_text.lower() or 'пользовател' in msg_text.lower() or
                        'новое сообщение' in msg_text.lower() or '@' in msg_text):
                        notification_message = message
                        notification_message_id = message.id
                        print(f"   ✅ Admin notification received!")
                        print(f"      Message ID: {notification_message_id}")
                        print(f"      Preview: {msg_text[:100]}...")
                        break

            if not notification_message:
                print("   ⚠️  No admin notification found")
                return {
                    'test': 'bot_functionality',
                    'passed': False,
                    'message': 'Admin notification not received',
                    'response': None
                }

            # STEP 4: Test reply functionality
            # CHANGE: Send reply in bot chat (not Saved Messages)
            # WHY: Admin replies to notifications IN the bot chat, not in Saved Messages
            # REF: Notification now comes from bot directly, so reply must be in bot chat
            print("\n   📋 Step 4: Testing reply to notification")
            reply_text = "Ответ админа через Reply"

            try:
                await self.client.send_message(
                    self.deployed_bot_username,
                    reply_text,
                    reply_to_message_id=notification_message_id
                )
                print(f"   ✅ Sent reply to notification")
                await asyncio.sleep(8)

                # Check for confirmation
                reply_confirmed = False
                async for message in self.client.get_chat_history(self.deployed_bot_username, limit=10):
                    if message.from_user and message.from_user.is_bot:
                        if message.text and 'отправлен' in message.text.lower():
                            reply_confirmed = True
                            print(f"   ✅ Bot confirmed reply was sent")
                            break

                # Check if reply received (we are both admin and user)
                reply_received = False
                async for message in self.client.get_chat_history(self.deployed_bot_username, limit=10):
                    if message.text and reply_text in message.text:
                        reply_received = True
                        print(f"   ✅ Reply delivered to user")
                        break

                if reply_confirmed or reply_received:
                    return {
                        'test': 'bot_functionality',
                        'passed': True,
                        'message': 'Admin message, notifications, and reply working',
                        'response': 'Full flow tested'
                    }
                else:
                    return {
                        'test': 'bot_functionality',
                        'passed': False,
                        'message': 'Reply sent but not confirmed',
                        'response': None
                    }

            except Exception as reply_error:
                print(f"   ❌ Reply failed: {reply_error}")
                return {
                    'test': 'bot_functionality',
                    'passed': False,
                    'message': f'Reply error: {reply_error}',
                    'response': None
                }

        except Exception as error:
            print(f"❌ Test failed with error: {error}")
            import traceback
            traceback.print_exc()
            return {
                'test': 'bot_functionality',
                'passed': False,
                'message': f'Error: {error}',
                'response': None
            }

    async def run_all_tests(self):
        """Run all E2E tests"""
        print("\n🧪 Starting Pyrogram E2E Tests...")
        print(f"Bot: @{BOT_USERNAME}")
        print(f"Test Account: {CREDS.phone_number or 'TELEGRAM_SESSION_STRING'}")

        async with self.client:
            me = await self.client.get_me()
            self.test_user_id = me.id

            # Test 1: Invalid token
            result1 = await self.test_invalid_token()
            self.test_results.append(result1)

            # Wait between tests
            await asyncio.sleep(3)

            # Test 2: Valid token
            result2 = await self.test_valid_token()
            self.test_results.append(result2)

            # Wait between tests
            await asyncio.sleep(3)

            # Test 3: Created bot functionality
            result3 = await self.test_created_bot_functionality()
            self.test_results.append(result3)

            # Print summary
            print("\n" + "=" * 60)
            print("TEST SUMMARY")
            print("=" * 60)

            passed = sum(1 for r in self.test_results if r['passed'])
            total = len(self.test_results)

            for result in self.test_results:
                status = "✅ PASSED" if result['passed'] else "❌ FAILED"
                print(f"{status} - {result['test']}: {result['message']}")

            print(f"\nTotal: {passed}/{total} passed ({int(passed/total*100)}%)")

            # Save conversation log
            import json
            log_file = os.path.join(os.path.dirname(__file__), 'e2e_conversation_log.json')
            with open(log_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                    'bot': BOT_USERNAME,
                    'conversation': self.conversation_log,
                    'test_results': self.test_results
                }, f, ensure_ascii=False, indent=2)
            print(f"\n📝 Conversation log saved to: {log_file}")

            return passed == total


async def main():
    """Main entry point"""
    global BOT_USERNAME, TEST_BUSINESS_NAME, INVALID_TOKEN, VALID_TOKEN
    args = parse_args()
    BOT_USERNAME = (args.main_bot or BOT_USERNAME).strip().lstrip('@')
    TEST_BUSINESS_NAME = (args.business_name or TEST_BUSINESS_NAME).strip()
    INVALID_TOKEN = (args.invalid_token or INVALID_TOKEN).strip()
    VALID_TOKEN = (args.valid_token or VALID_TOKEN).strip()

    runner = E2ETestRunner()
    try:
        success = await runner.run_all_tests()
        sys.exit(0 if success else 1)
    except Exception as error:
        print(f"\n❌ Fatal error: {error}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
