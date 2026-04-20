"""Phase 2.3 — AppManifest.lookup_column('table.col') helper."""
from __future__ import annotations

from app.services.chat_engine.manifest import get_manifest


def test_lookup_column_with_qualified_name() -> None:
    m = get_manifest("kaira-bot")
    col = m.lookup_column("analytics_run_facts.pass_rate")
    assert col is not None
    assert col.role == "measure"
    assert col.semantic_type == "percent"


def test_lookup_column_identifier_column() -> None:
    m = get_manifest("kaira-bot")
    col = m.lookup_column("analytics_run_facts.run_id")
    assert col is not None
    assert col.role == "identifier"
    assert col.semantic_type == "id_hash"


def test_lookup_column_unknown_returns_none() -> None:
    m = get_manifest("kaira-bot")
    assert m.lookup_column("does_not_exist.column") is None


def test_lookup_column_unqualified_returns_none() -> None:
    m = get_manifest("kaira-bot")
    assert m.lookup_column("unqualified_name") is None


def test_lookup_column_missing_column_on_real_table_returns_none() -> None:
    m = get_manifest("kaira-bot")
    assert m.lookup_column("analytics_run_facts.ghost_column") is None
