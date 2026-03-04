#!/usr/bin/env python3
"""
Interactive E2E Test with Pyrogram - Uses file-based code input

CHANGE: Modified version that reads confirmation code from file instead of stdin
WHY: Claude Code can't interact with stdin, so we use file-based communication
REF: User will provide code via file when prompted
"""

import os
import sys
import asyncio
import time
from dotenv import load_dotenv
from pyrogram import Client
from pyrogram.types import Message

# Load environment variables
ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(ENV_PATH)

# Fallback to hababru session string if available
HABABRU_ENV_PATH = '/root/space2/hababru/.env'
if not os.getenv('TELEGRAM_SESSION_STRING') and os.path.exists(HABABRU_ENV_PATH):
    load_dotenv(HABABRU_ENV_PATH)

# Pyrogram credentials
API_ID = int(os.getenv('TELEGRAM_API_ID', '20663119'))
API_HASH = os.getenv('TELEGRAM_API_HASH', '0735e154f4ee0ea6bcfe3d972de467b9')
PHONE_NUMBER = os.getenv('TELEGRAM_PHONE_NUMBER', '+79855954987')

# Test configuration
BOT_USERNAME = 'bananza_bot'
TEST_BUSINESS_NAME = 'Тестовый бот, просто пересылает мне сообщения'
TEST_BUSINESS_NAME_2 = 'Тестовый бот 2, просто пересылает мне сообщения'
INVALID_TOKEN = '123456:INVALID_TOKEN_FORMAT'
VALID_TOKEN = '8498906759:AAFU-f6TO5_SKIlh7-FEDLx9e8BFDSdn_58'

# Session and code files
SESSION_FILE = os.path.join(os.path.dirname(__file__), 'e2e_test_session')
SESSION_STRING = os.getenv('TELEGRAM_SESSION_STRING')
CODE_FILE = os.path.join(os.path.dirname(__file__), 'telegram_code.txt')


async def wait_for_code_file():
    """Wait for confirmation code to be written to file"""
    print(f"\n⏳ Waiting for confirmation code in: {CODE_FILE}")
    print("Please create this file with the code from Telegram")

    for i in range(120):  # Wait up to 2 minutes
        if os.path.exists(CODE_FILE):
            with open(CODE_FILE, 'r') as f:
                code = f.read().strip()
            os.remove(CODE_FILE)  # Clean up
            return code
        await asyncio.sleep(1)
        if i % 10 == 0:
            print(f"Still waiting... ({120-i} seconds left)")

    raise TimeoutError("No code file found within 2 minutes")


class InteractiveClient(Client):
    """Client that reads confirmation code from file"""

    async def authorize(self):
        """Override authorize to use file-based code input"""
        if not self.phone_number:
            raise ValueError("Phone number is required")

        # Check if already authorized
        try:
            await self.get_me()
            return
        except:
            pass

        # Send code
        try:
            sent_code = await self.send_code(self.phone_number)
        except Exception as e:
            print(f"Error sending code: {e}")
            raise

        # Wait for code from file
        phone_code = await wait_for_code_file()

        # Sign in with code
        try:
            await self.sign_in(self.phone_number, sent_code.phone_code_hash, phone_code)
        except Exception as e:
            print(f"Error signing in: {e}")
            raise


