"""Cross-turn structured state for Sherlock v3 chat sessions.

DORMANT — awaiting producer. The table + read path are wired so a future
supervisor-structured-output PR can light up cross-turn memory without
touching schema or callers. Today:

  * ``load_state(...)`` IS called by ``runtime.run_turn`` at turn start
    and the snapshot is threaded into the supervisor prompt via
    ``render_state_block``. For fresh sessions the snapshot is empty, so
    the prompt block is empty.
  * ``merge_state_delta(...)`` HAS NO PRODUCER. Specialists do not emit
    ``state_delta`` today (the field exists on ``SpecialistResult`` and
    the OpenAI tool schema does not declare it). Rows in
    ``platform.sherlock_state`` will only appear once the producer is
    wired in a follow-up.

One row per ``chat_session_id`` in ``platform.sherlock_state``. Two fields
are scoped for cross-turn promotion — ``resolved_entities`` and
``active_filters``.

JSONB deep-merge uses Postgres ``||`` (shallow merge on top-level keys), which
is the right shape for these two fields: ``resolved_entities`` is keyed by
entity slug (``{"agent": {...}, "patient": {...}}``) and ``active_filters`` by
filter slug — adding a new key preserves all others.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(slots=True, frozen=True)
class SherlockStateSnapshot:
    """What the supervisor sees at turn start. Empty dicts when no row exists."""

    resolved_entities: dict[str, Any]
    active_filters: dict[str, Any]

    @property
    def is_empty(self) -> bool:
        return not self.resolved_entities and not self.active_filters


_EMPTY_SNAPSHOT = SherlockStateSnapshot(resolved_entities={}, active_filters={})


async def load_state(
    db: AsyncSession,
    chat_session_id: uuid.UUID,
) -> SherlockStateSnapshot:
    row = (await db.execute(
        text(
            'SELECT resolved_entities, active_filters '
            'FROM platform.sherlock_state '
            'WHERE chat_session_id = :sid'
        ),
        {'sid': chat_session_id},
    )).first()
    if row is None:
        return _EMPTY_SNAPSHOT
    return SherlockStateSnapshot(
        resolved_entities=dict(row[0] or {}),
        active_filters=dict(row[1] or {}),
    )


async def merge_state_delta(
    db: AsyncSession,
    *,
    chat_session_id: uuid.UUID,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    resolved_entities: dict[str, Any] | None,
    active_filters: dict[str, Any] | None,
    last_artifact_id: uuid.UUID | None = None,
) -> None:
    """Upsert a state delta. No-op when both deltas are empty/None.

    Deep-merges via ``||`` on existing rows. Inserts a fresh row scoped to
    (tenant, user, app, session) when none exists. ``last_specialist_call_at``
    and ``updated_at`` are stamped server-side on every touch.
    """
    re_delta = resolved_entities or {}
    af_delta = active_filters or {}
    if not re_delta and not af_delta and last_artifact_id is None:
        return

    await db.execute(
        text(
            'INSERT INTO platform.sherlock_state ('
            '  chat_session_id, tenant_id, user_id, app_id, '
            '  resolved_entities, active_filters, last_artifact_id, '
            '  last_specialist_call_at, updated_at'
            ') VALUES ('
            '  :sid, :tid, :uid, :app, '
            '  CAST(:re AS jsonb), CAST(:af AS jsonb), :art, '
            '  NOW(), NOW()'
            ') ON CONFLICT (chat_session_id) DO UPDATE SET '
            '  resolved_entities = platform.sherlock_state.resolved_entities '
            '    || EXCLUDED.resolved_entities, '
            '  active_filters = platform.sherlock_state.active_filters '
            '    || EXCLUDED.active_filters, '
            '  last_artifact_id = COALESCE(EXCLUDED.last_artifact_id, '
            '    platform.sherlock_state.last_artifact_id), '
            '  last_specialist_call_at = NOW(), '
            '  updated_at = NOW()'
        ),
        {
            'sid': chat_session_id,
            'tid': tenant_id,
            'uid': user_id,
            'app': app_id,
            're': _jsonb_param(re_delta),
            'af': _jsonb_param(af_delta),
            'art': last_artifact_id,
        },
    )


def _jsonb_param(value: dict[str, Any]) -> str:
    """SQLAlchemy + asyncpg + text() needs explicit JSON serialization."""
    import json
    return json.dumps(value)


def render_state_block(snapshot: SherlockStateSnapshot) -> str:
    """Format the snapshot as a short markdown block for the supervisor prompt.

    Returns '' when both fields are empty so the prompt stays noise-free
    for fresh sessions. Each resolved entity renders as a ready-to-paste
    WHERE fragment so follow-up SQL inherits the pin without re-deriving.
    """
    if snapshot.is_empty:
        return ''
    lines: list[str] = ['# Cross-turn memory (carry into follow-up SQL)']
    if snapshot.resolved_entities:
        lines.append('Known entities — follow-up turns SHOULD WHERE on these:')
        for slug, value in snapshot.resolved_entities.items():
            if isinstance(value, dict):
                col = value.get('filter_column', '?')
                val = value.get('filter_value', '?')
                disp = value.get('display') or val
                lines.append(f'- {slug} ({disp}): WHERE {col} = {val!r}')
            else:
                lines.append(f'- {slug}: {value}')
    if snapshot.active_filters:
        lines.append('Active filters (inherited unless the user changes scope):')
        for slug, value in snapshot.active_filters.items():
            lines.append(f'- {slug}: {value}')
    return '\n'.join(lines)


__all__ = [
    'SherlockStateSnapshot',
    'load_state',
    'merge_state_delta',
    'render_state_block',
]
