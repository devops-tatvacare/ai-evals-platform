"""Sherlock v3 runtime — one-turn execution + SSE event normalization.

The route handler at ``/api/chat/turn`` is a thin orchestrator: it persists
the user message, opens an SSE stream, and consumes ``run_turn`` to emit
v3 events to the wire. All SDK interaction lives here.

Continuation strategy is ``previous_response_id`` chains (architecture spec
§4.2 post-2026-05-09 refresh). The chain head is persisted on
``platform.sherlock_agent_sessions.last_response_id`` (column added in an
earlier migration; existing model field). On chain expiry (>30 days)
Azure raises a stale-id error and the runtime replays the turn with
``previous_response_id=None``; this turn pays the full prompt cost but
the conversation continues.
"""
from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field, replace
from typing import Any

from agents import Runner

from app.auth.context import AuthContext
from app.services.orchestration_authoring.builder_snapshot import BuilderSnapshot
from app.services.sherlock_v3.azure_client import get_sherlock_azure_client
from app.services.sherlock_v3.intent_classifier import classify_intent
from app.services.sherlock_v3.manifest_projection import (
    GroundingContext,
    project_for_intent,
)
from app.services.sherlock_v3.supervisor import build_supervisor

logger = logging.getLogger(__name__)


# ─────────────────────────── context ───────────────────────────


@dataclass
class SherlockTurnContext:
    """Per-turn handles passed to the SDK as ``RunContextWrapper.context``.

    Decision D5: ``RunContextWrapper.context`` is a per-request handle bag,
    not a store. State lives in ``platform.sherlock_state``; evidence in
    ``platform.sherlock_evidence``. This class holds *only* the things a
    tool handler might need to reach back to: tenant/user/app, the chat
    session id, a turn id for evidence rows + event seq, and a per-turn
    ``scratch`` dict that specialist tools use to hand intermediate state
    across each other inside one turn.

    `auth` is required so per-tool re-checks (R3) can read permissions /
    app_access without reaching back into the route. `builder_context` is
    optional; the route handler stamps it only when a builder page is
    open AND `'orchestration:manage'` is in `auth.permissions`.
    """

    tenant_id: uuid.UUID
    user_id: uuid.UUID
    app_id: str
    chat_session_id: uuid.UUID
    turn_id: uuid.UUID
    auth: AuthContext
    previous_response_id: str | None = None
    streamed_text_parts: list[str] = field(default_factory=list)
    scratch: dict[str, Any] = field(default_factory=dict)
    builder_context: BuilderSnapshot | None = None


# ─────────────────────────── stale-chain detection ───────────────


_STALE_PREVIOUS_RESPONSE_ID_MARKERS = (
    'previous_response_not_found',
    'previous_response was not found',
    'previous response not found',
)


def _is_stale_previous_response_id(exc: BaseException) -> bool:
    """Detect Azure/OpenAI's "this response_id is too old" error.

    Triggered when the chain head has aged past the 30-day retention.
    The runtime replays the turn once with ``previous_response_id=None``;
    further failures bubble up as ``error_emitted``.
    """
    raw = repr(exc).lower()
    return any(marker in raw for marker in _STALE_PREVIOUS_RESPONSE_ID_MARKERS)


# ─────────────────────────── event normalization ─────────────────


