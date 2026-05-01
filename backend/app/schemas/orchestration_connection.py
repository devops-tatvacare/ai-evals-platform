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

from app.schemas.base import CamelModel, CamelORMModel


class ConnectionCreateRequest(CamelModel):
    app_id: str
    provider: str
    name: str
    config: dict[str, Any] = Field(default_factory=dict)
    active: bool = True


class ConnectionUpdateRequest(CamelModel):
    name: Optional[str] = None
    active: Optional[bool] = None
    # Partial plaintext config. Omitted secret keys are preserved, blank
    # secret strings are rejected at the service layer (never overwrite a
    # stored credential with empty).
    config: Optional[dict[str, Any]] = None


class ConnectionFieldDescriptor(CamelModel):
    """Per-field metadata returned in list/detail responses so the form can
    render password inputs and copy buttons without a second round-trip."""
    name: str
    secret: bool
    required: bool
    description: str = ""
    default: Optional[str] = None


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
    # Provider field schema + which keys are secret. Lets the UI render edit
    # forms without fetching the schema endpoint separately.
    fields: list[ConnectionFieldDescriptor]
    created_by: uuid.UUID
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


class AgentVariablesResponse(CamelModel):
    """Returned by GET /api/orchestration/connections/{id}/agent-variables.

    Provider-aware introspection surface for variable-mapping UIs.
    The caller may pass `agentId` and/or `templateSlug`; the backend resolves
    template defaults as needed and caches results per connection revision.
    """
    provider: str
    variables: list[str]
