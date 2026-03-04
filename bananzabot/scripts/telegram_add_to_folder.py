#!/usr/bin/env python3
"""
Add Telegram chat/user to a named folder via Pyrogram raw API.

Usage:
  python3 telegram_add_to_folder.py @username bananza
  python3 telegram_add_to_folder.py 123456789 bananza
"""

import asyncio
import os
import sys
from dotenv import load_dotenv
from pyrogram import Client
from pyrogram.errors import PeerIdInvalid
from pyrogram.raw.functions.messages import GetDialogFilters, UpdateDialogFilter
from pyrogram.raw.types import DialogFilter, DialogFilterChatlist


ENV_PATHS = [
    "/root/space2/hababru/.env",
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "space2", "hababru", ".env"),
    os.path.join(os.path.dirname(__file__), ".env"),
]


def load_env():
    for env_path in ENV_PATHS:
        if os.path.exists(env_path):
            load_dotenv(env_path)
            return
    load_dotenv()


def get_client():
    api_id = os.getenv("TELEGRAM_API_ID")
    api_hash = os.getenv("TELEGRAM_API_HASH")
    session_string = os.getenv("TELEGRAM_SESSION_STRING")
    phone_number = os.getenv("TELEGRAM_PHONE_NUMBER")
    if not api_id or not api_hash:
        raise RuntimeError("Missing TELEGRAM_API_ID/TELEGRAM_API_HASH")
    if session_string:
        return Client(
            name="hababru_sender",
            api_id=int(api_id),
            api_hash=api_hash,
            session_string=session_string,
            workdir=".",
        )
    return Client(
        name="hababru_sender",
        api_id=int(api_id),
        api_hash=api_hash,
        phone_number=phone_number,
        workdir=".",
    )


def peer_key(peer):
    name = type(peer).__name__
    for attr in ("user_id", "chat_id", "channel_id"):
        if hasattr(peer, attr):
            return f"{name}:{getattr(peer, attr)}"
    return name


def folder_title_text(filter_obj, fallback_id):
    title = getattr(filter_obj, "title", None)
    if isinstance(title, str):
        return title
    return f"Folder {fallback_id}"


def build_dialog_filter(folder_id, title, include_peers, source=None):
    if source is None:
        pinned_peers = []
        exclude_peers = []
        contacts = False
        non_contacts = False
        groups = False
        broadcasts = False
        bots = False
        exclude_muted = False
        exclude_read = False
        exclude_archived = False
        emoticon = "📁"
    else:
        pinned_peers = list(getattr(source, "pinned_peers", []) or [])
        exclude_peers = list(getattr(source, "exclude_peers", []) or [])
        contacts = bool(getattr(source, "contacts", False))
        non_contacts = bool(getattr(source, "non_contacts", False))
        groups = bool(getattr(source, "groups", False))
        broadcasts = bool(getattr(source, "broadcasts", False))
        bots = bool(getattr(source, "bots", False))
        exclude_muted = bool(getattr(source, "exclude_muted", False))
        exclude_read = bool(getattr(source, "exclude_read", False))
        exclude_archived = bool(getattr(source, "exclude_archived", False))
        emoticon = getattr(source, "emoticon", None) or "📁"

    return DialogFilter(
        id=folder_id,
        title=title,
        pinned_peers=pinned_peers,
        include_peers=include_peers,
        exclude_peers=exclude_peers,
        contacts=contacts,
        non_contacts=non_contacts,
        groups=groups,
        broadcasts=broadcasts,
        bots=bots,
        exclude_muted=exclude_muted,
        exclude_read=exclude_read,
        exclude_archived=exclude_archived,
        emoticon=emoticon,
    )


async def resolve_target_peer(client: Client, target: str):
    normalized = str(target or "").strip()
    if not normalized:
        raise RuntimeError("Target is empty")

    username = normalized.lstrip("@")
    numeric_id = int(username) if username.lstrip("-").isdigit() else None

    resolve_candidates = [normalized]
    if username and username != normalized:
        resolve_candidates.append(username)
    if username:
        resolve_candidates.append(f"@{username}")
    if numeric_id is not None:
        resolve_candidates.append(numeric_id)

    seen = set()
    for candidate in resolve_candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        try:
            return await client.resolve_peer(candidate)
        except PeerIdInvalid:
            continue
        except Exception:
            continue

    if numeric_id is not None:
        # get_users may prime session data with access_hash for known contacts
        try:
            user = await client.get_users(numeric_id)
            if user and getattr(user, "id", None):
                return await client.resolve_peer(user.id)
        except Exception:
            pass

        # If chat was seen in dialogs, resolve it by exact dialog id.
        try:
            async for dialog in client.get_dialogs(limit=400):
                chat = getattr(dialog, "chat", None)
                chat_id = getattr(chat, "id", None) if chat else None
                if chat_id == numeric_id:
                    return await client.resolve_peer(chat_id)
        except Exception:
            pass

    raise RuntimeError(
        f"Could not resolve peer for '{target}'. "
        "Telegram requires a known peer (with access_hash): open chat/contact first."
    )


async def add_to_folder(target: str, folder_name: str):
    client = get_client()
    await client.start()
    try:
        peer = await resolve_target_peer(client, target)

        filters = await client.invoke(GetDialogFilters())
        folder = None
        max_id = 0
        for f in filters:
            if isinstance(f, (DialogFilter, DialogFilterChatlist)):
                max_id = max(max_id, int(getattr(f, "id", 0)))
                title = folder_title_text(f, max_id)
                if title.strip().lower() == folder_name.strip().lower():
                    folder = f

        if folder is None:
            folder_id = max_id + 1 if max_id > 0 else 2
            current_include = []
            new_filter = build_dialog_filter(folder_id, folder_name, [peer], None)
            await client.invoke(UpdateDialogFilter(id=folder_id, filter=new_filter))
            print(f"OK created folder '{folder_name}' and added peer")
            return

        current_include = list(getattr(folder, "include_peers", []) or [])
        current_keys = {peer_key(p) for p in current_include}
        if peer_key(peer) in current_keys:
            print("OK already_in_folder")
            return

        updated_include = [*current_include, peer]
        updated_filter = build_dialog_filter(folder.id, folder_title_text(folder, folder.id), updated_include, folder)
        await client.invoke(UpdateDialogFilter(id=folder.id, filter=updated_filter))
        print("OK added_to_existing_folder")
    finally:
        await client.stop()


async def main():
    if len(sys.argv) < 3:
        print("Usage: python3 telegram_add_to_folder.py @username folder_name")
        sys.exit(2)
    load_env()
    target = sys.argv[1]
    folder_name = sys.argv[2]
    try:
        await add_to_folder(target, folder_name)
    except Exception as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