def normalize_to_v3_events(
    event: Any,
    ctx: SherlockTurnContext | None = None,
) -> list[dict[str, Any]]:
    """Map an Agents-SDK stream event onto a v3 SSE envelope (§14.5).

    Returns ``None`` for SDK events that have no v3 wire-equivalent (the
    consumer should silently drop them). Returns a dict with at least a
    ``type`` field for events that map.

    P1 covers the minimum surface needed to flow happy-path turns end-to-
    end: ``content_delta`` (with phase), ``specialist_started`` /
    ``specialist_finished``, ``agent_updated``, ``error_emitted``. The
    full event surface from §14.5 is implemented incrementally as the
    chat-widget consumer (P3) catches up.
    """
    event_type = type(event).__name__

    if event_type == 'RawResponsesStreamEvent':
        data = getattr(event, 'data', None)
        raw_type = str(getattr(data, 'type', '') or '')
        delta = getattr(data, 'delta', None)
        if isinstance(delta, str) and delta:
            if raw_type == 'response.output_text.delta':
                return [{'type': 'content_delta', 'phase': 'final_answer', 'text': delta}]
            # function_call_arguments.delta is the supervisor LLM streaming the
            # raw TaskBrief JSON — internal noise, not user-facing.
        return []

    if event_type == 'AgentUpdatedStreamEvent':
        return [{
            'type': 'agent_updated',
            'from_agent': getattr(getattr(event, 'previous_agent', None), 'name', '') or 'supervisor',
            'to_agent': getattr(getattr(event, 'new_agent', None), 'name', '') or 'unknown',
        }]

    if event_type == 'RunItemStreamEvent':
        item_name = getattr(event, 'name', '')
        if item_name == 'tool_called':
            tool_call = getattr(event, 'item', None)
            specialist = _tool_call_name(tool_call)
            call_id = _tool_call_call_id(tool_call)
            if ctx is not None and call_id:
                ctx.scratch.setdefault('tool_call_names', {})[call_id] = specialist
            return [{
                'type': 'specialist_started',
                'specialist': specialist,
                'call_id': call_id,
                'brief_summary': _tool_call_brief(tool_call),
            }]
        if item_name == 'tool_output':
            tool_output = getattr(event, 'item', None)
            result = _extract_specialist_result(tool_output)
            call_id = _tool_output_call_id(tool_output)
            specialist = _tool_output_name(tool_output, ctx=ctx, call_id=call_id)
            events: list[dict[str, Any]] = [{
                'type': 'specialist_finished',
                'specialist': specialist,
                'call_id': call_id,
                'status': str(result.get('status') or 'ok') if result else 'ok',
                'result_summary': str(result.get('summary') or '') if result else '',
                'evidence_refs': _evidence_ref_ids(result),
                'artifact_refs': _artifact_ref_ids(result),
                'duration_ms': _specialist_latency_ms(result),
                # Phase 1A telemetry: surface the grounded routing
                # decision (intent class + projected tables + attempted
                # SQL) on the wire so the chat widget can narrate the
                # specialist's work concretely instead of "Used 2 tools".
                'routing': _specialist_routing(result),
                'row_count': _specialist_row_count(result),
            }]
            if result:
                for artifact in _specialist_artifacts(result):
                    events.append({
                        'type': 'artifact_emitted',
                        'kind': artifact['kind'],
                        'payload': artifact['payload'],
                    })
            return events

    return []


def normalize_to_v3_event(event: Any) -> dict[str, Any] | None:
    """Compatibility wrapper for callers/tests that expect a single event."""
    events = normalize_to_v3_events(event)
    return events[0] if events else None


def _raw_item(item: Any) -> Any:
    return getattr(item, 'raw_item', item)


def _tool_call_name(item: Any) -> str:
    raw = _raw_item(item)
    if isinstance(raw, dict):
        return str(raw.get('name') or 'data_specialist')
    return str(getattr(raw, 'name', '') or 'data_specialist')


def _tool_call_call_id(item: Any) -> str:
    raw = _raw_item(item)
    if isinstance(raw, dict):
        return str(raw.get('call_id') or '')
    return str(getattr(raw, 'call_id', '') or '')


def _tool_call_brief(item: Any) -> str:
    raw = _raw_item(item)
    args = raw.get('arguments') if isinstance(raw, dict) else getattr(raw, 'arguments', None)
    if not isinstance(args, str) or not args:
        return ''
    try:
        payload = json.loads(args)
    except json.JSONDecodeError:
        return ''
    if not isinstance(payload, dict):
        return ''
    task = payload.get('task')
    if isinstance(task, str):
        return task[:240]
    nested_input = payload.get('input')
    if isinstance(nested_input, str):
        return nested_input[:240]
    return ''


def _tool_output_payload(item: Any) -> Any:
    return getattr(item, 'output', None)


