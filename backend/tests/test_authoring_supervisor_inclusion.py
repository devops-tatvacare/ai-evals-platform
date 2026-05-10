"""Phase 1 Step 7 — supervisor conditionally includes authoring_specialist.

R2 (decision §R2): the authoring sub-agent is NOT constructed when:
  - builder_context is None, OR
  - 'orchestration:manage' is not in auth.permissions.

The LLM cannot call a tool that doesn't exist; permission gating happens
before any token sampling.
"""
from __future__ import annotations

import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.auth.context import AuthContext
from app.services.orchestration_authoring.builder_snapshot import BuilderSnapshot


def _make_auth(*, with_perm: bool = True) -> AuthContext:
    return AuthContext(
        user_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        email='t@t',
        role_id=uuid.uuid4(),
        is_owner=False,
        permissions=frozenset({'orchestration:manage'} if with_perm else set()),
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


def _patched_supervisor():
    """Patch every external dep so build_supervisor runs without Azure
    or registries; capture what tools land on the resulting Agent."""
    from app.services.sherlock_v3 import supervisor as sup_mod

    fake_client = MagicMock()
    captured: dict = {}

    def _fake_build_data_specialist(client, app_id, *, grounding=None):
        del client, app_id, grounding
        agent = MagicMock()
        agent.as_tool = MagicMock(return_value='data_specialist_tool')
        return agent

    def _fake_build_authoring_specialist(client, app_id, *, builder_context, auth):
        captured['authoring_built_with'] = (app_id, builder_context, auth)
        agent = MagicMock()
        agent.as_tool = MagicMock(return_value='authoring_specialist_tool')
        return agent

    def _fake_agent(*args, **kwargs):
        captured['tools'] = kwargs.get('tools')
        return MagicMock()

    return sup_mod, fake_client, captured, [
        patch.object(sup_mod, 'build_data_specialist', side_effect=_fake_build_data_specialist),
        patch.object(sup_mod, 'build_authoring_specialist', side_effect=_fake_build_authoring_specialist),
        patch.object(sup_mod, 'Agent', side_effect=_fake_agent),
        patch.object(sup_mod, 'OpenAIResponsesModel', MagicMock()),
    ]


class SupervisorAuthoringInclusionTests(unittest.TestCase):
    def test_excludes_authoring_when_builder_context_none(self) -> None:
        sup_mod, fake_client, captured, patchers = _patched_supervisor()
        with patchers[0], patchers[1], patchers[2], patchers[3]:
            sup_mod.build_supervisor(
                'inside-sales', fake_client,
                builder_context=None,
                auth=_make_auth(with_perm=True),
            )
        tools = captured.get('tools') or []
        self.assertEqual(tools, ['data_specialist_tool'])
        self.assertNotIn('authoring_built_with', captured)

    def test_excludes_authoring_when_permission_missing(self) -> None:
        sup_mod, fake_client, captured, patchers = _patched_supervisor()
        with patchers[0], patchers[1], patchers[2], patchers[3]:
            sup_mod.build_supervisor(
                'inside-sales', fake_client,
                builder_context=_make_snapshot(),
                auth=_make_auth(with_perm=False),
            )
        tools = captured.get('tools') or []
        self.assertEqual(tools, ['data_specialist_tool'])
        self.assertNotIn('authoring_built_with', captured)

    def test_excludes_authoring_when_auth_is_none(self) -> None:
        sup_mod, fake_client, captured, patchers = _patched_supervisor()
        with patchers[0], patchers[1], patchers[2], patchers[3]:
            sup_mod.build_supervisor(
                'inside-sales', fake_client,
                builder_context=_make_snapshot(),
                auth=None,
            )
        tools = captured.get('tools') or []
        self.assertEqual(tools, ['data_specialist_tool'])
        self.assertNotIn('authoring_built_with', captured)

    def test_includes_authoring_when_both_present(self) -> None:
        sup_mod, fake_client, captured, patchers = _patched_supervisor()
        with patchers[0], patchers[1], patchers[2], patchers[3]:
            sup_mod.build_supervisor(
                'inside-sales', fake_client,
                builder_context=_make_snapshot(),
                auth=_make_auth(with_perm=True),
            )
        tools = captured.get('tools') or []
        self.assertEqual(tools, ['data_specialist_tool', 'authoring_specialist_tool'])
        self.assertIn('authoring_built_with', captured)


if __name__ == '__main__':
    unittest.main()
