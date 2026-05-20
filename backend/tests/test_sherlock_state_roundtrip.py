"""Cross-turn state store — merge + load round-trip against the live DB.

Asserts the architecture-spec §5.2 contract:
  * Fresh sessions load to an empty snapshot.
  * merge_state_delta upserts a fresh row when none exists.
  * Subsequent merges deep-merge by top-level key (adding new entity slugs
    preserves prior ones; reusing a slug overwrites it).
  * Empty deltas short-circuit (no spurious UPDATE noise / no row created).
  * load_state returns the merged snapshot.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.chat import ChatSession
from app.services.sherlock_v3.state_store import (
    SherlockStateSnapshot,
    load_state,
    merge_state_delta,
)


async def _seed_chat_session(db_session) -> uuid.UUID:
    """Create one chat_sessions row; sherlock_state FKs to this id."""
    sid = uuid.uuid4()
    db_session.add(ChatSession(
        id=sid,
        tenant_id=SYSTEM_TENANT_ID,
        user_id=SYSTEM_USER_ID,
        app_id='inside-sales',
        title='roundtrip',
        server_session_id='sherlock',
    ))
    await db_session.flush()
    return sid


@pytest.mark.asyncio
async def test_load_state_returns_empty_when_no_row_exists(db_session) -> None:
    snapshot = await load_state(db_session, uuid.uuid4())
    assert isinstance(snapshot, SherlockStateSnapshot)
    assert snapshot.resolved_entities == {}
    assert snapshot.active_filters == {}
    assert snapshot.is_empty is True


@pytest.mark.asyncio
async def test_merge_state_delta_empty_inputs_are_noop(db_session) -> None:
    sid = await _seed_chat_session(db_session)
    await merge_state_delta(
        db_session,
        chat_session_id=sid,
        tenant_id=SYSTEM_TENANT_ID,
        user_id=SYSTEM_USER_ID,
        app_id='inside-sales',
        resolved_entities={},
        active_filters={},
    )
    row = (await db_session.execute(
        text('SELECT COUNT(*) FROM platform.sherlock_state WHERE chat_session_id = :sid'),
        {'sid': sid},
    )).scalar_one()
    assert row == 0


@pytest.mark.asyncio
async def test_merge_inserts_then_deep_merges(db_session) -> None:
    sid = await _seed_chat_session(db_session)

    alice = {'filter_column': 'agent',   'filter_value': 'Alice', 'display': 'Alice'}
    bob   = {'filter_column': 'agent',   'filter_value': 'Bob',   'display': 'Bob'}
    acme  = {'filter_column': 'lead_id', 'filter_value': 'l1',    'display': 'Acme Corp'}

    # First merge — INSERT
    await merge_state_delta(
        db_session,
        chat_session_id=sid,
        tenant_id=SYSTEM_TENANT_ID,
        user_id=SYSTEM_USER_ID,
        app_id='inside-sales',
        resolved_entities={'agent': alice},
        active_filters={'date_range': 'last_30_days'},
    )
    first = await load_state(db_session, sid)
    assert first.resolved_entities == {'agent': alice}
    assert first.active_filters == {'date_range': 'last_30_days'}

    # Second merge — deep merge: adds a new entity slug + overwrites the agent slug
    await merge_state_delta(
        db_session,
        chat_session_id=sid,
        tenant_id=SYSTEM_TENANT_ID,
        user_id=SYSTEM_USER_ID,
        app_id='inside-sales',
        resolved_entities={
            'agent': bob,    # overwrite
            'lead':  acme,   # new slug
        },
        active_filters={'status': 'open'},  # new filter slug
    )
    second = await load_state(db_session, sid)
    assert second.resolved_entities == {
        'agent': bob,
        'lead':  acme,
    }
    assert second.active_filters == {
        'date_range': 'last_30_days',  # preserved from first merge
        'status':     'open',          # added
    }


@pytest.mark.asyncio
async def test_merge_only_active_filters_still_creates_row(db_session) -> None:
    sid = await _seed_chat_session(db_session)
    await merge_state_delta(
        db_session,
        chat_session_id=sid,
        tenant_id=SYSTEM_TENANT_ID,
        user_id=SYSTEM_USER_ID,
        app_id='inside-sales',
        resolved_entities={},
        active_filters={'app': 'inside-sales'},
    )
    snapshot = await load_state(db_session, sid)
    assert snapshot.resolved_entities == {}
    assert snapshot.active_filters == {'app': 'inside-sales'}
