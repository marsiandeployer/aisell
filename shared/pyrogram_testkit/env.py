import os
from dataclasses import dataclass
from typing import Iterable, Optional

try:
    # Optional dependency. When missing (e.g. on a freshly provisioned server),
    # fall back to a tiny .env parser below.
    from dotenv import load_dotenv as _load_dotenv  # type: ignore
except Exception:  # pragma: no cover
    _load_dotenv = None


DEFAULT_ENV_PATHS = (
    "/root/space2/hababru/.env",
    "/root/aisell/noxonbot/.env",
    "/root/space2/noxonbot/.env",
    "/root/aisell/bananzabot/.env",
    "/root/space2/bananzabot/.env",
)


def _load_env_file_simple(path: str) -> None:
    # Minimal .env loader:
    # - supports KEY=VALUE lines
    # - ignores empty lines and comments
    # - strips optional wrapping quotes
    # - does NOT override already-set env vars (matches our intended behavior)
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()
                if not key or key in os.environ:
                    continue
                if (
                    (value.startswith('"') and value.endswith('"'))
                    or (value.startswith("'") and value.endswith("'"))
                ):
                    value = value[1:-1]
                os.environ[key] = value
    except FileNotFoundError:
        return


def load_env_files(paths: Optional[Iterable[str]] = None) -> None:
    """Load dotenv files in order (non-overriding), skipping missing files."""
    for candidate in (paths or DEFAULT_ENV_PATHS):
        if candidate and os.path.exists(candidate):
            if _load_dotenv is not None:
                _load_dotenv(candidate)
            else:
                _load_env_file_simple(candidate)


@dataclass(frozen=True)
class TelegramCreds:
    api_id: int
    api_hash: str
    session_string: Optional[str]
    phone_number: Optional[str]


def read_telegram_creds(
    *,
    default_api_id: int = 0,
    default_api_hash: str = "",
    default_phone_number: str = "",
) -> TelegramCreds:
    api_id_raw = os.getenv("TELEGRAM_API_ID", "").strip()
    api_id = int(api_id_raw) if api_id_raw.isdigit() else int(default_api_id)

    api_hash = (os.getenv("TELEGRAM_API_HASH", "") or default_api_hash).strip()
    session_string = os.getenv("TELEGRAM_SESSION_STRING", "").strip() or None
    phone_number = (os.getenv("TELEGRAM_PHONE_NUMBER", "") or default_phone_number).strip() or None

    return TelegramCreds(
        api_id=api_id,
        api_hash=api_hash,
        session_string=session_string,
        phone_number=phone_number,
    )
