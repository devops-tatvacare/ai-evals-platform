"""Phase 1.3/1.4 — every app manifest populates the chart-contract taxonomy.

Per plan audit-knot #5, identifier coverage checks target columns that actually
live in `catalog_tables`. `evaluation_runs` / `evaluation_run_thread_results` /
`evaluation_run_adversarial_results` are `data_surfaces`, not catalog tables, so
they're deliberately excluded from the catalog-identifier assertion below.
"""
from __future__ import annotations

from app.services.chat_engine.manifest import get_manifest


def _missing_semantic_type(app_id: str) -> list[str]:
    m = get_manifest(app_id)
    return [
        f"{t}.{c}"
        for t, tbl in m.catalog_tables.items()
        for c, col in tbl.columns.items()
        if col.role == "measure" and col.semantic_type is None
    ]


def _missing_data_type(app_id: str, roles: tuple[str, ...]) -> list[str]:
    m = get_manifest(app_id)
    return [
        f"{t}.{c}"
        for t, tbl in m.catalog_tables.items()
        for c, col in tbl.columns.items()
        if col.role in roles and col.data_type is None
    ]


def test_kaira_bot_every_measure_has_semantic_type() -> None:
    missing = _missing_semantic_type("kaira-bot")
    assert missing == [], f"kaira-bot measures without semantic_type: {missing}"


def test_kaira_bot_every_dimension_has_data_type() -> None:
    missing = _missing_data_type("kaira-bot", ("dimension", "ordered_categorical"))
    assert missing == [], f"kaira-bot dimensions without data_type: {missing}"


def test_kaira_bot_catalog_identifiers_declared() -> None:
    """Known identifier columns in catalog tables must be role=identifier."""
    m = get_manifest("kaira-bot")
    known_catalog_ids = {
        ("agg_evaluation_run", "id"),
        ("agg_evaluation_run", "run_id"),
        ("fact_evaluation", "id"),
        ("fact_evaluation", "run_id"),
        ("fact_evaluation", "item_id"),
        ("fact_evaluation_criterion", "id"),
        ("fact_evaluation_criterion", "run_id"),
        ("fact_evaluation_criterion", "item_id"),
        ("fact_evaluation_criterion", "criterion_id"),
    }
    bad: list[str] = []
    for table_name, col_name in known_catalog_ids:
        col = m.catalog_tables[table_name].columns.get(col_name)
        if col is None:
            bad.append(f"{table_name}.{col_name}: missing from manifest")
            continue
        if col.role != "identifier":
            bad.append(
                f"{table_name}.{col_name}: expected role=identifier, got {col.role}"
            )
    assert bad == [], "\n".join(bad)


def test_voice_rx_measures_have_semantic_type() -> None:
    missing = _missing_semantic_type("voice-rx")
    assert missing == [], f"voice-rx measures without semantic_type: {missing}"


def test_voice_rx_dimensions_have_data_type() -> None:
    missing = _missing_data_type("voice-rx", ("dimension", "ordered_categorical"))
    assert missing == [], f"voice-rx dimensions without data_type: {missing}"


def test_inside_sales_measures_have_semantic_type() -> None:
    missing = _missing_semantic_type("inside-sales")
    assert missing == [], f"inside-sales measures without semantic_type: {missing}"


def test_inside_sales_dimensions_have_data_type() -> None:
    missing = _missing_data_type("inside-sales", ("dimension", "ordered_categorical"))
    assert missing == [], f"inside-sales dimensions without data_type: {missing}"
