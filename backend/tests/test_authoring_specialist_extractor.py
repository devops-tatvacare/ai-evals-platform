"""Phase 1 Step 6 — extract_authoring_specialist_output strict matching."""
from __future__ import annotations

import json
import unittest
from types import SimpleNamespace

from app.services.sherlock_v3.authoring_specialist import (
    extract_authoring_specialist_output,
)


def _tool_output(name: str, output: str) -> SimpleNamespace:
    return SimpleNamespace(
        type='tool_call_output_item',
        raw_item={'name': name},
        output=output,
    )


class AuthoringSpecialistExtractorTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_apply_patch_output_when_present(self) -> None:
        run_result = SimpleNamespace(
            new_items=[
                _tool_output('list_node_types', '{"items": []}'),
                _tool_output('apply_patch', json.dumps({
                    'kind': 'action', 'status': 'ok',
                    'summary': 'patched', 'artifacts': [], 'evidence': [],
                    'state_delta': {}, 'meta': {},
                })),
            ],
            final_output='ignored prose',
        )
        result = await extract_authoring_specialist_output(run_result)
        decoded = json.loads(result)
        self.assertEqual(decoded['summary'], 'patched')

    async def test_returns_most_recent_apply_patch_when_multiple(self) -> None:
        run_result = SimpleNamespace(
            new_items=[
                _tool_output('apply_patch', '{"summary": "first"}'),
                _tool_output('apply_patch', '{"summary": "second"}'),
            ],
            final_output='',
        )
        result = await extract_authoring_specialist_output(run_result)
        self.assertIn('second', result)

    async def test_falls_back_to_final_output_when_no_apply_patch(self) -> None:
        # Clarifying-question turn: only a list_* lookup, no apply_patch.
        # Strict matcher MUST NOT pick the lookup output.
        run_result = SimpleNamespace(
            new_items=[
                _tool_output('list_provider_connections', '{"items": []}'),
            ],
            final_output='Which app should this connect to?',
        )
        result = await extract_authoring_specialist_output(run_result)
        self.assertEqual(result, 'Which app should this connect to?')

    async def test_returns_empty_string_when_no_items_no_final(self) -> None:
        run_result = SimpleNamespace(new_items=[], final_output=None)
        result = await extract_authoring_specialist_output(run_result)
        self.assertEqual(result, '')


class BuildAuthoringSpecialistImportTests(unittest.TestCase):
    def test_module_imports_without_side_effects(self) -> None:
        # Build path imports the pack, which auto-registers; the import
        # alone should not raise even with no DB available.
        from app.services.sherlock_v3 import authoring_specialist  # noqa: F401
        self.assertTrue(hasattr(authoring_specialist, 'build_authoring_specialist'))


if __name__ == '__main__':
    unittest.main()
