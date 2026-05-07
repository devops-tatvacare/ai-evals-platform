"""Match an inbound event against workflow_triggers and submit run-workflow jobs.

Used by:
  - /webhooks/event/<name>/<secret> directly
  - /webhooks/lsq/<secret> (after the LSQ handler translates the payload to 'lsq.lead.updated')

For each active matching trigger, creates one workflow_runs row + one
background_jobs row of type 'run-workflow'. The run-workflow handler is
already registered (Phase 1) and will execute the source nodes.
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_USER_ID
from app.models.job import BackgroundJob
from app.models.orchestration import Workflow, WorkflowRun, WorkflowTrigger


class EventPayloadContractError(ValueError):
    """Raised when an inbound event does not reference any recipient(s)."""


class EventTriggerConfigurationError(ValueError):
    """Raised when a matching trigger points at an invalid workflow state."""


_SINGLE_RECIPIENT_KEYS = ("recipient_id", "recipientId")


def _normalize_event_payload(event_payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize arbitrary inbound event payloads into the engine recipient contract.

    Canonical accepted shape:

        {
            "recipients": [
                {"recipient_id": "...", "payload": {...}}
            ],
            ...
        }

    For convenience, one-recipient generic events may also send a top-level
    ``recipient_id`` / ``recipientId``. Those are wrapped into the canonical
    ``recipients`` list automatically.
    """
    normalized = dict(event_payload)
    recipients = normalized.get("recipients")
    if recipients is not None:
        if not isinstance(recipients, list):
            raise EventPayloadContractError("event payload field 'recipients' must be a list")
        normalized_recipients: list[dict[str, Any]] = []
        for recipient in recipients:
            if not isinstance(recipient, dict):
                raise EventPayloadContractError(
                    "event payload recipients must be objects with recipient_id"
                )
            recipient_id = recipient.get("recipient_id") or recipient.get("recipientId")
            if recipient_id is None or not str(recipient_id):
                raise EventPayloadContractError(
                    "each event payload recipient must include recipient_id"
                )
            payload = recipient.get("payload")
            if payload is None:
                payload = {
                    key: value
                    for key, value in recipient.items()
                    if key not in ("recipient_id", "recipientId", "payload")
                }
            if not isinstance(payload, dict):
                raise EventPayloadContractError(
                    "event payload recipient field 'payload' must be an object"
                )
            normalized_recipients.append({
                "recipient_id": str(recipient_id),
                "payload": payload,
            })
        normalized["recipients"] = normalized_recipients
        return normalized

    for key in _SINGLE_RECIPIENT_KEYS:
        recipient_id = normalized.get(key)
        if recipient_id is not None and str(recipient_id):
            normalized["recipients"] = [{
                "recipient_id": str(recipient_id),
                "payload": dict(event_payload),
            }]
            return normalized

    raise EventPayloadContractError(
        "event payload must include recipients[] or recipient_id"
    )


async def fire_event(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: Optional[str],
    event_name: str,
    event_payload: dict[str, Any],
    triggered_by_user_id: Optional[uuid.UUID] = None,
) -> list[uuid.UUID]:
    """Find matching active triggers, create one workflow_run + one BackgroundJob per trigger.

    Returns the list of workflow_run.id values created.
    """
    normalized_payload = _normalize_event_payload(event_payload)
    stmt = select(WorkflowTrigger).where(
        WorkflowTrigger.tenant_id == tenant_id,
        WorkflowTrigger.event_name == event_name,
        WorkflowTrigger.kind == "event",
        WorkflowTrigger.active.is_(True),
    )
    if app_id is not None:
        stmt = stmt.where(WorkflowTrigger.app_id == app_id)
    triggers = (await db.execute(stmt)).scalars().all()

    workflows_by_trigger: dict[uuid.UUID, Workflow] = {}
    unpublished: list[str] = []
    for trigger in triggers:
        wf = (
            await db.execute(select(Workflow).where(Workflow.id == trigger.workflow_id))
        ).scalar_one()
        workflows_by_trigger[trigger.id] = wf
        if not wf.active or wf.current_published_version_id is None:
            unpublished.append(str(wf.id))
    if unpublished:
        raise EventTriggerConfigurationError(
            "matching event trigger(s) reference workflow(s) without a published version: "
            + ", ".join(unpublished)
        )

    created: list[uuid.UUID] = []
    for trigger in triggers:
        wf = workflows_by_trigger[trigger.id]

        run = WorkflowRun(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            app_id=trigger.app_id,
            workflow_id=wf.id,
            workflow_version_id=wf.current_published_version_id,
            trigger_id=trigger.id,
            triggered_by="event",
            triggered_by_user_id=triggered_by_user_id,
            status="pending",
            params={"event_payload": normalized_payload},
        )
        db.add(run)
        await db.flush()  # ensure run.id is materialized for FK on job

        job_user_id = triggered_by_user_id or trigger.created_by or SYSTEM_USER_ID
        job = BackgroundJob(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            app_id=trigger.app_id,
            user_id=job_user_id,
            job_type="run-workflow",
            queue_class="standard",
            priority=5,
            # ``process_job`` reads tenant_id / user_id off ``params``;
            # every run-workflow submission has to echo them.
            params={
                "run_id": str(run.id),
                "tenant_id": str(tenant_id),
                "user_id": str(job_user_id),
            },
            status="queued",
        )
        db.add(job)
        await db.flush()
        run.job_id = job.id
        created.append(run.id)

    await db.flush()
    return created
