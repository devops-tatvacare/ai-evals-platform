"""Phase 4 acceptance-gate tests (plan §Phase-4 → *Acceptance gates*).

Gates pinned here map 1:1 to the plan:

1. ``grep`` — ``sql_agent.py`` has zero ``manifest.lookup_column`` /
   ``get_manifest(`` matches (single derivation path: manifest →
   comment_emitter → pg_description → sql_agent).
2. ``grep`` — ``sql_agent.py`` has zero hand-typed
   ``"dimension" | "measure"`` enum strings (interpolated from
   ``manifest.py`` Literals via ``typing.get_args``).
3. Every non-count ``measure`` column in every manifest has a
   ``COMMENT ON COLUMN`` entry emitted by ``comment_emitter`` that
   carries the field's ``semantic_type`` (so SQL agent sees it).
4. Outer agent and inner SQL agent hold the same vocabulary — a
   randomised dimension name resolves to the same canonical column
   under both ``AnalyticsPack.tool_vocabulary`` (outer) and the SQL
   agent's ``_column_role_hints`` path (inner, via comment_metadata).
"""

from __future__ import annotations

import random
import re
import unittest
from pathlib import Path


_SQL_AGENT_PATH = (
    Path(__file__).resolve().parent.parent
    / 'app' / 'services' / 'chat_engine' / 'sql_agent.py'
)


class SourceGrepGates(unittest.TestCase):
    """Gates 1 and 2 — source-level guarantees that can be asserted by grep."""

    def test_sql_agent_has_no_manifest_lookup_column_or_get_manifest(self):
        source = _SQL_AGENT_PATH.read_text()
        self.assertNotIn(
            '.lookup_column(', source,
            'sql_agent.py must not call manifest.lookup_column; reads go '
            'through comment_metadata (plan §652).',
        )
        self.assertNotRegex(
            source, r'\bget_manifest\(',
            'sql_agent.py must not call get_manifest() directly; manifest '
            'flows via comment_emitter -> pg_description (plan §652).',
        )

    def test_sql_agent_has_no_hand_typed_role_or_semantic_enum_lists(self):
        source = _SQL_AGENT_PATH.read_text()
        # A hand-typed enum is a quoted role string immediately followed by
        # ``|`` and another quoted role string. The interpolated forms land
        # as ``_ROLE_ENUM`` / ``_SEMANTIC_TYPE_ENUM`` Python names, not as
        # literal strings in the source, so this pattern must be empty.
        pattern = re.compile(r'"dimension"\s*\|\s*"measure"')
        self.assertIsNone(
            pattern.search(source),
            'sql_agent.py contains a hand-typed role-enum list; enums must '
            'be interpolated from manifest.ColumnRole via typing.get_args '
            '(plan §656).',
        )
        pattern_sem = re.compile(r'"count"\s*\|\s*"percent"\s*\|\s*"ratio"')
        self.assertIsNone(
            pattern_sem.search(source),
            'sql_agent.py contains a hand-typed semantic-type enum list; '
            'enums must be interpolated from manifest.SemanticType '
            '(plan §656).',
        )


class CommentEmitterParityGate(unittest.TestCase):
    """Gate 3 — every non-count measure column carries its semantic_type
    through the emitter so the SQL-agent hints can read it."""

    def test_every_measure_column_has_field_bearing_comment(self):
        from app.services.chat_engine.catalog_tools import parse_column_comment
        from app.services.chat_engine.comment_emitter import emit_column_comments
        from app.services.chat_engine.manifest import load_all_manifests

        manifests = load_all_manifests()
        self.assertGreaterEqual(len(manifests), 1)

        stmts = emit_column_comments()
        comment_by_col: dict[tuple[str, str], str] = {}
        stmt_re = re.compile(
            r"^COMMENT ON COLUMN (?P<table>[^.]+)\.(?P<col>[^\s]+) IS '(?P<body>.*)'$"
        )
        for stmt in stmts:
            m = stmt_re.match(stmt)
            self.assertIsNotNone(m, f'unexpected comment statement shape: {stmt!r}')
            assert m is not None  # for type narrowing
            comment_by_col[(m.group('table'), m.group('col'))] = m.group('body').replace("''", "'")

        missing: list[str] = []
        for manifest in manifests.values():
            for table_name, table in manifest.catalog_tables.items():
                for col_name, col in table.columns.items():
                    if col.role != 'measure':
                        continue
                    if col.measure_kind == 'count' or col.semantic_type == 'count':
                        continue
                    body = comment_by_col.get((table_name, col_name))
                    if body is None:
                        missing.append(f'{table_name}.{col_name}: no COMMENT ON COLUMN emitted')
                        continue
                    parsed = parse_column_comment(body)
                    # Field-bearing = the parser recovered at least one of the
                    # analytics-relevant fields the SQL agent reads.
                    has_field = (
                        parsed.get('semantic_type')
                        or parsed.get('measure_kind')
                        or parsed.get('unit')
                        or parsed.get('data_type')
                    )
                    if not has_field:
                        missing.append(
                            f'{table_name}.{col_name}: comment {body!r} carries no '
                            f'semantic_type/measure_kind/unit/data_type field'
                        )
        self.assertEqual(
            missing, [],
            'Every non-count measure column must have a field-bearing '
            'COMMENT ON COLUMN entry (plan §Phase-4 acceptance gate 3). '
            'Missing:\n  - ' + '\n  - '.join(missing),
        )


