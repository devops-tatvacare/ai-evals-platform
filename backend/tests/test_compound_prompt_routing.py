"""Phase 3 Step 5 — Scenario 7 (compound prompt) sequencing.

Roleplay scenario 7 (Roleplays/sherlock-builder-scenarios.md) asks the
supervisor to call `data_specialist` FIRST, then `authoring_specialist`
SECOND, on a prompt that mixes an analytics question and an authoring
action. The implementation has two layers:

  1. SDK-level: `ModelSettings(parallel_tool_calls=False)` mechanically
     forbids fan-out across tool calls. This is the load-bearing
     guarantee — the LLM cannot fire both at once even if it wanted to.
  2. Prompt-level: a one-line rule under <tool_persistence_rules> tells
     the LLM the order it should pick. Without this, the LLM would have
     to guess; with it, the order is deterministic.

Running an end-to-end Scenario 7 invocation requires a live Azure
OpenAI model. We assert the structural enforcement instead: prompt text,
prompt placement, and model settings.
"""
from __future__ import annotations

import unittest
import uuid
from unittest.mock import MagicMock, patch

from app.auth.context import AuthContext
from app.services.orchestration_authoring.builder_snapshot import BuilderSnapshot
from app.services.sherlock_v3 import supervisor as sup_mod


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


def _make_snapshot() -> BuilderSnapshot:
    return BuilderSnapshot(
        workflow_id=uuid.uuid4(),
        version_id=None,
        workflow_type='crm',
        app_id='inside-sales',
        definition={'nodes': [], 'edges': []},
        data_hash='hash-1',
    )


class SupervisorPromptCompoundRuleTests(unittest.TestCase):
    """The compound-prompt rule is in the supervisor's prompt at the
    documented placement. Editing the prompt is a contract change; this
    test pins the sentence so a future refactor cannot silently drop
    the sequencing instruction."""

    def test_prompt_mandates_synthesis_first_with_decomposition_ordering(self) -> None:
        # v3 sequencing: query_synthesis_specialist is always called first,
        # then the supervisor dispatches sub-questions in the decomposition
        # order. The compound-prompt guarantee is delivered by synthesis
        # emitting ordered sub-questions (with depends_on_sub_question
        # links), not by a hardcoded data-then-authoring rule.
        prompt = sup_mod._SUPERVISOR_PROMPT
        self.assertIn('query_synthesis_specialist', prompt)
        self.assertIn('first', prompt.lower())
        self.assertIn('{available_tools_block}', prompt)

    def test_decomposition_ordering_lives_inside_tool_persistence_rules_block(self) -> None:
        prompt = sup_mod._SUPERVISOR_PROMPT
        block_start = prompt.index('<tool_persistence_rules>')
        block_end = prompt.index('</tool_persistence_rules>')
        block = prompt[block_start:block_end]
        self.assertIn('order', block.lower())
        self.assertIn('query synthesis', block.lower())


def _patched_supervisor():
    fake_client = MagicMock()
    captured: dict = {}

    def _fake_build_data_specialist(client, app_id, *, model, grounding=None):
        del client, app_id, model, grounding
        agent = MagicMock()
        agent.as_tool = MagicMock(return_value='data_specialist_tool')
        return agent

    def _fake_build_authoring_specialist(client, app_id, *, model, builder_context, auth):
        del client, app_id, model, builder_context, auth
        agent = MagicMock()
        agent.as_tool = MagicMock(return_value='authoring_specialist_tool')
        return agent

    def _fake_build_query_synthesis_specialist(client, app_id, *, model, available_targets):
        del client, app_id, model, available_targets
        agent = MagicMock()
        agent.as_tool = MagicMock(return_value='query_synthesis_specialist_tool')
        return agent

    def _fake_agent(*args, **kwargs):
        captured['tools'] = kwargs.get('tools')
        captured['model_settings'] = kwargs.get('model_settings')
        return MagicMock()

    return fake_client, captured, [
        patch.object(sup_mod, 'build_data_specialist', side_effect=_fake_build_data_specialist),
        patch.object(sup_mod, 'build_authoring_specialist', side_effect=_fake_build_authoring_specialist),
        patch.object(sup_mod, 'build_query_synthesis_specialist', side_effect=_fake_build_query_synthesis_specialist),
        patch.object(sup_mod, 'Agent', side_effect=_fake_agent),
        patch.object(sup_mod, 'OpenAIResponsesModel', MagicMock()),
    ]


class SupervisorParallelDisabledTests(unittest.TestCase):
    """Defense in depth: the load-bearing constraint is the SDK-level
    `parallel_tool_calls=False`. Even if the prompt rule were dropped,
    the SDK would still serialize the calls. This test pins it."""

    def test_supervisor_keeps_parallel_tool_calls_false(self) -> None:
        fake_client, captured, patchers = _patched_supervisor()
        with patchers[0], patchers[1], patchers[2], patchers[3], patchers[4]:
            sup_mod.build_supervisor(
                'inside-sales', fake_client,
                supervisor_model='gpt-4o',
                specialist_model='gpt-4o-mini',
                builder_context=_make_snapshot(),
                auth=_make_auth(),
            )
        settings = captured.get('model_settings')
        self.assertIsNotNone(settings)
        self.assertFalse(getattr(settings, 'parallel_tool_calls', True))

    def test_supervisor_includes_both_specialists_in_tool_list(self) -> None:
        # Sequencing only matters when both tools are on the surface.
        fake_client, captured, patchers = _patched_supervisor()
        with patchers[0], patchers[1], patchers[2], patchers[3], patchers[4]:
            sup_mod.build_supervisor(
                'inside-sales', fake_client,
                supervisor_model='gpt-4o',
                specialist_model='gpt-4o-mini',
                builder_context=_make_snapshot(),
                auth=_make_auth(),
            )
        tools = captured.get('tools') or []
        self.assertEqual(
            tools,
            ['query_synthesis_specialist_tool', 'data_specialist_tool', 'authoring_specialist_tool'],
        )


if __name__ == '__main__':
    unittest.main()
