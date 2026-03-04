import time
from pathlib import Path
from typing import Iterable, Optional

import subprocess
import shlex


def wait_for_file_contains(
    file_paths: Iterable[Path],
    expected_substring: str,
    *,
    timeout_seconds: float = 10.0,
    poll_interval_seconds: float = 0.5,
    description: Optional[str] = None,
) -> Path:
    """Wait until any file contains a substring (used for persistence assertions).

    We intentionally do a raw substring match rather than JSON parsing:
    - it's resilient to schema changes
    - the tests provide unique markers to avoid false positives
    """
    started_at = time.time()
    last_seen_existing = []

    while True:
        for file_path in file_paths:
            try:
                if not file_path.exists():
                    continue
                last_seen_existing.append(str(file_path))
                content = file_path.read_text(encoding="utf-8", errors="ignore")
                if expected_substring in content:
                    return file_path
            except Exception:
                # Keep retrying; filesystem writes may be mid-flight.
                continue

        if time.time() - started_at >= timeout_seconds:
            label = f" ({description})" if description else ""
            existing = ", ".join(sorted(set(last_seen_existing))) or "none"
            raise AssertionError(
                f"Expected substring not found{label}: {expected_substring!r}. "
                f"Checked files (existing during wait): {existing}"
            )

        time.sleep(poll_interval_seconds)


def wait_for_file_contains_ssh(
    ssh_host: str,
    file_paths: Iterable[str],
    expected_substring: str,
    *,
    timeout_seconds: float = 10.0,
    poll_interval_seconds: float = 0.5,
    description: Optional[str] = None,
) -> str:
    """Wait until any remote file (checked via SSH) contains a substring.

    This is used when the bot runs on another server (protected prod edge),
    but Telegram client + credentials must remain on the main server.
    """
    started_at = time.time()
    last_seen_existing = []

    quoted_sub = shlex.quote(expected_substring)

    while True:
        for file_path in file_paths:
            try:
                quoted_path = shlex.quote(file_path)
                # Fast check: file exists + contains substring.
                cmd = (
                    f"test -f {quoted_path} && "
                    f"grep -F -q -- {quoted_sub} {quoted_path} && "
                    f"echo {quoted_path}"
                )
                proc = subprocess.run(
                    ["ssh", "-o", "BatchMode=yes", ssh_host, "bash", "-lc", cmd],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if proc.returncode == 0:
                    last_seen_existing.append(file_path)
                    # Return the real remote path, not the shell-quoted one.
                    return file_path

                # If file exists but substring not found, remember it for debugging.
                exists_proc = subprocess.run(
                    ["ssh", "-o", "BatchMode=yes", ssh_host, "bash", "-lc", f"test -f {quoted_path}"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if exists_proc.returncode == 0:
                    last_seen_existing.append(file_path)
            except Exception:
                continue

        if time.time() - started_at >= timeout_seconds:
            label = f" ({description})" if description else ""
            existing = ", ".join(sorted(set(last_seen_existing))) or "none"
            raise AssertionError(
                f"Expected substring not found{label} on {ssh_host}: {expected_substring!r}. "
                f"Checked files (existing during wait): {existing}"
            )

        time.sleep(poll_interval_seconds)
