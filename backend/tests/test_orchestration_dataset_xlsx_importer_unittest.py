import io

import pytest
from openpyxl import Workbook

from app.services.orchestration.datasets.dataset_validator import DatasetImportError
from app.services.orchestration.datasets.xlsx_importer import parse_xlsx


def _xlsx_bytes(rows: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_with_column_strategy():
    raw = _xlsx_bytes([
        ["phone", "name"],
        ["+91111", "Alice"],
        ["+91222", "Bob"],
    ])
    out = parse_xlsx(raw, id_strategy="column", id_column="phone")
    assert out.recipient_ids == ["+91111", "+91222"]
    assert out.rows[0]["name"] == "Alice"
    assert out.schema_descriptor["columns"][0]["name"] == "phone"
    assert out.schema_descriptor["row_count"] == 2


def test_parse_with_uuid_strategy():
    raw = _xlsx_bytes([["name"], ["Alice"], ["Bob"]])
    out = parse_xlsx(raw, id_strategy="uuid", id_column=None)
    assert len(set(out.recipient_ids)) == 2


def test_duplicate_id_rejected():
    raw = _xlsx_bytes([["phone"], ["+91111"], ["+91111"]])
    with pytest.raises(DatasetImportError, match="duplicates an earlier row"):
        parse_xlsx(raw, id_strategy="column", id_column="phone")


def test_unknown_id_column_rejected():
    raw = _xlsx_bytes([["name"], ["Alice"]])
    with pytest.raises(DatasetImportError, match="not present in file header"):
        parse_xlsx(raw, id_strategy="column", id_column="missing")


def test_blank_header_cell_rejected():
    raw = _xlsx_bytes([["phone", None], ["+91111", "x"]])
    with pytest.raises(DatasetImportError, match="header"):
        parse_xlsx(raw, id_strategy="uuid", id_column=None)


def test_numeric_cell_stringified():
    raw = _xlsx_bytes([["phone", "score"], ["+91111", 10]])
    out = parse_xlsx(raw, id_strategy="column", id_column="phone")
    assert out.rows[0]["score"] == "10"


def test_corrupt_file_rejected():
    with pytest.raises(DatasetImportError, match="not a valid"):
        parse_xlsx(b"not-an-xlsx", id_strategy="uuid", id_column=None)
