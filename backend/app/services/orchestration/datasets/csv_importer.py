"""Pure CSV → (rows, schema_descriptor) parser. No DB, no IO outside the file handle.

Used by ``services/orchestration/api/datasets.py`` during dataset version import.
"""
from __future__ import annotations

import csv
import io
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Optional

MAX_ROWS = 20_000
SAMPLE_LIMIT = 50  # rows used for type inference
COLUMN_TYPES = ("integer", "number", "boolean", "datetime", "string")


class CsvImportError(ValueError):
    """Raised on any structural problem the user can fix."""


@dataclass(frozen=True)
class ImportedDataset:
    rows: list[dict]              # parsed payloads (text values coerced where possible)
    recipient_ids: list[str]      # 1:1 with rows
    schema_descriptor: dict       # {columns: [{name, type, sample_values, distinct_count}], row_count}


def parse_csv(
    fh: io.TextIOBase,
    *,
    id_strategy: str,
    id_column: Optional[str],
) -> ImportedDataset:
    if id_strategy not in ("column", "uuid"):
        raise CsvImportError(f"id_strategy must be 'column' or 'uuid', got {id_strategy!r}")
    if id_strategy == "column" and not id_column:
        raise CsvImportError("id_column is required when id_strategy='column'")

    reader = csv.DictReader(fh)
    if reader.fieldnames is None or not reader.fieldnames:
        raise CsvImportError("CSV has no header row")
    columns = [c.strip() for c in reader.fieldnames]
    if len(set(columns)) != len(columns):
        raise CsvImportError("CSV header has duplicate column names")
    if id_strategy == "column" and id_column not in columns:
        raise CsvImportError(f"id_column {id_column!r} not present in CSV header")

    rows: list[dict] = []
    for raw in reader:
        if len(rows) >= MAX_ROWS:
            raise CsvImportError(
                f"row cap exceeded: dataset versions are capped at {MAX_ROWS} rows"
            )
        rows.append({c: (raw.get(c) or "").strip() for c in columns})

    recipient_ids = _resolve_recipient_ids(rows, id_strategy=id_strategy, id_column=id_column)
    schema_descriptor = _infer_schema(columns, rows)
    return ImportedDataset(
        rows=rows,
        recipient_ids=recipient_ids,
        schema_descriptor={**schema_descriptor, "row_count": len(rows)},
    )


def _resolve_recipient_ids(
    rows: list[dict], *, id_strategy: str, id_column: Optional[str],
) -> list[str]:
    if id_strategy == "uuid":
        return [str(uuid.uuid4()) for _ in rows]
    assert id_column is not None
    seen: set[str] = set()
    out: list[str] = []
    for i, r in enumerate(rows, start=1):
        v = (r.get(id_column) or "").strip()
        if not v:
            raise CsvImportError(
                f"row {i}: id_column {id_column!r} is empty (id_strategy='column' requires non-empty values)"
            )
        if v in seen:
            raise CsvImportError(
                f"row {i}: id_column {id_column!r} value {v!r} duplicates an earlier row"
            )
        seen.add(v)
        out.append(v)
    return out


def _infer_schema(columns: list[str], rows: list[dict]) -> dict:
    sample = rows[:SAMPLE_LIMIT]
    cols_meta: list[dict] = []
    for c in columns:
        values = [r[c] for r in sample if r.get(c)]
        cols_meta.append({
            "name": c,
            "type": _infer_column_type(values),
            "sample_values": values[:5],
            "distinct_count": len({r[c] for r in rows if r.get(c)}),
        })
    return {"columns": cols_meta}


def _infer_column_type(values: Iterable[str]) -> str:
    vs = [v for v in values if v]
    if not vs:
        return "string"
    if all(_is_int(v) for v in vs):
        return "integer"
    if all(_is_number(v) for v in vs):
        return "number"
    if all(v.lower() in ("true", "false", "0", "1", "yes", "no") for v in vs):
        return "boolean"
    if all(_is_datetime(v) for v in vs):
        return "datetime"
    return "string"


def _is_int(v: str) -> bool:
    try:
        int(v); return True
    except ValueError:
        return False


def _is_number(v: str) -> bool:
    try:
        float(v); return True
    except ValueError:
        return False


def _is_datetime(v: str) -> bool:
    try:
        datetime.fromisoformat(v.replace("Z", "+00:00")); return True
    except ValueError:
        return False
