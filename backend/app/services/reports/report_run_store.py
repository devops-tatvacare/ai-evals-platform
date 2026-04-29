"""Persistence helpers for report runs and artifacts."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eval_run import EvaluationRun
from app.models.mixins.shareable import Visibility
from app.models.report_artifact import ReportArtifact
from app.models.report_run import ReportRun
from app.services.access_control import readable_scope_clause


def _shared_metadata(
    visibility: Visibility,
    user_id: uuid.UUID,
    *,
    now: datetime,
) -> tuple[uuid.UUID | None, datetime | None]:
    if visibility == Visibility.SHARED:
        return user_id, now
    return None, None


def _content_hash(artifact_data: dict) -> str:
    encoded = json.dumps(artifact_data, sort_keys=True, default=str).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


async def ensure_report_run(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    report_config,
    source_eval_run_id: uuid.UUID | None,
    visibility: Visibility | str | None,
    shared_by: uuid.UUID | None = None,
    shared_at: datetime | None = None,
    llm_provider: str | None,
    llm_model: str | None,
) -> ReportRun:
    now = datetime.now(timezone.utc)
    effective_visibility = Visibility.normalize(visibility) or report_config.default_report_run_visibility
    effective_shared_by, effective_shared_at = (
        (shared_by, shared_at)
        if shared_by is not None or shared_at is not None
        else _shared_metadata(effective_visibility, user_id, now=now)
    )
    if effective_visibility != Visibility.SHARED:
        effective_shared_by = None
        effective_shared_at = None

    existing = await db.scalar(
        select(ReportRun).where(
            ReportRun.tenant_id == tenant_id,
            ReportRun.job_id == job_id,
        )
    )
    if existing is not None:
        existing.status = 'running'
        existing.visibility = effective_visibility
        existing.shared_by = effective_shared_by
        existing.shared_at = effective_shared_at
        existing.source_eval_run_id = source_eval_run_id
        existing.llm_provider = llm_provider
        existing.llm_model = llm_model
        existing.report_config_version = report_config.version
        existing.started_at = existing.started_at or now
        existing.completed_at = None
        return existing

    report_run = ReportRun(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=report_config.app_id,
        report_id=report_config.report_id,
        scope=report_config.scope,
        source_eval_run_id=source_eval_run_id,
        status='running',
        visibility=effective_visibility,
        shared_by=effective_shared_by,
        shared_at=effective_shared_at,
        job_id=job_id,
        llm_provider=llm_provider,
        llm_model=llm_model,
        report_config_version=report_config.version,
        started_at=now,
    )
    db.add(report_run)
    await db.flush()
    return report_run


async def persist_report_artifact(
    db: AsyncSession,
    *,
    report_run: ReportRun,
    artifact_data: dict,
    source_run_count: int | None,
    latest_source_run_at: datetime | None,
) -> ReportArtifact:
    existing = await db.scalar(
        select(ReportArtifact).where(ReportArtifact.report_run_id == report_run.id)
    )
    digest = _content_hash(artifact_data)
    if existing is not None:
        existing.artifact_data = artifact_data
        existing.content_hash = digest
        existing.computed_at = datetime.now(timezone.utc)
        existing.source_run_count = source_run_count
        existing.latest_source_run_at = latest_source_run_at
        return existing

    artifact = ReportArtifact(
        report_run_id=report_run.id,
        tenant_id=report_run.tenant_id,
        app_id=report_run.app_id,
        report_id=report_run.report_id,
        scope=report_run.scope,
        artifact_data=artifact_data,
        content_hash=digest,
        source_run_count=source_run_count,
        latest_source_run_at=latest_source_run_at,
    )
    db.add(artifact)
    await db.flush()
    return artifact


async def fetch_single_run_artifact(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_access: frozenset[str],
    run_id: uuid.UUID,
    app_id: str,
    report_id: str,
) -> dict | None:
    access_user = type(
        'AccessUser',
        (),
        {
            'tenant_id': tenant_id,
            'user_id': user_id,
            'app_access': app_access,
        },
    )()
    stmt = (
        select(ReportArtifact.artifact_data)
        .join(ReportRun, ReportRun.id == ReportArtifact.report_run_id)
        .join(EvaluationRun, EvaluationRun.id == ReportRun.source_eval_run_id)
        .where(
            readable_scope_clause(EvaluationRun, access_user),
            ReportRun.app_id == app_id,
            ReportRun.report_id == report_id,
            ReportRun.scope == 'single_run',
            EvaluationRun.id == run_id,
            ReportRun.status == 'completed',
        )
        .order_by(desc(ReportRun.completed_at), desc(ReportArtifact.computed_at))
    )
    return await db.scalar(stmt)


async def fetch_report_run_artifact(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_access: frozenset[str],
    report_run_id: uuid.UUID,
) -> tuple[ReportRun, ReportArtifact] | None:
    access_user = type(
        'AccessUser',
        (),
        {
            'tenant_id': tenant_id,
            'user_id': user_id,
            'app_access': app_access,
        },
    )()
    row = await db.execute(
        select(ReportRun, ReportArtifact)
        .join(ReportArtifact, ReportArtifact.report_run_id == ReportRun.id)
        .where(ReportRun.id == report_run_id)
    )
    result = row.first()
    if result is None:
        return None
    report_run, artifact = result
    if report_run.source_eval_run_id is None:
        if not await db.scalar(
            select(ReportRun.id).where(
                ReportRun.id == report_run_id,
                readable_scope_clause(ReportRun, access_user),
            )
        ):
            return None
        return report_run, artifact

    can_read_source = await db.scalar(
        select(EvaluationRun.id).where(
            EvaluationRun.id == report_run.source_eval_run_id,
            readable_scope_clause(EvaluationRun, access_user),
        )
    )
    if not can_read_source:
        return None
    return report_run, artifact
