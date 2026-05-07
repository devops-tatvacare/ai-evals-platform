"""Service layer for /api/orchestration/connections.

Encapsulates the safe-secret semantics from phase-10 §1.1 so the route layer
stays trivial:

- GET responses NEVER include plaintext secret values (they are stripped
  before construction).
- PATCH preserves omitted secret keys (operator does not have to re-enter
  every credential on each edit).
- Blank-string secret overwrites are rejected (an empty value cannot
  replace a stored credential — empty is the wire form for "leave alone").

Tenant + app scoping is enforced on every read and write. The unique index
``uq_provider_connections_scope_provider_name`` guards against duplicates;
``IntegrityError`` is translated to ``ConnectionConflict``.
"""
from __future__ import annotations

import secrets
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.mixins.shareable import Visibility
from app.models.provider_connection import ProviderConnection
from app.services.orchestration.integrations.bolna import (
    BolnaService,
    BolnaServiceError,
)
from app.services.orchestration.integrations.wati import WatiService, WatiServiceError
from app.services.orchestration.connections import crypto, health, provider_specs


WEBHOOK_PATH_PREFIX = "/api/orchestration/webhooks"
_AGENT_VARIABLE_CACHE_TTL_SECONDS = 3600.0
_AGENT_VARIABLE_CACHE: dict[tuple[str, ...], tuple[float, list[str]]] = {}


class ConnectionError_(ValueError):
    """Base for service-layer errors translated to HTTP 4xx in the route."""


class ConnectionConflict(ConnectionError_):
    """Duplicate (tenant_id, app_id, provider, name)."""


class ConnectionNotFound(ConnectionError_):
    """No row visible to the caller's tenant + app."""


class ConnectionInvalid(ConnectionError_):
    """Config payload fails provider-spec validation."""


def _public_base_url() -> str:
    """Public origin used when composing per-connection webhook URLs.

    Returns the empty string if unset — the route response then ships a
    relative path that the frontend resolves against the current origin.
    ``APP_BASE_URL`` is intentionally NOT used as a fallback: it points at
    the FRONTEND, while webhooks must hit the BACKEND.
    """
    return (settings.ORCHESTRATION_PUBLIC_BASE_URL or "").rstrip("/")


def _generate_webhook_token() -> str:
    """32-byte urlsafe token. Trimmed to fit the VARCHAR(64) column.

    ``secrets.token_urlsafe(32)`` returns ~43 chars of base64url → safely
    inside the 64-char column. ~256 bits of entropy keeps collision
    probability astronomically below the unique index's enforcement bar.
    """
    return secrets.token_urlsafe(32)