def _tool_output_name(
    item: Any,
    *,
    ctx: SherlockTurnContext | None,
    call_id: str,
) -> str:
    if ctx is not None and call_id:
        names = ctx.scratch.get('tool_call_names')
        if isinstance(names, dict) and isinstance(names.get(call_id), str):
            return names[call_id]
    raw = getattr(item, 'raw_item', None)
    if isinstance(raw, dict):
        return str(raw.get('name') or raw.get('tool_name') or 'data_specialist')
    return str(getattr(raw, 'name', '') or getattr(item, 'name', '') or 'data_specialist')


def _tool_output_call_id(item: Any) -> str:
    raw = getattr(item, 'raw_item', None)
    if isinstance(raw, dict):
        return str(raw.get('call_id') or '')
    return str(getattr(raw, 'call_id', '') or getattr(item, 'call_id', '') or '')


def _extract_specialist_result(item: Any) -> dict[str, Any] | None:
    payload = _tool_output_payload(item)
    if isinstance(payload, str):
        try:
            decoded = json.loads(payload)
        except json.JSONDecodeError:
            return None
        return decoded if isinstance(decoded, dict) and 'status' in decoded else None
    return payload if isinstance(payload, dict) and 'status' in payload else None


def _evidence_ref_ids(result: dict[str, Any] | None) -> list[str]:
    if not result:
        return []
    evidence = result.get('evidence')
    if not isinstance(evidence, list):
        return []
    refs: list[str] = []
    for item in evidence:
        if isinstance(item, dict) and item.get('ref_id'):
            refs.append(str(item['ref_id']))
    return refs


def _specialist_artifacts(result: dict[str, Any]) -> list[dict[str, Any]]:
    artifacts = result.get('artifacts')
    if not isinstance(artifacts, list):
        return []
    out: list[dict[str, Any]] = []
    for item in artifacts:
        if not isinstance(item, dict):
            continue
        kind = item.get('kind')
        payload = item.get('payload')
        if isinstance(kind, str) and isinstance(payload, dict):
            out.append({'kind': kind, 'payload': payload})
    return out


def _artifact_ref_ids(result: dict[str, Any] | None) -> list[str]:
    if not result:
        return []
    artifacts = _specialist_artifacts(result)
    return [f'artifact_{idx + 1}' for idx, _artifact in enumerate(artifacts)]


def _specialist_latency_ms(result: dict[str, Any] | None) -> int:
    if not result:
        return 0
    meta = result.get('meta')
    if not isinstance(meta, dict):
        return 0
    latency = meta.get('latency_ms')
    return latency if isinstance(latency, int) else 0


def _specialist_routing(result: dict[str, Any] | None) -> dict[str, Any] | None:
    """Pull the Phase 1A routing block off the SpecialistResult ``meta``.

    Shape (set by ``data_specialist._emit_with_telemetry``):
      ``{intent_class, allowed_layers, projected_tables,
         attempted_sql, validation_result, execution_status,
         chart_payload_kind, status, latency_ms, grounding}``

    Returned to the wire only when present; widget treats absence as
    "no projection ran for this turn" and degrades the chip narration
    gracefully.
    """
    if not result:
        return None
    meta = result.get('meta')
    if not isinstance(meta, dict):
        return None
    routing = meta.get('routing')
    return routing if isinstance(routing, dict) else None


def _specialist_row_count(result: dict[str, Any] | None) -> int | None:
    """Best-effort row count for the chip narration.

    Pulled from the first artifact's ``data`` array length when present
    (table fallbacks always carry one) — not a contract field, so we
    return ``None`` when it can't be derived rather than lying with 0.
    """
    if not result:
        return None
    artifacts = _specialist_artifacts(result)
    if not artifacts:
        return None
    payload = artifacts[0].get('payload')
    if not isinstance(payload, dict):
        return None
    data = payload.get('data')
    if isinstance(data, list):
        return len(data)
    return None


# ─────────────────────────── grounding (Phase 1A) ────────────────


