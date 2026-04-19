"""Agents SDK ``TracingProcessor`` that feeds ``llm_usage``.

Design contract (from the hardened spec §7.2):

1. **Generation spans only.** Tool spans stay in ``agent_tool_logs`` / Sherlock
   runtime events. Non-generation spans are ignored here.
2. **Never raises.** Every hook is wrapped in ``try/except`` so tracing
   failures cannot break the Sherlock turn.
3. **Owner attribution comes from ``SHERLOCK_TURN_CONTEXT``.** If the
   contextvar is unset when a span ends, we skip recording rather than
   guessing who the run belongs to.
4. **Aggregate fallback.** If a trace ends without a single generation span
   producing real token counts, we emit one ``agents_sdk_aggregate`` row per
   trace so the turn still has a call-count record. This matches the
   "best-effort, no fabrication" guarantee in §6.

The processor is registered once at import time (call
``install_cost_tracking_processor()`` from the adapter). The Agents SDK keeps
one global trace provider, so repeated registration must be a no-op — the
helper enforces that.
"""
from __future__ import annotations

import asyncio
import contextvars
import logging
import threading
from typing import Any

from agents.tracing import (
    ResponseSpanData,
    Span,
    Trace,
    TracingProcessor,
    add_trace_processor,
)

from app.services.cost_tracking.correlation import (
    SherlockTurnContext,
    get_sherlock_turn_context,
)
from app.services.cost_tracking.models import LLMCallMetadata, empty_metadata
from app.services.cost_tracking.normalizers import (
    normalize_openai_chat,
    normalize_openai_responses,
)
from app.services.cost_tracking.recorder import record_llm_usage

_log = logging.getLogger(__name__)

_INSTALLED = False
_INSTALL_LOCK = threading.Lock()


class _TraceState:
    """Accumulator used to decide whether to emit an aggregate fallback row."""

    __slots__ = ('turn_context', 'generation_rows_written', 'aggregate_meta')

    def __init__(self, turn_context: SherlockTurnContext | None) -> None:
        self.turn_context = turn_context
        self.generation_rows_written = 0
        self.aggregate_meta: LLMCallMetadata | None = None


class CostTrackingProcessor(TracingProcessor):
    """Record Agents SDK generation spans into ``llm_usage``."""

    def __init__(self) -> None:
        # Keyed by trace_id. The SDK guarantees on_trace_start → on_span_* →
        # on_trace_end ordering per trace, but multiple traces may interleave
        # so we keep per-trace state explicitly.
        self._traces: dict[str, _TraceState] = {}
        self._lock = threading.Lock()

    # ── TracingProcessor interface ───────────────────────────────────

    def on_trace_start(self, trace: Trace) -> None:
        try:
            with self._lock:
                self._traces[trace.trace_id] = _TraceState(get_sherlock_turn_context())
        except Exception:
            _log.debug('on_trace_start failed', exc_info=True)

    def on_span_start(self, span: Span[Any]) -> None:
        # We only care about ends (they carry usage).
        return None

    def on_span_end(self, span: Span[Any]) -> None:
        try:
            self._handle_span_end(span)
        except Exception:
            _log.debug('on_span_end failed', exc_info=True)

    def on_trace_end(self, trace: Trace) -> None:
        try:
            self._handle_trace_end(trace)
        except Exception:
            _log.debug('on_trace_end failed', exc_info=True)

    def force_flush(self) -> None:
        return None

    def shutdown(self) -> None:
        with self._lock:
            self._traces.clear()

    # ── Internals ────────────────────────────────────────────────────

    def _handle_span_end(self, span: Span[Any]) -> None:
        data = span.span_data
        state = self._traces.get(span.trace_id)
        if state is None or state.turn_context is None:
            return

        metadata, model, api_surface = _extract_span_metadata(data)
        if metadata is None:
            return

        turn_ctx = state.turn_context
        if _has_real_usage(metadata):
            state.generation_rows_written += 1
            _schedule_record(
                tenant_id=turn_ctx.tenant_id,
                user_id=turn_ctx.user_id,
                app_id=turn_ctx.app_id,
                owner_type='sherlock_turn',
                owner_id=turn_ctx.turn_id,
                subsystem=turn_ctx.subsystem,
                provider='openai',  # agents SDK drives openai/azure today
                model=model or '',
                api_surface=api_surface,
                metadata=metadata,
                call_purpose='sherlock_turn',
            )
            return

        # No real tokens on this span — accumulate into the aggregate so we
        # still persist a call-count record once the trace ends.
        agg = state.aggregate_meta
        if agg is None:
            agg = empty_metadata()
        state.aggregate_meta = _merge_metadata(agg, metadata)

    def _handle_trace_end(self, trace: Trace) -> None:
        with self._lock:
            state = self._traces.pop(trace.trace_id, None)
        if state is None or state.turn_context is None:
            return

        if state.generation_rows_written > 0 or state.aggregate_meta is None:
            return

        # No per-span usage was recorded. Persist exactly one aggregate row so
        # the turn at least has a "a run happened" marker instead of silence.
        turn_ctx = state.turn_context
        aggregate = state.aggregate_meta
        _schedule_record(
            tenant_id=turn_ctx.tenant_id,
            user_id=turn_ctx.user_id,
            app_id=turn_ctx.app_id,
            owner_type='sherlock_turn',
            owner_id=turn_ctx.turn_id,
            subsystem=turn_ctx.subsystem,
            provider='openai',
            model=aggregate.get('model', '') or '',
            api_surface='agents_sdk_aggregate',
            metadata=aggregate,
            call_purpose='sherlock_turn',
        )


