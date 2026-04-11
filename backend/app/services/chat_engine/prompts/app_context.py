"""Layer 2: app context and self-describing data profile."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app import App

logger = logging.getLogger(__name__)


async def render(session: dict[str, Any], db: AsyncSession) -> str:
    cached = session.get('_app_context')
    if cached is not None:
        return cached

    app_id = session.get('app_id', '')
    tenant_id = session.get('tenant_id', '')
    parts = [f'APP CONTEXT ({app_id}):']

    app_summary = await _load_app_summary(app_id, db)
    if app_summary:
        parts.append(app_summary)

    sections_text = await _load_app_sections(app_id, db)
    if sections_text:
        parts.append(sections_text)

    data_profile = await _load_data_profile(app_id, tenant_id, db)
    if data_profile:
        parts.append(data_profile)

    result = '\n'.join(part for part in parts if part)
    session['_app_context'] = result
    return result


async def _load_app_summary(app_id: str, db: AsyncSession) -> str:
    try:
        result = await db.execute(
            select(App.display_name, App.description).where(
                App.slug == app_id,
                App.is_active.is_(True),
            )
        )
        row = result.first()
        if not row:
            return ''

        display_name, description = row
        if description:
            return f'App: {display_name} — {description}'
        return f'App: {display_name}'
    except Exception as exc:
        logger.warning('Failed to load app summary for %s: %s', app_id, exc)
        return ''


async def _load_app_sections(app_id: str, db: AsyncSession) -> str:
    try:
        result = await db.execute(
            select(App.config).where(
                App.slug == app_id,
                App.is_active.is_(True),
            )
        )
        config = result.scalar_one_or_none() or {}
        sections = (
            config.get('analytics', {})
            .get('singleRun', {})
            .get('sections', [])
        )
        names = [
            section.get('type') or section.get('key')
            for section in sections
            if isinstance(section, dict) and (section.get('type') or section.get('key'))
        ]
        if not names:
            return ''
        return f'Available report sections: {", ".join(names)}'
    except Exception as exc:
        logger.warning('Failed to load app sections for %s: %s', app_id, exc)
        return ''


async def _load_data_profile(app_id: str, tenant_id: str, db: AsyncSession) -> str:
    params = {'app_id': app_id, 'tenant_id': tenant_id}
    lines = ['DATA PROFILE:']

    try:
        eval_rows = await db.execute(
            text(
                """
                SELECT evaluator_type, evaluator_name, COUNT(*) AS n
                FROM analytics_eval_facts
                WHERE app_id = :app_id AND tenant_id = :tenant_id
                GROUP BY evaluator_type, evaluator_name
                ORDER BY n DESC, evaluator_type ASC, evaluator_name ASC
                """
            ),
            params,
        )
        evaluators = [
            f'{row[0]}/{row[1]} ({row[2]})'
            for row in eval_rows.all()
            if row[0] and row[1]
        ]
        if evaluators:
            lines.append(f'Evaluators: {", ".join(evaluators)}')
        else:
            lines.append('Evaluators: (no evaluation data yet)')
    except Exception as exc:
        logger.warning('Failed to load evaluator profile for %s: %s', app_id, exc)

    try:
        field_rows = await db.execute(
            text(
                """
                SELECT DISTINCT jsonb_object_keys(context) AS field
                FROM analytics_eval_facts
                WHERE app_id = :app_id AND tenant_id = :tenant_id
                """
            ),
            params,
        )
        fields = sorted({row[0] for row in field_rows.all() if row[0]})
        if fields:
            lines.append(f'Context fields on eval_facts: {", ".join(fields)}')
        else:
            lines.append('Context fields on eval_facts: (none)')
    except Exception as exc:
        logger.warning('Failed to load context fields for %s: %s', app_id, exc)

    try:
        criterion_rows = await db.execute(
            text(
                """
                SELECT criterion_source, COUNT(*) AS n
                FROM analytics_criterion_facts
                WHERE app_id = :app_id AND tenant_id = :tenant_id
                GROUP BY criterion_source
                ORDER BY n DESC, criterion_source ASC
                """
            ),
            params,
        )
        criteria = [
            f'{row[0]} ({row[1]})'
            for row in criterion_rows.all()
            if row[0]
        ]
        if criteria:
            lines.append(f'Criterion data: {", ".join(criteria)}')
        else:
            lines.append('Criterion data: (none — no rule/criterion data for this app)')
    except Exception as exc:
        logger.warning('Failed to load criterion profile for %s: %s', app_id, exc)

    try:
        run_rows = await db.execute(
            text(
                """
                SELECT
                    eval_type,
                    COUNT(*) AS runs,
                    ROUND(AVG(thread_count)) AS avg_items,
                    BOOL_OR(adversarial_total IS NOT NULL) AS has_adversarial
                FROM analytics_run_facts
                WHERE app_id = :app_id AND tenant_id = :tenant_id
                GROUP BY eval_type
                ORDER BY runs DESC, eval_type ASC
                """
            ),
            params,
        )
        run_types: list[str] = []
        for eval_type, runs, avg_items, has_adversarial in run_rows.all():
            if not eval_type:
                continue
            description = f'{eval_type} ({runs} runs, ~{int(avg_items or 0)} items/run'
            if has_adversarial:
                description += ', adversarial stats'
            description += ')'
            run_types.append(description)
        if run_types:
            lines.append(f'Run types: {", ".join(run_types)}')
    except Exception as exc:
        logger.warning('Failed to load run profile for %s: %s', app_id, exc)

    return '\n'.join(lines) if len(lines) > 1 else ''
