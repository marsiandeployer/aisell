#!/usr/bin/env python3
"""
E2E-ish auto-test for Web Chat mode (No Telegram).

Goals:
- Guest bootstrap shows /start + greeting (public endpoint)
- First-time "claim" (name+email) creates a session cookie (no email verification)
- /start is initialized and history is persisted to disk
- Sending the first real message persists user+bot messages
- Re-claiming with the same email restores the same history (persistence)
"""

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests


DEFAULT_URLS = [
    "http://127.0.0.1:8092",  # Coderbox EN (web)
]


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def http_json(sess: requests.Session, method: str, url: str, **kwargs) -> Tuple[int, Dict[str, Any]]:
    resp = sess.request(method, url, timeout=15, **kwargs)
    try:
        data = resp.json()
    except Exception:
        data = {"_raw": resp.text[:1000]}
    return resp.status_code, data


def wait_until(fn, timeout_s: float, step_s: float = 0.4) -> Any:
    deadline = time.time() + timeout_s
    last_err: Optional[Exception] = None
    while time.time() < deadline:
        try:
            return fn()
        except Exception as e:
            last_err = e
            time.sleep(step_s)
    if last_err:
        raise last_err
    raise TimeoutError("wait_until: timeout")


def load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return fallback


def save_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), "utf-8")


def cleanup_webchat_user(email: str, user_id: int) -> None:
    base = Path("/root/aisell/noxonbot/data/webchat")
    users_path = base / "users.json"
    sessions_path = base / "sessions.json"
    chats_path = base / "chats" / f"{user_id}.json"
    workspace = Path(f"/root/aisellusers/user_{user_id}")

    users = load_json(users_path, [])
    if isinstance(users, list):
        users = [u for u in users if not (isinstance(u, dict) and u.get("email") == email)]
        save_json(users_path, users)

    sessions = load_json(sessions_path, [])
    if isinstance(sessions, list):
        sessions = [s for s in sessions if not (isinstance(s, dict) and s.get("userId") == user_id)]
        save_json(sessions_path, sessions)

    try:
        if chats_path.exists():
            chats_path.unlink()
    except Exception:
        pass

    try:
        if workspace.exists():
            # Best-effort: onboarding free mode may create this folder.
            for p in sorted(workspace.rglob("*"), reverse=True):
                try:
                    if p.is_file() or p.is_symlink():
                        p.unlink()
                    else:
                        p.rmdir()
                except Exception:
                    pass
            try:
                workspace.rmdir()
            except Exception:
                pass
    except Exception:
        pass


