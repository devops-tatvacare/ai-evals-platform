"""
In-memory session store for report builder chat sessions.
Keyed by session_id. Sessions expire after inactivity.
"""
from __future__ import annotations

import time
import uuid
from typing import Any

SESSION_TTL_SECONDS = 3600  # 1 hour

_sessions: dict[str, tuple[dict, float]] = {}


def create_session(
    app_id: str, tenant_id: str, user_id: str, provider: str, model: str,
) -> tuple[str, dict]:
    session_id = uuid.uuid4().hex
    session: dict[str, Any] = {
        "app_id": app_id,
        "tenant_id": tenant_id,
        "user_id": user_id,
        "provider": provider,
        "model": model,
        "messages": [],  # opaque, provider-native format
        "scratchpad": {
            "findings": [],
            "composed_report": None,
            "errors": [],
            "discovery": None,
            "lookups": {},
        },
        "_app_context": None,
        "_user_context": None,
    }
    _sessions[session_id] = (session, time.time())
    _evict_expired()
    return session_id, session


def get_session(session_id: str) -> dict | None:
    entry = _sessions.get(session_id)
    if not entry:
        return None
    session, created_at = entry
    if time.time() - created_at > SESSION_TTL_SECONDS:
        _sessions.pop(session_id, None)
        return None
    _sessions[session_id] = (session, time.time())  # refresh
    return session


def _evict_expired() -> None:
    now = time.time()
    expired = [k for k, (_, ts) in _sessions.items() if now - ts > SESSION_TTL_SECONDS]
    for k in expired:
        _sessions.pop(k, None)
