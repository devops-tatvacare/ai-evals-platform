"""EvidenceRef — pointer into ``platform.sherlock_evidence``."""
from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


EvidenceSource = Literal[
    'sql_row',
    'vector_chunk',
    'kg_triple',
    'action_receipt',
    'doc_excerpt',
]


class EvidenceRef(BaseModel):
    model_config = ConfigDict(extra='forbid')

    ref_id: uuid.UUID
    source: EvidenceSource
    locator: dict[str, Any]
    snippet: str | None = None
