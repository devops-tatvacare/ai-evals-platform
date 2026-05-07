import io
import pytest
from app.services.orchestration.datasets.csv_importer import (
    CsvImportError,
    parse_csv,
)


def _csv(text):
    return io.StringIO(text)


def test_parse_with_column_strategy():
    out = parse_csv(
        _csv("phone,name\n+91111,Alice\n+91222,Bob\n"),
        id_strategy="column",
        id_column="phone",
    )
    assert out.recipient_ids == ["+91111", "+91222"]
    assert out.rows[0]["name"] == "Alice"
    assert out.schema_descriptor["columns"][0]["name"] == "phone"
    assert out.schema_descriptor["row_count"] == 2


def test_parse_with_uuid_strategy_generates_unique_ids():
    out = parse_csv(_csv("name\nAlice\nBob\n"), id_strategy="uuid", id_column=None)
    assert len(set(out.recipient_ids)) == 2


def test_duplicate_recipient_id_rejected():
    with pytest.raises(CsvImportError, match="duplicates an earlier row"):
        parse_csv(
            _csv("phone\n+91111\n+91111\n"),
            id_strategy="column",
            id_column="phone",
        )


def test_empty_recipient_id_rejected():
    with pytest.raises(CsvImportError, match="empty"):
        parse_csv(
            _csv("phone,name\n,Alice\n"),
            id_strategy="column",
            id_column="phone",
        )


def test_unknown_id_column_rejected():
    with pytest.raises(CsvImportError, match="not present in CSV header"):
        parse_csv(
            _csv("name\nAlice\n"),
            id_strategy="column",
            id_column="missing",
        )


def test_duplicate_headers_rejected():
    with pytest.raises(CsvImportError, match="duplicate column names"):
        parse_csv(_csv("a,a\n1,2\n"), id_strategy="uuid", id_column=None)


def test_row_cap_enforced():
    body = "phone\n" + "\n".join(f"+91{i:06d}" for i in range(20_001)) + "\n"
    with pytest.raises(CsvImportError, match="row cap"):
        parse_csv(_csv(body), id_strategy="column", id_column="phone")


def test_type_inference():
    out = parse_csv(
        _csv("score,active,name,when\n10,true,Alice,2026-01-01T00:00:00Z\n"
             "20,false,Bob,2026-02-01T00:00:00Z\n"),
        id_strategy="uuid", id_column=None,
    )
    by_name = {c["name"]: c["type"] for c in out.schema_descriptor["columns"]}
    assert by_name == {
        "score": "integer", "active": "boolean",
        "name": "string", "when": "datetime",
    }
