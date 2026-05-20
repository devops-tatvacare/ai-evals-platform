import pytest

from app.services.orchestration.datasets.format_registry import (
    FormatNotSupportedError,
    all_handlers,
    resolve,
)


def test_registry_lists_csv_and_xlsx():
    source_types = {h.source_type for h in all_handlers()}
    assert {"csv", "xlsx"}.issubset(source_types)


def test_resolve_by_csv_extension():
    handler = resolve(filename="leads.csv", content_type=None)
    assert handler.source_type == "csv"


def test_resolve_by_csv_mime():
    handler = resolve(filename=None, content_type="text/csv")
    assert handler.source_type == "csv"


def test_resolve_by_xlsx_extension():
    handler = resolve(filename="leads.xlsx", content_type=None)
    assert handler.source_type == "xlsx"


def test_resolve_by_xlsx_mime():
    handler = resolve(
        filename=None,
        content_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
    )
    assert handler.source_type == "xlsx"


def test_resolve_extension_wins_over_unknown_mime():
    handler = resolve(filename="leads.xlsx", content_type="application/octet-stream")
    assert handler.source_type == "xlsx"


def test_resolve_unknown_format_raises():
    with pytest.raises(FormatNotSupportedError, match="not supported"):
        resolve(filename="leads.pdf", content_type="application/pdf")


def test_resolve_no_signal_raises():
    with pytest.raises(FormatNotSupportedError):
        resolve(filename=None, content_type=None)