async def _compute_grounding(
    app_id: str,
    user_message: str,
    *,
    tenant_id: uuid.UUID,
) -> GroundingContext | None:
    """Build the per-turn ``GroundingContext`` from ``user_message`` + manifest.

    Returns ``None`` when projection cannot be computed for this app
    (no manifest, semantic-model load failure) — the agent then falls
    back to the unprojected schema and the routing telemetry records
    no ``grounding`` block. Failure modes here MUST NOT crash a turn:
    the worst case is "no projection, behave like pre-Phase-1A", which
    is strictly an improvement over silently breaking the chat surface.

    Phase 2A: also retrieves verified question→SQL examples from
    ``platform.sherlock_verified_queries`` (lexical Jaccard against
    ``user_message``). Retrieval failure is non-fatal — the grounding
    context still ships projection, with empty ``verified_examples``.
    """
    try:
        from app.services.chat_engine.manifest import get_manifest
        from app.services.chat_engine.sql_agent import (
            _allowed_tables,
            _build_schema_context,
            _column_role_hints,
            load_semantic_model,
        )

        manifest = get_manifest(app_id)
        intent_class = classify_intent(user_message)
        semantic_model = load_semantic_model(app_id)
        schema_context = _build_schema_context(semantic_model, None)
        grounding = project_for_intent(
            app_id=app_id,
            user_message=user_message,
            intent_class=intent_class,
            manifest=manifest,
            schema_context=schema_context,
            full_allowed_tables=sorted(_allowed_tables(semantic_model)),
            full_role_hints=_column_role_hints(schema_context, app_id=app_id),
        )
    except Exception as exc:  # noqa: BLE001 — non-fatal; degrade to unprojected
        logger.warning(
            'sherlock_v3 grounding computation failed for app=%s; '
            'falling back to unprojected schema: %s',
            app_id, exc,
        )
        return None

    # Phase 2A — verified-query retrieval + Phase 3 instructions load.
    # Both are additive on top of the projection contract; failure of
    # either is non-fatal and degrades to the prior-phase behavior.
    try:
        from app.database import async_session
        from app.services.sherlock_v3.instructions import load_instructions
        from app.services.sherlock_v3.manifest_projection import VerifiedExampleRef
        from app.services.sherlock_v3.verified_queries import retrieve_top_k

        async with async_session() as db:
            hits = await retrieve_top_k(
                user_message,
                tenant_id=tenant_id,
                app_id=app_id,
                db=db,
                k=5,
            )
            instructions_block = await load_instructions(
                app_id, tenant_id=tenant_id, db=db,
            )
        verified = tuple(
            VerifiedExampleRef(
                id=str(h.id), question=h.question, sql=h.sql,
                score=h.score, source=h.source,
            )
            for h in hits
        )
        return replace(
            grounding,
            verified_examples=verified,
            instructions_block=instructions_block,
        )
    except Exception as exc:  # noqa: BLE001 — non-fatal
        logger.warning(
            'sherlock_v3 grounding enrichment failed for app=%s; '
            'continuing with projection only: %s',
            app_id, exc,
        )
        return grounding


# ─────────────────────────── run_turn ────────────────────────────


async def run_turn(
    user_message: str,
    ctx: SherlockTurnContext,
    *,
    max_turns: int = 10,
) -> AsyncIterator[dict[str, Any]]:
    """Execute one Sherlock v3 turn, streaming v3 SSE events.

    The caller (route handler) is responsible for:
      * writing the user row to ``platform.chat_messages`` *before* calling
      * persisting the assistant row + ``last_response_id`` *after* the
        ``turn_finished`` event yields
      * writing each yielded event into ``platform.sherlock_turn_events``
        *before* flushing it onto the wire (DB-at-or-ahead-of-wire rule
        from §14.4)

    On stale ``previous_response_id`` we replay once with ``None`` —
    further failures bubble up as ``error_emitted`` events.
    """
    client = await get_sherlock_azure_client(
        tenant_id=ctx.tenant_id, user_id=ctx.user_id,
    )

    # Phase 1A: compute grounding from the user_message + manifest
    # BEFORE the agent is constructed. The result is passed explicitly
    # through ``build_supervisor`` -> ``build_data_specialist`` instead
    # of being stashed on ``ctx.scratch`` (Plan §1.2).
    grounding = await _compute_grounding(
        ctx.app_id, user_message, tenant_id=ctx.tenant_id,
    )
    supervisor = build_supervisor(
        ctx.app_id,
        client,
        grounding=grounding,
        builder_context=ctx.builder_context,
        auth=ctx.auth,
    )

    try:
        async for normalized in _stream_once(
            supervisor, user_message, ctx, ctx.previous_response_id, max_turns,
        ):
            yield normalized
        return
    except Exception as exc:
        if not _is_stale_previous_response_id(exc):
            yield {
                'type': 'error_emitted',
                'source': 'supervisor',
                'message': f'{type(exc).__name__}: {exc}',
                'recoverable': False,
            }
            return
        logger.warning(
            'sherlock_v3.run_turn previous_response_id is stale '
            '(>30d); replaying turn=%s without prior chain',
            ctx.turn_id,
        )

    # Stale chain — replay full text history with previous_response_id=None.
    try:
        replay_input = await _history_input_for_context(ctx)
        if not replay_input or replay_input[-1] != {'role': 'user', 'content': user_message}:
            replay_input.append({'role': 'user', 'content': user_message})
        async for normalized in _stream_once(
            supervisor, replay_input or user_message, ctx, None, max_turns,
        ):
            yield normalized
    except Exception as exc:
        yield {
            'type': 'error_emitted',
            'source': 'supervisor',
            'message': f'{type(exc).__name__}: {exc}',
            'recoverable': False,
        }


