"""Layer 3: user-specific cross-session context."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def render(session: dict[str, Any], db: AsyncSession) -> str:
    cached = session.get('_user_context')
    if cached is not None:
        return cached

    app_id = session.get('app_id', '')
    tenant_id = session.get('tenant_id', '')
    user_id = session.get('user_id', '')
    lines: list[str] = []

    try:
        template_rows = await db.execute(
            text(
                """
                SELECT name
                FROM report_configs
                WHERE tenant_id = :tenant_id
                  AND user_id = :user_id
                  AND app_id = :app_id
                ORDER BY updated_at DESC
                LIMIT 5
                """
            ),
            {
                'tenant_id': tenant_id,
                'user_id': user_id,
                'app_id': app_id,
            },
        )
        templates = [row[0] for row in template_rows.all() if row[0]]
        if templates:
            lines.append(
                'Saved report templates: ' + ', '.join(f'"{template}"' for template in templates)
            )
    except Exception as exc:
        logger.debug('Failed to load report templates: %s', exc)

    try:
        usage_rows = await db.execute(
            text(
                """
                SELECT
                  CASE
                    WHEN tool_name = 'analyze' THEN 'data_query'
                    WHEN tool_name = 'compose_report' THEN 'blueprint_compose'
                    WHEN tool_name = 'save_template' THEN 'blueprint_save'
                    WHEN tool_name IN ('list_section_types', 'list_app_sections', 'get_section_detail') THEN 'blueprint_blocks'
                    ELSE tool_name
                  END AS tool_name,
                  COUNT(*) AS uses
                FROM agent_tool_logs
                WHERE tenant_id = :tenant_id
                  AND user_id = :user_id
                  AND app_id = :app_id
                  AND created_at > now() - interval '7 days'
                GROUP BY 1
                ORDER BY uses DESC, tool_name ASC
                LIMIT 5
                """
            ),
            {
                'tenant_id': tenant_id,
                'user_id': user_id,
                'app_id': app_id,
            },
        )
        usage = [f'{row[0]} ({row[1]} uses)' for row in usage_rows.all() if row[0]]
        if usage:
            lines.append('Recent activity: ' + ', '.join(usage))
    except Exception as exc:
        logger.debug('Failed to load recent tool usage: %s', exc)

    result = ''
    if lines:
        result = 'USER CONTEXT:\n' + '\n'.join(lines)

    session['_user_context'] = result
    return result
