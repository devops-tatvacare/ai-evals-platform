"""{{name}} placeholder substitution shared by dispatch nodes."""
from __future__ import annotations

import re
from typing import Any

_TEMPLATE_VAR_RE = re.compile(r"\{\{\s*([\w.\-]+)\s*\}\}")


def render(value: Any, payload: dict[str, Any]) -> str:
    def sub(match: re.Match[str]) -> str:
        return str(payload.get(match.group(1).strip(), ""))
    return _TEMPLATE_VAR_RE.sub(sub, str(value))


__all__ = ["render"]
