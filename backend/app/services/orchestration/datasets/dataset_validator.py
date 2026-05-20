"""Format-agnostic validation + schema inference shared by every dataset importer."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Optional

MAX_ROWS = 20_000
SAMPLE_LIMIT = 50
COLUMN_TYPES = ("integer", "number", "boolean", "datetime", "string")


class DatasetImportError(ValueError):
    """Raised on any structural problem the user can fix."""


@dataclass(frozen=True)
class ImportedDataset:
    rows: list[dict]
    recipient_ids: list[str]
    schema_descriptor: dict


def validate_id_strategy(id_strategy: str, id_column: Optional[str]) -> None:
    if id_strategy not in ("column", "uuid"):
        raise DatasetImportError(
            f"id_strategy must be 'column' or 'uuid', got {id_strategy!r}"
        )
    if id_strategy == "column" and not id_column:
        raise DatasetImportError("id_column is required when id_strategy='column'")


def validate_headers(columns: list[str], *, id_strategy: str, id_column: Optional[str]) -> None:
    if not columns:
        raise DatasetImportError("file has no header row")
    if len(set(columns)) != len(columns):
        raise DatasetImportError("file header has duplicate column names")
    if id_strategy == "column" and id_column not in columns:
        raise DatasetImportError(
            f"id_column {id_column!r} not present in file header"
        )


def assemble(
    columns: list[str],
    rows: list[dict],
    *,
    id_strategy: str,
    id_column: Optional[str],
) -> ImportedDataset:
    if len(rows) > MAX_ROWS:
        raise DatasetImportError(
            f"row cap exceeded: dataset versions are capped at {MAX_ROWS} rows"
        )
    recipient_ids = resolve_recipient_ids(
        rows, id_strategy=id_strategy, id_column=id_column,
    )
    schema_descriptor = infer_schema(columns, rows)
    return ImportedDataset(
        rows=rows,
        recipient_ids=recipient_ids,
        schema_descriptor={**schema_descriptor, "row_count": len(rows)},
    )


def resolve_recipient_ids(
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
            raise DatasetImportError(
                f"row {i}: id_column {id_column!r} is empty (id_strategy='column' requires non-empty values)"
            )
        if v in seen:
            raise DatasetImportError(
                f"row {i}: id_column {id_column!r} value {v!r} duplicates an earlier row"
            )
        seen.add(v)
        out.append(v)
    return out


def infer_schema(columns: list[str], rows: list[dict]) -> dict:
    sample = rows[:SAMPLE_LIMIT]
    cols_meta: list[dict] = []
    for c in columns:
        values = [r[c] for r in sample if r.get(c)]
        cols_meta.append({
            "name": c,
            "type": infer_column_type(values),
            "sample_values": values[:5],
            "distinct_count": len({r[c] for r in rows if r.get(c)}),
        })
    return {"columns": cols_meta}


def infer_column_type(values: Iterable[str]) -> str:
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
