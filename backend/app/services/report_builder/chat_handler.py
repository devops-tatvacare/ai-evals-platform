"""
Report builder chat surface.
Wires report-specific tools and system prompt into the shared chat engine.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import json
import logging
import time
import uuid
from typing import Any, Awaitable, Callable

import openai
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.sherlock_runtime import SherlockConversationTurn
from app.services.report_builder.chart_contract import (
    CHART_PAYLOAD_ADAPTER,
    ChartPayload,
)
from app.services.cost_tracking import (
    SherlockTurnContext,
    aggregate_turn_usage,
    get_correlation_id,
    reset_correlation_id,
    reset_sherlock_turn_context,
    set_correlation_id,
    set_sherlock_turn_context,
)
from app.services.sherlock import (
    BundleBuilder,
    RecognitionEvent,
    ScopedBundle,
    ScopeContext,
    build_recognition_event,
    render_bundle_context,
    resolve_turn_scope_and_bundle,
)
from app.services.chat_engine.openai_agents_adapter import (
    SherlockContext,
    TURN_DEADLINE_SECONDS,
    create_openai_client,
    run_sherlock_sdk_turn,
)
from app.services.chat_engine.sql_agent import load_app_config, load_semantic_model
from app.services.report_builder.schemas import ToolCallDetailOut
from app.services.report_builder.scratchpad_state import (
    apply_state_delta,
    apply_tool_recovery,
    build_analysis_snapshot,
    default_scratchpad,
    drop_scope_derived_filters,
    push_analysis_snapshot,
    remember_active_filters,
    remember_catalog_inspection,
    remember_catalog_relations,
    remember_data_check,
    remember_json_structure,
    remember_last_evidence,
    remember_resolved_entities,
)
from app.services.report_builder.tool_definitions import resolve_tools
from app.services.report_builder.runtime_store import (
    SherlockAgentSessionState,
    append_runtime_event,
    create_assistant_message,
    finalize_assistant_message,
    list_sherlock_history_for_responses_input,
    record_user_message,
    save_runtime_state,
    touch_sherlock_chat_session,
    update_last_response_id,
)
from app.services.report_builder.turn_store import (
    SherlockConversationTurnState,
    mark_turn_active,
    mark_turn_terminal,
)

logger = logging.getLogger(__name__)


def _reset_turn_contextvars(correlation_token, sherlock_token) -> None:
    """Release the contextvars set at the top of ``_execute_chat_turn``.

    Invoked in both the success and error branches (guards run before the
    function returns/raises) so subsequent turns on the same worker see a
    clean context.
    """
    if correlation_token is not None:
        try:
            reset_correlation_id(correlation_token)
        except Exception:
            pass
    if sherlock_token is not None:
        try:
            reset_sherlock_turn_context(sherlock_token)
        except Exception:
            pass

MAX_TOOL_ROUNDS = 15
EventEmitter = Callable[[dict[str, Any]], Awaitable[None]]


def _chart_title_from_result(result: dict[str, Any]) -> str:
    """Extract the chart title from the data_query result.

    The inner SQL-generation LLM returns a ``chart_title`` alongside the SQL.
    Falls back to the question text (capped) if the LLM didn't produce one.
    """
    title = str(result.get('chart_title') or '').strip()
    if title:
        return title
    # Fallback: use the question, capped at 60 chars.
    raw = str(result.get('question') or '').strip().rstrip('?.! ')
    if not raw:
        return 'Chart'
    title = raw[:1].upper() + raw[1:]
    if len(title) > 60:
        cut = title[:60].rfind(' ')
        title = title[:cut if cut > 30 else 60] + '…'
    return title


def _pivot_chart_rows(
    rows: list[dict[str, Any]],
    *,
    x_key: str,
    series_key: str,
    value_key: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    pivoted: dict[str, dict[str, Any]] = {}
    series_values: list[str] = []
    seen_series: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        x_value = row.get(x_key)
        series_value = row.get(series_key)
        if x_value in (None, '') or series_value in (None, ''):
            continue
        bucket_key = json.dumps(x_value, sort_keys=True, default=str)
        bucket = pivoted.setdefault(bucket_key, {x_key: x_value})
        series_text = str(series_value)
        bucket[series_text] = row.get(value_key)
        if series_text not in seen_series:
            seen_series.add(series_text)
            series_values.append(series_text)
    return list(pivoted.values()), series_values


_KPI_FORMAT_BY_SEMTYPE: dict[str, str] = {
    'percent': 'percent',
    'currency': 'currency',
    'count': 'integer',
    'duration': 'duration_ms',
    'ratio': 'decimal',
    'score': 'decimal',
}


def _typed_result_from_json_payload(result: dict[str, Any]) -> "TypedResultSet | None":
    """Reconstruct a ``TypedResultSet`` from the JSON-safe tool-result envelope.

    Audit-knot #2: the tool boundary serializes via ``json.dumps(..., default=str)``
    so no live Python object can be relied on after ``dispatch_tool_call``. The
    orchestrator consumes ``result['typed_columns']`` + ``result['data']``, the
    contract emitted by ``sql_agent.data_query`` in Phase 2.
    """
    from app.services.chat_engine.result_set_typer import TypedColumn, TypedResultSet

    raw_cols = result.get('typed_columns')
    rows = result.get('data')
    if not isinstance(raw_cols, list) or not isinstance(rows, list):
        return None
    rebuilt: list[TypedColumn] = []
    for raw in raw_cols:
        if not isinstance(raw, dict):
            continue
        name = raw.get('name')
        role = raw.get('role')
        data_type = raw.get('data_type')
        if not (name and role and data_type):
            continue
        rebuilt.append(
            TypedColumn(
                name=str(name),
                role=role,
                data_type=data_type,
                semantic_type=raw.get('semantic_type'),
                cardinality=int(raw.get('cardinality') or 0),
                null_frac=float(raw.get('null_frac') or 0.0),
                is_constant=bool(raw.get('is_constant') or False),
            )
        )
    clean_rows = [r for r in rows if isinstance(r, dict)]
    return TypedResultSet(columns=rebuilt, rows=clean_rows)


def _kpi_from_single_value(typed: "TypedResultSet") -> dict[str, Any]:
    col = typed.columns[0]
    value = typed.rows[0].get(col.name) if typed.rows else None
    fmt = _KPI_FORMAT_BY_SEMTYPE.get(col.semantic_type or '', 'decimal')
    return {
        'value': value,
        'label': col.name.replace('_', ' ').title(),
        'format': fmt,
        'semantic_type': col.semantic_type,
    }


def _summary_from_single_row(typed: "TypedResultSet") -> dict[str, Any]:
    row = typed.rows[0] if typed.rows else {}
    return {
        'fields': [
            {
                'name': c.name,
                'label': c.name.replace('_', ' ').title(),
                'value': row.get(c.name),
                'semantic_type': c.semantic_type,
                'role': c.role,
            }
            for c in typed.columns
        ],
    }


def _table_columns(typed: "TypedResultSet") -> list[dict[str, Any]]:
    return [
        {
            'name': c.name,
            'label': c.name.replace('_', ' ').title(),
            'role': c.role,
            'semantic_type': c.semantic_type,
            'data_type': c.data_type,
        }
        for c in typed.columns
    ]


def _build_analytics_chart_outcome(result: dict[str, Any] | None) -> dict[str, Any] | None:
    """Run the deterministic chart pipeline and return envelope-ready fields.

    Returns a dict with:
        ``chart_payload``: the ``ChartPayload`` discriminated union (same
            shape as legacy ``_build_chart_payload``), used as the
            ``analytics.chart.v1`` artifact payload.
        ``reason_code``: gate's ``CG_*`` code (or ``None`` for pure
            chart success with no degradation), plus ``CG_EMIT_FAILED``
            when emitter raised.
        ``rendered_as``: the Vega-Lite mark the picker chose
            (``bar | grouped_bar | ... | pie``), or ``None`` for non-chart
            fallbacks.
        ``top_n``: gate-suggested row cap when the picker degraded a
            high-cardinality result; ``None`` otherwise.
        ``warnings``: list (empty or one-element) for SSE emission.
        ``artifact_type``: the payload ``kind`` -- ``chart | kpi |
            summary | table | empty`` -- surfaced in
            ``outcome.artifact.type``.
        ``row_count``: rows the gate saw (pre-truncation).

    Returns ``None`` when ``result`` is not an ``ok`` payload or cannot
    be typed; the handler then emits an error envelope without an
    artifact slot. This is the Phase-2 single source that both
    ``_build_chart_payload`` (legacy callers) and ``handle_data_query``
    (envelope path) consume.
    """
    if not isinstance(result, dict) or result.get('status') != 'ok':
        return None

    from jsonschema import ValidationError

    from app.services.chat_engine.chartability_gate import evaluate as evaluate_gate
    from app.services.chat_engine.chart_type_picker import pick as pick_chart
    from app.services.chat_engine.result_set_typer import TypedResultSet
    from app.services.chat_engine.vega_lite_emitter import emit as emit_vl

    typed = _typed_result_from_json_payload(result)
    if typed is None:
        return None

    gate = evaluate_gate(typed)
    row_count = len(typed.rows)
    base: dict[str, Any] = {
        'title': _chart_title_from_result(result),
        'source_question': result.get('question', ''),
        'sql_query': result.get('sql_used', ''),
    }

    warnings: list[str] = [gate.warning] if gate.warning else []

    if gate.fallback == 'empty':
        return {
            'chart_payload': {'kind': 'empty', 'reason_code': gate.reason_code, **base},
            'reason_code': gate.reason_code,
            'rendered_as': None,
            'top_n': None,
            'warnings': warnings,
            'artifact_type': 'empty',
            'row_count': row_count,
        }

    if gate.fallback == 'kpi':
        return {
            'chart_payload': {
                'kind': 'kpi',
                'reason_code': gate.reason_code,
                'kpi': _kpi_from_single_value(typed),
                **base,
            },
            'reason_code': gate.reason_code,
            'rendered_as': None,
            'top_n': None,
            'warnings': warnings,
            'artifact_type': 'kpi',
            'row_count': row_count,
        }

    if gate.fallback == 'summary':
        return {
            'chart_payload': {
                'kind': 'summary',
                'reason_code': gate.reason_code,
                'summary': _summary_from_single_row(typed),
                **base,
            },
            'reason_code': gate.reason_code,
            'rendered_as': None,
            'top_n': None,
            'warnings': warnings,
            'artifact_type': 'summary',
            'row_count': row_count,
        }

    if gate.fallback == 'table':
        return {
            'chart_payload': {
                'kind': 'table',
                'reason_code': gate.reason_code,
                'warning': gate.warning,
                'columns': _table_columns(typed),
                'data': typed.rows,
                **base,
            },
            'reason_code': gate.reason_code,
            'rendered_as': None,
            'top_n': None,
            'warnings': warnings,
            'artifact_type': 'table',
            'row_count': row_count,
        }

    # chartable — either 'chart' or 'chart_with_warning'
    chart_typed = typed
    if gate.fallback == 'chart_with_warning' and gate.top_n:
        chart_typed = TypedResultSet(
            columns=typed.columns, rows=typed.rows[: gate.top_n]
        )

    try:
        picked = pick_chart(chart_typed)
        emitted = emit_vl(chart_typed, picked)
    except (ValueError, ValidationError) as exc:
        from app.services.chat_engine import reason_codes as _rc

        logger.warning('sherlock chart: emitter failed, degrading to table: %s', exc)
        return {
            'chart_payload': {
                'kind': 'table',
                'reason_code': _rc.CG_EMIT_FAILED,
                'warning': f'Could not render chart: {exc}',
                'columns': _table_columns(typed),
                'data': typed.rows,
                **base,
            },
            'reason_code': _rc.CG_EMIT_FAILED,
            'rendered_as': None,
            'top_n': None,
            'warnings': [f'Could not render chart: {exc}'],
            'artifact_type': 'table',
            'row_count': row_count,
        }

    return {
        'chart_payload': {
            'kind': 'chart',
            'reason_code': gate.reason_code,
            'warning': gate.warning,
            'spec': emitted['spec'],
            'data': emitted['data'],
            **base,
        },
        'reason_code': gate.reason_code,
        'rendered_as': picked.mark,
        'top_n': gate.top_n,
        'warnings': warnings,
        'artifact_type': 'chart',
        'row_count': row_count,
    }


def _build_chart_payload(result: dict[str, Any] | None) -> dict[str, Any] | None:
    """Plan §737 egress: validate the payload at the backend boundary.

    ``_build_analytics_chart_outcome`` returns a plain dict for wire
    serialization; this wrapper runs ``CHART_PAYLOAD_ADAPTER.validate_python``
    against the dict before returning, so any drift from the Pydantic
    union raises ``ValidationError`` at the harness boundary rather than
    silently downstream. The return shape is unchanged on the wire —
    ``model_dump`` round-trips to the same JSON.
    """
    outcome = _build_analytics_chart_outcome(result)
    if outcome is None:
        return None
    payload = outcome['chart_payload']
    # Validates → raises pydantic.ValidationError on drift.
    CHART_PAYLOAD_ADAPTER.validate_python(payload)
    return payload


async def assemble_context(session: dict[str, Any], db: AsyncSession) -> str:
    """Build the report-builder system prompt's *cacheable-prefix + per-turn*
    sections. The per-turn pending-jobs block is NOT assembled here — the
    caller appends it last, AFTER ``recognition_context`` and
    ``question_contract_hints`` (plan §770 ordering):

        [persona + voice + scope]            — cacheable
        [TOOLS section]                      — cacheable (memoized Phase 3)
        [app_context + user_context
         + scratchpad + entity/hints]        — per-turn
        [pending-jobs block]                 — per-turn, bound last
        [user message]                       — appended by SDK

    The cacheable prefix MUST remain byte-identical turn-over-turn per
    session; all dynamic content lands AFTER it.
    """
    from app.services.chat_engine.prompts import base, app_context, scratchpad, user_context
    from app.services.chat_engine.prompt_generator import render_tools_section

    session.setdefault('scratchpad', default_scratchpad())
    session.setdefault('_app_context', None)
    session.setdefault('_user_context', None)

    app_id = session.get('app_id')
    tools_section = render_tools_section(app_id=app_id) if app_id else ''

    parts = [
        base.render(),
        tools_section,
        await app_context.render(session, db),
        await user_context.render(session, db),
        scratchpad.render(session),
    ]
    return '\n\n'.join(part for part in parts if part)


async def _render_pending_jobs_block(
    session: dict[str, Any], db: AsyncSession
) -> str:
    """Phase 7 per-turn block. Plan §770-813 + audit fixes Gaps 3, 6, 7.

    Responsibilities:

    1. **Pending** (``queued`` / ``running`` / ``retryable_failed``) Sherlock
       jobs for this session are always shown as one-line pack-rendered
       descriptions. They're in flight; the agent needs to know.
    2. **Newly completed** (``completed`` / ``failed`` / ``cancelled``) jobs
       since ``SherlockAgentSession.last_job_observed_at`` appear as
       synthetic §6.2 envelopes with ``outcome.kind == 'job_completed'``,
       ``outcome.job == {id, status}``, and ``payload`` carrying the job's
       output/error. The agent observes them as structured tool-result-style
       data, not just prose (plan §776-782).
    3. After rendering, advance ``last_job_observed_at`` to the max
       ``completed_at`` of surfaced terminal jobs so the same row is never
       re-observed on subsequent turns.

    The block is appended AFTER ``recognition_context`` /
    ``question_contract_hints`` by the caller (plan Rule 10: pending-jobs
    is the last per-turn section before the user message).
    """
    import json as _json

    from sqlalchemy import select, update as sa_update

    from app.models.job import Job
    from app.models.sherlock_runtime import SherlockAgentSession
    from app.services.chat_engine.capability_pack import (
        CAPABILITY_PACK_REGISTRY,
        SHERLOCK_SUBMISSION_SURFACE,
        render_job_line,
    )

    chat_session_id = session.get('chat_session_id')
    if not chat_session_id:
        return ''

    tenant_id = session.get('tenant_id')
    user_id = session.get('user_id')
    if tenant_id is None or user_id is None:
        return ''

    runtime_row = await db.scalar(
        select(SherlockAgentSession).where(
            SherlockAgentSession.chat_session_id == chat_session_id
        )
    )
    last_observed = getattr(runtime_row, 'last_job_observed_at', None)

    terminal_statuses = ('completed', 'failed', 'cancelled')
    pending_statuses = ('queued', 'running', 'retryable_failed')

    # JSONB containment matches the surface+session_id keys; the GIN
    # ``jsonb_path_ops`` index on ``submission_context``
    # (``idx_jobs_submission_context_gin``) keeps this bounded to the
    # session's jobs.
    session_clause = (
        Job.tenant_id == tenant_id,
        Job.user_id == user_id,
        Job.submission_context.is_not(None),
        Job.submission_context.op('@>')(
            {
                'surface': SHERLOCK_SUBMISSION_SURFACE,
                'session_id': str(chat_session_id),
            }
        ),
    )

    pending_stmt = (
        select(Job)
        .where(*session_clause, Job.status.in_(pending_statuses))
        .order_by(Job.created_at.desc())
        .limit(10)
    )
    pending_jobs = await _result_scalars_all(await db.execute(pending_stmt))

    terminal_where = [*session_clause, Job.status.in_(terminal_statuses)]
    if last_observed is not None:
        # Sherlock only surfaces terminal jobs completed after the
        # watermark — prevents replaying the whole session's job history.
        terminal_where.append(Job.completed_at > last_observed)
    terminal_stmt = (
        select(Job)
        .where(*terminal_where)
        .order_by(Job.completed_at.asc())
        .limit(10)
    )
    terminal_jobs = await _result_scalars_all(await db.execute(terminal_stmt))

    if not pending_jobs and not terminal_jobs:
        return ''

    def _pack_describe(job: Any) -> str:
        pack_id = None
        ctx = getattr(job, 'submission_context', None) or {}
        if isinstance(ctx, dict):
            pack_id = ctx.get('pack_id')
        pack = CAPABILITY_PACK_REGISTRY.get(pack_id) if pack_id else None
        describe = getattr(pack, 'describe_job', None) if pack is not None else None
        try:
            raw = describe(job) if callable(describe) else render_job_line(job)
            return str(raw) if raw is not None else render_job_line(job)
        except Exception:  # pragma: no cover — defensive; renderer must not crash assembly
            logger.warning(
                'describe_job failed pack=%s job_id=%s', pack_id, getattr(job, 'id', None),
                exc_info=True,
            )
            return render_job_line(job)

    sections: list[str] = []

    if pending_jobs:
        sections.append('## Pack jobs still in flight (this session)')
        for job in pending_jobs:
            sections.append(_pack_describe(job))

    if terminal_jobs:
        sections.append(
            '## Newly completed pack jobs (synthetic job_completed envelopes)'
        )
        for job in terminal_jobs:
            ctx = getattr(job, 'submission_context', None) or {}
            pack_id = (ctx.get('pack_id') if isinstance(ctx, dict) else None) or 'harness'
            job_status = getattr(job, 'status', 'completed') or 'completed'
            payload: dict[str, Any] = {
                'job_type': getattr(job, 'job_type', None),
                'result': getattr(job, 'result', None),
            }
            error_message = getattr(job, 'error_message', None)
            if error_message:
                payload['error_message'] = error_message
            envelope = {
                'status': 'ok' if job_status == 'completed' else 'error',
                'summary': _pack_describe(job),
                'outcome': {
                    'kind': 'job_completed',
                    'capability': pack_id,
                    'reason_code': None,
                    'warnings': [],
                    'counts': {'rows': 0, 'records': 0, 'affected': 0},
                    'job': {'id': str(getattr(job, 'id', '')), 'status': job_status},
                },
                'payload': payload,
            }
            sections.append('```json')
            sections.append(_json.dumps(envelope, default=str, indent=2))
            sections.append('```')

    # Advance watermark to the max completed_at of surfaced terminal jobs
    # so the same rows don't reappear next turn. Pending jobs don't move
    # the watermark — they'll be re-queried and re-shown until terminal.
    if terminal_jobs:
        max_completed = max(
            (j.completed_at for j in terminal_jobs if j.completed_at is not None),
            default=None,
        )
        if max_completed is not None:
            await db.execute(
                sa_update(SherlockAgentSession)
                .where(SherlockAgentSession.chat_session_id == chat_session_id)
                .values(last_job_observed_at=max_completed)
            )

    return '\n'.join(sections)


async def _result_scalars_all(result: Any) -> list[Any]:
    scalars = result.scalars()
    if inspect.isawaitable(scalars):
        scalars = await scalars
    rows = scalars.all()
    if inspect.isawaitable(rows):
        rows = await rows
    return list(rows)


def _copy_working_session(session: dict[str, Any]) -> dict[str, Any]:
    return {
        **session,
        'messages': list(session.get('messages', [])),
        'scratchpad': copy.deepcopy(session.get('scratchpad', default_scratchpad())),
        'last_response_id': session.get('last_response_id'),
        '_app_context': session.get('_app_context'),
        '_user_context': session.get('_user_context'),
    }


def _sync_session_state(target: dict[str, Any], source: dict[str, Any]) -> None:
    for key in (
        'messages',
        'scratchpad',
        'last_response_id',
        '_app_context',
        '_user_context',
        # M2: the scope-change detector reads the previous turn's
        # effective app_id from the session; it must survive the
        # working-session deep-copy round-trip.
        '_last_effective_app_id',
    ):
        target[key] = source.get(key)


def _serialize_recognition_event(result: RecognitionEvent) -> dict[str, Any]:
    """Serialize the bundle-synthesized recognition payload.

    The frontend SSE contract still carries an ``entity_recognition``
    event shaped like the old ``EntityRecognitionResult``; M2 keeps the
    key set stable but populates it deterministically from the bundle
    rather than from an LLM pre-pass.
    """
    return result.model_dump(mode='json')


def _question_contract_hints(
    *,
    question: str,
    app_id: str,
    semantic_model: dict[str, Any],
    app_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Aggregate question-analysis hints from every active pack.

    Harness-core never reaches into a specific pack; it resolves the
    app's active pack ids from ``app_config.chat.capabilities`` and asks
    each pack (generically) for its question-hint contribution via
    ``capability_pack.collect_question_hints``.
    """
    from app.schemas.app_config import AppConfig
    from app.services.chat_engine.capability_pack import (
        collect_question_hints,
        resolve_pack_ids_for_app,
    )

    parsed = AppConfig.model_validate(app_config) if app_config else None
    pack_ids = resolve_pack_ids_for_app(
        parsed.chat.capabilities if parsed is not None else None,
        app_id=app_id,
    )
    return collect_question_hints(
        pack_ids=pack_ids,
        question=question,
        app_id=app_id,
        semantic_model=semantic_model,
    )


