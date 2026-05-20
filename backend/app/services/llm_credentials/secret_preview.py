"""Masked secret previews for stored credentials.

Keeps Fernet decryption inside ``app.services.llm_credentials`` per plan
README §102 invariant 6 (no code outside this package decrypts
``secret_blob_encrypted``). Callers — admin routes, audit logs, model
discovery — get a masked string and never touch the ciphertext.
"""
from __future__ import annotations

import json

from app.models.tenant_llm_credential import TenantLlmCredential
from app.services.llm_credentials.crypto import (
    LlmCredentialCryptoError,
    decrypt_json,
    encrypt_json,
)
from app.utils.secret_masking import mask_secret_value


def _decrypted_payload(row: TenantLlmCredential) -> dict[str, str]:
    try:
        payload = decrypt_json(row.secret_blob_encrypted)
    except LlmCredentialCryptoError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _pick_preview_candidate(payload: dict[str, str], provider: str) -> str:
    if not payload:
        return ""
    if provider in {"openai", "anthropic", "azure_openai", "gemini"}:
        return payload.get("api_key", "") or ""
    if provider == "bedrock":
        return payload.get("access_key_id", "") or ""
    if provider == "vertex":
        sa_json = payload.get("service_account_json", "") or ""
        if not sa_json:
            return ""
        try:
            info = json.loads(sa_json)
        except ValueError:
            return sa_json
        return info.get("client_email", "") or sa_json
    return ""


def get_secret_preview(row: TenantLlmCredential) -> str | None:
    """Return the masked preview for a credential row, or ``None`` if empty."""
    candidate = _pick_preview_candidate(_decrypted_payload(row), row.provider)
    if not candidate:
        return None
    return mask_secret_value(candidate) or None


def secret_has_value(row: TenantLlmCredential) -> bool:
    """True if the credential's secret blob carries any non-empty field.

    Used by admin summaries for "is this credential populated?" without
    leaking the decrypted payload to the caller.
    """
    payload = _decrypted_payload(row)
    return bool(
        payload.get("api_key")
        or payload.get("access_key_id")
        or payload.get("service_account_json")
    )


def merge_secret_update(
    row: TenantLlmCredential, partial: dict[str, str]
) -> tuple[bytes, bool]:
    """Re-encrypt the credential's secret blob with partial field updates.

    Blank/missing values in ``partial`` preserve the stored field (mirrors
    orchestration-connections semantics). Returns ``(new_blob, rotated)``
    where ``rotated`` is True if at least one stored field changed — the
    caller uses it to reset ``validation_status`` to ``'untested'``.

    Kept inside this package so callers never see the merged plaintext.
    """
    current = _decrypted_payload(row)
    merged = dict(current)
    rotated = False
    for k, v in partial.items():
        if v is None or v == "":
            continue
        merged[k] = v
        rotated = True
    if not rotated:
        return bytes(row.secret_blob_encrypted), False
    return encrypt_json(merged), True
