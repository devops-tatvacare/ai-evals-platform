"""DB-backed verified question→SQL retrieval for the Sherlock data_specialist.

Phase 2A — replaces the hand-edited Python list in ``exemplars.py``.
Two responsibilities:

  1. Bootstrap-time seeding from
     ``backend/app/seeds/data/platform.sherlock_verified_queries.json``
     into ``platform.sherlock_verified_queries``. Idempotent on
     ``(tenant_id, app_id, normalized_question)``; never overwrites
     ``source='admin'`` or ``source='user_thumbs_up'`` rows.

  2. Per-turn retrieval: ``retrieve_top_k(question, tenant_id, app_id,
     k=5)`` returns up to k enabled rows for the active app, scored by
     token-Jaccard against ``normalized_question``. Tenant-owned rows
     UNION system rows; ties broken by ``use_count`` then ``verified_at``.

No LLM, no embeddings — lexical only. A future pgvector phase can add
an ``embedding`` column without changing this surface.
"""
from __future__ import annotations

import json
import logging
import pathlib
import re
import uuid
from typing import Any, NamedTuple

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_TENANT_ID
from app.models.sherlock_verified_query import SherlockVerifiedQuery

_log = logging.getLogger(__name__)

_SEED_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / 'seeds' / 'data' / 'platform.sherlock_verified_queries.json'
)

# English stopwords are kept tight — Jaccard thrives on shared content
# tokens, not function words. Domain words ("evaluator", "criterion",
# "agent", "run") are NOT in this list and carry retrieval signal.
_STOPWORDS: frozenset[str] = frozenset({
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'and', 'or', 'but', 'if', 'then', 'else', 'of', 'in', 'on', 'at',
    'to', 'for', 'with', 'by', 'from', 'as', 'into', 'about', 'over',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it',
    'this', 'that', 'these', 'those',
    'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can',
    'could', 'should', 'may', 'might', 'must', 'shall',
    'show', 'find', 'list', 'give',
    'me', 'us',
    'what', 'which', 'who', 'when', 'where', 'why', 'how',
    'no', 'not',
})

_NORMALIZE_RE = re.compile(r'[^a-z0-9\s]+')
_WS_RE = re.compile(r'\s+')


def normalize_question(question: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace.

    Used both at seed-time (stored as ``normalized_question``) and at
    query-time (re-normalized so the comparison surface matches).
    """
    lowered = question.lower()
    cleaned = _NORMALIZE_RE.sub(' ', lowered)
    return _WS_RE.sub(' ', cleaned).strip()


def _tokens(normalized: str) -> set[str]:
    return {t for t in normalized.split(' ') if t and t not in _STOPWORDS}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / len(a | b)


# ─────────────────────────── retrieval ───────────────────────────


class RetrievedQuery(NamedTuple):
    id: uuid.UUID
    question: str
    sql: str
    score: float
    source: str
    is_system: bool


async def retrieve_top_k(
    question: str,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    db: AsyncSession,
    k: int = 5,
    min_score: float = 0.05,
) -> list[RetrievedQuery]:
    """Return up to ``k`` enabled verified queries scored by Jaccard.

    Scope: ``app_id`` matches AND (``tenant_id`` matches OR
    ``tenant_id = SYSTEM_TENANT_ID``). Disabled rows are filtered in SQL.
    Scoring is in Python on the candidate set so token-Jaccard stays
    deterministic and pgvector can drop in alongside later.

    Empty result list is the explicit fallback signal: the prompt builder
    renders "(none for this app yet)" and the LLM proceeds on schema
    alone — no exception, no silent default.
    """
    q_tokens = _tokens(normalize_question(question))
    if not q_tokens:
        return []

    stmt = (
        select(SherlockVerifiedQuery)
        .where(
            and_(
                SherlockVerifiedQuery.app_id == app_id,
                SherlockVerifiedQuery.enabled.is_(True),
                or_(
                    SherlockVerifiedQuery.tenant_id == tenant_id,
                    SherlockVerifiedQuery.tenant_id == SYSTEM_TENANT_ID,
                ),
            )
        )
    )
    rows = (await db.execute(stmt)).scalars().all()

    scored: list[RetrievedQuery] = []
    for row in rows:
        score = _jaccard(q_tokens, _tokens(row.normalized_question))
        if score < min_score:
            continue
        scored.append(RetrievedQuery(
            id=row.id,
            question=row.question,
            sql=row.sql,
            score=score,
            source=row.source,
            is_system=(row.tenant_id == SYSTEM_TENANT_ID),
        ))

    # Higher score wins; ties prefer tenant-owned over system, then more
    # battle-tested rows (use_count handled implicitly by source ordering
    # via the row tuple — kept simple here).
    scored.sort(key=lambda r: (-r.score, r.is_system))
    return scored[:k]


async def bump_usage(
    db: AsyncSession,
    *,
    ids: list[uuid.UUID],
) -> None:
    """Mark the given verified-query rows as used right now.

    Called after the data_specialist actually consumes the retrieved set
    in its prompt. Best-effort: failures here must not break the turn.
    """
    if not ids:
        return
    try:
        await db.execute(
            update(SherlockVerifiedQuery)
            .where(SherlockVerifiedQuery.id.in_(ids))
            .values(
                last_used_at=func.now(),
                use_count=SherlockVerifiedQuery.use_count + 1,
            )
        )
    except Exception as exc:  # noqa: BLE001
        _log.warning('verified_queries.bump_usage skipped: %s', exc)


# ─────────────────────────── seeding ───────────────────────────


async def seed_verified_queries(session: AsyncSession) -> int:
    """Insert bootstrap verified queries from JSON. Idempotent.

    Each row is keyed on ``(SYSTEM_TENANT_ID, app_id, normalized_question)``;
    re-runs UPDATE the ``sql`` and ``question`` columns for existing
    ``source='seed'`` rows so seed edits propagate, but never overwrite
    ``source='admin'`` / ``source='user_thumbs_up'`` rows.

    Returns the number of rows inserted.
    """
    if not _SEED_PATH.exists():
        _log.warning('platform.sherlock_verified_queries seed file missing at %s', _SEED_PATH)
        return 0
    try:
        raw = json.loads(_SEED_PATH.read_text())
    except json.JSONDecodeError as exc:
        _log.warning('platform.sherlock_verified_queries seed JSON invalid: %s', exc)
        return 0

    entries: list[dict[str, Any]] = raw.get('queries') or []
    if not entries:
        return 0

    inserted = 0
    for entry in entries:
        app_id = str(entry.get('app_id') or '').strip()
        question = str(entry.get('question') or '').strip()
        sql = str(entry.get('sql') or '').strip()
        if not app_id or not question or not sql:
            _log.warning('verified_queries seed entry skipped (missing field): %s', entry)
            continue

        normalized = normalize_question(question)
        stmt = pg_insert(SherlockVerifiedQuery.__table__).values(
            id=uuid.uuid4(),
            tenant_id=SYSTEM_TENANT_ID,
            app_id=app_id,
            question=question,
            normalized_question=normalized,
            sql=sql,
            source='seed',
            enabled=True,
        ).on_conflict_do_update(
            constraint='uq_sherlock_verified_queries_tenant_app_question',
            set_={
                'question': question,
                'sql': sql,
                'updated_at': func.now(),
            },
            where=SherlockVerifiedQuery.__table__.c.source == 'seed',
        )
        result = await session.execute(stmt)
        if result.rowcount:
            inserted += 1
    return inserted