def _update_scratchpad(session: dict[str, Any], tool_name: str, result_str: str, *, app_id: str = '') -> None:
    """Capture structured tool outcomes for the next turn's prompt.

    Phase 2: the handler's result is a §6.2 ``ToolEnvelope``. This
    function appends a structured record ``{tool, reason_code,
    artifact_type, counts}`` to the scratchpad's ``outcomes`` list and
    peels ``envelope.payload`` for the existing handler-specific
    findings/discovery/lookups bookkeeping.
    """
    pad = session.setdefault('scratchpad', default_scratchpad())

    try:
        envelope = json.loads(result_str)
    except (json.JSONDecodeError, TypeError):
        return

    outcome = envelope.get('outcome') if isinstance(envelope, dict) else None
    payload = envelope.get('payload') if isinstance(envelope, dict) else None
    if not isinstance(payload, dict):
        payload = {}

    # ------------------------------------------------------------------
    # Phase 1 — apply generic ``state_delta`` / ``recovery`` blocks.
    #
    # Both are optional and additive (plan §42-107). When present they
    # feed the harness-owned scratchpad blocks the outer prompt reads
    # back via ``build_recovery_context`` / ``render_recovery_context_block``.
    # When absent the behavior below is byte-identical to the pre-Phase-1
    # shape, so legacy pack envelopes continue to work unchanged.
    # ------------------------------------------------------------------
    if isinstance(envelope, dict):
        state_delta = envelope.get('state_delta')
        if isinstance(state_delta, dict):
            apply_state_delta(pad, state_delta)
        recovery = envelope.get('recovery')
        if isinstance(recovery, dict):
            reason_code_for_recovery = (
                outcome.get('reason_code') if isinstance(outcome, dict) else None
            )
            summary_for_recovery = envelope.get('summary') if isinstance(envelope, dict) else None
            apply_tool_recovery(
                pad,
                recovery,
                reason_code=str(reason_code_for_recovery) if reason_code_for_recovery else None,
                summary=str(summary_for_recovery) if summary_for_recovery else None,
            )

    # ------------------------------------------------------------------
    # Structured outcome record — plan §6 step 6. The outer agent sees
    # the full envelope through the tool result JSON; the scratchpad
    # record is the compact per-tool summary that crosses turns.
    # ------------------------------------------------------------------
    if isinstance(outcome, dict):
        artifact_block = outcome.get('artifact') if isinstance(outcome.get('artifact'), dict) else None
        outcomes_log = pad.setdefault('outcomes', [])
        outcomes_log.append({
            'tool': tool_name,
            'reason_code': outcome.get('reason_code'),
            'artifact_type': (artifact_block or {}).get('type'),
            'counts': dict(outcome.get('counts') or {}),
        })
        # Bound the buffer so a long session does not balloon the prompt.
        if len(outcomes_log) > 50:
            pad['outcomes'] = outcomes_log[-50:]

    status = envelope.get('status') if isinstance(envelope, dict) else None
    warnings = outcome.get('warnings') if isinstance(outcome, dict) else None
    if status == 'error':
        error_text = ''
        if isinstance(warnings, list) and warnings:
            error_text = '; '.join(str(item) for item in warnings)
        if error_text:
            pad['errors'].append(f'{tool_name}: {error_text[:200]}')
        return

    # Backwards compatibility: downstream code reads ``data.<field>`` from
    # the handler's raw shape. Phase 2 unwraps the envelope payload so
    # those helpers keep working without rewriting the whole file.
    data: dict[str, Any] = dict(payload)
    data['status'] = status

    if tool_name == 'data_query' and data.get('status') == 'ok':
        question = str(data.get('question', '')).strip()
        row_count = data.get('row_count', 0)
        # M2: applied filters come from a tool result — provenance is
        # ``resolver_derived`` (a resolver tool produced the value) or
        # ``model_inferred`` (the SQL agent picked it). Tag as
        # ``resolver_derived`` by default; the tool handler that knows
        # its own provenance can override when it writes directly.
        remember_active_filters(
            pad,
            data.get('applied_filters'),
            provenance='resolver_derived',
            source_tool=tool_name,
        )
        # Load dimension metadata for chart classifier
        dimensions: list[dict[str, Any]] | None = None
        if app_id:
            from app.services.chat_engine.sql_agent import load_semantic_model, _normalize_dimensions
            try:
                semantic_model = load_semantic_model(app_id)
                dimensions = _normalize_dimensions(semantic_model)
            except Exception:
                pass
        push_analysis_snapshot(
            pad,
            build_analysis_snapshot(data, dimensions=dimensions),
        )
        if question:
            pad['findings'].append(f'{question} ({row_count} rows)')
        return

    if tool_name == 'data_check' and data.get('status') == 'ok':
        remember_data_check(pad, data, provenance='resolver_derived')
        pad['findings'].append(f"{data.get('table', 'table')} check ({int(data.get('row_count', 0) or 0)} rows)")
        return

    if tool_name == 'discover' and data.get('status') == 'ok':
        pad['discovery'] = data
        dimensions = data.get('dimensions', [])
        metrics = data.get('metrics', [])
        pad['findings'].append(f'Discovered {len(dimensions)} dimensions and {len(metrics)} metrics')
        return

    if tool_name == 'lookup' and data.get('status') == 'ok':
        dimension = str(data.get('dimension', '')).strip()
        if dimension:
            lookups = pad.setdefault('lookups', {})
            lookups[dimension] = {
                'search': data.get('search'),
                'values': data.get('values', []),
            }
            pad['findings'].append(f"Resolved {dimension} ({len(data.get('values', []))} values)")
        return

    if tool_name == 'catalog_inspect' and data.get('status') == 'ok':
        table = str(data.get('table', '')).strip()
        columns = data.get('columns', [])
        if table and isinstance(columns, list):
            remember_catalog_inspection(pad, table=table, columns=[column for column in columns if isinstance(column, dict)])
        return

    if tool_name == 'catalog_relations' and data.get('status') == 'ok':
        relations = data.get('relations', [])
        if isinstance(relations, list):
            remember_catalog_relations(pad, [relation for relation in relations if isinstance(relation, dict)])
        return

    if tool_name == 'catalog_sample' and data.get('status') == 'ok' and data.get('json_structure') is not None:
        table = str(data.get('table', '')).strip()
        column = str(data.get('column', '')).strip()
        json_structure = data.get('json_structure')
        if table and column and isinstance(json_structure, dict):
            remember_json_structure(pad, table=table, column=column, json_structure=json_structure)
        return

    if tool_name == 'resolve_entity' and data.get('status') == 'ok':
        entity_type = str(data.get('entity_type', '')).strip()
        if entity_type:
            matches = data.get('matches', [])
            resolved_matches = matches if isinstance(matches, list) else []
            remember_resolved_entities(
                pad,
                entity_type=entity_type,
                search=str(data.get('search', '')).strip(),
                matches=resolved_matches,
                provenance='resolver_derived',
                source_tool=tool_name,
            )
            pad['findings'].append(f"Resolved {entity_type} ({len(resolved_matches)} matches)")
        return

    if tool_name == 'get_surface_records' and data.get('status') == 'ok':
        surface_key = str(data.get('surface_key', '')).strip()
        if surface_key:
            remember_last_evidence(
                pad,
                surface_key=surface_key,
                record_count=int(data.get('record_count', 0) or 0),
                entity_type=str(data.get('entity_type', '')).strip() or None,
                entity_value=str(data.get('entity_value', '')).strip() or None,
            )
            pad['findings'].append(f"{surface_key} evidence ({int(data.get('record_count', 0) or 0)} records)")
        return

    # Audit fix: used to set ``pad['composed_report']`` here on
    # ``blueprint_compose`` success. That wrote report-builder-pack state
    # into the Sherlock-wide scratchpad, violating Phase 1's pack-agnostic
    # core (plan §485-512). The preview now reaches the agent through the
    # prior turn's tool outcome envelope + message history; the widget
    # reconstructs the preview card from persisted ``BlueprintPart`` parts.

    if tool_name == 'blueprint_save':
        name = data.get('name')
        if name:
            pad['findings'].append(f'Saved template: {name}')
            session['_user_context'] = None


