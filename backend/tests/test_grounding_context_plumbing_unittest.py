"""Phase 1A — runtime computes grounding from user_message + manifest
and passes it explicitly through ``build_supervisor`` →
``build_data_specialist``, with NO ``ctx.scratch`` side-channel.

Plan §1.2: do not rely on ``SherlockTurnContext.scratch['user_message']``;
projection runs in pure Python before the agent is constructed.

These tests assert the wiring without spinning up an actual Agents-SDK
runner — we patch ``build_supervisor`` and inspect the kwargs.
"""
from __future__ import annotations

import inspect
import unittest
import uuid
from unittest.mock import AsyncMock, patch

from app.services.sherlock_v3 import data_specialist as ds_mod
from app.services.sherlock_v3 import runtime as runtime_mod
from app.services.sherlock_v3.runtime import SherlockTurnContext, run_turn


def _make_ctx() -> SherlockTurnContext:
    return SherlockTurnContext(
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        app_id='voice-rx',
        chat_session_id=uuid.uuid4(),
        turn_id=uuid.uuid4(),
        previous_response_id=None,
    )


class GroundingPlumbingTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_turn_passes_grounding_kwarg_to_build_supervisor(self) -> None:
        ctx = _make_ctx()
        captured: dict = {}

        async def _fake_stream(*_args, **_kwargs):
            yield {'type': 'turn_finished', 'status': 'done'}

        def _fake_build_supervisor(app_id, client, *, grounding=None):
            captured['app_id'] = app_id
            captured['grounding'] = grounding
            return object()  # any sentinel; _stream_once is patched

        with patch.object(runtime_mod, 'get_sherlock_azure_client', new=AsyncMock()), \
             patch.object(runtime_mod, 'build_supervisor', side_effect=_fake_build_supervisor), \
             patch.object(runtime_mod, '_stream_once', new=_fake_stream):
            async for _ in run_turn('Pass rate trend by week', ctx):
                pass

        self.assertEqual(captured['app_id'], 'voice-rx')
        grounding = captured['grounding']
        self.assertIsNotNone(grounding, 'grounding kwarg must be supplied')
        # The user_message must reach the GroundingContext literally —
        # no truncation, no fallback to chart_title.
        self.assertEqual(grounding.user_message, 'Pass rate trend by week')
        self.assertEqual(grounding.intent_class, 'aggregate')

    async def test_run_turn_does_not_write_user_message_to_scratch(self) -> None:
        ctx = _make_ctx()

        async def _fake_stream(*_args, **_kwargs):
            yield {'type': 'turn_finished', 'status': 'done'}

        with patch.object(runtime_mod, 'get_sherlock_azure_client', new=AsyncMock()), \
             patch.object(runtime_mod, 'build_supervisor', return_value=object()), \
             patch.object(runtime_mod, '_stream_once', new=_fake_stream):
            async for _ in run_turn('Top agents by evaluation count', ctx):
                pass

        # Scratch must not be used as a user_message side channel.
        self.assertNotIn('user_message', ctx.scratch)


class NoScratchUserMessageReadTests(unittest.TestCase):
    """Source-level guard: nothing in sherlock_v3 reads
    ``scratch['user_message']`` (or its bytes equivalent) ever again."""

    def test_data_specialist_module_does_not_read_scratch_user_message(self) -> None:
        src = inspect.getsource(ds_mod)
        for needle in (
            "scratch['user_message']",
            'scratch["user_message"]',
            "scratch.get('user_message'",
            'scratch.get("user_message"',
        ):
            self.assertNotIn(
                needle, src,
                msg=f'data_specialist still reads {needle!r} — '
                    'remove the side channel and read from grounding instead.',
            )

    def test_runtime_module_does_not_read_scratch_user_message(self) -> None:
        src = inspect.getsource(runtime_mod)
        for needle in (
            "scratch['user_message']",
            'scratch["user_message"]',
            "scratch.get('user_message'",
            'scratch.get("user_message"',
        ):
            self.assertNotIn(needle, src)


class BuildSupervisorAcceptsGroundingTests(unittest.TestCase):
    def test_build_supervisor_signature_has_grounding_kwarg(self) -> None:
        from app.services.sherlock_v3.supervisor import build_supervisor
        sig = inspect.signature(build_supervisor)
        self.assertIn('grounding', sig.parameters)
        # Keyword-only; default None for back-compat.
        param = sig.parameters['grounding']
        self.assertEqual(param.kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertIsNone(param.default)

    def test_build_data_specialist_signature_has_grounding_kwarg(self) -> None:
        from app.services.sherlock_v3.data_specialist import build_data_specialist
        sig = inspect.signature(build_data_specialist)
        self.assertIn('grounding', sig.parameters)
        param = sig.parameters['grounding']
        self.assertEqual(param.kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertIsNone(param.default)


if __name__ == '__main__':
    unittest.main()
