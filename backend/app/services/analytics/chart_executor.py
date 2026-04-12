"""Re-execute a saved chart's SQL query with current user's access control."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text

from app.database import analytics_session
from app.services.chat_engine.sql_agent import validate_sql, MAX_RESULT_ROWS, QUERY_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)


async def execute_chart(
    sql_query: str,
    *,
    tenant_id: str,
    app_id: str,
) -> list[dict[str, Any]]:
    """
    Execute a saved chart's SQL query with access control params.
    Returns rows as list of dicts.
    Raises on validation failure or execution error.
    """
    # Re-validate every time — defense in depth
    validated = validate_sql(sql_query)

    params = {"tenant_id": tenant_id, "app_id": app_id}

    # Add LIMIT if not present
    if "LIMIT" not in validated.upper():
        validated += f" LIMIT {MAX_RESULT_ROWS}"

    async with analytics_session() as db:
        result = await db.execute(
            text(validated).execution_options(timeout=QUERY_TIMEOUT_SECONDS),
            params,
        )
        rows = result.fetchall()
        columns = list(result.keys())

        return [
            {col: _serialize(row[i]) for i, col in enumerate(columns)}
            for row in rows
        ]


def _serialize(val: Any) -> Any:
    from decimal import Decimal

    if val is None:
        return None
    if isinstance(val, (int, float, bool, str)):
        return val
    if isinstance(val, Decimal):
        return float(val)
    return str(val)