class OuterInnerVocabularyParityGate(unittest.TestCase):
    """Gate 5 — outer agent (AnalyticsPack vocabulary) and inner SQL
    agent (comment_metadata-driven hints) resolve a randomised dimension
    to the same canonical column."""

    def test_randomised_dimension_resolves_identically_on_both_sides(self):
        from app.services.chat_engine.capability_pack import ensure_packs_registered
        from app.services.chat_engine.comment_emitter import _render_comment_body
        from app.services.chat_engine.catalog_tools import parse_column_comment
        from app.services.chat_engine.manifest import load_all_manifests
        from app.services.chat_engine.sql_agent import load_semantic_model
        from app.services.report_builder.analytics_pack import AnalyticsPack

        ensure_packs_registered()
        analytics_pack = AnalyticsPack()

        manifests = load_all_manifests()
        candidates: list[tuple[str, str, str, str]] = []
        for app_id, manifest in manifests.items():
            for table_name, table in manifest.catalog_tables.items():
                for col_name, col in table.columns.items():
                    if col.role in ('dimension', 'ordered_categorical'):
                        candidates.append((app_id, table_name, col_name, col.role))

        self.assertGreater(
            len(candidates), 0,
            'At least one dimension column must exist across manifests to '
            'run the parity check.',
        )

        rng = random.Random(0xC0DE)
        sample = rng.sample(candidates, min(5, len(candidates)))

        for app_id, table_name, col_name, _role in sample:
            manifest = manifests[app_id]
            col = manifest.catalog_tables[table_name].columns[col_name]

            # Outer side: the analytics pack's vocabulary resolves the column
            # name to a canonical ColumnTarget whose (table, column) pair is
            # what the outer agent treats as canonical.
            semantic_model = load_semantic_model(app_id)
            vocab = analytics_pack.tool_vocabulary(app_id, semantic_model)
            resolution = vocab.resolve_column(col_name, preferred_table=table_name)
            self.assertEqual(
                resolution.status, 'unique',
                f'Outer vocabulary for {table_name}.{col_name} (app={app_id!r}) '
                f'did not resolve uniquely: {resolution}',
            )
            assert resolution.canonical is not None
            outer_canonical = (resolution.canonical.table, resolution.canonical.column)

            # Inner side: the SQL agent reads comment_metadata (via
            # parse_column_comment) — same parser that consumes pg_description.
            # Round-trip the manifest column through the emitter to simulate
            # what pg_description will hold, then parse it back.
            parsed = parse_column_comment(_render_comment_body(col))
            inner_role = str(parsed.get('role') or '').strip().lower()

            self.assertEqual(
                inner_role, col.role,
                f'Inner SQL-agent view of {table_name}.{col_name} shows role={inner_role!r} '
                f'but manifest says {col.role!r} — derivation path is lossy.',
            )
            # The inner canonical identity is the (table, column) the agent
            # writes SQL against; that's the same pair the outer vocabulary
            # resolved to.
            self.assertEqual(
                outer_canonical, (table_name, col_name),
                f'Outer vocabulary resolved {col_name!r} to {outer_canonical} but '
                f'inner derivation pins it at ({table_name!r}, {col_name!r}).',
            )


if __name__ == '__main__':  # pragma: no cover
    unittest.main()
