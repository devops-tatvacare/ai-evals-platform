"""Pydantic request/response schemas for Sherlock observability routes.

Phase 15.1d — feeds the platform Logs page's Sherlock tab. ``analytics.log_sherlock_tool_call``
historically had no API surface; the rows were written by the chat handler and
read only by analysts hitting the DB directly. This module exposes a tenant +
user-scoped read API.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from app.schemas.base import CamelModel, CamelORMModel


class SherlockToolCallRow(CamelORMModel):
    """List-row shape for ``GET /api/sherlock/tool-calls``.

    Heavy payloads (``arguments``, ``generated_sql``, ``validated_sql``) are
    intentionally **not** projected on the list endpoint — the Sherlock tab
    renders a wide table and we don't want to ship MB of JSONB per page.
    The detail endpoint exposes the full row.

    ``args_summary`` is a short comma-joined list of the top-level
    ``arguments`` keys, computed server-side. It gives the table a hint of
    what the tool was called with without serialising the payload.
    """
    id: uuid.UUID
    session_id: Optional[str]
    db_session_id: Optional[uuid.UUID]
    app_id: str
    tool_name: str
    status: str
    error_message: Optional[str]
    execution_ms: Optional[float]
    row_count: Optional[int]
    llm_model: Optional[str]
    cache_hit: Optional[bool]
    args_summary: Optional[str]
    created_at: datetime


class SherlockToolCallDetail(CamelORMModel):
    """Full-row shape for ``GET /api/sherlock/tool-calls/{id}``.

    Includes the raw ``arguments`` payload and both SQL variants. The
    sub-route page renders these in collapsible JSON / SQL sections.
    """
    id: uuid.UUID
    session_id: Optional[str]
    db_session_id: Optional[uuid.UUID]
    app_id: str
    tool_name: str
    status: str
    error_message: Optional[str]
    execution_ms: Optional[float]
    row_count: Optional[int]
    llm_model: Optional[str]
    llm_tokens_in: Optional[int]
    llm_tokens_out: Optional[int]
    cache_hit: Optional[bool]
    arguments: Optional[dict[str, Any]]
    generated_sql: Optional[str]
    validated_sql: Optional[str]
    created_at: datetime


class SherlockToolCallListResponse(CamelModel):
    items: list[SherlockToolCallRow]
    total: int
    limit: int
    offset: int
