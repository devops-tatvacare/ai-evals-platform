"""Tenant-scoped admin route for Sherlock verified queries.

Seed-loaded system rows (``tenant_id = SYSTEM_TENANT_ID``) are visible
read-only via this surface — they are managed by deploy. Tenant-owned
rows can be created, edited, and enabled/disabled live; the retriever
in ``sherlock_v3.verified_queries`` UNIONs system + tenant on every turn.

Permission gate: ``sherlock:manage_verified_queries``. SQL safety is the
data_specialist's concern — the route only validates that the candidate
SQL starts with SELECT or WITH and has no statement separators.
"""
from __future__ import annotations

import pathlib
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext
from app.auth.permissions import require_permission
from app.constants import SYSTEM_TENANT_ID
from app.database import get_db
from app.models.sherlock_verified_query import SherlockVerifiedQuery
from app.models.tenant_config import TenantConfiguration
from app.schemas.sherlock_verified_queries import (
    SherlockInstructionsResponse,
    SherlockInstructionsUpdateRequest,
    VerifiedQueryCreateRequest,
    VerifiedQueryListResponse,
    VerifiedQueryRow,
    VerifiedQueryUpdateRequest,
)
from app.services.sherlock_v3.verified_queries import normalize_question


_INSTRUCTIONS_DIR = (
    pathlib.Path(__file__).resolve().parents[1]
    / 'services' / 'sherlock_v3' / 'instructions'
)


router = APIRouter(prefix='/api/sherlock/verified-queries', tags=['sherlock'])


_SQL_LEAD_RE = re.compile(r'^\s*(select|with)\b', re.IGNORECASE)
_FORBIDDEN_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r';\s*\w', re.IGNORECASE),  # stacked statements
    re.compile(r'\b(insert|update|delete|drop|alter|truncate|grant|revoke|vacuum|create|merge|copy)\b', re.IGNORECASE),
    re.compile(r'--'),
    re.compile(r'/\*'),
)


def _validate_sql_shape(sql: str) -> None:
    text = sql.strip()
    if not text:
        raise HTTPException(status_code=422, detail='sql cannot be empty')
    if not _SQL_LEAD_RE.match(text):
        raise HTTPException(
            status_code=422,
            detail='sql must start with SELECT or WITH',
        )
    for pat in _FORBIDDEN_PATTERNS:
        if pat.search(text):
            raise HTTPException(
                status_code=422,
                detail=f'sql contains disallowed pattern: {pat.pattern}',
            )


def _to_row(row: SherlockVerifiedQuery) -> VerifiedQueryRow:
    return VerifiedQueryRow.model_validate({
        **{c.name: getattr(row, c.name) for c in row.__table__.columns},
        'is_system': row.tenant_id == SYSTEM_TENANT_ID,
    })


@router.get('', response_model=VerifiedQueryListResponse)
async def list_verified_queries(
    app_id: Optional[str] = Query(None, alias='appId'),
    include_system: bool = Query(True, alias='includeSystem'),
    only_enabled: bool = Query(False, alias='onlyEnabled'),
    auth: AuthContext = require_permission('sherlock:manage_verified_queries'),
    db: AsyncSession = Depends(get_db),
):
    """List verified queries visible to the caller's tenant.

    By default returns tenant rows + system rows (the same scope the
    retriever sees per turn). ``includeSystem=false`` filters to
    tenant-owned rows only — useful when an admin UI wants to focus on
    the rows it can actually edit.
    """
    tenant_filter = (
        SherlockVerifiedQuery.tenant_id == auth.tenant_id
        if not include_system
        else or_(
            SherlockVerifiedQuery.tenant_id == auth.tenant_id,
            SherlockVerifiedQuery.tenant_id == SYSTEM_TENANT_ID,
        )
    )
    where = [tenant_filter]
    if app_id is not None:
        where.append(SherlockVerifiedQuery.app_id == app_id)
    if only_enabled:
        where.append(SherlockVerifiedQuery.enabled.is_(True))

    base = select(SherlockVerifiedQuery).where(and_(*where)).order_by(
        SherlockVerifiedQuery.app_id.asc(),
        SherlockVerifiedQuery.tenant_id.desc(),  # tenant rows first
        SherlockVerifiedQuery.use_count.desc(),
        SherlockVerifiedQuery.created_at.desc(),
    )
    rows = (await db.execute(base)).scalars().all()
    total = (await db.execute(
        select(func.count()).select_from(SherlockVerifiedQuery).where(and_(*where))
    )).scalar_one()

    return VerifiedQueryListResponse(
        items=[_to_row(r) for r in rows],
        total=total,
    )


