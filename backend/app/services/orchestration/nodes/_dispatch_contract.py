"""Shared runtime contract checks for high-risk dispatch nodes."""
from __future__ import annotations

from typing import Any


def assert_contact_field_present(
    *,
    node_type: str,
    recipient_id: str,
    payload: dict[str, Any],
    field_name: str,
) -> str:
    value = payload.get(field_name)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise RuntimeError(
            f"{node_type}: recipient {recipient_id!r} is missing required contact field "
            f"{field_name!r}"
        )
    return str(value)
