"""PartEmitter must only publish the two SSE event kinds the FE contracts on.

If a future edit introduces a third event kind (or renames one) the
chat-widget switch will fall through silently and nothing in unit tests
will scream. This test pins the wire vocabulary at the producer.
"""
from __future__ import annotations

import re
import unittest
import uuid
from pathlib import Path
from typing import Any

from app.services.sherlock_v3.contracts import (
    AssistantTextPart,
    new_part_id,
)
from app.services.sherlock_v3.emitter import PartEmitter


EMITTER_PATH = Path(__file__).resolve().parents[1] / 'app' / 'services' / 'sherlock_v3' / 'emitter.py'

ALLOWED_KINDS = {'part_added', 'part_updated'}


class PartEmitterWireShapeTests(unittest.IsolatedAsyncioTestCase):
    def test_emitter_source_publishes_only_part_added_and_part_updated(self) -> None:
        source = EMITTER_PATH.read_text(encoding='utf-8')
        kinds_in_source = set(re.findall(r"['\"]kind['\"]\s*:\s*['\"]([a-zA-Z_]+)['\"]", source))
        self.assertTrue(
            kinds_in_source,
            f'Expected at least one `kind: \"...\"` literal in {EMITTER_PATH}',
        )
        leaked = kinds_in_source - ALLOWED_KINDS
        self.assertEqual(
            set(), leaked,
            f'PartEmitter source publishes disallowed kind(s) {leaked}; '
            f'the FE only knows about {sorted(ALLOWED_KINDS)}. Add the new '
            f'kind to the FE contract first, or use part_updated.',
        )
        missing = ALLOWED_KINDS - kinds_in_source
        self.assertEqual(
            set(), missing,
            f'Expected both {sorted(ALLOWED_KINDS)} to appear in the emitter '
            f'source; missing: {sorted(missing)}. The wire vocabulary regressed.',
        )

    async def test_emit_and_update_publish_with_allowed_kinds_at_runtime(self) -> None:
        captured: list[tuple[str, dict[str, Any]]] = []

        async def _publish(turn_id: str, payload: dict[str, Any]) -> None:
            captured.append((turn_id, payload))

        emitter = _build_emitter_with_fake_db(publish=_publish)
        part = AssistantTextPart(
            id=new_part_id(),
            chat_session_id='',
            seq=0,
            created_at=0,
            text='hello',
        )

        emitted = await emitter.emit(part)
        await emitter.update(emitted.model_copy(update={'text': 'hello world', 'final': True}))

        observed_kinds = {payload['kind'] for _, payload in captured}
        self.assertEqual(
            observed_kinds, ALLOWED_KINDS,
            f'Runtime publish leaked kind(s) {observed_kinds - ALLOWED_KINDS} '
            f'or skipped one of {ALLOWED_KINDS - observed_kinds}',
        )


def _build_emitter_with_fake_db(*, publish) -> PartEmitter:
    class _FakeResult:
        def scalar_one(self) -> int:
            _FakeDb.counter += 1
            return _FakeDb.counter - 1

    class _FakeDb:
        counter = 0

        async def execute(self, *_a, **_kw) -> _FakeResult:
            return _FakeResult()

        async def flush(self) -> None:
            return None

        def add(self, _row) -> None:
            return None

    return PartEmitter(
        db=_FakeDb(),  # type: ignore[arg-type]
        chat_session_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        app_id='inside-sales',
        turn_id=str(uuid.uuid4()),
        publish=publish,
    )


if __name__ == '__main__':
    unittest.main()