class E2ETestRunner:
    """E2E test runner using Pyrogram"""

    def __init__(self):
        if SESSION_STRING:
            self.client = Client(
                name=SESSION_FILE,
                api_id=API_ID,
                api_hash=API_HASH,
                session_string=SESSION_STRING
            )
        else:
            self.client = InteractiveClient(
                name=SESSION_FILE,
                api_id=API_ID,
                api_hash=API_HASH,
                phone_number=PHONE_NUMBER
            )
        self.test_results = []
        self.conversation_log = []

    async def send_and_wait(self, chat_id: str, message: str, wait_seconds: int = 5, wait_for_keywords: list = None) -> Message:
        """Send message and wait for response

        Args:
            chat_id: Chat to send message to
            message: Message text to send
            wait_seconds: How long to wait for response
            wait_for_keywords: If provided, keep waiting until message contains one of these keywords
        """
        print(f"[→ USER] {message}")
        self.conversation_log.append({'role': 'user', 'content': message})

        # Get message count before sending
        history_before = []
        async for msg in self.client.get_chat_history(chat_id, limit=10):
            history_before.append(msg.id)

        # Send message
        await self.client.send_message(chat_id, message)

        # Wait for response with polling
        last_msg = None
        for attempt in range(wait_seconds * 2):  # Check every 0.5 seconds
            await asyncio.sleep(0.5)

            # Get latest messages
            async for msg in self.client.get_chat_history(chat_id, limit=10):
                # Check if this is a new message from bot
                if msg.id not in history_before and msg.from_user:
                    if msg.from_user.is_bot and (not msg.from_user.username or BOT_USERNAME in (msg.from_user.username or '')):
                        response_text = msg.text or msg.caption or ''

                        # If we have keyword requirements, check them
                        if wait_for_keywords:
                            response_lower = response_text.lower()
                            if any(keyword in response_lower for keyword in wait_for_keywords):
                                print(f"[← BOT] {response_text[:200]}...")
                                self.conversation_log.append({'role': 'assistant', 'content': response_text})
                                return msg
                            else:
                                # Save this message but keep waiting
                                last_msg = msg
                        else:
                            # No keyword requirement, return first message
                            print(f"[← BOT] {response_text[:200]}...")
                            self.conversation_log.append({'role': 'assistant', 'content': response_text})
                            return msg

        # If we were waiting for keywords and got a message but not the right one
        if wait_for_keywords and last_msg:
            response_text = last_msg.text or last_msg.caption or ''
            print(f"[← BOT (timeout)] {response_text[:200]}...")
            self.conversation_log.append({'role': 'assistant', 'content': response_text})
            return last_msg

        print(f"⚠️  No response from bot after {wait_seconds} seconds")
        raise Exception(f'No response from bot after {wait_seconds} seconds')

    async def test_invalid_token(self) -> dict:
        """Test scenario: Invalid API token"""
        print("\n" + "=" * 60)
        print("TEST 1: Invalid API Token")
        print("=" * 60)

        try:
            # Start conversation
            await self.send_and_wait(BOT_USERNAME, '/start', wait_seconds=2)

            # Send business name and wait for FULL prompt preview (contains "токен" or "BotFather")
            print("⏳ Waiting for prompt generation and token request...")
            prompt_request = await self.send_and_wait(
                BOT_USERNAME,
                TEST_BUSINESS_NAME,
                wait_seconds=30,  # Longer wait for AI generation
                wait_for_keywords=['токен', 'botfather', 'bananzatestbot']  # Wait for token instructions or test link
            )

            # Check if bot is ready and asks for token
            prompt_text = prompt_request.text.lower() if prompt_request.text else ''
            if 'токен' in prompt_text or 'botfather' in prompt_text or 'bananzatestbot' in prompt_text:
                print("✅ Bot generated prompt and asked for token")
            else:
                print(f"⚠️  Bot response doesn't contain token request. Response: {prompt_text[:100]}...")
                await self.send_and_wait(
                    BOT_USERNAME,
                    'пофигу на остальное просто перекидывай сообщения',
                    wait_seconds=30,
                    wait_for_keywords=['токен', 'botfather', 'bananzatestbot']
                )

            # Send invalid token
            response = await self.send_and_wait(BOT_USERNAME, INVALID_TOKEN, wait_seconds=10)

            # Check if bot detected invalid token
            response_text = response.text.lower() if response.text else ''
            detected_error = any(keyword in response_text for keyword in [
                'неверн', 'ошибк', 'invalid', 'error', 'некорректн', 'проверьте', 'не похоже'
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
            # Send /start again to reset
            await self.send_and_wait(BOT_USERNAME, '/start', wait_seconds=2)

            # Send business name and wait for FULL prompt preview
            print("⏳ Waiting for prompt generation and token request...")
            prompt_request = await self.send_and_wait(
                BOT_USERNAME,
                TEST_BUSINESS_NAME_2,
                wait_seconds=30,  # Longer wait for AI generation
                wait_for_keywords=['токен', 'botfather', 'bananzatestbot']  # Wait for token instructions or test link
            )

            # Check if bot is ready and asks for token
            prompt_text = prompt_request.text.lower() if prompt_request.text else ''
            if 'токен' in prompt_text or 'botfather' in prompt_text or 'bananzatestbot' in prompt_text:
                print("✅ Bot generated prompt and asked for token")
            else:
                # Bot didn't generate prompt - send explicit request
                print(f"⚠️  Bot response doesn't contain token request. Requesting prompt generation...")
                print(f"    Response was: {prompt_text[:100]}...")

                # Ask explicitly for prompt generation
                prompt_request = await self.send_and_wait(
                    BOT_USERNAME,
                    "Готово, создай промпт",
                    wait_seconds=30,
                    wait_for_keywords=['токен', 'botfather', 'bananzatestbot']
                )

                prompt_text = prompt_request.text.lower() if prompt_request.text else ''
                if 'токен' not in prompt_text and 'botfather' not in prompt_text and 'bananzatestbot' not in prompt_text:
                    print(f"❌ Bot still didn't generate prompt after explicit request")
                    return {
                        'test': 'valid_token',
                        'passed': False,
                        'message': 'Bot did not generate prompt even after explicit request',
                        'response': prompt_text
                    }
                print("✅ Bot generated prompt after explicit request")

            # Send valid token and wait for creation message
            # CHANGE: Wait longer and look for "бот создан" message
            # WHY: Bot sends multiple messages (checking token, creating, deploying)
            # REF: User wants to see full bot creation flow
            print("⏳ Waiting for bot creation (checking token, creating, deploying)...")
            response = await self.send_and_wait(
                BOT_USERNAME,
                VALID_TOKEN,
                wait_seconds=25,  # Longer wait for creation + deploy
                wait_for_keywords=['бот успешно создан', 'бот создан']  # Wait for creation confirmation
            )

            # Check if bot accepted token and proceeded
            response_text = response.text.lower() if response.text else ''
            token_accepted = any(keyword in response_text for keyword in [
                'бот успешно создан', 'бот создан', 'ожидает деплоя', 'задеплоен'
            ]) and not any(keyword in response_text for keyword in [
                'неверн', 'ошибк', 'invalid', 'error', 'не похоже'
            ])

            if token_accepted:
                print("✅ Bot accepted valid token!")

                # CHANGE: Extract bot username from response for later testing
                # WHY: Need to test interaction with created bot
                # REF: User request - "тестируй созданного бота тоже"
                bot_username = None
                response_full_text = response.text or ''
                # Look for @username or t.me/username pattern
                import re
                username_match = re.search(r'@(\w+)', response_full_text)
                if username_match:
                    bot_username = username_match.group(1)
                    print(f"   Extracted bot username: @{bot_username}")

                return {
                    'test': 'valid_token',
                    'passed': True,
                    'message': 'Bot accepted valid token',
                    'response': response_text,
                    'bot_username': bot_username  # Return username for Test 3
                }
            else:
                print("❌ Bot did not accept valid token")
                print(f"    Response was: {response_text[:150]}...")
                return {
                    'test': 'valid_token',
                    'passed': False,
                    'message': 'Bot should accept valid token',
                    'response': response_text,
                    'bot_username': None
                }

        except Exception as error:
            print(f"❌ Test failed with error: {error}")
            return {
                'test': 'valid_token',
                'passed': False,
                'message': f'Error: {error}',
                'response': None
            }

    async def test_created_bot_interaction(self, bot_username: str) -> dict:
        """Test scenario: Interact with created bot"""
        print("\n" + "=" * 60)
        print("TEST 3: Created Bot Interaction")
        print(f"Testing bot: @{bot_username}")
        print("=" * 60)

        try:
            # Wait for bot to be deployed (check every 3 seconds for up to 45 seconds)
            print("⏳ Waiting for bot deployment...")
            bot_deployed = False
            for i in range(15):  # 15 attempts * 3 seconds = 45 seconds
                await asyncio.sleep(3)
                try:
                    # Try to send message to bot
                    test_message = "Привет! Это тестовое сообщение."
                    response = await self.send_and_wait(bot_username, test_message, wait_seconds=5)

                    # If we got a response, bot is deployed
                    response_text = response.text or response.caption or ''
                    print(f"✅ Bot is deployed and responded!")
                    print(f"[← BOT] {response_text[:200]}...")

                    bot_deployed = True
                    break
                except Exception as e:
                    print(f"   Attempt {i+1}/15: Bot not ready yet...")
                    continue

            if not bot_deployed:
                print("❌ Bot was not deployed within 45 seconds")
                return {
                    'test': 'created_bot_interaction',
                    'passed': False,
                    'message': 'Bot was not deployed within 45 seconds',
                    'response': None
                }

            # Bot responded, check that response is not empty
            if response_text:
                print("✅ Created bot responded to test message!")
                return {
                    'test': 'created_bot_interaction',
                    'passed': True,
                    'message': 'Created bot responded successfully',
                    'response': response_text
                }
            else:
                print("❌ Bot responded but with empty message")
                return {
                    'test': 'created_bot_interaction',
                    'passed': False,
                    'message': 'Bot responded with empty message',
                    'response': ''
                }

        except Exception as error:
            print(f"❌ Test failed with error: {error}")
            return {
                'test': 'created_bot_interaction',
                'passed': False,
                'message': f'Error: {error}',
                'response': None
            }

    async def run_all_tests(self):
        """Run all E2E tests"""
        print("\n🧪 Starting Pyrogram E2E Tests...")
        print(f"Bot: @{BOT_USERNAME}")
        print(f"Test Account: {PHONE_NUMBER}")

        async with self.client:
            # Test 1: Invalid token
            result1 = await self.test_invalid_token()
            self.test_results.append(result1)

            # Wait between tests
            await asyncio.sleep(3)

            # Test 2: Valid token
            result2 = await self.test_valid_token()
            self.test_results.append(result2)

            # Test 3: Created bot interaction (only if Test 2 passed and we got username)
            # CHANGE: Test the created bot's responses
            # WHY: User wants to ensure created bot is working
            # REF: User request - "тестируй созданного бота тоже"
            if result2['passed'] and result2.get('bot_username'):
                print(f"\n⏳ Proceeding to test created bot: @{result2['bot_username']}")
                await asyncio.sleep(5)  # Wait a bit before testing

                result3 = await self.test_created_bot_interaction(result2['bot_username'])
                self.test_results.append(result3)
            else:
                if not result2['passed']:
                    print("\n⚠️  Skipping Test 3: Test 2 (valid token) failed")
                else:
                    print("\n⚠️  Skipping Test 3: Could not extract bot username from response")

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
