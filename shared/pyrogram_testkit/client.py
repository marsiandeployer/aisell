import asyncio
import time
from dataclasses import dataclass
from typing import Iterable, Optional

from pyrogram import Client
from pyrogram.types import Message

from .env import TelegramCreds


@dataclass
class WaitConfig:
    timeout_seconds: float = 10.0
    poll_interval_seconds: float = 1.0
    history_limit: int = 10
    keywords: Optional[Iterable[str]] = None


def build_client(
    *,
    session_name: str,
    creds: TelegramCreds,
) -> Client:
    if not creds.api_id or not creds.api_hash:
        raise RuntimeError("Missing TELEGRAM_API_ID/TELEGRAM_API_HASH in env")

    client_kwargs = {
        "name": session_name,
        "api_id": creds.api_id,
        "api_hash": creds.api_hash,
    }
    if creds.session_string:
        client_kwargs["session_string"] = creds.session_string
    elif creds.phone_number:
        client_kwargs["phone_number"] = creds.phone_number
    else:
        # Pyrogram will prompt interactively if no session_string provided.
        # For CI/non-interactive environments, TELEGRAM_SESSION_STRING is required.
        pass

    return Client(**client_kwargs)


async def find_latest_bot_message(client: Client, chat_id: str, limit: int = 10) -> Optional[Message]:
    latest: Optional[Message] = None
    async for msg in client.get_chat_history(chat_id, limit=limit):
        if msg.from_user and msg.from_user.is_bot:
            latest = msg
            break
    return latest


async def wait_for_bot_message(
    client: Client,
    *,
    chat_id: str,
    config: WaitConfig,
    min_message_id: Optional[int] = None,
) -> Message:
    """Poll chat history until a bot message is found (optionally with keywords)."""
    started_at = time.time()
    keywords = [k.lower() for k in (config.keywords or [])]
    last_seen: Optional[Message] = None

    while True:
        async for msg in client.get_chat_history(chat_id, limit=config.history_limit):
            if not (msg.from_user and msg.from_user.is_bot):
                continue
            if min_message_id is not None and msg.id <= min_message_id:
                continue

            last_seen = msg
            if not keywords:
                return msg

            text = (msg.text or msg.caption or "").lower()
            if any(k in text for k in keywords):
                return msg

        if time.time() - started_at >= config.timeout_seconds:
            if last_seen is not None:
                return last_seen
            raise RuntimeError("No bot response within timeout")

        await asyncio.sleep(config.poll_interval_seconds)


async def send_text_and_wait(
    client: Client,
    *,
    chat_id: str,
    text: str,
    config: WaitConfig,
    min_message_id: Optional[int] = None,
) -> Message:
    # If caller didn't provide a baseline, capture the latest bot message id BEFORE we send,
    # otherwise we might immediately "receive" an old message from previous runs.
    baseline_id = min_message_id
    if baseline_id is None:
        latest = await find_latest_bot_message(client, chat_id, limit=config.history_limit)
        baseline_id = latest.id if latest else None

    await client.send_message(chat_id, text)
    return await wait_for_bot_message(client, chat_id=chat_id, config=config, min_message_id=baseline_id)


async def click_callback_and_wait(
    client: Client,
    *,
    chat_id: str,
    message_id: int,
    callback_data: str,
    config: WaitConfig,
    min_message_id: Optional[int] = None,
) -> Message:
    baseline_id = min_message_id
    if baseline_id is None:
        latest = await find_latest_bot_message(client, chat_id, limit=config.history_limit)
        baseline_id = latest.id if latest else None

    await client.request_callback_answer(
        chat_id=chat_id,
        message_id=message_id,
        callback_data=callback_data,
    )
    return await wait_for_bot_message(client, chat_id=chat_id, config=config, min_message_id=baseline_id)
