"""Schemas for /api/admin/ai-settings.

Responses NEVER carry plaintext secrets — only ``hasSecret: bool`` and a
partial-reveal preview. Upserts treat a blank ``secret`` field as
"preserve the stored secret" (mirrors orchestration connections PATCH).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import Field

from app.schemas.base import CamelModel


SUPPORTED_PROVIDERS: tuple[str, ...] = (
    "openai",
    "azure_openai",
    "anthropic",
    "gemini",
    "vertex",
    "bedrock",
)

# Default credential name when callers don't specify one. Matches the resolver
# default and the migration-0050 backfill choice.
DEFAULT_CREDENTIAL_NAME: str = "default"


class ProviderConfigResponse(CamelModel):
    """Bridge summary — one entry per supported provider.

    Surfaces the ``name='default'`` credential (falling back to the
    most-recently-updated row when no ``default`` exists) plus aggregate counts.
    Still consumed by the 8 frontend pages that gate UI on "does this tenant
    have any working credential for provider X?"; per-credential admin runs
    through ``CredentialResponse`` below.
    """

    provider: str
    is_enabled: bool
    has_api_key: bool
    # Partial-reveal preview of the stored key. Format: ``XYZA••••WXYZ`` for
    # keys ≥ 8 chars, ``••••WXYZ`` for shorter values, ``None`` when no key
    # is stored. Mirrors the orchestration connections ``secretPreviews``
    # surface so the operator can confirm-by-shape without the plaintext
    # ever crossing the wire.
    api_key_preview: Optional[str] = None
    base_url: Optional[str] = None
    extra_config: dict = Field(default_factory=dict)
    curated_models: list[str] = Field(default_factory=list)
    validation_status: str
    last_validated_at: Optional[datetime] = None
    # Multi-credential counts so the Phase-1 admin UI can already hint at the
    # incoming multi-credential surface without owning the new editor.
    credential_count: int = 0
    enabled_credential_count: int = 0


class CredentialResponse(CamelModel):
    """One row from ``platform.tenant_llm_credentials``.

    ``secretPreview`` is the partial-reveal mask of the canonical secret field
    per provider (``api_key`` for openai/anthropic/azure/gemini-key,
    ``access_key_id`` for bedrock, derived ``client_email`` for vertex). The
    plaintext never crosses the wire.
    """

    id: str
    provider: str
    name: str
    is_enabled: bool
    secret_preview: Optional[str] = None
    extra_config: dict = Field(default_factory=dict)
    validation_status: str
    last_validated_at: Optional[datetime] = None


class CredentialCreate(CamelModel):
    """Create one credential row. Provider-specific ``secret`` shape — see
    ``app.models.tenant_llm_credential`` for the per-provider key schema.
    """

    name: str = DEFAULT_CREDENTIAL_NAME
    is_enabled: bool = False
    secret: dict[str, str] = Field(default_factory=dict)
    extra_config: dict = Field(default_factory=dict)


class CredentialUpdate(CamelModel):
    """PATCH semantics — omitted ``secret`` keys preserve their stored value.

    Empty-string values for ``secret`` keys also preserve the stored value
    (mirrors orchestration connections behaviour) so a blanked field in the
    form never overwrites a real secret.
    """

    name: Optional[str] = None
    is_enabled: Optional[bool] = None
    secret: Optional[dict[str, str]] = None
    extra_config: Optional[dict] = None


class DeploymentResponse(CamelModel):
    """One row from ``platform.tenant_llm_deployments``."""

    id: str
    credential_id: str
    deployment_name: str
    canonical_model_id: Optional[str] = None
    canonical_model: Optional[str] = None
    api_version_override: Optional[str] = None
    enabled: bool
    needs_mapping: bool


class DeploymentCreate(CamelModel):
    deployment_name: str
    canonical_model_id: Optional[str] = None
    api_version_override: Optional[str] = None
    enabled: bool = True


class DeploymentUpdate(CamelModel):
    canonical_model_id: Optional[str] = None
    api_version_override: Optional[str] = None
    enabled: Optional[bool] = None


class ModelSearchRequest(CamelModel):
    search: str = ""


class ModelSearchResponse(CamelModel):
    models: list[str] = Field(default_factory=list)


class ValidateResponse(CamelModel):
    validation_status: str
    detail: Optional[str] = None