@router.post('', response_model=VerifiedQueryRow, status_code=201)
async def create_verified_query(
    body: VerifiedQueryCreateRequest,
    auth: AuthContext = require_permission('sherlock:manage_verified_queries'),
    db: AsyncSession = Depends(get_db),
):
    """Create a tenant-scoped verified query (``source='admin'``).

    The new row is owned by the caller's tenant and only that tenant
    sees it during retrieval. To add a system row visible to every
    tenant, edit the seed JSON and redeploy.
    """
    _validate_sql_shape(body.sql)

    row = SherlockVerifiedQuery(
        id=uuid.uuid4(),
        tenant_id=auth.tenant_id,
        app_id=body.app_id,
        question=body.question.strip(),
        normalized_question=normalize_question(body.question),
        sql=body.sql.strip(),
        source='admin',
        enabled=body.enabled,
        verified_by=auth.user_id,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail='verified query already exists for this tenant + app + question',
        ) from exc
    await db.refresh(row)
    return _to_row(row)


@router.patch('/{verified_query_id}', response_model=VerifiedQueryRow)
async def update_verified_query(
    verified_query_id: uuid.UUID,
    body: VerifiedQueryUpdateRequest,
    auth: AuthContext = require_permission('sherlock:manage_verified_queries'),
    db: AsyncSession = Depends(get_db),
):
    """Edit/enable/disable a tenant-owned verified query.

    System rows (``tenant_id = SYSTEM_TENANT_ID``) reject mutation:
    seeded rows are managed by deploy, not by this surface.
    """
    row = (await db.execute(
        select(SherlockVerifiedQuery).where(
            SherlockVerifiedQuery.id == verified_query_id,
            SherlockVerifiedQuery.tenant_id == auth.tenant_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail='verified query not found in this tenant',
        )

    if body.question is not None:
        row.question = body.question.strip()
        row.normalized_question = normalize_question(body.question)
    if body.sql is not None:
        _validate_sql_shape(body.sql)
        row.sql = body.sql.strip()
    if body.enabled is not None:
        row.enabled = body.enabled

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail='verified query collides with another row for this tenant + app',
        ) from exc
    await db.refresh(row)
    return _to_row(row)


@router.delete('/{verified_query_id}', status_code=204)
async def delete_verified_query(
    verified_query_id: uuid.UUID,
    auth: AuthContext = require_permission('sherlock:manage_verified_queries'),
    db: AsyncSession = Depends(get_db),
):
    """Hard-delete a tenant-owned verified query.

    System rows are not deletable via this surface; use ``PATCH ... {enabled: false}``
    against a tenant-owned row if you only want to hide it temporarily.
    """
    result = await db.execute(
        delete(SherlockVerifiedQuery).where(
            SherlockVerifiedQuery.id == verified_query_id,
            SherlockVerifiedQuery.tenant_id == auth.tenant_id,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail='verified query not found in this tenant',
        )
    await db.commit()


# ─────────────────── instructions sub-surface ───────────────────


def _load_app_defaults() -> dict[str, str]:
    """Read every <app_id>.md in the instructions dir. Cached at module
    load would be tighter, but reads are infrequent (admin UI only)."""
    out: dict[str, str] = {}
    if not _INSTRUCTIONS_DIR.exists():
        return out
    for md in sorted(_INSTRUCTIONS_DIR.glob('*.md')):
        try:
            out[md.stem] = md.read_text(encoding='utf-8').strip()
        except OSError:
            continue
    return out


@router.get(
    '/instructions',
    response_model=SherlockInstructionsResponse,
    # NOTE: this lives under /api/sherlock/verified-queries by the
    # router's prefix, but we keep the path explicit so the URL reads
    # naturally — the admin page covers both surfaces.
)
async def get_instructions(
    auth: AuthContext = require_permission('sherlock:manage_verified_queries'),
    db: AsyncSession = Depends(get_db),
):
    """Return the tenant override + every app-default markdown for
    display. Empty/missing override surfaces as ``None``."""
    override = (await db.execute(
        select(TenantConfiguration.sherlock_instructions).where(
            TenantConfiguration.tenant_id == auth.tenant_id,
        )
    )).scalar_one_or_none()
    return SherlockInstructionsResponse(
        tenant_override=override,
        app_defaults=_load_app_defaults(),
    )


@router.put('/instructions', response_model=SherlockInstructionsResponse)
async def put_instructions(
    body: SherlockInstructionsUpdateRequest,
    auth: AuthContext = require_permission('sherlock:manage_verified_queries'),
    db: AsyncSession = Depends(get_db),
):
    """Set/clear the tenant override (single TEXT column).

    Empty string is treated as NULL — clears the override so the prompt
    falls back to app default only.
    """
    new_value = (body.tenant_override or '').strip() or None

    # Insert tenant_configurations row on demand so first-time tenants
    # don't 404 here. Idempotent on tenant_id (unique constraint).
    existing = (await db.execute(
        select(TenantConfiguration.id).where(
            TenantConfiguration.tenant_id == auth.tenant_id,
        )
    )).scalar_one_or_none()
    if existing is None:
        db.add(TenantConfiguration(
            tenant_id=auth.tenant_id,
            allowed_domains=[],
            sherlock_instructions=new_value,
        ))
    else:
        await db.execute(
            update(TenantConfiguration)
            .where(TenantConfiguration.tenant_id == auth.tenant_id)
            .values(sherlock_instructions=new_value)
        )
    await db.commit()
    return SherlockInstructionsResponse(
        tenant_override=new_value,
        app_defaults=_load_app_defaults(),
    )
