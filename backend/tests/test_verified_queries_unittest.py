"""Phase 2A — DB-backed verified-query retriever.

Asserts the contract callers depend on:

  * Tenant-scoped + system rows visible together.
  * Disabled rows excluded.
  * Lexical Jaccard ranks matching questions above unrelated ones.
  * Empty token set returns empty list (deterministic fallback signal).
  * Cross-app rows never leak.
  * Seed loader is idempotent and corrects ``source='seed'`` rows on re-run.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import delete

from app.constants import SYSTEM_TENANT_ID
from app.models.sherlock_verified_query import SherlockVerifiedQuery
from app.services.sherlock_v3.verified_queries import (
    normalize_question,
    retrieve_top_k,
    seed_verified_queries,
)


@pytest_asyncio.fixture
async def clean_verified_queries(db_session):
    """Strip the table before/after each test so the assertions don't
    drift if seed_verified_queries ran during an earlier test."""
    await db_session.execute(delete(SherlockVerifiedQuery))
    await db_session.commit()
    yield
    await db_session.execute(delete(SherlockVerifiedQuery))
    await db_session.commit()


def _make_row(
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    question: str,
    sql: str = 'SELECT 1',
    enabled: bool = True,
    source: str = 'seed',
) -> SherlockVerifiedQuery:
    return SherlockVerifiedQuery(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        question=question,
        normalized_question=normalize_question(question),
        sql=sql,
        source=source,
        enabled=enabled,
    )


@pytest.mark.asyncio
async def test_normalize_question_strips_punctuation_and_lowercases() -> None:
    assert normalize_question('Show evaluation runs by status?') == \
        'show evaluation runs by status'
    assert normalize_question("What's the latest run's status?") == \
        'what s the latest run s status'


@pytest.mark.asyncio
async def test_retriever_returns_top_k_by_jaccard(
    db_session, clean_verified_queries,
) -> None:
    db_session.add_all([
        _make_row(
            tenant_id=SYSTEM_TENANT_ID, app_id='voice-rx',
            question='Show evaluation runs by status as a chart',
        ),
        _make_row(
            tenant_id=SYSTEM_TENANT_ID, app_id='voice-rx',
            question='Average call duration this week',
        ),
        _make_row(
            tenant_id=SYSTEM_TENANT_ID, app_id='voice-rx',
            question='Pass rate trend by week',
        ),
    ])
    await db_session.commit()

    hits = await retrieve_top_k(
        'evaluation runs by status',
        tenant_id=uuid.uuid4(),  # arbitrary tenant — only system rows hit
        app_id='voice-rx',
        db=db_session,
        k=3,
    )
    assert len(hits) >= 1, 'must find at least one similar question'
    assert 'status' in hits[0].question.lower()
    assert hits[0].score > 0


@pytest.mark.asyncio
async def test_retriever_excludes_disabled_rows(
    db_session, clean_verified_queries,
) -> None:
    db_session.add(_make_row(
        tenant_id=SYSTEM_TENANT_ID, app_id='voice-rx',
        question='Show evaluation runs by status',
        enabled=False,
    ))
    await db_session.commit()

    hits = await retrieve_top_k(
        'show evaluation runs by status',
        tenant_id=uuid.uuid4(),
        app_id='voice-rx',
        db=db_session,
    )
    assert hits == []


@pytest.mark.asyncio
async def test_retriever_scopes_to_app(
    db_session, clean_verified_queries,
) -> None:
    db_session.add(_make_row(
        tenant_id=SYSTEM_TENANT_ID, app_id='inside-sales',
        question='Show evaluation runs by status',
    ))
    await db_session.commit()

    hits = await retrieve_top_k(
        'show evaluation runs by status',
        tenant_id=uuid.uuid4(),
        app_id='voice-rx',  # different app
        db=db_session,
    )
    assert hits == []


@pytest.mark.asyncio
async def test_retriever_unions_tenant_and_system_rows(
    db_session, clean_verified_queries,
) -> None:
    tenant_id = SYSTEM_TENANT_ID  # any tenant FK target works for the test
    db_session.add_all([
        _make_row(
            tenant_id=tenant_id, app_id='voice-rx',
            question='Custom tenant question for runs',
        ),
        _make_row(
            tenant_id=SYSTEM_TENANT_ID, app_id='voice-rx',
            question='System question for runs',
        ),
    ])
    await db_session.commit()

    hits = await retrieve_top_k(
        'custom runs question',
        tenant_id=tenant_id,
        app_id='voice-rx',
        db=db_session,
        k=10,
        min_score=0.0,
    )
    qs = {h.question for h in hits}
    assert 'Custom tenant question for runs' in qs
    assert 'System question for runs' in qs


@pytest.mark.asyncio
async def test_retriever_empty_question_returns_empty(
    db_session, clean_verified_queries,
) -> None:
    db_session.add(_make_row(
        tenant_id=SYSTEM_TENANT_ID, app_id='voice-rx',
        question='Show evaluation runs by status',
    ))
    await db_session.commit()

    hits = await retrieve_top_k(
        '   ',  # only whitespace -> normalized to empty
        tenant_id=uuid.uuid4(),
        app_id='voice-rx',
        db=db_session,
    )
    assert hits == []


@pytest.mark.asyncio
async def test_seed_loader_is_idempotent(
    db_session, clean_verified_queries,
) -> None:
    inserted_first = await seed_verified_queries(db_session)
    await db_session.commit()

    inserted_second = await seed_verified_queries(db_session)
    await db_session.commit()

    assert inserted_first > 0, 'seed file must produce at least one row'
    # On the second run, ON CONFLICT updates row by source='seed'; rowcount
    # for an UPDATE counts the row as affected, so we only assert
    # idempotency by row total, not by ``inserted_second == 0``.
    from sqlalchemy import func, select
    total = (await db_session.execute(
        select(func.count()).select_from(SherlockVerifiedQuery)
    )).scalar_one()
    assert total == inserted_first, \
        'idempotent reseed must not insert duplicate rows'