def run_for_base(base_url: str) -> None:
    print(f"\n[{_now()}] 🌐 Webchat test: {base_url}")
    base_url = base_url.rstrip("/")

    sess = requests.Session()

    # Public bootstrap (guest mode).
    code, boot = http_json(sess, "GET", f"{base_url}/api/public/bootstrap")
    assert_true(code == 200, f"bootstrap status != 200: {code} {boot}")
    start_messages = boot.get("startMessages") or []
    assert_true(isinstance(start_messages, list) and len(start_messages) >= 2, f"bootstrap.startMessages invalid: {start_messages}")
    assert_true(start_messages[0].get("role") == "user" and start_messages[0].get("text") == "/start", "bootstrap: first message must be user /start")

    # Crawl-tests endpoint must expose both RU and EN targets for visibility in web UI.
    code, crawl = http_json(sess, "GET", f"{base_url}/api/crawl-tests")
    assert_true(code == 200, f"crawl-tests status != 200: {code} {crawl}")
    results = crawl.get("results") or []
    assert_true(isinstance(results, list), "crawl-tests.results must be a list")
    labels = {str(item.get("label", "")).upper() for item in results if isinstance(item, dict)}
    assert_true("RU" in labels and "EN" in labels, f"crawl-tests must include RU and EN targets, got labels={sorted(labels)}")

    # Unauthed endpoints (skip localhost auto-auth check).
    # CHANGE: Localhost auto-authenticates by design for dev convenience
    # WHY: ensureAuthed() in webchat.ts creates virtual user 999999999 for localhost
    # REF: webchat.ts:2665-2696
    is_localhost_test = "127.0.0.1" in base_url or "localhost" in base_url
    if not is_localhost_test:
        code, _ = http_json(sess, "GET", f"{base_url}/api/me")
        assert_true(code == 401, f"/api/me without session must be 401, got {code}")
        code, _ = http_json(sess, "GET", f"{base_url}/api/history")
        assert_true(code == 401, f"/api/history without session must be 401, got {code}")

    # Claim session (no magic-link).
    run_id = uuid.uuid4().hex[:10]
    email = f"webchat_test_{run_id}@example.com"
    name = f"Webchat Test {run_id}"
    code, claim = http_json(sess, "POST", f"{base_url}/api/auth/claim", json={"name": name, "email": email})
    assert_true(code == 200 and claim.get("ok") is True, f"claim failed: {code} {claim}")
    user = claim.get("user") or {}
    user_id = int(user.get("userId"))
    assert_true(user_id > 0, f"invalid userId: {user_id}")

    # /start should have been initialized on first visit.
    def _history_has_start() -> List[Dict[str, Any]]:
        c, h = http_json(sess, "GET", f"{base_url}/api/history")
        assert_true(c == 200, f"/api/history failed after claim: {c} {h}")
        msgs = h.get("messages") or []
        assert_true(isinstance(msgs, list), "history.messages must be a list")
        assert_true(any(m.get("role") == "user" and m.get("text") == "/start" for m in msgs), "history must contain user /start")
        assert_true(any(m.get("role") == "assistant" and isinstance(m.get("text"), str) and len(m.get("text")) > 0 for m in msgs), "history must contain assistant greeting")
        return msgs

    wait_until(_history_has_start, timeout_s=15)

    # Send first real message (unique marker) and wait until it persists.
    marker = f"[webchat-history-marker:{run_id}]"
    text = f"Идея проекта: {marker}"
    code, msg_resp = http_json(sess, "POST", f"{base_url}/api/message", json={"text": text})
    assert_true(code == 200 and msg_resp.get("ok") is True, f"send message failed: {code} {msg_resp}")

    def _history_has_marker() -> List[Dict[str, Any]]:
        c, h = http_json(sess, "GET", f"{base_url}/api/history")
        assert_true(c == 200, f"/api/history failed after message: {c} {h}")
        msgs = h.get("messages") or []
        assert_true(any(isinstance(m.get("text"), str) and marker in m.get("text") for m in msgs), "marker not found in history yet")
        assert_true(any(m.get("role") == "assistant" and isinstance(m.get("text"), str) and len(m.get("text")) > 0 for m in msgs), "assistant reply missing")
        return msgs

    msgs = wait_until(_history_has_marker, timeout_s=25)

    # Verify transcript persisted on disk.
    transcript_path = Path("/root/aisell/noxonbot/data/webchat/chats") / f"{user_id}.json"
    assert_true(transcript_path.exists(), f"transcript file missing: {transcript_path}")
    transcript = load_json(transcript_path, [])
    assert_true(isinstance(transcript, list), "transcript must be a list")
    assert_true(any(isinstance(m, dict) and isinstance(m.get("text"), str) and marker in m.get("text") for m in transcript), "marker not found in transcript file")

    # Verify workspace chat log is kept in sync once the workspace exists.
    workspace = Path(f"/root/aisellusers/user_{user_id}")
    workspace_log_path = workspace / "chat_log.json"

    def _workspace_log_has_marker() -> List[Dict[str, Any]]:
        assert_true(workspace_log_path.exists(), f"workspace chat_log.json missing: {workspace_log_path}")
        ws_log = load_json(workspace_log_path, [])
        assert_true(isinstance(ws_log, list), "workspace chat_log.json must be a list")
        assert_true(any(isinstance(m, dict) and isinstance(m.get("text"), str) and marker in m.get("text") for m in ws_log), "marker not found in workspace chat_log.json")
        return ws_log

    wait_until(_workspace_log_has_marker, timeout_s=10)

    # Re-claim in a new session: history must be restored (persistence across sessions).
    sess2 = requests.Session()
    code, claim2 = http_json(sess2, "POST", f"{base_url}/api/auth/claim", json={"name": name, "email": email})
    assert_true(code == 200 and claim2.get("ok") is True, f"re-claim failed: {code} {claim2}")

    code, h2 = http_json(sess2, "GET", f"{base_url}/api/history")
    assert_true(code == 200, f"/api/history after re-claim failed: {code} {h2}")
    msgs2 = h2.get("messages") or []
    assert_true(any(isinstance(m.get("text"), str) and marker in m.get("text") for m in msgs2), "marker not found after re-claim (history not restored)")

    print(f"[{_now()}] ✅ PASS: {base_url} (userId={user_id}, messages={len(msgs)})")

    # Cleanup test artifacts (best-effort) to avoid polluting admin views.
    cleanup_webchat_user(email=email, user_id=user_id)


def main() -> None:
    raw = (os.environ.get("WEBCHAT_TEST_URLS") or "").strip()
    urls = [u.strip() for u in raw.split(",") if u.strip()] if raw else DEFAULT_URLS

    failed: List[Tuple[str, str]] = []
    for u in urls:
        try:
            run_for_base(u)
        except Exception as e:
            failed.append((u, str(e)))

    if failed:
        print("\n❌ FAILED:")
        for u, err in failed:
            print(f"- {u}: {err}")
        raise SystemExit(1)

    print("\n✅ All webchat tests passed.")


if __name__ == "__main__":
    main()
