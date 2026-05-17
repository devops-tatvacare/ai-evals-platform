"""Partial-reveal previews for stored secrets.

The preview is a UI hint only. It is not reversible and never replaces
server-side encryption for the stored credential.
"""
from __future__ import annotations

from typing import Any

_PREVIEW_BULLET = "•" * 4


def mask_secret_value(value: Any) -> str:
    """Return a partial-reveal preview of one stored secret value.

    Rules:
    - value length >= 8: first 4 + bullets + last 4.
    - value length 1-7: bullets + last 4.
    - empty / non-string: empty string.
    """
    if not isinstance(value, str) or value == "":
        return ""
    if len(value) >= 8:
        return f"{value[:4]}{_PREVIEW_BULLET}{value[-4:]}"
    return f"{_PREVIEW_BULLET}{value[-4:]}"