def _summarize_tool_result(name: str, result_str: str) -> str:
    """Extract a short human-readable label for the UI badge.

    Phase 2 — reads the §6.2 envelope shape: status from
    ``envelope.status``; per-tool fields from ``envelope.payload``.
    Kept UI-only; the outer agent reads the full envelope directly and
    does not depend on this prose.
    """
    try:
        envelope = json.loads(result_str)
    except (json.JSONDecodeError, TypeError):
        return "done"

    if not isinstance(envelope, dict):
        return "done"
    status = envelope.get('status')
    payload = envelope.get('payload') if isinstance(envelope.get('payload'), dict) else {}
    data = payload or {}

    if name == "data_query":
        if status == "error":
            return "query failed"
        return f"{data.get('row_count', 0)} rows"
    if name == 'data_check':
        if status == 'error':
            return 'check failed'
        return f"{data.get('row_count', 0)} rows"
    if name == 'discover':
        return f"{len(data.get('dimensions', []))} dims · {len(data.get('surfaces', []))} surfaces"
    if name == 'lookup':
        return f"{data.get('dimension', 'value')} · {len(data.get('values', []))} values"
    if name == 'resolve_entity':
        return f"{data.get('entity_type', 'entity')} · {len(data.get('matches', []))} matches"
    if name == 'get_surface_records':
        return f"{data.get('surface_key', 'surface')} · {data.get('record_count', 0)} records"
    if name == 'catalog_inspect':
        return f"{data.get('table', 'table')} · {len(data.get('columns', []))} cols"
    if name == 'catalog_relations':
        return f"{data.get('table', 'table')} · {len(data.get('relations', []))} relations"
    if name == 'catalog_values':
        return f"{data.get('column', 'column')} · {len(data.get('values', []))} values"
    if name == 'catalog_sample':
        if data.get('json_structure') is not None:
            return f"{data.get('column', 'json')} · JSON structure"
        return f"{data.get('table', 'table')} · {len(data.get('sample_rows', []))} samples"
    if name == 'blueprint_blocks':
        return f"{len(data.get('blocks', []))} blocks"
    if name == 'blueprint_list':
        return f"{len(data.get('blueprints', []))} blueprints"
    if name == "blueprint_compose":
        return f"{len(data.get('sections', []))} sections"
    if name == "blueprint_save":
        return data.get("name", "saved")
    return "done"


