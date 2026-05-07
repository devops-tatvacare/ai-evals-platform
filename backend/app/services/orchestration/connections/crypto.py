"""Fernet encrypt/decrypt for orchestration provider-connection configs.

One process-level key, read from ``settings.ORCHESTRATION_CONNECTION_KEY``.
Per phase-10 §1.2: per-tenant rotation is future. Loss of the key means all
existing rows become unreadable — back it up with the same rigor as
``JWT_SECRET``.

The key is a urlsafe-base64-encoded 32-byte value, exactly as produced by
``cryptography.fernet.Fernet.generate_key()``. Boot validator
(`_validate_startup_config`) raises a clear RuntimeError when the env var is
missing or not a valid Fernet key.
"""
from __future__ import annotations

import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


class ConnectionCryptoError(RuntimeError):
    """Raised when the configured key is missing/invalid or a blob fails to decrypt."""


def _fernet() -> Fernet:
    key = settings.ORCHESTRATION_CONNECTION_KEY
    if not key:
        raise ConnectionCryptoError(
            "ORCHESTRATION_CONNECTION_KEY environment variable is required."
        )
    try:
        return Fernet(key.encode("utf-8") if isinstance(key, str) else key)
    except (ValueError, TypeError) as exc:
        raise ConnectionCryptoError(
            "ORCHESTRATION_CONNECTION_KEY is not a valid urlsafe-base64 32-byte Fernet key."
        ) from exc


def encrypt(config: dict[str, Any]) -> bytes:
    """Encrypt a plaintext config dict to a token suitable for ``LargeBinary`` storage."""
    return _fernet().encrypt(json.dumps(config, sort_keys=True).encode("utf-8"))


def decrypt(token: bytes) -> dict[str, Any]:
    """Reverse of ``encrypt``. Raises ``ConnectionCryptoError`` on tamper / wrong key."""
    try:
        plain = _fernet().decrypt(bytes(token))
    except InvalidToken as exc:
        raise ConnectionCryptoError("provider connection blob failed to decrypt") from exc
    return json.loads(plain.decode("utf-8"))


def assert_key_valid() -> None:
    """Boot-time check — call from lifespan validator.

    Constructs a Fernet from the configured key and round-trips a small token
    so an invalid base64 / wrong-length value is rejected at boot, not the
    first time an operator opens the connections page.
    """
    f = _fernet()
    f.decrypt(f.encrypt(b"ok"))
