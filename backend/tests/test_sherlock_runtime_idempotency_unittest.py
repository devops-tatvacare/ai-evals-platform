import unittest
import uuid

from sqlalchemy.exc import IntegrityError

from app.models.sherlock_runtime import SherlockConversationTurn
from app.services.report_builder.runtime_store import SherlockAgentSessionState
from app.services.report_builder.turn_store import get_or_create_turn


class _FakeAsyncSession:
    def __init__(self) -> None:
        self.row = None

    async def scalar(self, _stmt):
        return self.row

    def add(self, row) -> None:
        if getattr(row, 'id', None) is None:
            row.id = uuid.uuid4()
        self.row = row

    async def flush(self) -> None:
        return None


class _NestedTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _RaceAsyncSession:
    def __init__(self, existing_row: SherlockConversationTurn) -> None:
        self.scalar_calls = 0
        self.existing_row = existing_row
        self.added_rows = []
        self.flush_attempts = 0

    async def scalar(self, _stmt):
        self.scalar_calls += 1
        if self.scalar_calls == 1:
            return None
        return self.existing_row

    def add(self, row) -> None:
        self.added_rows.append(row)

    def begin_nested(self) -> _NestedTransaction:
        return _NestedTransaction()

    async def flush(self) -> None:
        self.flush_attempts += 1
        if self.flush_attempts == 1:
            raise IntegrityError('duplicate key value violates unique constraint', params=None, orig=None)


class SherlockRuntimeIdempotencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_same_turn_id_reuses_existing_turn(self):
        runtime_session = SherlockAgentSessionState(
            chat_session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            app_id='kaira-bot',
            tenant_id='31f8f72f-3bd4-4af0-91af-fc87ed5ebd87',
            user_id='74c1be47-e307-4127-bf0f-a3ef5b2cf38f',
            provider='openai',
            model='gpt-5.4',
            message_state=[],
            next_event_seq=1,
        )
        db = _FakeAsyncSession()

        turn_a = await get_or_create_turn(
            runtime_session=runtime_session,
            turn_id='turn_123',
            user_message='show pass rate',
            provider='openai',
            model='gpt-5.4',
            db=db,
        )
        turn_b = await get_or_create_turn(
            runtime_session=runtime_session,
            turn_id='turn_123',
            user_message='show pass rate',
            provider='openai',
            model='gpt-5.4',
            db=db,
        )

        self.assertEqual(turn_a.id, turn_b.id)
        self.assertEqual(turn_a.status, 'queued')

    async def test_unique_conflict_reloads_existing_turn_instead_of_failing(self):
        runtime_session = SherlockAgentSessionState(
            chat_session_id='8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221',
            app_id='kaira-bot',
            tenant_id='31f8f72f-3bd4-4af0-91af-fc87ed5ebd87',
            user_id='74c1be47-e307-4127-bf0f-a3ef5b2cf38f',
            provider='openai',
            model='gpt-5.4',
            message_state=[],
            next_event_seq=1,
        )
        existing_row = SherlockConversationTurn(
            id=uuid.uuid4(),
            chat_session_id=uuid.UUID(runtime_session.chat_session_id),
            tenant_id=uuid.UUID(runtime_session.tenant_id),
            user_id=uuid.UUID(runtime_session.user_id),
            app_id='kaira-bot',
            client_turn_id='turn_123',
            provider='openai',
            model='gpt-5.4',
            user_message='show pass rate',
            status='active',
            assistant_message_id=None,
            last_event_seq=3,
            last_error=None,
        )
        db = _RaceAsyncSession(existing_row)

        turn = await get_or_create_turn(
            runtime_session=runtime_session,
            turn_id='turn_123',
            user_message='show pass rate',
            provider='openai',
            model='gpt-5.4',
            db=db,
        )

        self.assertEqual(turn.id, str(existing_row.id))
        self.assertEqual(turn.status, 'active')
        self.assertEqual(db.flush_attempts, 1)