def _build_tool_call_detail(name: str, result_str: str, *, execution_ms: float) -> ToolCallDetailOut:
    """Build structured tool metadata for the chat widget.

    Phase 2 — reads the §6.2 envelope: the error surface is
    ``outcome.warnings`` (on ``status: error``); per-tool numeric
    fields come from ``envelope.payload``.
    """
    try:
        envelope = json.loads(result_str)
    except (json.JSONDecodeError, TypeError):
        envelope = {}

    outcome = envelope.get('outcome') if isinstance(envelope, dict) else {}
    payload = envelope.get('payload') if isinstance(envelope, dict) else {}
    if not isinstance(payload, dict):
        payload = {}

    error: str | None = None
    if isinstance(envelope, dict) and envelope.get('status') == 'error':
        warnings = (outcome or {}).get('warnings') if isinstance(outcome, dict) else None
        if isinstance(warnings, list) and warnings:
            error = '; '.join(str(item) for item in warnings)

    detail = ToolCallDetailOut(
        execution_ms=round(execution_ms, 2),
        error=error,
    )

    if name == 'data_query':
        detail.sql_used = payload.get('sql_used')
        detail.row_count = payload.get('row_count')
        detail.cache_hit = bool(payload.get('cache_hit', False))
    elif name == 'data_check':
        detail.row_count = payload.get('row_count')
    elif name == 'catalog_values':
        detail.row_count = len(payload.get('values', []))
    elif name == 'catalog_sample':
        detail.row_count = payload.get('sample_count') or len(payload.get('sample_rows', []))
    elif name == 'resolve_entity':
        detail.row_count = len(payload.get('matches', []))
    elif name == 'get_surface_records':
        detail.row_count = payload.get('record_count')

    return detail


