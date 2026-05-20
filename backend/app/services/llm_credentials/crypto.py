"""Fernet encrypt/decrypt for tenant_llm_credentials.secret_blob_encrypted.

One process-level key from ``settings.LLM_CREDENTIAL_KEY``. Mirrors
``orchestration/connections/crypto.py`` — same pattern, separate key so the
two credential domains rotate independently.

JSON helpers (``encrypt_json`` / ``decrypt_json``) are the runtime path.
The legacy string helpers (``encrypt_secret`` / ``decrypt_secret``) remain
exported only for migration 0047 (which wrote single-string ciphertexts)
and migration 0050's backfill (which reads those ciphertexts and re-emits
them as JSON). Do not call them from runtime code.
"""
from __future__ import annotations

import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


class LlmCredentialCryptoError(RuntimeError):
    """Raised when LLM_CREDENTIAL_KEY is missing/invalid or a blob fails to decrypt."""


def _fernet() -> Fernet:
    key = settings.LLM_CREDENTIAL_KEY
    if not key:
        raise LlmCredentialCryptoError("LLM_CREDENTIAL_KEY environment variable is required.")
    try:
        return Fernet(key.encode("utf-8") if isinstance(key, str) else key)
    except (ValueError, TypeError) as exc:
        raise LlmCredentialCryptoError(
            "LLM_CREDENTIAL_KEY is not a valid urlsafe-base64 32-byte Fernet key."
        ) from exc


def encrypt_json(payload: dict[str, Any]) -> bytes:
    """Encrypt a plaintext secret dict to a token suitable for ``LargeBinary`` storage.

    Mirrors ``orchestration.connections.crypto.encrypt`` — Fernet(JSON(payload)).
    """
    return _fernet().encrypt(json.dumps(payload, sort_keys=True).encode("utf-8"))


def decrypt_json(blob: bytes) -> dict[str, Any]:
    """Reverse of ``encrypt_json``. Raises ``LlmCredentialCryptoError`` on tamper / wrong key,
    malformed JSON, or a payload that isn't a JSON object (dict)."""
    try:
        plain = _fernet().decrypt(bytes(blob))
    except InvalidToken as exc:
        raise LlmCredentialCryptoError("LLM credential blob failed to decrypt") from exc
    try:
        payload = json.loads(plain.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise LlmCredentialCryptoError("LLM credential blob is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise LlmCredentialCryptoError(
            "LLM credential blob did not contain a JSON object"
        )
    return payload


# Used only by migration 0050 backfill — do not call from runtime code.
def encrypt_secret(plaintext: str) -> str:
    """Encrypt an API key string. Returns a urlsafe-base64 token (str)."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


# Used only by migration 0050 backfill — do not call from runtime code.
def decrypt_secret(token: str) -> str:
    """Reverse of ``encrypt_secret``. Raises ``LlmCredentialCryptoError`` on tamper / wrong key."""
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise LlmCredentialCryptoError("LLM credential blob failed to decrypt") from exc


def assert_key_valid() -> None:
    """Boot-time check — call from the lifespan validator."""
    f = _fernet()
    f.decrypt(f.encrypt(b"ok"))
