"""Phase 3 Step 8 — canvas-too-large early refusal in authoring_specialist.

A 200-node fixture must NOT trigger an LLM round-trip. Instead,
`build_authoring_specialist` raises `CanvasTooLargeError` carrying the
documented reason_code + summary; the supervisor catches and skips
inclusion of the authoring tool for the turn.

Per the design doc's "risks still open": "token-budget cliff at
~150–200 nodes." 150 is the hard cap until the `describe_workflow`
tool ships in v2.
"""
from __future__ import annotations

import unittest
import uuid
from unittest.mock import MagicMock, patch

from app.auth.context import AuthContext
from app.services.orchestration_authoring.builder_snapshot import BuilderSnapshot
from app.services.sherlock_v3 import supervisor as sup_mod
from app.services.sherlock_v3.authoring_specialist import (
    CANVAS_NODE_LIMIT,
    CANVAS_TOO_LARGE_SUMMARY,
    CanvasTooLargeError,
    build_authoring_specialist,
)


def _snapshot_with_n_nodes(n: int) -> BuilderSnapshot:
    return BuilderSnapshot(
        workflow_id=uuid.uuid4(),
        version_id=None,
        workflow_type='crm',
        app_id='inside-sales',
        definition={
            'nodes': [
                {
                    'id': f'n_{i}',
                    'type': 'sink.complete',
                    'position': {'x': 0, 'y': 0},
                    'data': {},
                    'config': {},
                }
                for i in range(n)
            ],
            'edges': [],
        },
        data_hash=f'hash-{n}',
        selected_node_id=None,
        view_mode='edit',
    )


def _make_auth() -> AuthContext:
    return AuthContext(
        user_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        email='t@t',
        role_id=uuid.uuid4(),
        is_owner=False,
        permissions=frozenset({'orchestration:manage'}),
        app_access=frozenset({'inside-sales'}),
    )


class CanvasTooLargeBuildTests(unittest.TestCase):
    def test_two_hundred_nodes_raises_canvas_too_large(self) -> None:
        snap = _snapshot_with_n_nodes(200)
        client = MagicMock()
        with self.assertRaises(CanvasTooLargeError) as cm:
            build_authoring_specialist(
                client, 'inside-sales',
                builder_context=snap,
                auth=_make_auth(),
            )
        self.assertEqual(cm.exception.reason_code, 'CANVAS_TOO_LARGE')
        self.assertEqual(cm.exception.summary, CANVAS_TOO_LARGE_SUMMARY)
        self.assertEqual(cm.exception.node_count, 200)

    def test_no_llm_round_trip_for_too_large_canvas(self) -> None:
        """The mock client must NOT have any methods invoked — that
        would mean we tried to call the LLM. The refusal happens at
        build time, synchronously, no I/O at all."""
        snap = _snapshot_with_n_nodes(200)
        client = MagicMock()
        with self.assertRaises(CanvasTooLargeError):
            build_authoring_specialist(
                client, 'inside-sales',
                builder_context=snap,
                auth=_make_auth(),
            )
        # Zero attribute reads, zero method calls — usage telemetry
        # would record zero tokens for the (non-)turn.
        self.assertEqual(client.method_calls, [])

    def test_at_cap_still_builds(self) -> None:
        """The cap is `> 150`, so exactly 150 nodes still goes through."""
        snap = _snapshot_with_n_nodes(CANVAS_NODE_LIMIT)
        # Patch every external dep so the build doesn't touch Azure
        # or registries.
        from app.services.sherlock_v3 import authoring_specialist as as_mod
        with patch.object(as_mod, 'OpenAIResponsesModel', MagicMock()), \
             patch.object(as_mod, 'Agent', MagicMock(return_value='ok-agent')), \
             patch.object(as_mod, 'specialist_model', MagicMock(return_value='m')):
            agent = build_authoring_specialist(
                MagicMock(), 'inside-sales',
                builder_context=snap,
                auth=_make_auth(),
            )
        self.assertEqual(agent, 'ok-agent')

    def test_just_above_cap_raises(self) -> None:
        snap = _snapshot_with_n_nodes(CANVAS_NODE_LIMIT + 1)
        with self.assertRaises(CanvasTooLargeError):
            build_authoring_specialist(
                MagicMock(), 'inside-sales',
                builder_context=snap,
                auth=_make_auth(),
            )

    def test_empty_canvas_builds_normally(self) -> None:
        snap = _snapshot_with_n_nodes(0)
        from app.services.sherlock_v3 import authoring_specialist as as_mod
        with patch.object(as_mod, 'OpenAIResponsesModel', MagicMock()), \
             patch.object(as_mod, 'Agent', MagicMock(return_value='ok-agent')), \
             patch.object(as_mod, 'specialist_model', MagicMock(return_value='m')):
            agent = build_authoring_specialist(
                MagicMock(), 'inside-sales',
                builder_context=snap,
                auth=_make_auth(),
            )
        self.assertEqual(agent, 'ok-agent')


def _patched_supervisor_canvas_too_large():
    """Like _patched_supervisor in test_authoring_supervisor_inclusion,
    but `build_authoring_specialist` raises CanvasTooLargeError."""
    fake_client = MagicMock()
    captured: dict = {}

    def _fake_build_data_specialist(client, app_id, *, grounding=None):
        del client, app_id, grounding
        agent = MagicMock()
        agent.as_tool = MagicMock(return_value='data_specialist_tool')
        return agent

    def _fake_build_authoring_specialist(client, app_id, *, builder_context, auth):
        del client, app_id, builder_context, auth
        raise CanvasTooLargeError(
            reason_code='CANVAS_TOO_LARGE',
            summary=CANVAS_TOO_LARGE_SUMMARY,
            node_count=200,
        )

    def _fake_agent(*args, **kwargs):
        captured['tools'] = kwargs.get('tools')
        return MagicMock()

    return fake_client, captured, [
        patch.object(sup_mod, 'build_data_specialist', side_effect=_fake_build_data_specialist),
        patch.object(sup_mod, 'build_authoring_specialist', side_effect=_fake_build_authoring_specialist),
        patch.object(sup_mod, 'Agent', side_effect=_fake_agent),
        patch.object(sup_mod, 'OpenAIResponsesModel', MagicMock()),
    ]


class SupervisorSkipsAuthoringWhenCanvasTooLarge(unittest.TestCase):
    def test_supervisor_skips_authoring_tool_inclusion(self) -> None:
        fake_client, captured, patchers = _patched_supervisor_canvas_too_large()
        with patchers[0], patchers[1], patchers[2], patchers[3]:
            sup_mod.build_supervisor(
                'inside-sales', fake_client,
                builder_context=_snapshot_with_n_nodes(200),
                auth=_make_auth(),
            )
        tools = captured.get('tools') or []
        # Only data_specialist remains; authoring_specialist was refused.
        self.assertEqual(tools, ['data_specialist_tool'])


if __name__ == '__main__':
    unittest.main()
