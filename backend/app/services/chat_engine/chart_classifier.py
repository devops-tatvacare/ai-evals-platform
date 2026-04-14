"""Data-shape-driven chart type classification.

The classifier inspects analyze result columns to determine which
Recharts chart types are eligible for the data. No app-specific logic —
only data shape and optional semantic model dimension metadata.
"""
from __future__ import annotations

import re
from typing import Any

# Patterns for detecting temporal columns
_TEMPORAL_NAME_PATTERN = re.compile(
    r'(date|time|month|week|year|quarter|day|period|created|updated)',
    re.IGNORECASE,
)
_ISO_DATE_PATTERN = re.compile(
    r'^\d{4}[-/]\d{2}([-/]\d{2})?([T ]\d{2}:\d{2}(:\d{2})?)?',
)


def _is_numeric_value(value: Any) -> bool:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return True
    if isinstance(value, str):
        try:
            float(value)
            return True
        except (ValueError, TypeError):
            return False
    return False


def _is_temporal_value(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return bool(_ISO_DATE_PATTERN.match(value.strip()))


def classify_columns(
    columns: list[str],
    rows: list[dict[str, Any]],
    *,
    dimensions: list[dict[str, Any]] | None = None,
) -> dict[str, str]:
    """Classify each column as numeric, temporal, ordered_categorical, or categorical.

    Args:
        columns: ordered column names from the analyze result.
        rows: data rows (list of dicts).
        dimensions: optional semantic model dimension metadata. Each dict
            may include an ``ordering`` key (list of ordered values) that
            promotes the column to ``ordered_categorical``.

    Returns:
        dict mapping column name to type string.
    """
    ordered_dims: set[str] = set()
    if dimensions:
        for dim in dimensions:
            if isinstance(dim, dict) and dim.get('ordering'):
                ordered_dims.add(str(dim.get('name', '')))

    result: dict[str, str] = {}
    for col in columns:
        # Check ordered categorical first (from semantic model metadata)
        if col in ordered_dims:
            result[col] = 'ordered_categorical'
            continue

        # Sample non-null values
        values = [
            row[col]
            for row in rows
            if isinstance(row, dict) and col in row and row[col] is not None
        ]

        if not values:
            result[col] = 'categorical'
            continue

        # Check numeric
        if all(_is_numeric_value(v) for v in values):
            result[col] = 'numeric'
            continue

        # Check temporal — by column name or by value pattern
        if _TEMPORAL_NAME_PATTERN.search(col):
            result[col] = 'temporal'
            continue
        if all(_is_temporal_value(v) for v in values):
            result[col] = 'temporal'
            continue

        result[col] = 'categorical'

    return result
