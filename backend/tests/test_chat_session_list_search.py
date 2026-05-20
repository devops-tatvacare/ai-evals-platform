"""GET /api/chat/sessions search + pagination over title and message content."""
import uuid

import pytest

from app.auth import AuthContext
from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.chat import ChatMessage, ChatSession
from app.routes.chat import list_sessions, search_sessions


def _auth(app_id: str) -> AuthContext:
    return AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=SYSTEM_TENANT_ID,
        email='t@example.com',
        role_id=uuid.uuid4(),
        is_owner=True,
        permissions=frozenset(),
        app_access=frozenset({app_id}),
    )


def _session(app_id: str, title: str) -> ChatSession:
    return ChatSession(
        tenant_id=SYSTEM_TENANT_ID, user_id=SYSTEM_USER_ID, app_id=app_id,
        server_session_id='sherlock', title=title,
    )


@pytest.mark.asyncio
async def test_search_matches_title_or_message_content(db_session):
    app_id = f'search-{uuid.uuid4().hex[:8]}'
    needle = uuid.uuid4().hex
    by_title = _session(app_id, f'About {needle}')
    by_message = _session(app_id, 'Generic conversation')
    no_match = _session(app_id, 'Something unrelated')
    db_session.add_all([by_title, by_message, no_match])
    await db_session.flush()
    db_session.add(ChatMessage(
        tenant_id=SYSTEM_TENANT_ID, user_id=SYSTEM_USER_ID, session_id=by_message.id,
        role='assistant', content=f'the assistant answer references {needle} here',
    ))
    await db_session.commit()

    rows = await list_sessions(
        app_id=app_id, source='sherlock', search=needle, limit=20, offset=0,
        auth=_auth(app_id), db=db_session,
    )
    ids = {s.id for s in rows}
    assert by_title.id in ids
    assert by_message.id in ids
    assert no_match.id not in ids


@pytest.mark.asyncio
async def test_search_hits_return_windowed_message_snippets(db_session):
    app_id = f'hits-{uuid.uuid4().hex[:8]}'
    s = _session(app_id, "India's Fuel Price Stability")
    db_session.add(s)
    await db_session.flush()
    db_session.add_all([
        ChatMessage(
            tenant_id=SYSTEM_TENANT_ID, user_id=SYSTEM_USER_ID, session_id=s.id, role='user',
            content='Explain this to me: India is among the few countries with stable fuel prices over the decade',
        ),
        ChatMessage(
            tenant_id=SYSTEM_TENANT_ID, user_id=SYSTEM_USER_ID, session_id=s.id, role='assistant',
            content='Here is the breakdown — the cost for Indian Oil Marketing Companies rose sharply last quarter',
        ),
    ])
    other = _session(app_id, 'Completely unrelated topic')
    db_session.add(other)
    await db_session.flush()
    db_session.add(ChatMessage(
        tenant_id=SYSTEM_TENANT_ID, user_id=SYSTEM_USER_ID, session_id=other.id,
        role='user', content='nothing relevant here',
    ))
    await db_session.commit()

    hits = await search_sessions(
        app_id=app_id, q='india', source='sherlock', limit=20, offset=0,
        auth=_auth(app_id), db=db_session,
    )
    message_hits = [h for h in hits if h.matched_in == 'message']
    assert len(message_hits) == 2
    assert all(h.session_id == s.id for h in message_hits)
    assert all('india' in (h.snippet or '').lower() for h in message_hits)
    assert any('…' in (h.snippet or '') for h in message_hits)  # windowed
    assert all(h.session_id != other.id for h in hits)


@pytest.mark.asyncio
async def test_search_includes_title_only_hit(db_session):
    app_id = f'title-{uuid.uuid4().hex[:8]}'
    s = _session(app_id, 'Zydus Shareholder Pattern Update')
    db_session.add(s)
    await db_session.flush()
    db_session.add(ChatMessage(
        tenant_id=SYSTEM_TENANT_ID, user_id=SYSTEM_USER_ID, session_id=s.id,
        role='user', content='no matching token in this message body',
    ))
    await db_session.commit()

    hits = await search_sessions(
        app_id=app_id, q='zydus', source='sherlock', limit=20, offset=0,
        auth=_auth(app_id), db=db_session,
    )
    assert len(hits) == 1
    assert hits[0].matched_in == 'title'
    assert hits[0].snippet is None


@pytest.mark.asyncio
async def test_limit_offset_paginate_without_overlap(db_session):
    app_id = f'page-{uuid.uuid4().hex[:8]}'
    db_session.add_all([_session(app_id, f'S{i}') for i in range(5)])
    await db_session.commit()

    auth = _auth(app_id)
    page1 = await list_sessions(app_id=app_id, source='sherlock', search=None, limit=2, offset=0, auth=auth, db=db_session)
    page2 = await list_sessions(app_id=app_id, source='sherlock', search=None, limit=2, offset=2, auth=auth, db=db_session)
    page3 = await list_sessions(app_id=app_id, source='sherlock', search=None, limit=2, offset=4, auth=auth, db=db_session)

    assert [len(page1), len(page2), len(page3)] == [2, 2, 1]
    all_ids = [s.id for s in (*page1, *page2, *page3)]
    assert len(set(all_ids)) == 5
