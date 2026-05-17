"""LLM credential storage, encryption, and resolution.

Public surface:
    resolve_credentials      — the single read path for provider credentials
    ResolvedCredentials      — the value object callers receive (dict ``secret``)
    ProviderNotConfiguredError — raised when a tenant has no usable credential
    invalidate_cache         — drop cached creds after an admin write
    encrypt_json/decrypt_json — runtime crypto for ``secret_blob_encrypted``
    encrypt_secret/decrypt_secret — legacy single-string crypto, kept ONLY for
        migration 0050's backfill path (do not import from runtime code).
"""
from app.services.llm_credentials.crypto import (
    decrypt_json,
    decrypt_secret,
    encrypt_json,
    encrypt_secret,
)
from app.services.llm_credentials.resolver import (
    ProviderNotConfiguredError,
    ResolvedCredentials,
    invalidate_cache,
    resolve_credentials,
)

__all__ = [
    "resolve_credentials",
    "ResolvedCredentials",
    "ProviderNotConfiguredError",
    "invalidate_cache",
    "encrypt_json",
    "decrypt_json",
    "encrypt_secret",
    "decrypt_secret",
]