def _build_tools_from_bundle(
    scope: ScopeContext,
    bundle: ScopedBundle,
) -> list[dict[str, Any]]:
    """Assemble the per-turn tool list from the scoped bundle (M2 cutover).

    The ``ScopedBundle`` carries the authoritative pack list for this
    scope in ``scope.effective_pack_ids`` and the merged
    ``tool_schema_enums`` contributed by every active pack. This
    replaces the old ``_resolve_tools_for_app`` that read
    ``App.config.chat.capabilities`` directly — scope is now
    deterministic and upstream.

    Description rendering still flows through the pack's own
    ``describe_tools`` via :func:`resolve_tools`, and the bundle's
    ``tool_schema_enums`` are copied onto bounded string parameters the
    same way the legacy path did so the Agents SDK sees the same strict
    contract at the tool boundary.
    """
    pack_ids = list(scope.effective_pack_ids)
    tools = resolve_tools(pack_ids, app_id=scope.effective_app_id)
    enums = {key: list(values) for key, values in bundle.tool_schema_enums.items()}

    def _is_string_typed(prop: dict[str, Any]) -> bool:
        # Phase 3: strict-schema optional fields use ``["string", "null"]``
        # unions so the LLM can still omit them; enum injection must
        # cover both the plain-string and nullable-string shapes.
        t = prop.get('type')
        if t == 'string':
            return True
        if isinstance(t, list) and 'string' in t:
            return True
        return False

    tools = copy.deepcopy(tools)
    for tool in tools:
        props = (tool.get('inputSchema') or {}).get('properties', {})
        for param_name, allowed in enums.items():
            if not allowed:
                continue
            if param_name in props and _is_string_typed(props[param_name]):
                props[param_name]['enum'] = allowed
                props[param_name]['description'] = (
                    f"{props[param_name].get('description', '').rstrip()} "
                    f"Must be one of: {', '.join(allowed)}."
                ).strip()
        # Nested: a pack may bound a nested property by reusing one of the
        # aggregated enum lists — e.g. analytics binds
        # ``blueprint_compose.sections[*].type`` to ``block_type``.
        sections = props.get('sections') or {}
        section_items = sections.get('items') or {}
        section_props = section_items.get('properties') or {}
        block_type_enum = enums.get('block_type') or []
        if (
            'type' in section_props
            and _is_string_typed(section_props['type'])
            and block_type_enum
        ):
            section_props['type']['enum'] = block_type_enum

    return tools


