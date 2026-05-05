"""crm.place_bolna_call — outbound AI voice call via the configured Bolna account.

Workflow-visible outputs: ``success`` / ``exhausted``. Per-attempt retries are
governed by the node's ``attempt_policy`` (the helper runs them inline; see
:mod:`attempt_policy` for the backoff caveat). Bolna's own provider-side
``retry_config`` continues to govern *within-call* dial retries.

The Bolna service is resolved per-call from
``ctx.connections.bolna(config.connection_id)``. ``variable_mappings`` is the
sole source of Bolna ``user_data`` — there is no template-side fallback.

Action row: ``action_type='bolna_queued'``. The Bolna ``call_id`` (when
returned) is emitted into payload as ``bolna_call_id`` so inbound result
webhooks can correlate back to the parked recipient.

Phase 13/D.3: cohort dispatch splits at ``BATCH_THRESHOLD`` (10, matching
Bolna's paid-tier outbound concurrency cap). Below the threshold the
node walks the cohort sequentially via ``POST /call``; at or above the
threshold it serialises the cohort to CSV and submits a single
``POST /batches``. Each recipient still gets one
``workflow_run_recipient_actions`` row — the row's ``response`` carries
``mode={"single"|"batch"}`` plus the upstream correlation ids
(``execution_id`` and/or ``batch_id``) so the Phase E poller can
reconcile post-execution state.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.services.orchestration.attempt_policy import (
    AttemptPolicy,
    attempt_policy_json_schema_extra,
    run_with_attempt_policy,
)
from app.services.orchestration.connections.variable_mapping import (
    apply_variable_mappings_dict,
)
from app.services.orchestration.nodes._dispatch_contract import (
    assert_contact_field_present,
)
from app.services.orchestration.dispatch.resume_enqueue import (
    enqueue_bolna_correlation_poll,
)
from app.services.orchestration.integrations.bolna import BolnaServiceError
from app.services.orchestration.integrations.bolna_batch import (
    build_cohort_csv,
)


# Cohort threshold above which dispatch flips from sequential POST /call to
# multipart POST /batches. Matches Bolna paid-tier outbound concurrency
# cap (10) per https://www.bolna.ai/docs/outbound-calling-concurrency.
# Promotable to a per-connection setting if a tenant asks; today's
# constant suffices.
BATCH_THRESHOLD = 10
from app.services.orchestration.integrations.template_resolver import (
    TemplateNotFound,
    resolve_template,
)
from app.services.orchestration.node_protocol import (
    ActionDispatch,
    NodeResult,
    RecipientOutcome,
)
from app.services.orchestration.node_registry import register_node


class _Config(BaseModel):
    connection_id: uuid.UUID = Field(
        ...,
        json_schema_extra={"x-type": "connection_picker", "x-provider": "bolna"},
    )
    template_slug: str = Field(
        ...,
        title="Action Template",
        description=(
            "Internal platform action template used for retry defaults, "
            "tracking, and idempotency. Stored as a slug behind this picker."
        ),
        json_schema_extra={"x-type": "action_template_picker", "x-channel": "bolna"},
    )
    # Bolna agent UUID — UI-supplied per Phase 13 keystone #1. Required at
    # publish time (publish-gate validator); drafts may persist with the
    # default empty string while authors complete the form.
    agent_id: str = Field(
        "",
        title="Bolna Agent",
        description="Pick the live Bolna agent placed on the call.",
        json_schema_extra={"x-type": "bolna_agent_picker"},
    )
    # Optional outbound caller-id override. UI-supplied (no template-side
    # fallback per Phase 13 keystone #3). Empty string → fall back to the
    # connection's ``from_phone`` config; empty connection field → fall back
    # to Bolna's per-agent default at the upstream.
    from_phone: str = Field(
        "",
        title="Caller ID Override",
        description=(
            "Optional E.164 caller-id override. Leave blank to use the "
            "connection default or Bolna's per-agent default."
        ),
    )
    phone_field: str = "phone"  # E.164 with '+'
    variable_mappings: list[dict[str, Any]] = Field(
        default_factory=list,
        json_schema_extra={"x-type": "variable_mapping_list"},
    )
    attempt_policy: AttemptPolicy = Field(
        default_factory=AttemptPolicy,
        json_schema_extra=attempt_policy_json_schema_extra(),
    )


def _classify_bolna_error(exc: BaseException) -> Optional[str]:
    if isinstance(exc, BolnaServiceError):
        return "bolna_service_error"
    return None


@register_node(workflow_type="crm", node_type="crm.place_bolna_call")
class _Handler:
    node_type = "crm.place_bolna_call"
    config_schema = _Config
    output_edges = ["success", "exhausted"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        if ctx.connections is None:
            raise RuntimeError(
                "crm.place_bolna_call requires ctx.connections — wire ConnectionResolver in run_handler"
            )
        if not config.agent_id:
            # Defensive: the publish-gate validator should have caught this
            # before runtime, but seeded drafts and direct API submitters
            # can still reach here. Per Phase 13 keystone #1/#3, no fallback.
            raise RuntimeError(
                "crm.place_bolna_call: agent_id is required (Phase 13 — supply via the agent picker)."
            )
        service = await ctx.connections.bolna(config.connection_id)

        try:
            tmpl = await resolve_template(
                ctx.db, tenant_id=ctx.tenant_id, app_id=ctx.app_id,
                channel="bolna", slug=config.template_slug,
            )
        except TemplateNotFound as exc:
            raise RuntimeError(f"crm.place_bolna_call: {exc}") from exc

        agent_id = config.agent_id
        from_phone = config.from_phone or None
        on_exhausted = config.attempt_policy.on_exhausted_output_id

        # Materialise the cohort so we can pick the dispatch mode. The
        # in-memory cost is small (a few hundred dicts even at the upper
        # end of typical campaigns); if a future tenant pushes 100k+
        # rows we revisit with a streaming CSV writer.
        cohort: list[tuple[str, dict[str, Any]]] = []
        async for rid, payload in input_cohort:
            assert_contact_field_present(
                node_type=self.node_type,
                recipient_id=rid,
                payload=payload,
                field_name=config.phone_field,
            )
            cohort.append((rid, payload))

        if len(cohort) >= BATCH_THRESHOLD:
            return await self._dispatch_batch(
                ctx=ctx,
                config=config,
                tmpl=tmpl,
                cohort=cohort,
                agent_id=agent_id,
                from_phone=from_phone,
                on_exhausted=on_exhausted,
            )
        return await self._dispatch_sequential(
            ctx=ctx,
            service=service,
            config=config,
            tmpl=tmpl,
            cohort=cohort,
            agent_id=agent_id,
            from_phone=from_phone,
            on_exhausted=on_exhausted,
        )

    async def _dispatch_sequential(
        self, *, ctx, service, config, tmpl, cohort, agent_id, from_phone, on_exhausted,
    ) -> NodeResult:
        """Per-recipient ``POST /call`` flow used for cohorts below the
        batch threshold. Identical semantics to the pre-Phase-D handler."""
        success: list[RecipientOutcome] = []
        exhausted: list[RecipientOutcome] = []
        for rid, payload in cohort:
            phone = assert_contact_field_present(
                node_type=self.node_type,
                recipient_id=rid,
                payload=payload,
                field_name=config.phone_field,
            )

            user_data = apply_variable_mappings_dict(
                config.variable_mappings,
                payload,
            )
            idem = ctx.idempotency_key(rid, "bolna", config.template_slug)
            results = await ctx.dispatch_actions([
                ActionDispatch(
                    recipient_id=rid,
                    channel="bolna",
                    action_type="bolna_queued",
                    idempotency_key=idem,
                    payload={
                        "mode": "single",
                        # Persisted on the action so the per-correlation poller
                        # and the anomaly sweep can resolve the connection
                        # without joining ProviderConnection by tenant+app
                        # (which is ambiguous when >1 Bolna connection exists).
                        "connection_id": str(config.connection_id),
                        # Channel-agnostic recipient handle. Cross-channel
                        # reporting reads ``payload.contact`` instead of
                        # COALESCE'ing recipient_phone / whatsapp_number / email.
                        "contact": phone,
                        "agent_id": agent_id,
                        # Channel-specific alias kept for back-compat with
                        # readers that haven't migrated to ``contact`` yet.
                        "recipient_phone": phone,
                        "user_data": user_data,
                        "retry_config": tmpl.payload_schema.get("retry_config"),
                    },
                )
            ])
            r = results[0]
            if r.status != "pending":
                if r.status == "success":
                    success.append(RecipientOutcome(recipient_id=rid))
                else:
                    exhausted.append(RecipientOutcome(recipient_id=rid))
                continue

            async def _attempt(
                _n: int,
                _phone: str = phone,
                _user_data: dict = user_data,
            ) -> dict[str, Any]:
                del _n
                return await service.place_call(
                    agent_id=agent_id,
                    recipient_phone=_phone,
                    user_data=_user_data,
                    from_phone=from_phone,
                    retry_config=tmpl.payload_schema.get("retry_config"),
                )

            outcome = await run_with_attempt_policy(
                policy=config.attempt_policy,
                call=_attempt,
                classify_error=_classify_bolna_error,
            )
            if outcome.status == "success":
                resp = outcome.payload or {}
                execution_id = _extract_bolna_call_id(resp)
                await ctx.update_action_result(
                    r.action_id, status="success",
                    response={**resp, "mode": "single", "attempts": outcome.attempts},
                    bolna_execution_id=execution_id,
                    # Channel-agnostic correlation column (migration 0027).
                    provider_correlation_id=execution_id,
                    provider_status=str(resp.get("status") or "queued").lower(),
                )
                payload_delta: dict[str, Any] = {
                    "last_outcome": "bolna_queued",
                    "last_event_at": datetime.now(timezone.utc).isoformat(),
                }
                if execution_id is not None:
                    payload_delta["bolna_call_id"] = execution_id
                    # Self-replicating poll for this single call. First fire
                    # at +30s; the chain backs off (60s → 15m, ceiling 6h)
                    # and exits when ``provider_terminal`` flips. Webhook
                    # arrival short-circuits the chain at the next tick.
                    await enqueue_bolna_correlation_poll(
                        ctx.db,
                        tenant_id=ctx.tenant_id,
                        app_id=ctx.app_id,
                        run_id=ctx.run_id,
                        connection_id=config.connection_id,
                        correlation_id=str(execution_id),
                        kind="execution",
                    )
                success.append(RecipientOutcome(recipient_id=rid, payload_delta=payload_delta))
            else:
                await ctx.update_action_result(
                    r.action_id, status="failed",
                    error=f"exhausted after {outcome.attempts} attempts: {outcome.last_error}",
                )
                exhausted.append(RecipientOutcome(recipient_id=rid))

        return NodeResult(
            by_output_id={"success": success, on_exhausted: exhausted},
            summary={
                "mode": "single",
                "success_count": len(success),
                "exhausted_count": len(exhausted),
                "template_slug": config.template_slug,
            },
        )

    async def _dispatch_batch(
        self, *, ctx, config, tmpl, cohort, agent_id, from_phone, on_exhausted,
    ) -> NodeResult:
        """Cohort dispatch via ``POST /batches``. Bolna queues the
        dial-out internally; per-execution status is reconciled by the
        Phase E poller (``poll-bolna-executions``).

        Missing contact fields fail the node before any upstream dispatch so
        operators do not silently skip or partially send a malformed cohort.
        """
        success: list[RecipientOutcome] = []
        exhausted: list[RecipientOutcome] = []
        dispatched: list[tuple[str, dict[str, Any], dict[str, Any], str]] = []

        for rid, payload in cohort:
            phone = assert_contact_field_present(
                node_type=self.node_type,
                recipient_id=rid,
                payload=payload,
                field_name=config.phone_field,
            )
            user_data = apply_variable_mappings_dict(
                config.variable_mappings,
                payload,
            )
            idem = ctx.idempotency_key(rid, "bolna", config.template_slug)
            dispatched.append((rid, {"phone": phone, **user_data}, user_data, idem))

        if not dispatched:
            return NodeResult(
                by_output_id={"success": success, on_exhausted: exhausted},
                summary={
                    "mode": "batch",
                    "success_count": 0,
                    "exhausted_count": len(exhausted),
                    "template_slug": config.template_slug,
                },
            )

        # Persist one pending action row per recipient first. The
        # idempotency constraint short-circuits any recipient already
        # dispatched on a prior run pass.
        action_results = await ctx.dispatch_actions([
            ActionDispatch(
                recipient_id=rid,
                channel="bolna",
                action_type="bolna_queued",
                idempotency_key=idem,
                payload={
                    "mode": "batch",
                    # See singles flow: connection_id persisted on the action
                    # so the per-correlation poller and the anomaly sweep can
                    # resolve credentials by id, not by tenant+app scoping.
                    "connection_id": str(config.connection_id),
                    # Channel-agnostic recipient handle (migration 0027).
                    "contact": csv_payload["phone"],
                    "agent_id": agent_id,
                    "recipient_phone": csv_payload["phone"],
                    "user_data": user_data,
                    "retry_config": tmpl.payload_schema.get("retry_config"),
                },
            )
            for rid, csv_payload, user_data, idem in dispatched
        ])
        action_by_recipient = {r.recipient_id: r for r in action_results}

        # Build the CSV from the recipients whose action is pending
        # (exclude any already-completed-from-prior-run rows).
        pending = [
            (rid, csv_payload, user_data)
            for (rid, csv_payload, user_data, _idem) in dispatched
            if action_by_recipient[rid].status == "pending"
        ]
        for rid, _csv_payload, _ud, _idem in dispatched:
            r = action_by_recipient[rid]
            if r.status == "success":
                success.append(RecipientOutcome(recipient_id=rid))
            elif r.status == "failed":
                exhausted.append(RecipientOutcome(recipient_id=rid))
        if not pending:
            return NodeResult(
                by_output_id={"success": success, on_exhausted: exhausted},
                summary={
                    "mode": "batch",
                    "success_count": len(success),
                    "exhausted_count": len(exhausted),
                    "template_slug": config.template_slug,
                    "skipped_already_dispatched": True,
                },
            )

        extra_columns = sorted({
            k for _rid, _csv, ud in pending for k in ud.keys()
        })
        csv_rows = [
            (rid, {"contact_number": csv_payload["phone"], **user_data})
            for rid, csv_payload, user_data in pending
        ]
        csv_bytes = build_cohort_csv(csv_rows, extra_columns=extra_columns)

        batch_service = await ctx.connections.bolna_batch(config.connection_id)
        try:
            batch_resp = await batch_service.create_batch(
                agent_id=agent_id,
                from_phone_numbers=[from_phone] if from_phone else [],
                csv_bytes=csv_bytes,
                filename=f"{config.template_slug}.csv",
                batch_name=f"{config.template_slug}-{ctx.run_id}",
            )
        except BolnaServiceError as exc:
            for rid, _csv, _ud in pending:
                action = action_by_recipient[rid]
                await ctx.update_action_result(
                    action.action_id, status="failed",
                    error=f"batch create failed: {exc}",
                )
                exhausted.append(RecipientOutcome(recipient_id=rid))
            return NodeResult(
                by_output_id={"success": success, on_exhausted: exhausted},
                summary={
                    "mode": "batch",
                    "success_count": len(success),
                    "exhausted_count": len(exhausted),
                    "template_slug": config.template_slug,
                    "batch_error": str(exc),
                },
            )

        batch_id = (
            batch_resp.get("batch_id")
            or batch_resp.get("id")
            or batch_resp.get("batchId")
        )
        for rid, _csv, _ud in pending:
            action = action_by_recipient[rid]
            await ctx.update_action_result(
                action.action_id, status="success",
                response={
                    "mode": "batch",
                    "batch_id": batch_id,
                    "batch_status": batch_resp.get("status"),
                    "execution_id": None,
                },
                bolna_batch_id=str(batch_id) if batch_id else None,
                # Channel-agnostic correlation column. Batches → batch_id
                # (per-recipient execution_ids land later via the poller).
                provider_correlation_id=str(batch_id) if batch_id else None,
                provider_status=str(batch_resp.get("status") or "queued").lower(),
            )
            # Recipients flow to ``success`` immediately; per-execution
            # outcome (transcript, recording, hangup reason) is filled in
            # by the per-correlation poller below via the bolna_reconciler.
            success.append(RecipientOutcome(
                recipient_id=rid,
                payload_delta={
                    "bolna_batch_id": str(batch_id) if batch_id else "",
                    "last_outcome": "bolna_queued",
                    "last_event_at": datetime.now(timezone.utc).isoformat(),
                },
            ))

        # One self-replicating poll covers every recipient in this batch.
        # The handler walks GET /batches/{id}/executions paginated and
        # matches by recipient_id (set in the CSV ``recipient_id`` column).
        if batch_id:
            await enqueue_bolna_correlation_poll(
                ctx.db,
                tenant_id=ctx.tenant_id,
                app_id=ctx.app_id,
                run_id=ctx.run_id,
                connection_id=config.connection_id,
                correlation_id=str(batch_id),
                kind="batch",
            )

        return NodeResult(
            by_output_id={"success": success, on_exhausted: exhausted},
            summary={
                "mode": "batch",
                "batch_id": str(batch_id) if batch_id else None,
                "success_count": len(success),
                "exhausted_count": len(exhausted),
                "template_slug": config.template_slug,
            },
        )


def _extract_bolna_call_id(resp: dict[str, Any]) -> Optional[str]:
    """Pull the upstream correlation id out of Bolna's POST /call response.

    Bolna's documented v2 response is ``{message, status, execution_id}``
    — see ``BolnaService`` docstring. The legacy ``call_id`` / ``id`` /
    ``bolna_call_id`` keys never actually shipped from prod Bolna and
    were kept only as a defensive fallback. ``execution_id`` is the
    canonical key and MUST come first; every dispatched call drops on
    the floor without it (no polling chain enqueued, no
    ``bolna_execution_id`` stamped on the action, no transcript /
    recording / outcome ever reconciled).
    """
    for key in ("execution_id", "call_id", "id", "bolna_call_id"):
        v = resp.get(key)
        if v:
            return str(v)
    return None
