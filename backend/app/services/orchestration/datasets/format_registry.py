"""Registry mapping (filename, content-type) signals to per-format parsers."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Callable, Optional

from app.services.orchestration.datasets.csv_importer import parse_csv
from app.services.orchestration.datasets.dataset_validator import ImportedDataset
from app.services.orchestration.datasets.xlsx_importer import parse_xlsx

ParserFn = Callable[..., ImportedDataset]
_DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024


class FormatNotSupportedError(ValueError):
    """Raised when no handler matches the (filename, content_type) signal."""


@dataclass(frozen=True)
class FormatHandler:
    source_type: str
    extensions: tuple[str, ...]
    mime_types: tuple[str, ...]
    label: str
    parser: ParserFn = field(repr=False)
    max_upload_bytes: int = _DEFAULT_MAX_UPLOAD_BYTES
    supports_client_preview: bool = True


_HANDLERS: list[FormatHandler] = []


def register(handler: FormatHandler) -> None:
    if any(h.source_type == handler.source_type for h in _HANDLERS):
        raise ValueError(
            f"format handler for {handler.source_type!r} already registered"
        )
    _HANDLERS.append(handler)


def all_handlers() -> list[FormatHandler]:
    return list(_HANDLERS)


def resolve(
    *, filename: Optional[str], content_type: Optional[str],
) -> FormatHandler:
    ext = ""
    if filename:
        ext = os.path.splitext(filename)[1].lower()
    if ext:
        for h in _HANDLERS:
            if ext in h.extensions:
                return h
    if content_type:
        ct = content_type.split(";", 1)[0].strip().lower()
        for h in _HANDLERS:
            if ct in h.mime_types:
                return h
    supported = ", ".join(
        sorted({e for h in _HANDLERS for e in h.extensions})
    )
    raise FormatNotSupportedError(
        f"file format not supported (allowed: {supported})"
    )


register(FormatHandler(
    source_type="csv",
    extensions=(".csv",),
    mime_types=(
        "text/csv",
        "application/csv",
        "application/vnd.ms-excel",
    ),
    label="CSV (.csv)",
    parser=parse_csv,
))


register(FormatHandler(
    source_type="xlsx",
    extensions=(".xlsx",),
    mime_types=(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel.sheet.macroEnabled.12",
    ),
    label="Excel (.xlsx)",
    parser=parse_xlsx,
))