async def _stream_once(
    supervisor: Any,
    input_payload: Any,
    ctx: SherlockTurnContext,
    previous_response_id: str | None,
    max_turns: int,
) -> AsyncIterator[dict[str, Any]]:
    """Inner streamer — exists so the stale-chain replay is one call site."""
    streaming = Runner.run_streamed(
        supervisor,
        input_payload,
        context=ctx,
        max_turns=max_turns,
        previous_response_id=previous_response_id,
    )
    async for event in streaming.stream_events():
        for normalized in normalize_to_v3_events(event, ctx=ctx):
            yield normalized

    # Caller persists the chain head from the final RunResult.
    final_response_id = getattr(streaming, 'last_response_id', None)
    yield {
        'type': 'turn_finished',
        'turn_id': str(ctx.turn_id),
        'status': 'done',
        'final_message_id': None,  # written by route handler post-yield
        'usage': _extract_usage(streaming),
        'last_response_id': final_response_id,
    }


async def _history_input_for_context(ctx: SherlockTurnContext) -> list[dict[str, str]]:
    from app.database import async_session
    from app.models.chat import ChatMessage
    from sqlalchemy import select

    async with async_session() as db:
        rows = (
            await db.execute(
                select(ChatMessage.role, ChatMessage.content)
                .where(
                    ChatMessage.session_id == ctx.chat_session_id,
                    ChatMessage.tenant_id == ctx.tenant_id,
                    ChatMessage.user_id == ctx.user_id,
                    ChatMessage.status.in_(('complete', 'streaming')),
                    ChatMessage.role.in_(('user', 'assistant')),
                )
                .order_by(ChatMessage.created_at, ChatMessage.id)
            )
        ).all()
    return [
        {'role': role, 'content': content}
        for role, content in rows
        if role in {'user', 'assistant'} and content
    ]


def _extract_usage(streaming: Any) -> dict[str, Any]:
    """Pull token + cost telemetry off the streamed RunResult.

    The SDK guarantees ``streaming.context_wrapper.usage`` exists after
    a successful run. If it doesn't, the SDK shape changed and we want
    to surface that loudly via a log warning rather than silently
    reporting zero tokens (which would corrupt cost telemetry).
    """
    ctx_wrapper = getattr(streaming, 'context_wrapper', None)
    usage = getattr(ctx_wrapper, 'usage', None) if ctx_wrapper else None
    if usage is None:
        logger.warning(
            'sherlock_v3 runtime: streaming.context_wrapper.usage is None — '
            'SDK shape changed? cost telemetry for this turn will be zero',
        )
        return {
            'input_tokens': 0, 'output_tokens': 0, 'cached_read_tokens': 0,
            'cost_usd': 0.0, 'call_count': 0,
        }
    return {
        'input_tokens': getattr(usage, 'input_tokens', 0),
        'output_tokens': getattr(usage, 'output_tokens', 0),
        'cached_read_tokens': getattr(usage, 'cached_input_tokens', 0),
        'cost_usd': 0.0,  # filled in by the route handler against pricing_cache
        'call_count': getattr(usage, 'requests', 0),
    }
