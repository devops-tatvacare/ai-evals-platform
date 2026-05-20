"""Freeze a run's recipient set at T0 into ``orchestration.workflow_run_recipients``.

The freezer is invoked once per run, right after the cohort source node
materialises ``workflow_run_recipient_states``. It captures the canonical
``(recipient_id, phone_e164)`` set with a hash of the resolving predicate so
downstream dispatch nodes can hard-reject any recipient that mutated into the
cohort source after T0.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Iterable

import phonenumbers
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    CohortDefinitionVersion,
    WorkflowRun,
    WorkflowRunRecipient,
)


@dataclass(frozen=True)
class FreezeReceipt:
    frozen_count: int
    invalid_phone_count: int
    predicate_hash: str


def normalise_phone_e164(raw: str | None, default_region: str = "IN") -> str | None:
    """Return the E.164 form of ``raw`` or ``None`` if it cannot be validated.

    Empty strings, ``None``, and unparseable inputs all return ``None`` so the
    caller drops them with an audit count rather than dispatching to garbage.
    """
    if not raw:
        return None
    try:
        parsed = phonenumbers.parse(raw, default_region)
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(parsed):
        return None
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def _hash_predicate(version: CohortDefinitionVersion) -> str:
    payload = {
        "version_id": str(version.id),
        "source_ref": version.source_ref,
        "filters": version.filters or [],
        "payload_fields": version.payload_fields or [],
        "lookback_hours": version.lookback_hours,
        "lookback_column": version.lookback_column,
        "consent_gate_channel": version.consent_gate_channel,
    }
    canonical = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def freeze_recipients(
    db: AsyncSession,
    *,
    run: WorkflowRun,
    cohort_version: CohortDefinitionVersion,
    resolved_rows: Iterable[tuple[str, str | None]],
) -> FreezeReceipt:
    """Persist the frozen manifest.

    ``resolved_rows`` yields ``(recipient_id, raw_phone)`` tuples — typically
    sourced from ``workflow_run_recipient_states`` rows just written by the
    cohort source node. Invalid phones are dropped with an audit count; the
    write is idempotent against the ``(run_id, recipient_id)`` unique
    constraint so re-firing the freezer for the same run is safe.
    """
    predicate_hash = _hash_predicate(cohort_version)
    frozen = 0
    invalid = 0
    rows_to_insert: list[dict] = []
    for recipient_id, raw_phone in resolved_rows:
        e164 = normalise_phone_e164(raw_phone)
        if e164 is None:
            invalid += 1
            continue
        rows_to_insert.append(
            {
                "run_id": run.id,
                "tenant_id": run.tenant_id,
                "app_id": run.app_id,
                "recipient_id": recipient_id,
                "phone_e164": e164,
                "source_cohort_version_id": cohort_version.id,
                "predicate_hash": predicate_hash,
            }
        )
        frozen += 1
    if rows_to_insert:
        stmt = pg_insert(WorkflowRunRecipient).values(rows_to_insert)
        stmt = stmt.on_conflict_do_nothing(
            constraint="uq_workflow_run_recipients_run_recipient"
        )
        await db.execute(stmt)
        await db.flush()
    return FreezeReceipt(
        frozen_count=frozen,
        invalid_phone_count=invalid,
        predicate_hash=predicate_hash,
    )
