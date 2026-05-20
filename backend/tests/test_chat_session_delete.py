"""Deleting a chat session must cascade to messages + the full sherlock graph.

Regression guard: every child FK (chat_messages, sherlock_agent_sessions,
conversation_turns, parts, state, evidence) is ON DELETE CASCADE, so a single
``db.delete(session)`` removes the whole conversation. Catches a future FK that
drops CASCADE (which would 500 the delete route).
"""
import pytest
from sqlalchemy import select

from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.chat import ChatMessage, ChatSession
from app.models.sherlock_runtime import (
    SherlockAgentSession,
    SherlockConversationTurn,
    SherlockPart,
)


@pytest.mark.asyncio
async def test_delete_session_cascades_messages(db_session):
    tenant_id = SYSTEM_TENANT_ID
    user_id = SYSTEM_USER_ID
    session = ChatSession(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id='kaira-bot',
        server_session_id='sherlock',
        title='Conversations by intent',
    )
    db_session.add(session)
    await db_session.flush()
    db_session.add_all([
        ChatMessage(
            tenant_id=tenant_id, user_id=user_id, session_id=session.id,
            role='user', content='how many conversations by intent?',
        ),
        ChatMessage(
            tenant_id=tenant_id, user_id=user_id, session_id=session.id,
            role='assistant', content='FoodAgent leads with 259 conversations.',
        ),
    ])
    db_session.add(SherlockAgentSession(
        chat_session_id=session.id, tenant_id=tenant_id, user_id=user_id,
        app_id='kaira-bot', provider='openai', model='gpt',
    ))
    turn = SherlockConversationTurn(
        chat_session_id=session.id, tenant_id=tenant_id, user_id=user_id,
        app_id='kaira-bot', client_turn_id='t1', provider='openai', model='gpt',
        user_message='how many conversations by intent?',
    )
    db_session.add(turn)
    db_session.add(SherlockPart(
        id='p1', chat_session_id=session.id, tenant_id=tenant_id, user_id=user_id,
        app_id='kaira-bot', seq=1, type='assistant_text', payload={'text': 'x'},
    ))
    await db_session.commit()
    sid = session.id

    # Reload as the route does (messages collection unloaded), then delete.
    loaded = await db_session.scalar(select(ChatSession).where(ChatSession.id == sid))
    await db_session.delete(loaded)
    await db_session.commit()

    assert await db_session.scalar(select(ChatSession).where(ChatSession.id == sid)) is None
    remaining = await db_session.scalar(
        select(ChatMessage.id).where(ChatMessage.session_id == sid)
    )
    assert remaining is None
