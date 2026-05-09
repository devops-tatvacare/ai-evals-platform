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

import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from agents import Runner

from app.services.sherlock_v3.azure_client import get_sherlock_azure_client
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
    session id, and a turn id for evidence rows + event seq.
    """

    tenant_id: uuid.UUID
    user_id: uuid.UUID
    app_id: str
    chat_session_id: uuid.UUID
    turn_id: uuid.UUID
    previous_response_id: str | None = None
    streamed_text_parts: list[str] = field(default_factory=list)


# ─────────────────────────── stale-chain detection ───────────────


_STALE_PREVIOUS_RESPONSE_ID_MARKERS = (
    'previous_response_not_found',
    'previous_response was not found',
    'previous response not found',
)


def _is_stale_previous_response_id(exc: BaseException) -> bool:
    """Detect Azure/OpenAI's "this response_id is too old" error.

    Mirrors the existing helper at
    ``backend/app/services/report_builder/chat_handler.py:1443`` so the v3
    runtime and the legacy chat handler agree on what counts as stale.
    """
    raw = repr(exc).lower()
    return any(marker in raw for marker in _STALE_PREVIOUS_RESPONSE_ID_MARKERS)


# ─────────────────────────── event normalization ─────────────────


def normalize_to_v3_event(event: Any) -> dict[str, Any] | None:
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

    # SDK emits ``RawResponsesStreamEvent`` for token-level deltas. We
    # don't yet inspect the underlying response item to attach the
    # ``commentary`` / ``final_answer`` phase tag — that lands in P3 with
    # the supervisor prompt's ``phase:`` discipline. Until then we pass
    # text deltas through tagged as ``final_answer`` so the chat widget
    # renders them in the message body lane.
    if event_type == 'RawResponsesStreamEvent':
        delta = getattr(getattr(event, 'data', None), 'delta', None)
        if isinstance(delta, str) and delta:
            return {'type': 'content_delta', 'phase': 'final_answer', 'text': delta}
        return None

    if event_type == 'AgentUpdatedStreamEvent':
        return {
            'type': 'agent_updated',
            'from_agent': getattr(getattr(event, 'previous_agent', None), 'name', '') or 'supervisor',
            'to_agent': getattr(getattr(event, 'new_agent', None), 'name', '') or 'unknown',
        }

    if event_type == 'RunItemStreamEvent':
        item_name = getattr(event, 'name', '')
        if item_name == 'tool_called':
            tool_call = getattr(event, 'item', None)
            return {
                'type': 'specialist_started',
                'specialist': getattr(tool_call, 'name', '') or 'unknown',
                'call_id': getattr(tool_call, 'call_id', '') or '',
                'brief_summary': '',
            }
        if item_name == 'tool_output':
            tool_call = getattr(event, 'item', None)
            return {
                'type': 'specialist_finished',
                'specialist': getattr(tool_call, 'name', '') or 'unknown',
                'call_id': getattr(tool_call, 'call_id', '') or '',
                'status': 'ok',
                'result_summary': '',
                'evidence_refs': [],
                'artifact_refs': [],
                'duration_ms': 0,
            }

    return None


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
    supervisor = build_supervisor(ctx.app_id, client)

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

    # Stale chain — replay with previous_response_id=None.
    try:
        async for normalized in _stream_once(
            supervisor, user_message, ctx, None, max_turns,
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
    user_message: str,
    ctx: SherlockTurnContext,
    previous_response_id: str | None,
    max_turns: int,
) -> AsyncIterator[dict[str, Any]]:
    """Inner streamer — exists so the stale-chain replay is one call site."""
    streaming = Runner.run_streamed(
        supervisor,
        user_message,
        context=ctx,
        max_turns=max_turns,
        previous_response_id=previous_response_id,
    )
    async for event in streaming.stream_events():
        normalized = normalize_to_v3_event(event)
        if normalized is not None:
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


def _extract_usage(streaming: Any) -> dict[str, Any]:
    """Pull token + cost telemetry off the streamed RunResult.

    Robust to SDK minor-version drift in attribute names.
    """
    ctx_wrapper = getattr(streaming, 'context_wrapper', None)
    usage = getattr(ctx_wrapper, 'usage', None) if ctx_wrapper else None
    if usage is None:
        usage = getattr(streaming, 'usage', None)
    if usage is None:
        return {
            'input_tokens': 0,
            'output_tokens': 0,
            'cached_read_tokens': 0,
            'cost_usd': 0.0,
            'call_count': 0,
        }
    return {
        'input_tokens': getattr(usage, 'input_tokens', 0) or 0,
        'output_tokens': getattr(usage, 'output_tokens', 0) or 0,
        'cached_read_tokens': (
            getattr(usage, 'cached_input_tokens', 0)
            or getattr(usage, 'cached_tokens', 0)
            or 0
        ),
        'cost_usd': 0.0,  # filled in by the route handler against pricing_cache
        'call_count': getattr(usage, 'requests', 0) or 0,
    }
