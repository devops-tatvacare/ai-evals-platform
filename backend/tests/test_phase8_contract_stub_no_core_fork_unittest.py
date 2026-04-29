"""Phase 8 — negative proof that Harness Core has not been forked to
support the contract-stub pack.

Plan §Phase 8 failure condition: ``if tool_name == 'stub_make_note'`` or
``if pack_id == 'contract_stub'`` in Harness Core files.
"""
from __future__ import annotations

import pathlib
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

HARNESS_CORE_FILES = [
    'backend/app/services/chat_engine/openai_agents_adapter.py',
    'backend/app/services/chat_engine/artifact.py',
    'backend/app/services/report_builder/chat_handler.py',
    'backend/app/services/report_builder/tool_definitions.py',
    'backend/app/services/chat_engine/prompt_generator.py',
]

FORBIDDEN_STRINGS = (
    'contract_stub',
    'stub_make_note',
    'stub_capabilities',
    'contract_stub.note.v1',
)

GENERIC_REGISTRY_FILES = [
    'backend/app/services/chat_engine/capability_pack.py',
    'backend/app/services/chat_engine/reason_codes.py',
]


class NoStubSpecificBranchTests(unittest.TestCase):
    def test_no_stub_specific_branch_in_harness_core(self):
        """None of the forbidden files contains any stub-specific marker."""

        for relpath in HARNESS_CORE_FILES:
            abs_path = REPO_ROOT / relpath
            self.assertTrue(abs_path.exists(), f'missing: {abs_path}')
            content = abs_path.read_text(encoding='utf-8')
            for needle in FORBIDDEN_STRINGS:
                self.assertNotIn(
                    needle, content,
                    f'Harness Core file {relpath!r} contains stub-specific '
                    f'reference {needle!r} — Phase 8 forbids pack-specific '
                    f'orchestration logic in harness files.',
                )


class NoHardcodedStubRegistryEntryTests(unittest.TestCase):
    def test_generic_registry_surfaces_do_not_hardcode_contract_stub(self):
        for relpath in GENERIC_REGISTRY_FILES:
            abs_path = REPO_ROOT / relpath
            self.assertTrue(abs_path.exists(), f'missing: {abs_path}')
            content = abs_path.read_text(encoding='utf-8')
            self.assertNotIn(
                "'contract_stub'", content,
                f'{relpath!r} still hardcodes contract_stub; new packs should '
                f'enter through generic discovery / self-registration.',
            )
            self.assertNotIn(
                '"contract_stub"', content,
                f'{relpath!r} still hardcodes contract_stub; new packs should '
                f'enter through generic discovery / self-registration.',
            )


class NoStubRuntimeStateFieldTests(unittest.TestCase):
    """Plan §Phase 8: adding a pack must not re-center runtime state."""

    def test_stub_pack_addition_does_not_add_runtime_state_field(self):
        from dataclasses import fields as dataclass_fields

        from app.services.chat_engine.openai_agents_adapter import SherlockContext

        # ``SherlockContext`` is the single harness-wide runtime container.
        # Phase 1 collapsed pack-specific fields into the generic
        # ``artifacts`` list; Phase 8 must not reintroduce a stub-specific
        # slot alongside it.
        field_names = [f.name for f in dataclass_fields(SherlockContext)]
        forbidden_substrings = ('stub', 'contract_stub', 'note_card')
        for name in field_names:
            for needle in forbidden_substrings:
                self.assertNotIn(
                    needle, name.lower(),
                    f'SherlockContext gained a stub-specific field: {name!r}',
                )

    def test_scratchpad_default_shape_has_no_stub_key(self):
        """The per-session scratchpad default dict must stay pack-agnostic."""

        # Scratchpad is built lazily in report_builder/chat_handler via
        # ``_update_scratchpad``; its default shape should not mention the
        # stub pack. We grep the source for any stub key.
        path = REPO_ROOT / 'backend/app/services/report_builder/chat_handler.py'
        content = path.read_text(encoding='utf-8')
        for needle in ('contract_stub', 'stub_make_note', 'stub_capabilities'):
            self.assertNotIn(
                needle, content,
                f'chat_handler scratchpad default references {needle!r}',
            )

    def test_runtime_db_default_json_has_no_stub_field(self):
        """The sherlock_agent_sessions default JSON stays pack-agnostic."""

        # The runtime DB default lives in the ORM model / migrations. A
        # quick grep across the backend service tree ensures no
        # stub-specific default was pinned into runtime defaults.
        runtime_files = [
            REPO_ROOT / 'backend/app/models/sherlock_runtime.py',
        ]
        for path in runtime_files:
            if not path.exists():
                continue
            content = path.read_text(encoding='utf-8')
            for needle in ('contract_stub', 'stub_make_note', 'stub_capabilities'):
                self.assertNotIn(
                    needle, content,
                    f'{path.name} contains stub-specific runtime default: {needle!r}',
                )


if __name__ == '__main__':  # pragma: no cover
    unittest.main()