def _compose_webhook_url(provider: str, token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    base = _public_base_url()
    path = f"{WEBHOOK_PATH_PREFIX}/{provider}/{token}"
    return f"{base}{path}" if base else path


def _redact(provider: str, config: dict[str, Any]) -> dict[str, Any]:
    """Strip secret fields from a plaintext config dict for GET responses."""
    secret = provider_specs.secret_field_names(provider)
    return {k: v for k, v in config.items() if k not in secret}


_PREVIEW_BULLET = "•" * 4  # "••••"


def _mask_secret_value(value: Any) -> str:
    """Return a partial-reveal preview of one stored secret value.

    Rules (per product call, 2026-05-05):
      * value length >= 8: ``XYZA``…••••…``WXYZ`` (first 4 + last 4).
      * value length 1–7: ``••••WXYZ`` (last 4 only — short keys would
        otherwise leak themselves; clamps to whatever's available).
      * empty / non-string: empty string — caller should drop the entry so
        the FE doesn't render "no preview" noise.

    The preview is a UI hint, not a credential. The full value is never
    decryptable from it (4 + 4 chars on a 32+ char key reveals < 25 % of
    the entropy and never the secret-bearing middle). Mirrors how Stripe /
    AWS / GitHub render stored API keys."""
    if not isinstance(value, str) or value == "":
        return ""
    if len(value) >= 8:
        return f"{value[:4]}{_PREVIEW_BULLET}{value[-4:]}"
    return f"{_PREVIEW_BULLET}{value[-4:]}"


def _secret_previews(provider: str, config: dict[str, Any]) -> dict[str, str]:
    """Per-secret-field preview map. Empty when nothing is stored.

    Sibling of ``_redact``: redact strips the value, this surfaces a
    masked hint so the operator can confirm-by-shape (“yes that’s the prod
    key’s last 4 = ABCD”) without the page ever shipping the plaintext."""
    secret = provider_specs.secret_field_names(provider)
    previews: dict[str, str] = {}
    for name in secret:
        masked = _mask_secret_value(config.get(name))
        if masked:
            previews[name] = masked
    return previews


def _field_descriptors(provider: str) -> list[dict[str, Any]]:
    spec = provider_specs.get_spec(provider)
    return [
        {
            "name": f.name,
            "title": f.title,
            "secret": f.secret,
            "required": f.required,
            "description": f.description,
            "default": f.default,
        }
        for f in spec.fields
    ]


def _serialize(row: ProviderConnection) -> dict[str, Any]:
    plaintext = crypto.decrypt(row.config_encrypted)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "app_id": row.app_id,
        "provider": row.provider,
        "name": row.name,
        "active": row.active,
        "last_used_at": row.last_used_at,
        "webhook_url": _compose_webhook_url(row.provider, row.webhook_token),
        "config_redacted": _redact(row.provider, plaintext),
        # Phase 14 follow-up — partial-reveal previews so the connections
        # form can render `XYZA••••WXYZ` next to each secret field instead
        # of an empty placeholder. Plaintext never leaves the server; this
        # is metadata, not the credential.
        "secret_previews": _secret_previews(row.provider, plaintext),
        "fields": _field_descriptors(row.provider),
        "created_by": row.created_by,
        "visibility": row.visibility,
        "shared_by": row.shared_by,
        "shared_at": row.shared_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def serialize_connection(row: ProviderConnection) -> dict[str, Any]:
    return _serialize(row)


def _unique_names(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in values:
        name = raw.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


def _coerce_variable_names(value: Any) -> list[str]:
    if isinstance(value, str):
        return _unique_names([value])
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            if isinstance(item, str):
                out.append(item)
                continue
            if isinstance(item, dict):
                for key in ("name", "variable", "key", "agent_variable", "parameter"):
                    raw = item.get(key)
                    if isinstance(raw, str):
                        out.append(raw)
                        break
        return _unique_names(out)
    return []


def _extract_variable_names(payload: Any) -> list[str]:
    """Best-effort parser for provider metadata responses.

    We only inspect keys that commonly carry variable/parameter metadata and
    recurse through a small set of container keys so unrelated strings in the
    response do not leak into the picker.
    """
    candidate_keys = {
        "variables",
        "prompt_variables",
        "agent_variables",
        "dynamic_variables",
        "parameters",
        "placeholders",
    }
    container_keys = {
        "data",
        "result",
        "response",
        "agent",
        "template",
        "templates",
        "messageTemplates",
        "message_templates",
    }
    queue: list[Any] = [payload]
    found: list[str] = []
    while queue:
        current = queue.pop(0)
        if isinstance(current, dict):
            for key, value in current.items():
                if key in candidate_keys:
                    found.extend(_coerce_variable_names(value))
                elif key in container_keys and isinstance(value, (dict, list)):
                    queue.append(value)
        elif isinstance(current, list):
            for item in current:
                if isinstance(item, dict):
                    queue.append(item)
    return _unique_names(found)


def _get_cached_variables(key: tuple[str, ...]) -> Optional[list[str]]:
    cached = _AGENT_VARIABLE_CACHE.get(key)
    if cached is None:
        return None
    expires_at, values = cached
    if expires_at <= time.monotonic():
        _AGENT_VARIABLE_CACHE.pop(key, None)
        return None
    return list(values)


def _put_cached_variables(key: tuple[str, ...], values: list[str]) -> None:
    _AGENT_VARIABLE_CACHE[key] = (
        time.monotonic() + _AGENT_VARIABLE_CACHE_TTL_SECONDS,
        list(values),
    )


async def _load_owned(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    connection_id: uuid.UUID,
) -> ProviderConnection:
    row = await db.scalar(
        select(ProviderConnection).where(
            ProviderConnection.id == connection_id,
            ProviderConnection.tenant_id == tenant_id,
        )
    )
    if row is None:
        raise ConnectionNotFound(f"connection {connection_id} not found")
    return row


def _validate_full_config(provider: str, config: dict[str, Any]) -> None:
    try:
        provider_specs.validate_config(provider, config)
    except ValueError as exc:
        raise ConnectionInvalid(str(exc)) from exc


def _merge_config_for_patch(
    provider: str,
    *,
    stored: dict[str, Any],
    submitted: dict[str, Any],
) -> dict[str, Any]:
    """Merge a partial PATCH body onto the stored plaintext config.

    - Non-secret keys: replace stored value (including blanks if the field
      is optional; required-blank rejected by validate_config).
    - Secret keys: a non-empty submitted value overwrites; an absent key
      preserves the stored value; an empty-string submitted value is
      rejected here so we never silently wipe a stored credential.
    """
    secret_keys = provider_specs.secret_field_names(provider)
    merged: dict[str, Any] = dict(stored)
    for key, value in submitted.items():
        if key in secret_keys:
            if value == "":
                raise ConnectionInvalid(
                    f"{key!r}: blank value cannot overwrite stored secret; "
                    "omit the key to keep the existing value."
                )
            merged[key] = value
        else:
            merged[key] = value
    return merged


# ─── public service API ─────────────────────────────────────────────────────


async def create_connection(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    provider: str,
    name: str,
    config: dict[str, Any],
    created_by: uuid.UUID,
    active: bool = True,
    webhook_token: Optional[str] = None,
    visibility: Visibility = Visibility.PRIVATE,
) -> dict[str, Any]:
    spec = provider_specs.get_spec(provider)  # raises ValueError → caller maps
    _validate_full_config(provider, config)
    normalized_visibility = Visibility.normalize(visibility) or Visibility.PRIVATE

    token: Optional[str] = None
    if spec.supports_webhook:
        token = webhook_token or _generate_webhook_token()

    row = ProviderConnection(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        provider=provider,
        name=name,
        config_encrypted=crypto.encrypt(config),
        webhook_token=token,
        active=active,
        created_by=created_by,
        visibility=normalized_visibility,
        shared_by=created_by if normalized_visibility == Visibility.SHARED else None,
        shared_at=(
            datetime.now(timezone.utc)
            if normalized_visibility == Visibility.SHARED
            else None
        ),
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConnectionConflict(
            f"connection name {name!r} already exists for "
            f"app_id={app_id!r} provider={provider!r}"
        ) from exc
    await db.refresh(row)
    return _serialize(row)


async def list_connections(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: Optional[uuid.UUID] = None,
    app_id: Optional[str] = None,
    providers: Optional[Iterable[str]] = None,
    include_inactive: bool = False,
    visibility: str = "all",
) -> list[dict[str, Any]]:
    stmt = select(ProviderConnection).where(ProviderConnection.tenant_id == tenant_id)
    if user_id is not None:
        if visibility == "private":
            stmt = stmt.where(ProviderConnection.created_by == user_id)
        elif visibility == "shared":
            stmt = stmt.where(ProviderConnection.visibility == Visibility.SHARED)
        else:
            stmt = stmt.where(
                or_(
                    ProviderConnection.created_by == user_id,
                    ProviderConnection.visibility == Visibility.SHARED,
                )
            )
    if app_id is not None:
        stmt = stmt.where(ProviderConnection.app_id == app_id)
    if providers:
        stmt = stmt.where(ProviderConnection.provider.in_(list(providers)))
    if not include_inactive:
        stmt = stmt.where(ProviderConnection.active.is_(True))
    stmt = stmt.order_by(ProviderConnection.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [_serialize(r) for r in rows]


async def get_connection(
    db: AsyncSession, *, tenant_id: uuid.UUID, connection_id: uuid.UUID,
) -> dict[str, Any]:
    row = await _load_owned(db, tenant_id=tenant_id, connection_id=connection_id)
    return _serialize(row)


async def update_connection(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    connection_id: uuid.UUID,
    name: Optional[str] = None,
    active: Optional[bool] = None,
    config: Optional[dict[str, Any]] = None,
    visibility: Optional[Visibility] = None,
) -> dict[str, Any]:
    row = await _load_owned(db, tenant_id=tenant_id, connection_id=connection_id)
    if name is not None:
        row.name = name
    if active is not None:
        row.active = active
    if visibility is not None:
        normalized_visibility = Visibility.normalize(visibility) or Visibility.PRIVATE
        row.visibility = normalized_visibility
        if normalized_visibility == Visibility.SHARED:
            row.shared_by = row.created_by
            row.shared_at = row.shared_at or datetime.now(timezone.utc)
        else:
            row.shared_by = None
            row.shared_at = None
    if config is not None:
        stored = crypto.decrypt(row.config_encrypted)
        merged = _merge_config_for_patch(row.provider, stored=stored, submitted=config)
        _validate_full_config(row.provider, merged)
        row.config_encrypted = crypto.encrypt(merged)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConnectionConflict(
            f"connection name {name!r} already exists for this tenant + app + provider"
        ) from exc
    await db.refresh(row)
    return _serialize(row)


async def archive_connection(
    db: AsyncSession, *, tenant_id: uuid.UUID, connection_id: uuid.UUID,
) -> None:
    """Soft-disable: sets active=false. Webhooks for this connection
    immediately stop matching incoming requests (the partial active-index
    on the lookup column means dispatch resolution returns 404)."""
    row = await _load_owned(db, tenant_id=tenant_id, connection_id=connection_id)
    row.active = False
    await db.commit()


async def rotate_webhook_token(
    db: AsyncSession, *, tenant_id: uuid.UUID, connection_id: uuid.UUID,
) -> dict[str, Any]:
    row = await _load_owned(db, tenant_id=tenant_id, connection_id=connection_id)
    spec = provider_specs.get_spec(row.provider)
    if not spec.supports_webhook:
        raise ConnectionInvalid(
            f"provider {row.provider!r} does not use a webhook token"
        )
    row.webhook_token = _generate_webhook_token()
    await db.commit()
    return {"webhook_url": _compose_webhook_url(row.provider, row.webhook_token)}


async def test_connection(
    db: AsyncSession, *, tenant_id: uuid.UUID, connection_id: uuid.UUID,
) -> dict[str, Any]:
    row = await _load_owned(db, tenant_id=tenant_id, connection_id=connection_id)
    config = crypto.decrypt(row.config_encrypted)
    return await health.probe(row.provider, config)


def get_provider_schema(provider: str) -> dict[str, Any]:
    spec = provider_specs.get_spec(provider)
    return {
        "provider": spec.provider,
        "label": spec.label,
        "supports_webhook": spec.supports_webhook,
        "json_schema": provider_specs.to_json_schema(provider),
        "fields": _field_descriptors(provider),
    }


async def get_agent_variables(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    connection_id: uuid.UUID,
    agent_id: Optional[str] = None,
    template_name: Optional[str] = None,
) -> dict[str, Any]:
    row = await _load_owned(db, tenant_id=tenant_id, connection_id=connection_id)
    cache_key = (
        str(row.id),
        row.provider,
        agent_id or "",
        template_name or "",
        row.updated_at.isoformat() if row.updated_at else "",
    )
    cached = _get_cached_variables(cache_key)
    if cached is not None:
        return {"provider": row.provider, "variables": cached, "error": None}

    config = crypto.decrypt(row.config_encrypted)
    try:
        variables = await _provider_agent_variables(
            row=row,
            config=config,
            agent_id=agent_id,
            template_name=template_name,
        )
    except (BolnaServiceError, WatiServiceError) as exc:
        # Provider responded (or refused to respond) — that's a config /
        # data condition, not a server bug. Surface the message inline so
        # the variable-mapping UI can keep accepting manual entries while
        # the operator chases down the upstream issue. Do NOT cache; a
        # transient 4xx shouldn't poison the picker for the cache TTL.
        return {"provider": row.provider, "variables": [], "error": str(exc)}
    _put_cached_variables(cache_key, variables)
    return {"provider": row.provider, "variables": variables, "error": None}


async def _provider_agent_variables(
    *,
    row: ProviderConnection,
    config: dict[str, Any],
    agent_id: Optional[str],
    template_name: Optional[str],
) -> list[str]:
    if row.provider == "bolna":
        return await _agent_variables_for_bolna(config=config, agent_id=agent_id)
    if row.provider == "wati":
        return await _agent_variables_for_wati(config=config, template_name=template_name)
    return []


async def _agent_variables_for_bolna(
    *,
    config: dict[str, Any],
    agent_id: Optional[str],
) -> list[str]:
    """Variable names declared by the selected live Bolna agent."""
    if not agent_id:
        return []

    service = BolnaService(
        base_url=str(config.get("base_url") or ""),
        api_key=str(config.get("api_key") or ""),
    )
    payload = await service.get_agent(agent_id=agent_id)
    return _extract_variable_names(payload)


async def _agent_variables_for_wati(
    *,
    config: dict[str, Any],
    template_name: Optional[str],
) -> list[str]:
    """Variable names declared by the selected live WATI template."""
    if not template_name:
        return []

    service = WatiService(
        base_url=str(config.get("base_url") or ""),
        wati_tenant_id=str(config.get("wati_tenant_id") or ""),
        api_token=str(config.get("api_token") or ""),
    )
    summaries = await service.list_message_templates_summary()
    for summary in summaries:
        if summary.get("name") != template_name:
            continue
        parameters = summary.get("parameters")
        if not isinstance(parameters, list):
            return []
        return [str(item) for item in parameters if isinstance(item, str) and item]
    return []
