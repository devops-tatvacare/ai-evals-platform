"""`send-mail` background-job type and its enqueue helper."""
from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.job import BackgroundJob
from app.services.mail.call_sites import CallSite
from app.services.mail.sender import (
    MailNotConfigured,
    MailSendError,
    send_mail,
)

logger = logging.getLogger(__name__)


JOB_TYPE = "send-mail"


async def enqueue_send_mail(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    call_site: CallSite,
    recipient: str,
    context: dict[str, Any],
    correlation_id: str | None = None,
    actor_user_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """Queue a `send-mail` BackgroundJob row; falls back to SYSTEM_USER_ID when no actor."""
    from app.constants import SYSTEM_USER_ID

    job = BackgroundJob(
        tenant_id=tenant_id,
        user_id=actor_user_id or SYSTEM_USER_ID,
        job_type=JOB_TYPE,
        app_id="",
        status="queued",
        params={
            "tenant_id": str(tenant_id),
            "user_id": str(actor_user_id or SYSTEM_USER_ID),
            "call_site": call_site.value,
            "recipient": recipient,
            "context": context,
            "correlation_id": correlation_id,
        },
    )
    db.add(job)
    await db.flush()
    return job.id


async def run_send_mail_job(
    job_id: uuid.UUID,
    params: dict[str, Any],
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Job-type handler: render + relay + log via the existing send_mail facade."""
    call_site = CallSite(params["call_site"])
    recipient = params["recipient"]
    context = dict(params.get("context") or {})
    correlation_id = params.get("correlation_id")

    async with async_session() as db:
        try:
            await send_mail(
                db,
                tenant_id=tenant_id,
                call_site=call_site,
                recipient=recipient,
                context=context,
                correlation_id=correlation_id,
            )
            await db.commit()
            return {"status": "sent", "recipient": recipient}
        except MailNotConfigured as exc:
            logger.warning(
                "send_mail_job_not_configured",
                extra={
                    "job_id": str(job_id),
                    "tenant_id": str(tenant_id),
                    "call_site": call_site.value,
                    "error": str(exc),
                },
            )
            return {"status": "not_configured", "recipient": recipient}
        except MailSendError as exc:
            await db.commit()  # persist the failure log row
            logger.warning(
                "send_mail_job_failed",
                extra={
                    "job_id": str(job_id),
                    "tenant_id": str(tenant_id),
                    "call_site": call_site.value,
                    "recipient": recipient,
                    "error": str(exc),
                },
            )
            return {"status": "failed", "recipient": recipient}
