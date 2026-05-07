"""Deterministic idempotency keys for outbound side-effects.

Same (workflow_version_id, node_id, recipient_id, *parts) → same key, always.
Retries reuse the key, so the unique constraint on workflow_run_recipient_actions
catches doubles before the provider call fires.
"""
from __future__ import annotations

import hashlib
import uuid


def idempotency_key(
    workflow_version_id: uuid.UUID,
    node_id: str,
    recipient_id: str,
    *parts: str,
) -> str:
    """sha256 hex digest of pipe-joined inputs. Truncated to 64 chars to fit VARCHAR(128) with room."""
    raw = "|".join([str(workflow_version_id), node_id, recipient_id, *parts])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:64]
