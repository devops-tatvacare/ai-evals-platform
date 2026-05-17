"""The single read path for LLM provider credentials.

resolve_credentials(db, tenant_id, provider, name='default'):
  enabled tenant row -> decrypt secret_blob_encrypted, return ResolvedCredentials
  no explicit-name match + a single enabled credential for (tenant, provider)
    -> auto-fall-back to that credential (callers don't all know which name to ask for)
  gemini + system tenant + no row -> env service-account path
  otherwise -> ProviderNotConfiguredError

No user_id. No auth_intent. No provider_override. Callers pass the provider
they already hold and get credentials only — the model name is the caller's
concern.

There is no transitional alias for the pre-rename ``resolve_llm_credentials``
function — every caller updates in the same commit (per the no-legacy-
scaffolding invariant).
"""
from __future__ import annotations

import os
import time
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.constants import SYSTEM_TENANT_ID
from app.models.tenant_llm_credential import TenantLlmCredential
from app.services.llm_credentials.crypto import decrypt_json


class ProviderNotConfiguredError(RuntimeError):
    """Raised when a tenant has no usable credential for the requested provider.

    Carries a stable client-facing message — surface it as the HTTPException
    detail so the UI can show "configure <provider> in AI Settings".
    """

    def __init__(self, provider: str, name: str | None = None):
        self.provider = provider
        self.name = name
        suffix = f" (name='{name}')" if name and name != "default" else ""
        super().__init__(
            f"LLM provider '{provider}'{suffix} is not configured for this tenant. "
            f"An admin must enable it in AI Settings."
        )


@dataclass(frozen=True)
class ResolvedCredentials:
    provider: str
    name: str
    secret: dict[str, str] = field(default_factory=dict)
    extra_config: dict = field(default_factory=dict)
    # System-tenant Gemini fallback only — path to the SA JSON on disk.
    service_account_path: str | None = None


_DEFAULT_NAME = "default"

# Cache key: (tenant_id, provider, name)
_CACHE: dict[tuple[str, str, str], tuple[float, ResolvedCredentials]] = {}
_CACHE_TTL_SECONDS = 60.0


def invalidate_cache(
    tenant_id: uuid.UUID | str,
    provider: str | None = None,
    name: str | None = None,
) -> None:
    """Drop cached credentials. Three optional levels of cascading invalidation.

    - tenant only           : evict every cached credential for the tenant
    - tenant + provider     : evict every name under that provider
    - tenant + provider + name : evict that single cache entry
    """
    tid = str(tenant_id)
    if provider is None:
        for key in [k for k in _CACHE if k[0] == tid]:
            _CACHE.pop(key, None)
        return
    if name is None:
        for key in [k for k in _CACHE if k[0] == tid and k[1] == provider]:
            _CACHE.pop(key, None)
        return
    _CACHE.pop((tid, provider, name), None)


def _detect_system_sa_path() -> str:
    sa_path = settings.GEMINI_SERVICE_ACCOUNT_PATH
    return sa_path if (sa_path and os.path.isfile(sa_path)) else ""


async def resolve_credentials(
    db: AsyncSession,
    tenant_id: uuid.UUID | str,
    provider: str,
    name: str = _DEFAULT_NAME,
) -> ResolvedCredentials:
    """Resolve a single tenant credential for ``provider`` + optional ``name``.

    Lookup order:
      1. ``(tenant, provider, name)`` enabled row — exact match
      2. If ``name == 'default'`` and there's exactly one enabled credential
         for ``(tenant, provider)``, return it (single-credential auto-fallback)
      3. System-tenant Gemini SA fallback (only when ``tenant == SYSTEM_TENANT_ID``
         and ``provider == 'gemini'``)
      4. ``ProviderNotConfiguredError``
    """
    tid = uuid.UUID(str(tenant_id)) if not isinstance(tenant_id, uuid.UUID) else tenant_id
    cache_key = (str(tid), provider, name)
    now = time.monotonic()
    cached = _CACHE.get(cache_key)
    if cached and cached[0] > now:
        return cached[1]

    # 1. exact (tenant, provider, name) match
    row = (
        await db.execute(
            select(TenantLlmCredential).where(
                TenantLlmCredential.tenant_id == tid,
                TenantLlmCredential.provider == provider,
                TenantLlmCredential.name == name,
                TenantLlmCredential.is_enabled.is_(True),
            )
        )
    ).scalar_one_or_none()

    # 2. single-credential auto-fallback when default-name asked for and there's exactly one row
    if row is None and name == _DEFAULT_NAME:
        all_rows = (
            await db.execute(
                select(TenantLlmCredential).where(
                    TenantLlmCredential.tenant_id == tid,
                    TenantLlmCredential.provider == provider,
                    TenantLlmCredential.is_enabled.is_(True),
                )
            )
        ).scalars().all()
        if len(all_rows) == 1:
            row = all_rows[0]

    resolved: ResolvedCredentials | None = None
    if row is not None:
        # decrypt_json raises LlmCredentialCryptoError on non-dict payloads,
        # so the dict cast below is safe.
        secret = decrypt_json(row.secret_blob_encrypted)
        resolved = ResolvedCredentials(
            provider=row.provider,
            name=row.name,
            secret=dict(secret),
            extra_config=dict(row.extra_config or {}),
            service_account_path=None,
        )
    elif (
        provider == "gemini"
        and name == _DEFAULT_NAME
        and tid == SYSTEM_TENANT_ID
    ):
        sa_path = _detect_system_sa_path()
        if sa_path:
            resolved = ResolvedCredentials(
                provider="gemini",
                name=_DEFAULT_NAME,
                secret={},
                extra_config={},
                service_account_path=sa_path,
            )

    if resolved is None:
        raise ProviderNotConfiguredError(provider, name)

    _CACHE[cache_key] = (now + _CACHE_TTL_SECONDS, resolved)
    return resolved
