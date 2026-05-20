"""CSV → ImportedDataset parser. Shape validation lives in dataset_validator."""
from __future__ import annotations

import csv
import io
from typing import Optional

from app.services.orchestration.datasets.dataset_validator import (
    DatasetImportError,
    ImportedDataset,
    MAX_ROWS,
    assemble,
    validate_headers,
    validate_id_strategy,
)


def parse_csv(
    raw: bytes,
    *,
    id_strategy: str,
    id_column: Optional[str],
) -> ImportedDataset:
    validate_id_strategy(id_strategy, id_column)

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise DatasetImportError("CSV must be UTF-8 encoded") from exc

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise DatasetImportError("file has no header row")
    columns = [c.strip() for c in reader.fieldnames]
    validate_headers(columns, id_strategy=id_strategy, id_column=id_column)

    rows: list[dict] = []
    for raw_row in reader:
        if len(rows) >= MAX_ROWS:
            raise DatasetImportError(
                f"row cap exceeded: dataset versions are capped at {MAX_ROWS} rows"
            )
        rows.append({c: (raw_row.get(c) or "").strip() for c in columns})

    return assemble(columns, rows, id_strategy=id_strategy, id_column=id_column)