def _bundle_event_payload(bundle: ScopedBundle) -> dict[str, Any]:
    """Stable shape for the ``bundle.assembled`` runtime event (plan §4).

    The bundle itself is per-request ephemeral, but the event payload
    records its cache-key inputs (ontology version, pack versions), the
    resolved tool / enum / safety views, and the pack projection
    identities so replay consumers can reason about which assembly
    shipped the turn. Raw ontology/resolver rows are intentionally not
    persisted — they live in ``sherlock_ontology_*`` and can be
    re-hydrated by ontology version.

    Phase 2 §2.3: also surface the per-pack ``projected_classes`` slice
    so debug/replay consumers can see which ontology classes landed on
    which pack storage, and which fields each pack flagged
    ``explicit_only``. This is stable metadata — it does not leak row
    data and the shapes are already captured in the bundle's typed
    ``ClassProjection`` records, so we just serialize them.
    """
    pack_versions = sorted(
        (proj.pack_id, proj.pack_version) for proj in bundle.pack_projections
    )
    pack_projections_payload: list[dict[str, Any]] = []
    for proj in bundle.pack_projections:
        classes_payload: list[dict[str, Any]] = []
        for cls in proj.projected_classes:
            entry: dict[str, Any] = {
                'ontology_class': cls.ontology_class,
            }
            if cls.storage:
                entry['storage'] = cls.storage
            if cls.identifier_field:
                entry['identifier_field'] = cls.identifier_field
            if cls.contract_id:
                entry['contract_id'] = cls.contract_id
            if cls.field_safety:
                # Serialize only ``explicit_only`` overrides to keep the
                # payload compact — the default ``safe_first_pass`` does
                # not need to show up here.
                explicit_only = {
                    str(col): str(level)
                    for col, level in cls.field_safety.items()
                    if str(level).strip().lower() == 'explicit_only'
                }
                if explicit_only:
                    entry['field_safety'] = explicit_only
            classes_payload.append(entry)
        pack_projections_payload.append({
            'pack_id': proj.pack_id,
            'pack_version': proj.pack_version,
            'projected_classes': classes_payload,
        })
    return {
        'cache_key': [
            str(bundle.scope.tenant_id),
            bundle.scope.effective_app_id,
            int(bundle.ontology_version),
            [list(pair) for pair in pack_versions],
        ],
        'ontology_version': int(bundle.ontology_version),
        'effective_app_id': bundle.scope.effective_app_id,
        'effective_pack_ids': list(bundle.scope.effective_pack_ids),
        'pack_versions': [
            {'pack_id': pid, 'pack_version': ver} for pid, ver in pack_versions
        ],
        'pack_projections': pack_projections_payload,
        'tool_names': sorted({
            str(spec.get('name')) for spec in bundle.tool_specs
            if isinstance(spec, dict) and spec.get('name')
        }),
        'tool_schema_enums': {
            key: list(values) for key, values in bundle.tool_schema_enums.items()
        },
        'safety_by_entity': bundle.safety_by_entity(),
        'resolver_keys': sorted({r.key for r in bundle.resolvers if r.key}),
    }


def _runtime_session_from_state(session: dict[str, Any], provider: str, model: str) -> SherlockAgentSessionState:
    return SherlockAgentSessionState(
        chat_session_id=session['chat_session_id'],
        app_id=session['app_id'],
        tenant_id=session['tenant_id'],
        user_id=session['user_id'],
        provider=provider,
        model=model,
        message_state=list(session.get('messages', [])),
        scratchpad=dict(session.get('scratchpad', default_scratchpad())),
        next_event_seq=1,
        last_response_id=session.get('last_response_id'),
    )


def _tool_call_warning(tool_name: str, detail: ToolCallDetailOut | None) -> str | None:
    if detail is None or not detail.error:
        return None
    return f'{tool_name}: {detail.error}'


async def _emit_runtime_event(
    runtime_session: SherlockAgentSessionState,
    event_type: str,
    payload: dict[str, Any],
    emit: EventEmitter | None,
    db: AsyncSession,
) -> dict[str, Any]:
    seq = await append_runtime_event(
        runtime_session=runtime_session,
        event_type=event_type,
        payload=payload,
        db=db,
    )
    event = {'event': event_type, 'data': {'seq': seq, **payload}}
    if emit is not None:
        await emit(event)
    return event


