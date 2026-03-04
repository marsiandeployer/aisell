"""Shared utilities for Pyrogram-based E2E tests.

This module exists to remove duplicated boilerplate across bots' Python tests:
- dotenv loading from multiple legacy locations
- Pyrogram client creation (session string / phone fallback)
- wait/poll helpers for bot responses
"""