# ── Helpers ──────────────────────────────────────────────────────────


def _extract_span_metadata(
    span_data: Any,
) -> tuple[LLMCallMetadata | None, str | None, str | None]:
    """Return ``(metadata, model, api_surface)`` for a generation-class span."""
    if isinstance(span_data, ResponseSpanData):
        response = span_data.response
        if response is not None:
            meta = normalize_openai_responses(response)
            return meta, getattr(response, 'model', None), 'agents_sdk_response'
        usage_dict = span_data.usage or {}
        if not usage_dict:
            return None, None, None
        # Build a minimal envelope from the raw usage map. Keep defensively.
        meta = empty_metadata()
        meta['provider'] = 'openai'
        meta['api_surface'] = 'agents_sdk_response'
        meta['input_tokens'] = int(usage_dict.get('input_tokens') or 0)
        meta['output_tokens'] = int(usage_dict.get('output_tokens') or 0)
        input_details = usage_dict.get('input_tokens_details') or {}
        if isinstance(input_details, dict):
            meta['cached_read_tokens'] = int(input_details.get('cached_tokens') or 0)
            meta['input_tokens'] = max(0, meta['input_tokens'] - meta['cached_read_tokens'])
        output_details = usage_dict.get('output_tokens_details') or {}
        if isinstance(output_details, dict):
            reasoning = int(output_details.get('reasoning_tokens') or 0)
            meta['reasoning_tokens'] = reasoning
            meta['output_tokens'] = max(0, meta['output_tokens'] - reasoning)
        return meta, None, 'agents_sdk_response'

    # GenerationSpanData (chat completions / legacy completions path).
    model = getattr(span_data, 'model', None)
    usage = getattr(span_data, 'usage', None)
    if usage is None:
        return None, None, None
    # Use the chat normalizer's field map — it's compatible with the shape
    # ``GenerationSpanData.usage`` typically carries.
    class _FakeResponse:
        def __init__(self, usage_dict: dict) -> None:
            self.usage = _Namespace(usage_dict)

    class _Namespace:
        def __init__(self, payload: dict) -> None:
            for key, value in payload.items():
                setattr(self, key, value if not isinstance(value, dict) else _Namespace(value))

    try:
        meta = normalize_openai_chat(_FakeResponse(usage), provider='openai')
    except Exception:
        meta = None
    if meta is None:
        return None, model, 'agents_sdk_generation'
    return meta, model, 'agents_sdk_generation'


def _has_real_usage(metadata: LLMCallMetadata) -> bool:
    keys = (
        'input_tokens',
        'output_tokens',
        'cached_read_tokens',
        'cached_write_tokens',
        'reasoning_tokens',
        'tool_use_prompt_tokens',
    )
    return any(int(metadata.get(k) or 0) > 0 for k in keys)  # type: ignore[literal-required]


def _merge_metadata(base: LLMCallMetadata, add: LLMCallMetadata) -> LLMCallMetadata:
    token_keys = (
        'input_tokens',
        'output_tokens',
        'cached_read_tokens',
        'cached_write_tokens',
        'reasoning_tokens',
        'tool_use_prompt_tokens',
    )
    for key in token_keys:
        base[key] = int(base.get(key) or 0) + int(add.get(key) or 0)  # type: ignore[literal-required]
    # Keep first seen model / api_surface to aid debugging.
    if not base.get('model') and add.get('model'):
        base['model'] = add['model']
    if not base.get('api_surface') and add.get('api_surface'):
        base['api_surface'] = add['api_surface']
    return base


def _schedule_record(**kwargs: Any) -> None:
    """Fire-and-forget ``record_llm_usage`` from a sync tracing hook.

    The tracing processor is invoked by the Agents SDK runtime — sometimes on
    the same event loop (the sync hook is called from inside an async task),
    sometimes from a worker thread. We handle both: prefer
    ``asyncio.create_task`` when a loop is running, fall back to
    ``asyncio.run`` otherwise. Failures never raise.
    """
    coro_factory = _bind_coroutine(kwargs)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is not None:
        # ContextVars are captured at task creation — wrap so SHERLOCK_TURN_CONTEXT
        # is not re-read from a different context when the task actually runs.
        ctx = contextvars.copy_context()
        loop.create_task(coro_factory(), name='cost_tracking_record')
        _ = ctx  # ctx retained purely to make the intent explicit
        return

    try:
        asyncio.run(coro_factory())
    except Exception:
        _log.debug('cost_tracking sync-path record failed', exc_info=True)


def _bind_coroutine(kwargs: dict[str, Any]):
    async def _run() -> None:
        try:
            await record_llm_usage(**kwargs)
        except Exception:
            _log.debug('record_llm_usage inside tracing processor failed', exc_info=True)

    return _run


def install_cost_tracking_processor() -> CostTrackingProcessor | None:
    """Register the processor once per process. Subsequent calls are no-ops."""
    global _INSTALLED
    with _INSTALL_LOCK:
        if _INSTALLED:
            return None
        processor = CostTrackingProcessor()
        try:
            add_trace_processor(processor)
        except Exception:
            _log.warning('Failed to register CostTrackingProcessor', exc_info=True)
            return None
        _INSTALLED = True
        return processor


