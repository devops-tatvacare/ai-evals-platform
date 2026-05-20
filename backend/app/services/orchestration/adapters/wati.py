"""MessagingAdapter for WATI — WhatsApp template dispatch + webhook normalization."""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Mapping, Optional
from urllib.parse import urlsplit, urlunsplit

import httpx
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    WorkflowConsentRecord,
    WorkflowRunNodeStep,
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)
from app.services.orchestration.adapters.canonical import (
    CancelDispatchOutcome,
    CancelDispatchResult,
    CanonicalMessagingEvent,
    CanonicalSendRequest,
    CanonicalSendResponse,
)
from app.services.orchestration.dispatch.bag import bag_write

_log = logging.getLogger(__name__)


class WatiServiceError(RuntimeError):
    """4xx from WATI — non-retryable, surfaced verbatim on the action row."""


_STOP_RE = re.compile(r"^\s*(stop|unsub(scribe)?)\s*$", re.IGNORECASE)

# event_type → (canonical_status, child_action_type, resumes_workflow)
_EVENT_MAP: dict[str, tuple[str, Optional[str], bool]] = {
    "templateMessageSent_v2":   ("sent",      None,          False),
    "sentMessageDELIVERED_v2":  ("delivered", "wa_delivered", False),
    "sentMessageREAD_v2":       ("read",      "wa_read",      False),
    "sentMessageREPLIED_v2":    ("replied",   "wa_replied",   True),
    "messageReceived":          ("replied",   "wa_replied",   True),
    "templateMessageFailed":    ("failed",    "wa_failed",    False),
}

_INBOUND_REPLY_EVENTS = frozenset({"messageReceived", "sentMessageREPLIED_v2"})


def _make_client(timeout: float = 30.0) -> httpx.AsyncClient:
    """Hook for tests — monkeypatch to inject httpx.MockTransport."""
    return httpx.AsyncClient(timeout=timeout)


def resolve_wati_api_endpoint(base_url: str, wati_tenant_id: str) -> str:
    """Return the tenant-scoped WATI API endpoint without double-appending."""
    base = base_url.strip().rstrip("/")
    tenant = wati_tenant_id.strip().strip("/")
    parts = urlsplit(base)
    segments = [seg for seg in parts.path.split("/") if seg]
    if not segments or segments[-1] != tenant:
        segments.append(tenant)
    path = "/" + "/".join(segments)
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def _extract_local_message_id(resp: dict[str, Any]) -> Optional[str]:
    """Pull localMessageId from V2 top-level, V1 receivers[0], or legacy nested shapes."""
    for key in ("localMessageId", "messageId", "id"):
        v = resp.get(key)
        if v:
            return str(v)
    receivers = resp.get("receivers")
    if isinstance(receivers, list):
        for entry in receivers:
            if isinstance(entry, dict):
                for key in ("localMessageId", "messageId", "id"):
                    v = entry.get(key)
                    if v:
                        return str(v)
    nested = resp.get("messageContact")
    if isinstance(nested, dict):
        for key in ("localMessageId", "messageId"):
            v = nested.get(key)
            if v:
                return str(v)
    return None


def _strip_plus(e164: str) -> str:
    """WATI accepts digits-only (no leading '+')."""
    return e164.lstrip("+").strip()


def _extract_button_id(raw: dict[str, Any]) -> Optional[str]:
    """WATI ships buttonReply.payload as stringified JSON carrying ButtonIndex."""
    button = raw.get("buttonReply")
    if isinstance(button, dict):
        payload_str = button.get("payload")
        if isinstance(payload_str, str) and payload_str:
            try:
                parsed = json.loads(payload_str)
                idx = parsed.get("ButtonIndex")
                if idx is not None:
                    return str(idx)
            except (json.JSONDecodeError, AttributeError):
                pass
    interactive = raw.get("interactiveButtonReply")
    if isinstance(interactive, dict):
        bid = interactive.get("buttonId") or interactive.get("id")
        if bid is not None:
            return str(bid)
    return None


