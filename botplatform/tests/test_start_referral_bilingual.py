#!/usr/bin/env python3
"""
Auto-test for /start deep-link referral tracking in both bots.

Checks:
1. Sends `/start t_GoGptRu` to @noxonbot (RU) and @coderboxbot (EN)
2. Verifies each bot responds
3. Verifies start notification was sent (via PM2 logs)
4. Verifies referral data persisted in user_referrals.json
"""

import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path

# Shared Pyrogram testkit (removes duplicated boilerplate across bots).
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
from pyrogram_testkit.env import load_env_files, read_telegram_creds
from pyrogram_testkit.client import WaitConfig, build_client, send_text_and_wait
from pyrogram_testkit.history import wait_for_file_contains

load_env_files((
    '/root/space2/hababru/.env',
    '/root/aisell/noxonbot/.env',
    '/root/space2/noxonbot/.env',
))

START_PARAM = 't_GoGptRu'
# Referral storage was migrated to data/referrals/ (see noxonbot/data/README.md).
# Keep legacy path as fallback so the test works across deployments.
USER_REFERRALS_PATHS = [
    Path('/root/aisell/noxonbot/data/referrals/user_referrals.json'),
    Path('/root/space2/noxonbot/data/referrals/user_referrals.json'),
    Path('/root/space2/noxonbot/user_referrals.json'),  # legacy
]

BOTS = [
    {
        'username': 'noxonbot',
        'language': 'ru',
        'pm2_process': 'noxonbot',
    },
    {
        'username': 'coderboxbot',
        'language': 'en',
        'pm2_process': 'coderboxbot',
    },
]


