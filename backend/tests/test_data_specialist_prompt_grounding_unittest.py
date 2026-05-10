"""Phase 1A — projected schema must reach the data_specialist prompt.

Plan §Tests (Phase 1):
- projected schema appears in the rendered prompt;
- hidden-layer sentinel does NOT.

These tests render the prompt at agent-build time (without actually
constructing the Agent — we don't need the OpenAI client) and assert
on the resulting string.
"""
from __future__ import annotations

import unittest

from app.services.chat_engine.manifest import (
    _clear_manifest_cache_for_tests,
    get_manifest,
)
from app.services.chat_engine.sql_agent import (
    _allowed_tables,
    _build_schema_context,
    _column_role_hints,
    load_semantic_model,
)
from app.services.sherlock_v3.data_specialist_prompt import (
    build_data_specialist_prompt,
)
from app.services.sherlock_v3.intent_classifier import classify_intent
from app.services.sherlock_v3.manifest_projection import project_for_intent


def _render_with_grounding(app_id: str, question: str) -> str:
    """Build the data_specialist prompt the same way ``build_data_specialist`` does."""
    _clear_manifest_cache_for_tests()
    sm = load_semantic_model(app_id)
    sc = _build_schema_context(sm, None)
    at = sorted(_allowed_tables(sm))
    hints = _column_role_hints(sc, app_id=app_id)
    mf = get_manifest(app_id)
    g = project_for_intent(
        app_id=app_id,
        user_message=question,
        intent_class=classify_intent(question),
        manifest=mf,
        schema_context=sc,
        full_allowed_tables=at,
        full_role_hints=hints,
    )
    grounding_header = (
        'GROUNDING (Phase 1A — deterministic, no LLM):\n'
        f'- intent_class: {g.intent_class}\n'
        f'- allowed_layers: {", ".join(sorted(g.allowed_layers))}\n'
        f'- projected_tables: {", ".join(g.projected_tables) or "(none — fallback)"}\n'
        'The schema below has been filtered to the layers above. '
        'Pick a table from the projected list; do not invent one.'
    )
    return build_data_specialist_prompt(
        app_id=app_id,
        schema_context=g.projected_schema,
        allowed_tables=list(g.allowed_tables_hint),
        column_role_hints=list(g.projected_role_hints),
        exemplars=[],
        max_rows=200,
        grounding_header=grounding_header,
    )


class PromptShowsProjectedSchemaTests(unittest.TestCase):
    def test_aggregate_intent_prompt_names_aggregate_table(self) -> None:
        prompt = _render_with_grounding(
            'voice-rx', 'Show evaluation runs by status as a chart',
        )
        # Header announces the projected layer choice.
        self.assertIn('intent_class: aggregate', prompt)
        self.assertIn('agg_evaluation_run', prompt)

    def test_aggregate_intent_prompt_hides_transactional_table(self) -> None:
        prompt = _render_with_grounding(
            'voice-rx', 'Show evaluation runs by status as a chart',
        )
        # `evaluation_runs` is the transactional table; it must not
        # appear in the rendered "Allowed tables:" line.
        # (It can still appear inside the GROUNDING header phrase if
        # we ever add example text, so check the Allowed-tables block
        # specifically.)
        allowed_block = next(
            line for line in prompt.splitlines()
            if line.startswith('Allowed tables:')
        )
        self.assertNotIn('evaluation_runs', allowed_block)
        self.assertIn('agg_evaluation_run', allowed_block)

    def test_detail_intent_prompt_names_transactional_table(self) -> None:
        prompt = _render_with_grounding(
            'voice-rx', 'Find the most recent failed run',
        )
        self.assertIn('intent_class: detail', prompt)
        allowed_block = next(
            line for line in prompt.splitlines()
            if line.startswith('Allowed tables:')
        )
        self.assertIn('evaluation_runs', allowed_block)
        self.assertNotIn('agg_evaluation_run', allowed_block)

    def test_grounding_header_is_absent_when_no_grounding(self) -> None:
        # Legacy callers (no grounding) get the unprojected prompt
        # without the GROUNDING block — backward-compat guard.
        prompt = build_data_specialist_prompt(
            app_id='voice-rx',
            schema_context={'tables': {}, 'available_tables': []},
            allowed_tables=[],
            column_role_hints=[],
            exemplars=[],
            max_rows=200,
            grounding_header=None,
        )
        self.assertNotIn('GROUNDING', prompt)


if __name__ == '__main__':
    unittest.main()
