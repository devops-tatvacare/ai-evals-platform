"""PR5: the evaluate-inside-sales runner reads ONLY from source-backed records.

Structural test — the runner must not import the legacy LSQ-reading
functions from `inside_sales_dataset_resolver`. Functional correctness of
the source resolver is covered elsewhere.
"""

from __future__ import annotations

import inspect


def test_runner_uses_source_resolver_not_legacy_lsq_fetch():
    import app.services.evaluators.inside_sales_runner as runner

    source = inspect.getsource(runner)
    # The runner aliases `resolve_call_selection_from_source` as
    # `resolve_call_selection` for back-compat — accept either name.
    assert (
        "inside_sales_source_resolver" in source
    ), "Runner should source its selection from the source resolver"
    assert (
        "resolve_call_selection_from_source" in source
    ), "Runner must import the source-backed resolver entry point"
    # The legacy LSQ-bound resolver must not be invoked at runtime.
    assert (
        "from app.services.inside_sales_dataset_resolver import" in source
    ), "Runner can still use dataclasses from the dataset resolver module"
    # BUT must not import the legacy `resolve_call_selection` (LSQ) function.
    assert (
        "import (\n    InsideSalesCallFilters,\n    resolve_call_selection,\n)" not in source
    ), "Runner must not import the legacy LSQ-fetching resolve_call_selection"


def test_source_resolver_exposes_expected_entrypoints():
    from app.services import inside_sales_source_resolver as mod

    assert hasattr(mod, "resolve_call_selection_from_source")
    assert hasattr(mod, "resolve_call_dataset_page_from_source")
    assert hasattr(mod, "resolve_lead_dataset_page_from_source")


def test_source_resolver_does_not_import_lsq_client_modules():
    import app.services.inside_sales_source_resolver as mod

    source = inspect.getsource(mod)
    # The source resolver must not call LSQ at all.
    assert "lsq_client" not in source
    assert "fetch_call_activities" not in source
    assert "fetch_leads" not in source