def _extract_list_id(raw: dict[str, Any]) -> Optional[str]:
    lst = raw.get("listReply")
    if isinstance(lst, dict):
        rid = lst.get("id") or lst.get("rowId")
        if rid is not None:
            return str(rid)
    return None


def _extract_reply_text(raw: dict[str, Any]) -> Optional[str]:
    for key in ("text", "messageBody"):
        v = raw.get(key)
        if isinstance(v, str) and v:
            return v
    button = raw.get("buttonReply")
    if isinstance(button, dict):
        t = button.get("text")
        if isinstance(t, str) and t:
            return t
    return None


def _extract_reply_type(raw: dict[str, Any]) -> Optional[str]:
    if raw.get("buttonReply") or raw.get("interactiveButtonReply"):
        return "button"
    if raw.get("listReply"):
        return "list"
    rtype = raw.get("type")
    if isinstance(rtype, str) and rtype:
        return rtype
    if raw.get("text") or raw.get("messageBody"):
        return "text"
    return None


class WatiAdapter:
    capability = "messaging"
    vendor = "wati"

    async def send_template(
        self, *, connection: dict[str, Any], request: CanonicalSendRequest,
    ) -> CanonicalSendResponse:
        base_url = connection.get("base_url") or ""
        tenant_id = connection.get("wati_tenant_id") or ""
        api_token = connection.get("api_token") or ""
        if not (base_url and tenant_id and api_token):
            raise WatiServiceError("WATI connection missing base_url / wati_tenant_id / api_token")

        endpoint = resolve_wati_api_endpoint(base_url, tenant_id)
        url = f"{endpoint}/api/v2/sendTemplateMessage"
        whatsapp_number = _strip_plus(request.contact)
        body: dict[str, Any] = {
            "template_name": request.template_slug,
            "broadcast_name": request.template_slug,
            "parameters": [{"name": k, "value": v} for k, v in request.variables.items()],
        }
        channels = connection.get("channel_numbers") or []
        if channels:
            body["channel_number"] = channels[0]

        headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        }
        async with _make_client() as client:
            resp = await client.post(
                url, params={"whatsappNumber": whatsapp_number},
                json=body, headers=headers,
            )
            if 400 <= resp.status_code < 500:
                try:
                    err_body = resp.json()
                except Exception:
                    err_body = {"text": resp.text[:200]}
                raise WatiServiceError(f"WATI {resp.status_code}: {err_body}")
            resp.raise_for_status()
            raw = resp.json() if resp.content else {}

        local_msg_id = _extract_local_message_id(raw)
        if not local_msg_id:
            raise WatiServiceError(
                "WATI send_template response missing localMessageId — cannot correlate inbound webhooks"
            )
        return CanonicalSendResponse(
            provider_correlation_id=local_msg_id,
            contact=request.contact,
            raw=raw,
        )

    def normalize_webhook(self, raw: dict[str, Any]) -> CanonicalMessagingEvent:
        event_type = raw.get("eventType") or ""
        status, _action, _resumes = _EVENT_MAP.get(event_type, ("unknown", None, False))
        contact = str(raw.get("waId") or raw.get("whatsappNumber") or "")
        local_msg_id = str(raw.get("localMessageId") or "")
        reply_ctx = raw.get("replyContextId")
        return CanonicalMessagingEvent(
            status=status,
            contact=contact,
            provider_correlation_id=local_msg_id,
            reply_context_id=str(reply_ctx) if reply_ctx else None,
            reply_type=_extract_reply_type(raw) if event_type in _INBOUND_REPLY_EVENTS else None,
            reply_text=_extract_reply_text(raw) if event_type in _INBOUND_REPLY_EVENTS else None,
            button_id=_extract_button_id(raw) if event_type in _INBOUND_REPLY_EVENTS else None,
            list_id=_extract_list_id(raw) if event_type in _INBOUND_REPLY_EVENTS else None,
            vendor_raw=raw,
        )

    def verify_signature(self, raw: bytes, headers: Mapping[str, str]) -> bool:  # noqa: ARG002
        # WATI ships no HMAC; the per-connection URL token gates the route.
        return True

    async def handle_webhook(
        self,
        db: AsyncSession,
        *,
        tenant_id: uuid.UUID,
        app_id: str,
        payload: dict[str, Any],
    ) -> None:
        event_type = payload.get("eventType") or ""
        if event_type not in _EVENT_MAP:
            return

        if event_type in _INBOUND_REPLY_EVENTS:
            body_text = _extract_reply_text(payload) or ""
            if _STOP_RE.match(body_text):
                await self._record_optout(db, tenant_id=tenant_id, app_id=app_id, payload=payload)
                return

        parent, node_id = await self._find_parent(
            db, tenant_id=tenant_id, payload=payload,
        )
        if parent is None:
            return

        _status, child_action_type, resumes = _EVENT_MAP[event_type]
        if child_action_type is None:
            return

        local_msg_id = str(payload.get("localMessageId") or "")
        idem = f"webhook|{event_type}|{local_msg_id}"
        now = datetime.now(timezone.utc)
        await db.execute(
            pg_insert(WorkflowRunRecipientAction).values(
                id=uuid.uuid4(),
                tenant_id=tenant_id, app_id=app_id,
                workflow_id=parent.workflow_id,
                workflow_version_id=parent.workflow_version_id,
                run_id=parent.run_id, node_step_id=parent.node_step_id,
                recipient_id=parent.recipient_id, channel="whatsapp",
                action_type=child_action_type, status="success",
                idempotency_key=idem,
                payload={"contact": (parent.payload or {}).get("contact"), "event": event_type},
                response=payload,
                parent_action_id=parent.id,
                provider_correlation_id=parent.provider_correlation_id,
                provider_terminal=True,
                completed_at=now,
            ).on_conflict_do_nothing(
                constraint="uq_workflow_run_recipient_actions_idempotency",
            )
        )

        ttl_gate = or_(
            WorkflowRunRecipientState.ignore_webhooks_after.is_(None),
            WorkflowRunRecipientState.ignore_webhooks_after > func.now(),
        )

        bag_fields: dict[str, Any] = {
            "wa_status": child_action_type.removeprefix("wa_"),
            "wa_last_event_at": now.isoformat(),
        }
        canonical = self.normalize_webhook(payload)
        if event_type in _INBOUND_REPLY_EVENTS:
            if canonical.reply_type is not None:
                bag_fields["wa_reply_type"] = canonical.reply_type
            if canonical.reply_text is not None:
                bag_fields["wa_reply_text"] = canonical.reply_text
            if canonical.button_id is not None:
                bag_fields["wa_button_id"] = canonical.button_id
            if canonical.list_id is not None:
                bag_fields["wa_list_id"] = canonical.list_id
            if canonical.reply_context_id is not None:
                bag_fields["wa_reply_context_id"] = canonical.reply_context_id

        namespaced = bag_write(node_id=node_id, fields=bag_fields)
        await db.execute(
            update(WorkflowRunRecipientState)
            .where(
                WorkflowRunRecipientState.run_id == parent.run_id,
                WorkflowRunRecipientState.recipient_id == parent.recipient_id,
                ttl_gate,
            )
            .values(payload=WorkflowRunRecipientState.payload.op("||")(namespaced))
        )

        if resumes:
            flip = await db.execute(
                update(WorkflowRunRecipientState)
                .where(
                    WorkflowRunRecipientState.run_id == parent.run_id,
                    WorkflowRunRecipientState.recipient_id == parent.recipient_id,
                    WorkflowRunRecipientState.status == "waiting",
                    ttl_gate,
                )
                .values(status="ready", wakeup_at=None)
            )
            if getattr(flip, "rowcount", 0):
                from app.services.orchestration.dispatch.resume_enqueue import (
                    enqueue_resume_for_recipient,
                )
                await enqueue_resume_for_recipient(
                    db, run_id=parent.run_id, recipient_id=parent.recipient_id,
                    available_at=None,
                    reason=f"ready:wati:{event_type}:{local_msg_id}",
                )
        await db.flush()

    async def _find_parent(
        self,
        db: AsyncSession,
        *,
        tenant_id: uuid.UUID,
        payload: dict[str, Any],
    ) -> tuple[Optional[WorkflowRunRecipientAction], Optional[str]]:
        reply_ctx = payload.get("replyContextId")
        local_msg = payload.get("localMessageId")

        ttl_join_gate = or_(
            WorkflowRunRecipientState.ignore_webhooks_after.is_(None),
            WorkflowRunRecipientState.ignore_webhooks_after > func.now(),
        )

        base = (
            select(WorkflowRunRecipientAction, WorkflowRunNodeStep.node_id)
            .join(
                WorkflowRunNodeStep,
                WorkflowRunNodeStep.id == WorkflowRunRecipientAction.node_step_id,
            )
            .join(
                WorkflowRunRecipientState,
                and_(
                    WorkflowRunRecipientState.run_id == WorkflowRunRecipientAction.run_id,
                    WorkflowRunRecipientState.recipient_id == WorkflowRunRecipientAction.recipient_id,
                ),
            )
            .where(
                WorkflowRunRecipientAction.tenant_id == tenant_id,
                WorkflowRunRecipientAction.channel == "whatsapp",
                WorkflowRunRecipientAction.action_type == "wa_dispatched",
                ttl_join_gate,
            )
        )

        if reply_ctx:
            q = base.where(
                WorkflowRunRecipientAction.response["whatsappMessageId"].astext == str(reply_ctx)
            )
            rows = (await db.execute(q)).all()
            if len(rows) == 1:
                row = rows[0]
                return row[0], row[1]
            if len(rows) > 1:
                _log.warning(
                    "wati.replyContextId.multi_match reply_context_id=%s count=%d — refusing to route",
                    reply_ctx, len(rows),
                )
                return None, None
        if local_msg:
            q = base.where(
                WorkflowRunRecipientAction.response["localMessageId"].astext == str(local_msg)
            ).order_by(WorkflowRunRecipientAction.created_at.desc()).limit(1)
            row = (await db.execute(q)).first()
            if row is not None:
                return row[0], row[1]
        return None, None

    async def _record_optout(
        self,
        db: AsyncSession,
        *,
        tenant_id: uuid.UUID,
        app_id: str,
        payload: dict[str, Any],
    ) -> None:
        parent, _node_id = await self._find_parent(
            db, tenant_id=tenant_id, payload=payload,
        )
        if parent is None:
            return
        db.add(WorkflowConsentRecord(
            id=uuid.uuid4(),
            tenant_id=tenant_id, app_id=app_id,
            recipient_id=parent.recipient_id, channel="wa",
            status="opted_out", source="wa_reply_stop",
            evidence={"webhook": payload},
        ))
        await db.flush()

    async def cancel_dispatch(
        self, *, connection: dict[str, Any], action: Any,  # noqa: ARG002
    ) -> CancelDispatchResult:
        # WATI exposes no public cancel/recall API; once submitted to Meta the
        # template message is unrecallable.
        return CancelDispatchResult(
            outcome=CancelDispatchOutcome.noop_unsupported,
            provider_message="wati: no recall api",
        )

    async def cancel_run_actions(
        self, *, connection: dict[str, Any], actions: list[Any],
    ) -> list[CancelDispatchResult]:
        return [
            await self.cancel_dispatch(connection=connection, action=a)
            for a in actions
        ]


from app.services.orchestration.adapters import register_adapter  # noqa: E402

register_adapter(capability="messaging", vendor="wati", adapter=WatiAdapter())


__all__ = ["WatiAdapter", "WatiServiceError", "resolve_wati_api_endpoint"]
