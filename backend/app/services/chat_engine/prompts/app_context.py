"""Layer 2: app identity and report-builder affordances."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app import App

logger = logging.getLogger(__name__)


async def render(session: dict[str, Any], db: AsyncSession) -> str:
    cached = session.get('_app_context')
    if cached is not None:
        return cached

    app_id = session.get('app_id', '')
    parts = [f'APP: {app_id}']

    app_summary = await _load_app_summary(app_id, db)
    if app_summary:
        parts.append(app_summary)

    sections_text = await _load_app_sections(app_id, db)
    if sections_text:
        parts.append(sections_text)

    chat_context = await _load_chat_context(app_id, db)
    if chat_context:
        parts.append(chat_context)

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
            return f'{display_name} — {description}'
        return display_name
    except Exception as exc:
        logger.warning('Failed to load app summary for %s: %s', app_id, exc)
        return ''


async def _load_chat_context(app_id: str, db: AsyncSession) -> str:
    try:
        result = await db.execute(
            select(App.config).where(
                App.slug == app_id,
                App.is_active.is_(True),
            )
        )
        config = result.scalar_one_or_none() or {}
        context_note = str((config.get('chat') or {}).get('context', '') or '').strip()
        if not context_note:
            return ''
        return f'DOMAIN CONTEXT:\n{context_note}'
    except Exception as exc:
        logger.warning('Failed to load chat context for %s: %s', app_id, exc)
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
