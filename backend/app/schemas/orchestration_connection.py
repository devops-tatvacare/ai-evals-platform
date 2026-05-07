"""Pydantic request/response schemas for /api/orchestration/connections.

GET responses NEVER include plaintext secret values; the service layer strips
them via ``provider_specs.secret_field_names`` before constructing the
response. PATCH semantics (preserve omitted secret keys, reject blank-string
overwrites) are enforced in ``services.orchestration.api.connections`` —
schemas only carry shape + camelCase aliasing.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import Field

from app.models.mixins.shareable import Visibility
from app.schemas.base import CamelModel, CamelORMModel


class ConnectionCreateRequest(CamelModel):
    app_id: str
    provider: str
    name: str
    config: dict[str, Any] = Field(default_factory=dict)
    active: bool = True
    visibility: Visibility = Visibility.PRIVATE


class ConnectionUpdateRequest(CamelModel):
    name: Optional[str] = None
    active: Optional[bool] = None
    visibility: Optional[Visibility] = None
    # Partial plaintext config. Omitted secret keys are preserved, blank
    # secret strings are rejected at the service layer (never overwrite a
    # stored credential with empty).
    config: Optional[dict[str, Any]] = None


class ConnectionFieldDescriptor(CamelModel):
    """Per-field metadata returned in list/detail responses so the form can
    render password inputs and copy buttons without a second round-trip."""
    name: str
    title: str = ""
    secret: bool
    required: bool
    description: str = ""
    default: Any = None


class ConnectionResponse(CamelORMModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    app_id: str
    provider: str
    name: str
    active: bool
    last_used_at: Optional[datetime]
    # Composed server-side from ORCHESTRATION_PUBLIC_BASE_URL when set,
    # otherwise returned as a relative backend path that the frontend resolves
    # against the current origin before display/copy. Null for outbound-only
    # providers.
    webhook_url: Optional[str]
    # Plaintext config WITH secret values stripped — operators see remaining
    # non-secret fields (e.g. base_url, sender_id) for sanity checks.
    config_redacted: dict[str, Any]
    # Phase 14 follow-up — partial-reveal previews of stored secret values,
    # keyed by field name. Format: ``XYZA••••WXYZ`` for values >= 8 chars,
    # ``••••WXYZ`` for shorter. Empty when nothing is stored. UI hint only —
    # the full secret is never decryptable from this preview.
    secret_previews: dict[str, str] = Field(default_factory=dict)
    # Provider field schema + which keys are secret. Lets the UI render edit
    # forms without fetching the schema endpoint separately.
    fields: list[ConnectionFieldDescriptor]
    created_by: uuid.UUID
    visibility: Visibility
    shared_by: Optional[uuid.UUID] = None
    shared_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ConnectionTestResponse(CamelModel):
    ok: bool
    detail: str


class ConnectionRotateTokenResponse(CamelModel):
    webhook_url: str


class ProviderSpecResponse(CamelModel):
    """Returned by GET /api/orchestration/connections/schema?provider=...

    Frontend uses this to drive DynamicConfigForm field rendering.
    """
    provider: str
    label: str
    supports_webhook: bool
    json_schema: dict[str, Any]
    fields: list[ConnectionFieldDescriptor]


class ProviderAgentSummary(CamelModel):
    """One row in ``ProviderAgentsListResponse.items``. Provider-agnostic
    surface so a future WATI templates response can reuse the same shape."""
    id: str
    name: str
    status: str
    type: str


class ProviderAgentsListResponse(CamelModel):
    """Returned by GET /api/orchestration/connections/{id}/agents.

    Soft-error contract: ``error`` carries an inline message when the
    upstream provider couldn't be queried; ``items`` is empty in that
    case but the HTTP status stays 200 so the picker doesn't blow up
    the form.
    """
    provider: str
    items: list[ProviderAgentSummary]
    error: Optional[str] = None


class ProviderTemplateSummary(CamelModel):
    """Phase 13/C.1 — one row in the WATI templates list. ``parameters``
    carries the ordered placeholder names the variable-mapping editor
    consumes; empty list when the upstream payload didn't expose any."""
    name: str
    language: str = ""
    status: str = ""
    parameters: list[str] = []


class ProviderTemplatesListResponse(CamelModel):
    """Returned by GET /api/orchestration/connections/{id}/templates.

    Same soft-error envelope as ``ProviderAgentsListResponse`` so the
    WATI picker can keep rendering with manual entry on upstream
    failure.
    """
    provider: str
    items: list[ProviderTemplateSummary]
    error: Optional[str] = None


class AgentVariablesResponse(CamelModel):
    """Returned by GET /api/orchestration/connections/{id}/agent-variables.

    Provider-aware introspection surface for variable-mapping UIs.
    The caller passes the runtime-selected provider entity:
    `agentId` for Bolna, `templateName` for WATI. No seeded-template fallback.

    ``error`` carries a soft, user-facing string when the upstream provider
    couldn't be queried (e.g. 404 because the agent id doesn't exist under
    this account, or a transient transport error). The endpoint stays at
    HTTP 200 so the picker keeps working — the user can still type variable
    names manually — but the UI surfaces the message inline.
    """
    provider: str
    variables: list[str]
    error: Optional[str] = None