class StartReferralTester:
    def __init__(self):
        self.creds = read_telegram_creds()
        self.app = None
        self.me = None
        self.passed = 0
        self.failed = 0
        self.last_message_id_by_bot = {}

    def check(self, condition: bool, name: str, detail: str = '') -> bool:
        suffix = f' - {detail}' if detail else ''
        if condition:
            print(f'✅ {name}{suffix}')
            self.passed += 1
            return True
        print(f'❌ {name}{suffix}')
        self.failed += 1
        return False

    async def connect(self) -> bool:
        print('🔗 Connecting to Telegram...')
        if not self.creds.api_id or not self.creds.api_hash:
            self.check(False, 'Telegram credentials found')
            return False

        self.app = build_client(session_name='start_referral_bilingual_test', creds=self.creds)

        try:
            await self.app.start()
            self.me = await self.app.get_me()
            self.check(True, 'Connected to Telegram', f'@{self.me.username} ({self.me.id})')
            return True
        except Exception as error:
            self.check(False, 'Connected to Telegram', str(error))
            return False

    async def disconnect(self) -> None:
        if self.app:
            await self.app.stop()
            print('✅ Disconnected')

    async def send_start_and_get_response(self, bot_username: str) -> str:
        min_id = self.last_message_id_by_bot.get(bot_username)
        msg = await send_text_and_wait(
            self.app,
            chat_id=bot_username,
            text=f'/start {START_PARAM}',
            config=WaitConfig(timeout_seconds=10),
            min_message_id=min_id,
        )
        self.last_message_id_by_bot[bot_username] = msg.id
        return msg.text or ''

    @staticmethod
    def has_cyrillic(text: str) -> bool:
        return bool(re.search('[а-яА-ЯЁё]', text))

    def check_language(self, text: str, expected_language: str, bot_username: str) -> bool:
        if expected_language == 'en':
            return self.check(not self.has_cyrillic(text), f'English response has no Cyrillic ({bot_username})')
        return self.check(self.has_cyrillic(text), f'Russian response has Cyrillic ({bot_username})')

    @staticmethod
    def read_log_tail_from_offset(log_file: Path, offset: int) -> str:
        if not log_file.exists():
            return ''
        with log_file.open('r', encoding='utf8', errors='ignore') as fh:
            fh.seek(offset)
            return fh.read()

    async def wait_for_log_contains(
        self,
        log_path: Path,
        offset: int,
        expected_substring: str,
        *,
        timeout_seconds: float = 12.0,
        poll_interval_seconds: float = 0.5,
    ) -> bool:
        """Wait for a substring to appear in a pm2 log file after a given offset.

        Why: /start notifications are sent via a spawned python process and can take a few seconds.
        Also: pm2-logrotate may truncate/rotate logs; handle that by resetting offset when needed.
        """
        started_at = time.time()
        current_offset = offset

        while time.time() - started_at < timeout_seconds:
            try:
                if log_path.exists():
                    size = log_path.stat().st_size
                    if size < current_offset:
                        # Log rotated/truncated.
                        current_offset = 0
                    chunk = self.read_log_tail_from_offset(log_path, current_offset)
                    if expected_substring in chunk:
                        return True
                    current_offset = size
            except Exception:
                pass

            await asyncio.sleep(poll_interval_seconds)

        return False

    async def run(self) -> int:
        if not await self.connect():
            return 1

        try:
            user_id = self.me.id
            log_offsets = {}
            for bot in BOTS:
                log_path = Path(f'/root/.pm2/logs/{bot["pm2_process"]}-out.log')
                log_offsets[bot['pm2_process']] = log_path.stat().st_size if log_path.exists() else 0

            for bot in BOTS:
                username = bot['username']
                language = bot['language']
                process_name = bot['pm2_process']

                print(f'\n📋 Testing @{username} ({language})')
                response_text = await self.send_start_and_get_response(username)

                self.check(bool(response_text), f'Bot response exists (@{username})')
                if response_text:
                    self.check_language(response_text, language, username)

                # Verify per-chat history cache was persisted to disk.
                # This is a unified check shared across pyrogram tests.
                history_paths = [
                    Path(f"/root/aisell/noxonbot/data/history/chats/{user_id}.json"),
                    Path(f"/root/space2/noxonbot/data/history/chats/{user_id}.json"),
                ]
                try:
                    found = wait_for_file_contains(
                        history_paths,
                        f"/start {START_PARAM}",
                        timeout_seconds=10,
                        description=f"{process_name} chat cache",
                    )
                    self.check(True, f'History cache persisted ({process_name})', str(found))
                except Exception as e:
                    self.check(False, f'History cache persisted ({process_name})', str(e))

                log_path = Path(f'/root/.pm2/logs/{process_name}-out.log')
                has_notif_log = await self.wait_for_log_contains(
                    log_path,
                    log_offsets[process_name],
                    '/start notification sent for user',
                    timeout_seconds=15.0,
                )
                # Referral tracking log is synchronous and should be near-instant, but keep it resilient too.
                has_param_log = await self.wait_for_log_contains(
                    log_path,
                    log_offsets[process_name],
                    START_PARAM,
                    timeout_seconds=10.0,
                ) or await self.wait_for_log_contains(
                    log_path,
                    log_offsets[process_name],
                    'Referral saved:',
                    timeout_seconds=10.0,
                )

                self.check(has_notif_log, f'/start notification logged ({process_name})')
                self.check(has_param_log, f'Start param/referral logged ({process_name})')

            # Validate referral file has entries for BOTH processes
            entries = []
            for candidate in USER_REFERRALS_PATHS:
                if not candidate.exists():
                    continue
                raw = candidate.read_text(encoding='utf8')
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    entries = parsed
                    break

            self.check(len(entries) > 0, 'user_referrals.json has entries')

            for bot in BOTS:
                process_name = bot['pm2_process']
                matched = [
                    entry for entry in entries
                    if str(entry.get('userId')) == str(user_id)
                    and entry.get('referralParam') == START_PARAM
                    and entry.get('botProcessName') == process_name
                ]
                self.check(bool(matched), f'Referral saved for process {process_name}')
                if matched:
                    latest = matched[-1]
                    self.check(
                        latest.get('referralSource') == 'telegram_channel:GoGptRu',
                        f'Referral source parsed correctly ({process_name})',
                        str(latest.get('referralSource')),
                    )

            print('\n============================================================')
            print('📊 Start Referral Test Summary')
            print('============================================================')
            print(f'✅ Passed: {self.passed}')
            print(f'❌ Failed: {self.failed}')
            total = self.passed + self.failed
            print(f'📈 Total: {total}')
            success_rate = (self.passed / total * 100.0) if total else 0.0
            print(f'🎯 Success rate: {success_rate:.1f}%')
            print('============================================================')

            return 0 if self.failed == 0 else 1
        finally:
            await self.disconnect()


async def main() -> int:
    tester = StartReferralTester()
    return await tester.run()


if __name__ == '__main__':
    try:
        code = asyncio.run(main())
        sys.exit(code)
    except KeyboardInterrupt:
        print('\n⚠️ Interrupted')
        sys.exit(130)