async def _execute_chat_turn(
    session: dict[str, Any],
    user_message: str,
    *,
    provider: str,
    model: str,
    db: AsyncSession | None = None,
    auth: 'Any',
    emit: EventEmitter | None = None,
    turn: SherlockConversationTurnState | None = None,
    entity_recognition: RecognitionEvent | None = None,
) -> dict[str, Any]:
    if db is None:
        async with async_session() as owned_db:
            return await _execute_chat_turn(
                session,
                user_message,
                provider=provider,
                model=model,
                db=owned_db,
                auth=auth,
                emit=emit,
                turn=turn,
                entity_recognition=entity_recognition,
            )

    # Ensure a correlation id is active for the duration of this turn and
    # expose the turn context to the global Agents SDK cost-tracking
    # processor. Both are no-ops if the turn hasn't been created yet (legacy
    # callers); the finally block cleans up.
    correlation_token = None
    sherlock_token = None
    if get_correlation_id() is None:
        correlation_token = set_correlation_id(uuid.uuid4())
    if turn is not None:
        try:
            turn_ctx = SherlockTurnContext(
                tenant_id=uuid.UUID(session['tenant_id']),
                user_id=uuid.UUID(session['user_id']) if session.get('user_id') else None,
                app_id=session['app_id'],
                turn_id=uuid.UUID(turn.id),
            )
            sherlock_token = set_sherlock_turn_context(turn_ctx)
        except (ValueError, TypeError):
            sherlock_token = None

    working_session = _copy_working_session(session)
    runtime_session = _runtime_session_from_state(working_session, provider, model)
    # Phase 1: harness persists pack-produced results as opaque artifact
    # triples. The analytics chart payload is still projected out so the
    # live SSE ``chart`` event keeps its discriminated-union shape; the
    # ``done`` event and persisted metadata use ``artifacts[]`` instead.
    artifacts_serialized: list[dict[str, Any]] = []
    chart_payload: dict | None = None
    tool_call_log: list[dict[str, Any]] = []
    streamed_text_parts: list[str] = []
    warnings: list[str] = []
    text = ''
    assistant_message_id: str | None = None
    entity_recognition_payload = RecognitionEvent().model_dump(mode='json')

    try:
        # M2 cutover: the turn starts with deterministic scope + bundle.
        # ``ScopeGuard`` resolves exactly one ``effective_app_id`` for
        # the turn (single-app runtime contract preserved);
        # ``BundleBuilder`` assembles platform ontology + pack
        # projections into the ``ScopedBundle`` the rest of the turn
        # reads from. No LLM entity pre-pass runs here — entity
        # classification has moved into the ReAct loop via
        # ``resolve_entity`` / ``lookup`` / ``get_surface_records``.
        requested_app_id = session.get('requested_app_id') or working_session.get('requested_app_id')
        assembly = await resolve_turn_scope_and_bundle(
            auth=auth,
            session_app_id=working_session.get('app_id'),
            requested_app_id=requested_app_id,
            db=db,
        )
        scope = assembly.scope
        bundle = assembly.bundle
        # Working-session is single-app (scope.effective_app_id == session['app_id']).
        # Attach the bundle so tool handlers can read resolver/safety
        # metadata without re-deriving it from app config.
        working_session['_scope'] = scope
        working_session['_bundle'] = bundle

        # Plan §8.1 carry-forward policy: ``scope_derived`` filters are
        # recomputed every turn. Drop them at the top of each turn so
        # the scratchpad only carries ``user_explicit`` / resolver-derived
        # state. Any ``scope_derived`` hint for this turn is re-emitted
        # downstream (e.g. when a tool projects the resolved app scope
        # into ``active_filters``).
        previous_app_id = working_session.get('_last_effective_app_id')
        scope_changed = (
            previous_app_id is not None
            and previous_app_id != scope.effective_app_id
        )
        drop_scope_derived_filters(working_session.get('scratchpad'))
        working_session['_last_effective_app_id'] = scope.effective_app_id
        if scope_changed:
            # Scope change is rare (single-app runtime contract) but
            # possible via ``requested_app_id``. Resolved entities are
            # frequently scope-specific; clear them so the next turn
            # must re-resolve under the new scope.
            pad = working_session.get('scratchpad') or {}
            if isinstance(pad.get('resolved_entities'), dict):
                pad['resolved_entities'] = {}

        tools = _build_tools_from_bundle(scope, bundle)
        app_config = await load_app_config(db, scope.effective_app_id)
        semantic_model = load_semantic_model(scope.effective_app_id, app_config=app_config)
        entity_recognition = entity_recognition or build_recognition_event(bundle)
        entity_recognition_payload = _serialize_recognition_event(entity_recognition)
        question_contract_hints = _question_contract_hints(
            question=user_message,
            app_id=scope.effective_app_id,
            semantic_model=semantic_model,
            app_config=app_config,
        )

        await record_user_message(runtime_session=runtime_session, content=user_message, db=db)
        assistant_message_id = await create_assistant_message(runtime_session=runtime_session, db=db)
        if turn is not None:
            await mark_turn_active(turn_id=turn.id, assistant_message_id=assistant_message_id, db=db)
            current_correlation = get_correlation_id()
            if current_correlation is not None:
                await db.execute(
                    sa_update(SherlockConversationTurn)
                    .where(SherlockConversationTurn.id == uuid.UUID(turn.id))
                    .values(correlation_id=current_correlation)
                )
        await save_runtime_state(
            runtime_session=runtime_session,
            message_state=list(working_session.get('messages', [])),
            scratchpad=working_session['scratchpad'],
            status='active',
            last_error=None,
            db=db,
        )
        await _emit_runtime_event(
            runtime_session,
            'user_message_added',
            {'role': 'user', 'content': user_message},
            None,
            db,
        )
        # M2: deterministic scope + bundle events are append-only and
        # land before the synthesized ``entity_recognition`` event so
        # replay consumers see scope/bundle first.
        await _emit_runtime_event(
            runtime_session,
            'scope.resolved',
            scope.as_event_payload(),
            None,
            db,
        )
        await _emit_runtime_event(
            runtime_session,
            'bundle.assembled',
            _bundle_event_payload(bundle),
            None,
            db,
        )
        await _emit_runtime_event(
            runtime_session,
            'entity_recognition',
            entity_recognition_payload,
            emit,
            db,
        )
        await db.commit()

        from app.services.evaluators.settings_helper import get_llm_settings_from_db

        creds = await get_llm_settings_from_db(
            tenant_id=working_session['tenant_id'],
            user_id=working_session['user_id'],
            provider_override=provider,
            auth_intent='interactive',
        )
        azure = provider == 'azure_openai'
        client = create_openai_client(
            api_key=creds.get('api_key', ''),
            azure=azure,
            azure_endpoint=creds.get('azure_endpoint', '') if azure else '',
            api_version=creds.get('api_version', '2025-04-01-preview') if azure else '',
        )
        # Plan §770 binding ordering + audit fix Gap 6: the per-turn
        # pending-jobs block is the LAST section before the user message.
        # ``assemble_context`` owns cacheable + per-turn state; the caller
        # appends entity/hints next, and the pending-jobs block last.
        system = await assemble_context(working_session, db)
        recognition_context = render_bundle_context(scope, bundle)
        if bundle.question_hints:
            system = f'{system}\n\n{bundle.question_hints}'
        if question_contract_hints['context']:
            system = f'{system}\n\n{question_contract_hints["context"]}'
        if recognition_context:
            system = f'{system}\n\n{recognition_context}'
        pending_jobs_block = await _render_pending_jobs_block(working_session, db)
        if pending_jobs_block:
            system = f'{system}\n\n{pending_jobs_block}'

        await _emit_runtime_event(
            runtime_session,
            'system_prompt',
            {'prompt': system, 'char_count': len(system)},
            None,  # don't stream to client — internal debug only
            db,
        )
        await db.commit()

        async def _noop_emit(_event: dict[str, Any]) -> None:
            return None

        sherlock_ctx = SherlockContext(
            auth=auth,
            app_id=working_session['app_id'],
            provider=provider,
            working_session=working_session,
            emit=_noop_emit,
            tool_call_log=[],
        )

        deadline = time.monotonic() + TURN_DEADLINE_SECONDS
        # M2 cutover: scope is deterministic and the turn is always
        # in-scope by construction (``ScopeGuard`` raised earlier if no
        # app could be resolved). Tool-choice stays ``auto``; the outer
        # agent decides whether to call a tool or refuse.
        turn_tools = tools

        def _build_agen(prev_id: str | None, replay_items: list[dict[str, Any]] | None):
            return run_sherlock_sdk_turn(
                user_message=user_message,
                instructions=system,
                tools=turn_tools,
                sherlock_context=sherlock_ctx,
                model=model,
                client=client,
                previous_response_id=prev_id,
                max_turns=MAX_TOOL_ROUNDS,
                input_items=replay_items,
            )

        # OpenAI Responses API retains response objects for 30 days. If the
        # stored ``last_response_id`` has expired (or was deleted),
        # ``Runner.run_streamed`` raises ``openai.BadRequestError`` with
        # code ``previous_response_not_found`` before any events drain.
        # Recover by replaying the local conversation history
        # (chat_messages) as a fresh Responses-API ``input`` list with
        # ``previous_response_id=None`` — OpenAI generates a new
        # response_id, full continuity preserved.
        def _is_stale_previous_response_id(exc: BaseException) -> bool:
            cur: BaseException | None = exc
            while cur is not None:
                if isinstance(cur, openai.BadRequestError):
                    code = getattr(cur, 'code', None)
                    if code == 'previous_response_not_found':
                        return True
                    body = getattr(cur, 'body', None)
                    if isinstance(body, dict):
                        err = body.get('error') or {}
                        if isinstance(err, dict) and err.get('code') == 'previous_response_not_found':
                            return True
                if isinstance(cur, openai.NotFoundError):
                    msg = str(cur).lower()
                    if 'previous_response' in msg or 'previous response' in msg:
                        return True
                nxt = cur.__cause__ or cur.__context__
                if nxt is cur:
                    break
                cur = nxt
            return False

        agen = _build_agen(runtime_session.last_response_id, None)
        stale_id_retried = False
        while True:
            try:
                async for event in agen:
                    if time.monotonic() >= deadline:
                        warnings.append(f'turn exceeded {TURN_DEADLINE_SECONDS:.0f}s wall-clock deadline')
                        await agen.aclose()
                        break

                    if event['event'] == '_internal_turn_complete':
                        new_response_id = event['data'].get('last_response_id')
                        if new_response_id:
                            runtime_session.last_response_id = new_response_id
                            working_session['last_response_id'] = new_response_id
                        final_output = event['data'].get('final_output') or ''
                        if final_output:
                            text = final_output
                        continue

                    # Ephemeral: forward status events to SSE but do NOT persist.
                    # Stale on reload; indicator falls back to phrase rotation.
                    if event['event'] == 'status':
                        if emit is not None:
                            await emit({'event': 'status', 'data': event['data']})
                        continue

                    if event['event'] == 'content_delta':
                        streamed_text_parts.append(event['data']['delta'])

                    await _emit_runtime_event(
                        runtime_session,
                        event['event'],
                        event['data'],
                        emit,
                        db,
                    )
                    await db.commit()
                break
            except (openai.BadRequestError, openai.NotFoundError) as exc:
                if not _is_stale_previous_response_id(exc):
                    raise
                if stale_id_retried or runtime_session.last_response_id is None:
                    raise
                stale_id_retried = True
                replay_items = await list_sherlock_history_for_responses_input(
                    runtime_session=runtime_session,
                    db=db,
                )
                runtime_session.last_response_id = None
                working_session['last_response_id'] = None
                # Persist the null immediately so a future turn doesn't
                # re-trigger the same fallback if our retry below fails.
                await update_last_response_id(
                    runtime_session=runtime_session,
                    last_response_id=None,
                    db=db,
                )
                await db.commit()
                warnings.append(
                    'previous_response_id expired (>30d retention); '
                    f'replayed {len(replay_items)} messages from local history'
                )
                agen = _build_agen(None, replay_items)

        tool_call_log = sherlock_ctx.tool_call_log
        # Phase 1: pack-produced results arrive as ``Artifact`` triples on
        # ``sherlock_ctx.artifacts``. Harness Core never inspects the inner
        # payload; only this orchestrator projects out the analytics chart
        # for the live SSE ``chart`` event. The ``done`` event and
        # persisted metadata carry the opaque artifact list directly.
        artifacts_serialized = [a.as_dict() for a in sherlock_ctx.artifacts]
        chart_payload = next(
            (
                a.payload
                for a in reversed(sherlock_ctx.artifacts)
                if a.pack_id == 'analytics' and a.contract_id == 'analytics.chart.v1'
            ),
            None,
        )
        warnings.extend(sherlock_ctx.warnings)
        if streamed_text_parts and not text:
            text = ''.join(streamed_text_parts)
        if not text:
            text = "I wasn't able to produce a response for this turn."
            warnings.append('empty model output')

        working_session['messages'] = []
        terminal_status = 'degraded' if warnings else 'done'
        await save_runtime_state(
            runtime_session=runtime_session,
            message_state=[],
            scratchpad=working_session['scratchpad'],
            status=terminal_status,
            last_error=None,
            db=db,
        )
        if runtime_session.last_response_id:
            await update_last_response_id(
                runtime_session=runtime_session,
                last_response_id=runtime_session.last_response_id,
                db=db,
            )

        if chart_payload is not None:
            # Live SSE ``chart`` event is projected from the analytics
            # artifact carried on ``sherlock_ctx.artifacts``. The event
            # shape stays the same discriminated-union chart payload the
            # UI already consumes; the ``done`` event and persisted
            # metadata use the new ``artifacts[]`` contract.
            await _emit_runtime_event(
                runtime_session,
                'chart',
                chart_payload,
                emit,
                db,
            )

        # Phase 2 Gate (plan §Phase-2 acceptance gate 5): every persisted
        # tool-call entry surfaces the envelope's ``outcome`` block so
        # assistant metadata and the SSE ``done`` event expose the same
        # deterministic ``reason_code`` + artifact extras the outer agent
        # observed live, not just the UI prose summary.
        def _serialize_tool_call_entry(tc: dict[str, Any]) -> dict[str, Any]:
            entry: dict[str, Any] = {
                'toolCallId': tc['tool_call_id'],
                'name': tc['name'],
                'summary': tc['summary'],
                'detail': tc['detail'].model_dump(by_alias=True, mode='json') if tc.get('detail') else None,
            }
            if tc.get('outcome') is not None:
                entry['outcome'] = tc['outcome']
            return entry

        metadata = {
            'terminalStatus': terminal_status,
            'warnings': warnings,
            'entityRecognition': entity_recognition_payload,
            'toolCalls': [_serialize_tool_call_entry(tc) for tc in tool_call_log],
            # Phase 1: persisted metadata carries opaque artifact triples
            # instead of top-level ``chart`` / ``composedReport`` / ``blueprint``
            # keys. Consumers dispatch on ``pack_id`` + ``contract_id`` to
            # render chart / blueprint / future pack outputs uniformly.
            'artifacts': artifacts_serialized,
        }
        await finalize_assistant_message(
            runtime_session=runtime_session,
            message_id=assistant_message_id,
            content=text,
            metadata=metadata,
            status='complete',
            db=db,
        )
        done_payload = {
            'terminalStatus': terminal_status,
            'content': text,
            'toolCalls': [_serialize_tool_call_entry(tc) for tc in tool_call_log],
            # Phase 1: ``done`` event carries opaque artifact triples —
            # the frontend dispatches on ``pack_id`` + ``contract_id`` to
            # render analytics charts, report-builder blueprints, and any
            # future pack artifacts uniformly.
            'artifacts': artifacts_serialized,
            'warnings': warnings,
            'entityRecognition': entity_recognition_payload,
        }
        if turn is not None:
            try:
                usage_summary = await aggregate_turn_usage(
                    db,
                    owner_type='sherlock_turn',
                    owner_id=uuid.UUID(turn.id),
                )
            except Exception:
                logger.debug('aggregate_turn_usage failed', exc_info=True)
                usage_summary = None
            if usage_summary is not None:
                done_payload['usage'] = usage_summary
        done_event = await _emit_runtime_event(runtime_session, 'done', done_payload, emit, db)
        await touch_sherlock_chat_session(runtime_session=runtime_session, db=db)
        if turn is not None:
            await mark_turn_terminal(
                turn_id=turn.id,
                status=terminal_status,
                last_event_seq=done_event['data']['seq'],
                last_error=None,
                db=db,
            )
        await db.commit()
        _sync_session_state(session, working_session)
    except (Exception, asyncio.CancelledError) as exc:
        terminal_status = 'interrupted' if isinstance(exc, asyncio.CancelledError) else 'error'
        error_text = str(exc)
        # Plan §Phase-2 ("observation must include outcome") + §4.1
        # (harness owns runtime-event emission): the agent AND any replay
        # consumer must see that the turn errored. Two things block that
        # today: (1) the root failure is swallowed into ``error_text`` with
        # no log line, so ops can't tell what broke; (2) the aborted-but-
        # unrolled-back transaction makes every recovery-path DB write
        # raise ``InFailedSQLTransactionError``, which propagates out of
        # the except block and kills ``_turn_task`` before any ``error``
        # SSE event is emitted. Rolling back once here restores the
        # invariant "every turn ends with a terminal event (done | error)".
        if not isinstance(exc, asyncio.CancelledError):
            logger.exception(
                'Sherlock turn failed: %s: %s', type(exc).__name__, error_text,
            )
        try:
            await db.rollback()
        except Exception:
            logger.debug('rollback after turn failure failed', exc_info=True)
        await save_runtime_state(
            runtime_session=runtime_session,
            message_state=[],
            scratchpad=working_session['scratchpad'],
            status=terminal_status,
            last_error=error_text,
            db=db,
        )
        if assistant_message_id is not None:
            await finalize_assistant_message(
                runtime_session=runtime_session,
                message_id=assistant_message_id,
                content=''.join(streamed_text_parts) if streamed_text_parts else error_text,
                metadata={
                    'terminalStatus': terminal_status,
                    'warnings': warnings,
                    'toolCalls': [
                        {
                            'toolCallId': tc['tool_call_id'],
                            'name': tc['name'],
                            'summary': tc['summary'],
                            'detail': tc['detail'].model_dump(by_alias=True, mode='json') if tc.get('detail') else None,
                        }
                        for tc in tool_call_log
                    ],
                    'artifacts': artifacts_serialized,
                    'entityRecognition': entity_recognition_payload,
                },
                status='error',
                error_message=error_text,
                db=db,
            )
        error_event = await _emit_runtime_event(
            runtime_session,
            'error',
            {
                'terminalStatus': terminal_status,
                'message': error_text,
                'recoverable': False,
                'entityRecognition': entity_recognition_payload,
            },
            emit,
            db,
        )
        await touch_sherlock_chat_session(runtime_session=runtime_session, db=db)
        if turn is not None:
            await mark_turn_terminal(
                turn_id=turn.id,
                status=terminal_status,
                last_event_seq=error_event['data']['seq'],
                last_error=error_text,
                db=db,
            )
        await db.commit()
        _sync_session_state(session, working_session)
        _reset_turn_contextvars(correlation_token, sherlock_token)
        raise

    _reset_turn_contextvars(correlation_token, sherlock_token)
    return {
        "role": "assistant",
        "content": text,
        "tool_calls": tool_call_log,
        "artifacts": artifacts_serialized,
        "terminal_status": terminal_status,
        "warnings": warnings,
        "entity_recognition": entity_recognition_payload,
    }


async def run_chat_turn_streaming_background(
    session: dict[str, Any],
    user_message: str,
    *,
    provider: str,
    model: str,
    auth: Any,
    turn: SherlockConversationTurnState,
    on_event: Callable[[dict[str, Any]], Awaitable[None]],
) -> None:
    await _execute_chat_turn(
        session,
        user_message,
        provider=provider,
        model=model,
        db=None,
        auth=auth,
        emit=on_event,
        turn=turn,
        entity_recognition=None,
    )
