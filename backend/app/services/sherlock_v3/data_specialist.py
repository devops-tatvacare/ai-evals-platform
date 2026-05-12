"""Sherlock v3 data_specialist — true agent-in-SDK.

The data_specialist's own LLM (one call, fully orchestrated by the
Agents SDK) generates the SQL inline. Its instructions carry the
schema, allowed tables, column hints, verified-query exemplars, and
safety contract. There is **no second LLM call** — the legacy
``sql_agent.generate_sql`` raw-client path is gone from this file.

One tool: ``submit_sql``. It validates the SQL against the manifest,
parameterizes it with tenant/app filters, executes it, types the
result set, runs the chart pipeline, persists one
``platform.sherlock_evidence`` row per result row, and returns a
SpecialistResult JSON string with ``evidence`` populated. The
data_specialist may call ``submit_sql`` once; if it returns
``status='error'``, one corrective retry is allowed.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

import openai
from agents import Agent, FunctionTool
from agents.model_settings import ModelSettings
from agents.models.openai_responses import OpenAIResponsesModel
from agents.tool_context import ToolContext
from openai.types.shared import Reasoning

from app.services.sherlock_v3.azure_client import specialist_model
from app.services.sherlock_v3.data_specialist_prompt import build_data_specialist_prompt
from app.services.sherlock_v3.grounding import GroundingContext

logger = logging.getLogger(__name__)


# Structured logger for routing telemetry. Every submit_sql attempt
# emits one JSON-friendly INFO line — success, empty, validation
# failure, execution error — so the audit set can measure first-try
# correctness from logs alone.
routing_logger = logging.getLogger('sherlock_v3.routing')


# Cap evidence writes per query so a 200-row result set doesn't dump 200 rows
# into ``sherlock_evidence``. Evidence is for citation, not for warehousing —
# the supervisor only needs enough refs to back the prose.
_MAX_EVIDENCE_PER_QUERY = 50
_EVIDENCE_SNIPPET_CHARS = 500


_SUBMIT_SQL_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    # ``declared_grain`` and ``expected_row_bound`` are required on every
    # call so the bouncer can run R9 (grain match) / R10 (no duplicate
    # grain) post-execution and so the server can pick the row cap
    # honestly. The LLM's value is a hint — the server owns the actual
    # cap (R7 honest LIMIT).
    'required': [
        'sql', 'chart_title', 'output_columns',
        'declared_grain', 'expected_row_bound',
    ],
    'properties': {
        'sql': {
            'type': 'string',
            'description': (
                'A read-only PostgreSQL SELECT (or CTE WITH … SELECT). MUST '
                'filter every joined catalog-table alias on :tenant_id and '
                ':app_id. No DDL, no DML, no comments, no information_schema/pg_*. '
                'The workbench bouncer enforces these rules deterministically.'
            ),
        },
        'declared_grain': {
            'type': 'array',
            'description': (
                'Logical column names that uniquely identify one row in the '
                'result set. Used by the bouncer to reject queries that '
                'return duplicate rows for the same grain key. For aggregate '
                'queries this is the GROUP BY columns; for fact queries it '
                'is the catalog table\'s analytical_grain columns.'
            ),
            'items': {'type': 'string'},
        },
        'expected_row_bound': {
            'type': 'string',
            'description': (
                "How many rows you expect. Server picks the actual cap and "
                "returns more_rows_exist when the result exceeds it."
            ),
            'enum': ['single', 'small', 'medium', 'large', 'unbounded'],
        },
        'chart_title': {
            'type': 'string',
            'description': 'Short ≤ 8 word title that describes the result.',
        },
        'output_columns': {
            'type': 'array',
            'description': 'One entry per SELECT column, in SELECT order. Drives the chart pipeline.',
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['alias', 'role_hint', 'type_hint'],
                'properties': {
                    'alias': {'type': 'string'},
                    'role_hint': {
                        'type': 'string',
                        'enum': [
                            'dimension', 'measure', 'temporal',
                            'ordered_categorical', 'key', 'identifier',
                        ],
                    },
                    'type_hint': {
                        'type': 'string',
                        'enum': [
                            'quantitative', 'temporal', 'ordinal',
                            'nominal', 'boolean', 'geo',
                        ],
                    },
                    'source_column': {
                        'type': 'string',
                        'description': 'Optional. Only for passthrough columns: <table>.<column>.',
                    },
                    'semantic_type_hint': {
                        'type': 'string',
                        'enum': [
                            'pk', 'fk', 'category', 'id_hash', 'currency',
                            'percent', 'lat', 'lon', 'count', 'ratio',
                            'score', 'duration', 'none',
                        ],
                    },
                },
            },
        },
    },
}


# ─────────────────────── tool handler ───────────────────────


def _make_submit_sql_handler(
    grounding: GroundingContext | None,
):
    """Build the ``submit_sql`` tool handler with grounding closed in.

    ``grounding`` is the per-turn context that runtime computed before
    the agent was constructed. Closed over here (not a per-turn side
    channel) so the handler can use ``grounding.user_message`` as the
    chart question label and stamp grounding telemetry on every attempt.
    """

    async def _submit_sql_handler(ctx: ToolContext[Any], args: str) -> str:
        started = time.monotonic()
        sherlock_ctx = ctx.context
        app_id = sherlock_ctx.app_id
        try:
            parsed = json.loads(args) if args.strip() else {}
        except json.JSONDecodeError as exc:
            return _emit_with_telemetry(
                grounding=grounding, app_id=app_id, started=started,
                attempted_sql='', validation_result='tool_args_invalid',
                execution_status='error: JSONDecodeError',
                chart_payload_kind=None,
                status='error',
                summary=f'submit_sql arguments were not valid JSON: {exc.msg}',
                artifacts=[], evidence=None,
            )

        sql_raw = (parsed.get('sql') or '').strip()
        chart_title = (parsed.get('chart_title') or '').strip()
        output_columns = parsed.get('output_columns') or []
        declared_grain = list(parsed.get('declared_grain') or [])
        expected_row_bound = parsed.get('expected_row_bound') or 'medium'

        # Question label for chart payloads / supervisor summaries.
        # Pulled from grounding (the user's actual question) when
        # available; falls back to chart_title for legacy/unit-test
        # callers that build the agent without grounding.
        question = (grounding.user_message if grounding else '') or chart_title

        from app.services.chat_engine.workbench_catalog import (
            load_workbench_catalog_strict,
        )

        try:
            workbench_catalog = load_workbench_catalog_strict(app_id)
        except Exception as exc:  # noqa: BLE001 — top-level tool boundary
            logger.exception('sherlock_v3 workbench catalog load failed')
            return _emit_with_telemetry(
                grounding=grounding, app_id=app_id, started=started,
                attempted_sql=sql_raw, validation_result='catalog_load_failed',
                execution_status=f'error: {type(exc).__name__}',
                chart_payload_kind=None,
                status='error',
                summary=f'{type(exc).__name__}: {exc}',
                artifacts=[], evidence=None,
            )

        return await _run_workbench_pipeline(
            sql_raw=sql_raw,
            declared_grain=declared_grain,
            expected_row_bound=expected_row_bound,
            output_columns=output_columns,
            chart_title=chart_title,
            question=question,
            sherlock_ctx=sherlock_ctx,
            app_id=app_id,
            grounding=grounding,
            started=started,
            catalog=workbench_catalog,
        )

    return _submit_sql_handler


async def _run_workbench_pipeline(
    *,
    sql_raw: str,
    declared_grain: list[str],
    expected_row_bound: str,
    output_columns: list[dict[str, Any]],
    chart_title: str,
    question: str,
    sherlock_ctx: Any,
    app_id: str,
    grounding: GroundingContext | None,
    started: float,
    catalog: Any,
) -> str:
    """Run a submit_sql call through the workbench bouncer pipeline.

    Bouncer-driven path (Phase 2):
      1. ``check_before`` — pre-execution AST checks (R1–R8b).
      2. ``prepare_query`` — UUID prefix resolution + param binding.
      3. ``apply_server_limit`` — wrap with ``LIMIT cap + 1``.
      4. Execute (no inner ``LIMIT 200`` wrap — ``row_cap=None``).
      5. ``check_after`` — post-execution row checks (R9–R12).
      6. Build chart artifact from trimmed rows; surface
         ``more_rows_exist``, ``displayed_row_count``, ``limit_applied``,
         and the bouncer telemetry block on every return.
    """
    from app.database import async_session
    from app.services.chat_engine.granularity_graph import (
        build_granularity_graph,
    )
    from app.services.chat_engine.sql_agent import (
        SQLValidationError,
        UUIDParamRegistry,
        execute_query,
        prepare_query,
    )
    from app.services.chat_engine.sql_bouncer import (
        apply_server_limit,
        check_after,
        check_before,
        expand_logical_columns,
    )

    graph = build_granularity_graph(catalog)

    # ── R1–R8b ────────────────────────────────────────────────────────
    before = check_before(
        sql=sql_raw,
        declared_grain=declared_grain,
        expected_row_bound=expected_row_bound,  # type: ignore[arg-type]
        catalog=catalog,
        graph=graph,
    )
    if not before.ok:
        return _emit_with_bouncer_telemetry(
            grounding=grounding, app_id=app_id, started=started,
            attempted_sql=sql_raw,
            bouncer_verdict=before,
            execution_status='bouncer_rejected_before',
            chart_payload_kind=None,
            status='error',
            summary=_bouncer_summary(before),
            artifacts=[], evidence=None,
        )

    try:
        executable_sql = expand_logical_columns(sql_raw, catalog)
        cleaned_sql, params = prepare_query(
            executable_sql,
            sherlock_ctx,
            app_id,
            None,  # semantic model unused on this path; we don't inject
            uuid_registry=UUIDParamRegistry(),
        )
    except (SQLValidationError, ValueError) as exc:
        return _emit_with_bouncer_telemetry(
            grounding=grounding, app_id=app_id, started=started,
            attempted_sql=sql_raw,
            bouncer_verdict=before,
            execution_status=f'prepare_failed: {exc}',
            chart_payload_kind=None,
            status='error',
            summary=f'prepare_query failed: {exc}',
            artifacts=[], evidence=None,
        )

    safe_sql = apply_server_limit(cleaned_sql, row_cap=before.row_cap or 0)
    try:
        async with async_session() as db:
            rows = await execute_query(safe_sql, params, db, row_cap=None)
    except Exception as exc:  # noqa: BLE001 — tool boundary
        logger.exception('sherlock_v3 workbench execute crashed')
        return _emit_with_bouncer_telemetry(
            grounding=grounding, app_id=app_id, started=started,
            attempted_sql=safe_sql,
            bouncer_verdict=before,
            execution_status=f'error: {type(exc).__name__}',
            chart_payload_kind=None,
            status='error',
            summary=f'{type(exc).__name__}: {exc}',
            artifacts=[], evidence=None,
        )

    after = check_after(
        rows=rows,
        declared_grain=declared_grain,
        expected_row_bound=expected_row_bound,  # type: ignore[arg-type]
        row_cap=before.row_cap or 0,
    )
    if not after.ok:
        return _emit_with_bouncer_telemetry(
            grounding=grounding, app_id=app_id, started=started,
            attempted_sql=safe_sql,
            bouncer_verdict=after,
            pre_execution_verdict=before,
            execution_status='bouncer_rejected_after',
            chart_payload_kind=None,
            status='error',
            summary=_bouncer_summary(after),
            artifacts=[], evidence=None,
        )

    # Trim to displayed rows; build artifact + evidence from those only.
    displayed_rows = rows[: after.displayed_row_count or len(rows)]
    artifacts = _build_artifact_list(
        rows=displayed_rows,
        output_columns=list(output_columns),
        question=question,
        sql_used=safe_sql,
        chart_title=chart_title,
        app_id=app_id,
    )
    _attach_bouncer_result_metadata(
        artifacts,
        before_verdict=before,
        after_verdict=after,
    )
    evidence = await _persist_sql_evidence(
        rows=displayed_rows,
        sql=safe_sql,
        sherlock_ctx=sherlock_ctx,
    )
    chart_kind = artifacts[0]['kind'] if artifacts else None
    return _emit_with_bouncer_telemetry(
        grounding=grounding, app_id=app_id, started=started,
        attempted_sql=safe_sql,
        bouncer_verdict=after,
        pre_execution_verdict=before,
        execution_status='ok' if displayed_rows else 'empty',
        chart_payload_kind=chart_kind,
        status='ok' if displayed_rows else 'empty',
        summary=_workbench_summary(question, after, artifacts),
        artifacts=artifacts, evidence=evidence,
    )


def _bouncer_summary(verdict: Any) -> str:
    diag = verdict.diagnostic
    if diag is None:
        return 'bouncer rejected the SQL'
    return f'{diag.rule_id}: {diag.message}'


def _workbench_summary(question: str, verdict: Any, artifacts: list[dict[str, Any]]) -> str:
    n = verdict.displayed_row_count or 0
    more = ' (more rows exist)' if verdict.more_rows_exist else ''
    if not artifacts:
        return f'{n} rows for: {question}{more}'
    return f'{artifacts[0]["kind"]}: {n} rows for: {question}{more}'


def _attach_bouncer_result_metadata(
    artifacts: list[dict[str, Any]],
    *,
    before_verdict: Any,
    after_verdict: Any,
) -> None:
    metadata = {
        'more_rows_exist': after_verdict.more_rows_exist,
        'displayed_row_count': after_verdict.displayed_row_count,
        'row_cap': before_verdict.row_cap,
        'limit_applied': before_verdict.limit_applied,
    }
    for artifact in artifacts:
        payload = artifact.get('payload')
        if isinstance(payload, dict):
            payload['result_metadata'] = metadata


def _emit_with_bouncer_telemetry(
    *,
    grounding: GroundingContext | None,
    app_id: str,
    started: float,
    attempted_sql: str,
    bouncer_verdict: Any,
    execution_status: str,
    chart_payload_kind: str | None,
    status: str,
    summary: str,
    artifacts: list[dict[str, Any]],
    evidence: list[dict[str, Any]] | None,
    pre_execution_verdict: Any | None = None,
) -> str:
    """Workbench-path telemetry. Same shape as the legacy emitter but adds
    a ``bouncer`` sub-object on the routing payload so logs / detail pages
    can render ``rule_id``, ``diagnostic``, ``declared_grain``,
    ``expected_row_bound``, ``more_rows_exist``, ``displayed_row_count``,
    and ``limit_applied`` for every submit_sql call.
    """
    bouncer_block = bouncer_verdict.to_telemetry() if bouncer_verdict is not None else {}
    if pre_execution_verdict is not None:
        pre_block = pre_execution_verdict.to_telemetry()
        for key in ('row_cap', 'limit_applied', 'safe_sql'):
            if key in pre_block and key not in bouncer_block:
                bouncer_block[key] = pre_block[key]
    validation_result = (
        f"bouncer_invalid: {bouncer_block.get('rule_id')}"
        if bouncer_block.get('status') == 'invalid'
        else 'ok'
    )
    routing_payload: dict[str, Any] = {
        'event': 'submit_sql_attempt',
        'app_id': app_id,
        'attempted_sql': attempted_sql,
        'validation_result': validation_result,
        'execution_status': execution_status,
        'chart_payload_kind': chart_payload_kind,
        'status': status,
        'latency_ms': int((time.monotonic() - started) * 1000),
        'bouncer': bouncer_block,
    }
    if grounding is not None:
        routing_payload['grounding'] = grounding.telemetry_dict()
    routing_logger.info('sherlock_v3.submit_sql %s', routing_payload)
    return _result_json(
        status=status,
        summary=summary,
        artifacts=artifacts,
        evidence=evidence,
        started=started,
        app_id=app_id,
        routing=routing_payload,
    )


def _emit_with_telemetry(
    *,
    grounding: GroundingContext | None,
    app_id: str,
    started: float,
    attempted_sql: str,
    validation_result: str,
    execution_status: str,
    chart_payload_kind: str | None,
    status: str,
    summary: str,
    artifacts: list[dict[str, Any]],
    evidence: list[dict[str, Any]] | None,
) -> str:
    """Record one routing-telemetry log line and return the SpecialistResult JSON.

    Plan §1.3 acceptance gate: telemetry MUST land for every submit_sql
    attempt, including failed validation and empty result sets, so the
    Q1–Q10 routing-correctness bar can be measured from logs alone
    when ``platform.sherlock_evidence`` is empty.
    """
    routing_payload: dict[str, Any] = {
        'event': 'submit_sql_attempt',
        'app_id': app_id,
        'attempted_sql': attempted_sql,
        'validation_result': validation_result,
        'execution_status': execution_status,
        'chart_payload_kind': chart_payload_kind,
        'status': status,
        'latency_ms': int((time.monotonic() - started) * 1000),
    }
    if grounding is not None:
        routing_payload['grounding'] = grounding.telemetry_dict()
    routing_logger.info('sherlock_v3.submit_sql %s', routing_payload)

    return _result_json(
        status=status,
        summary=summary,
        artifacts=artifacts,
        evidence=evidence,
        started=started,
        app_id=app_id,
        routing=routing_payload,
    )


# ─────────────────────── chart pipeline ───────────────────────


def _build_artifact_list(
    *,
    rows: list[dict[str, Any]],
    output_columns: list[dict[str, Any]],
    question: str,
    sql_used: str,
    chart_title: str,
    app_id: str,
) -> list[dict[str, Any]]:
    """Type the rows + run the v3 chart pipeline. Returns 0 or 1 artifact.

    Every payload returned here passes ``CHART_PAYLOAD_ADAPTER.validate_python``
    before leaving this function. A payload that fails validation degrades to
    a contract-valid table fallback with ``reason_code='CG_EMIT_FAILED'`` so a
    drift in any builder cannot leak to the wire.
    """
    from pydantic import ValidationError as PydanticValidationError

    from app.services.report_builder.chart_contract import CHART_PAYLOAD_ADAPTER

    payload = build_chart_payload_from_rows(
        rows=rows,
        output_columns=output_columns,
        question=question,
        sql_used=sql_used,
        chart_title=chart_title,
        app_id=app_id,
    )

    try:
        CHART_PAYLOAD_ADAPTER.validate_python(payload)
    except PydanticValidationError as exc:
        logger.warning(
            'sherlock_v3 chart payload failed contract validation; '
            'falling back to table: %s',
            exc,
        )
        payload = _table_fallback_for_validation_failure(
            rows=rows,
            output_columns=output_columns,
            chart_title=chart_title,
            question=question,
            sql_used=sql_used,
            app_id=app_id,
            reason=str(exc),
        )
        # Re-validate the fallback so a builder bug surfaces immediately rather
        # than ping-ponging between two invalid shapes.
        CHART_PAYLOAD_ADAPTER.validate_python(payload)

    return [{'kind': payload['kind'], 'payload': payload}]


def build_chart_payload_from_rows(
    *,
    rows: list[dict[str, Any]],
    output_columns: list[dict[str, Any]],
    question: str,
    sql_used: str,
    chart_title: str,
    app_id: str,
) -> dict[str, Any]:
    """Single payload-builder for chart / kpi / summary / table / empty.

    Conforms to ``app.services.report_builder.chart_contract.ChartPayload``.
    The caller (``_build_artifact_list``) is responsible for the contract
    validation step; this function never returns an invalid shape on its own
    inputs but it is the ``output_columns`` hint surface that the typer
    treats as advisory — actual columns are derived from ``rows[0].keys()``.
    """
    from jsonschema import ValidationError as JsonSchemaValidationError

    from app.services.chat_engine.chartability_gate import evaluate as evaluate_gate
    from app.services.chat_engine.chart_type_picker import pick as pick_chart
    from app.services.chat_engine.manifest import manifest_for_result_typer
    from app.services.chat_engine.result_set_typer import (
        TypedResultSet,
        type_result_set,
    )
    from app.services.chat_engine.vega_lite_emitter import (
        SpecDataMismatchError,
        assert_spec_fields_exist_in_rows,
        emit as emit_vl,
    )

    manifest = manifest_for_result_typer(app_id)

    typed = type_result_set(
        rows=rows,
        declared_columns=output_columns,
        manifest=manifest,
    )
    gate = evaluate_gate(typed)
    base = {
        'title': chart_title,
        'source_question': question,
        'sql_query': sql_used,
    }

    if gate.fallback == 'empty':
        return {
            'kind': 'empty',
            'reason_code': gate.reason_code,
            **base,
        }

    if gate.fallback == 'kpi':
        return {
            'kind': 'kpi',
            'reason_code': gate.reason_code,
            'kpi': _kpi_from_single_value(typed),
            **base,
        }

    if gate.fallback == 'summary':
        return {
            'kind': 'summary',
            'reason_code': gate.reason_code,
            'summary': _summary_from_single_row(typed),
            **base,
        }

    if gate.fallback == 'table':
        return {
            'kind': 'table',
            'reason_code': gate.reason_code,
            'warning': gate.warning,
            'columns': _table_columns(typed),
            'data': typed.rows,
            **base,
        }

    # Chart path. For high-cardinality, sort by the chart's measure desc
    # before truncating to top-N. If we cannot pick a safe measure, degrade
    # to a table fallback rather than emitting a misleading first-25-by-row-
    # order chart.
    chart_typed = typed
    if gate.fallback == 'chart_with_warning' and gate.top_n:
        try:
            picked_for_sort = pick_chart(typed)
        except ValueError:
            picked_for_sort = None
        sorted_rows = _sort_rows_for_top_n(
            typed_rows=typed.rows,
            measure_field=getattr(picked_for_sort, 'y_field', None) if picked_for_sort else None,
        )
        if sorted_rows is None:
            from app.services.chat_engine import reason_codes as _rc
            return {
                'kind': 'table',
                'reason_code': _rc.CG_EMIT_FAILED,
                'warning': (
                    'Showing as a list — too many distinct values and no safe '
                    'measure to rank top entries by.'
                ),
                'columns': _table_columns(typed),
                'data': typed.rows,
                **base,
            }
        chart_typed = TypedResultSet(
            columns=typed.columns,
            rows=sorted_rows[: gate.top_n],
        )

    try:
        picked = pick_chart(chart_typed)
        emitted = emit_vl(chart_typed, picked)
        # Additive regression guard: every Vega-Lite field reference must
        # exist in actual data rows. The typer derives columns from real
        # row keys today, so the check passes by construction — it only
        # fires if a future edit lets an LLM-declared field through.
        assert_spec_fields_exist_in_rows(emitted['spec'], emitted['data'])
    except (ValueError, JsonSchemaValidationError, SpecDataMismatchError) as exc:
        from app.services.chat_engine import reason_codes as _rc
        logger.warning('sherlock_v3 chart emit fell back to table: %s', exc)
        return {
            'kind': 'table',
            'reason_code': _rc.CG_EMIT_FAILED,
            'warning': f'Could not render chart: {exc}',
            'columns': _table_columns(typed),
            'data': typed.rows,
            **base,
        }

    return {
        'kind': 'chart',
        'reason_code': gate.reason_code,
        'warning': gate.warning,
        'spec': emitted['spec'],
        'data': emitted['data'],
        **base,
    }


# ─────────────────────── payload field builders ───────────────────────


_KPI_SEMANTIC_TO_FORMAT: dict[str, str] = {
    'count': 'integer',
    'currency': 'currency',
    'percent': 'percent',
    'duration': 'duration_ms',
}


def _kpi_format_for(semantic_type: Any, value: Any) -> str:
    """Map (semantic_type, observed value) to the KpiFormat literal.

    Falls back to ``decimal`` when the value is non-numeric or unknown — the
    contract's ``format`` field is required, so ``None`` is not a valid leak.
    """
    if isinstance(semantic_type, str) and semantic_type in _KPI_SEMANTIC_TO_FORMAT:
        return _KPI_SEMANTIC_TO_FORMAT[semantic_type]
    # bool is an int subclass; treat as decimal so we don't claim integer-ness
    # for True/False.
    if isinstance(value, bool):
        return 'decimal'
    if isinstance(value, int):
        return 'integer'
    if isinstance(value, float):
        return 'integer' if value.is_integer() else 'decimal'
    return 'decimal'


def _kpi_from_single_value(typed: Any) -> dict[str, Any]:
    if not typed.rows or not typed.columns:
        return {'label': 'value', 'value': None, 'format': 'decimal'}
    col = typed.columns[0]
    value = typed.rows[0].get(col.name)
    semantic_type = getattr(col, 'semantic_type', None)
    return {
        'label': col.name,
        'value': value,
        'format': _kpi_format_for(semantic_type, value),
        'semantic_type': semantic_type,
    }


def _summary_from_single_row(typed: Any) -> dict[str, Any]:
    if not typed.rows:
        return {'fields': []}
    row = typed.rows[0]
    return {
        'fields': [
            {
                'name': c.name,
                'label': c.name,
                'value': row.get(c.name),
                'role': c.role,
                'semantic_type': getattr(c, 'semantic_type', None),
            }
            for c in typed.columns
        ],
    }


def _table_columns(typed: Any) -> list[dict[str, Any]]:
    return [
        {
            'name': c.name,
            'label': c.name,
            'role': c.role,
            'semantic_type': getattr(c, 'semantic_type', None),
            'data_type': getattr(c, 'data_type', None),
        }
        for c in typed.columns
    ]


def _table_fallback_for_validation_failure(
    *,
    rows: list[dict[str, Any]],
    output_columns: list[dict[str, Any]],
    chart_title: str,
    question: str,
    sql_used: str,
    app_id: str,
    reason: str,
) -> dict[str, Any]:
    """Build a contract-valid table payload when the primary builder produces
    an invalid shape.

    Reuses the typer so the column rows are derived from actual row keys —
    we never inherit the broken shape that triggered this fallback.
    """
    from app.services.chat_engine import reason_codes as _rc
    from app.services.chat_engine.manifest import manifest_for_result_typer
    from app.services.chat_engine.result_set_typer import type_result_set

    manifest = manifest_for_result_typer(app_id)
    typed = type_result_set(
        rows=rows,
        declared_columns=output_columns,
        manifest=manifest,
    )
    return {
        'kind': 'table',
        'reason_code': _rc.CG_EMIT_FAILED,
        'warning': f'Could not render chart: {reason}',
        'columns': _table_columns(typed),
        'data': typed.rows,
        'title': chart_title,
        'source_question': question,
        'sql_query': sql_used,
    }


def _sort_rows_for_top_n(
    *,
    typed_rows: list[dict[str, Any]],
    measure_field: Any,
) -> list[dict[str, Any]] | None:
    """Sort rows by ``measure_field`` desc for an honest top-N truncation.

    Returns ``None`` when there is no measure to rank by, or when the column's
    values are not consistently numeric — caller degrades to a table.
    """
    if not isinstance(measure_field, str) or not measure_field:
        return None
    if not typed_rows:
        return list(typed_rows)
    sample = typed_rows[0].get(measure_field)
    if isinstance(sample, bool):
        return None
    # Allow None values (sort to the bottom) but require the non-null
    # population to be numeric — string sorts of "10" vs "9" lie about size.
    non_null = [r.get(measure_field) for r in typed_rows if r.get(measure_field) is not None]
    if not non_null:
        return None
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in non_null):
        return None

    def _key(row: dict[str, Any]) -> tuple[int, float]:
        v = row.get(measure_field)
        if v is None:
            # Push nulls to the bottom under desc order.
            return (1, 0.0)
        return (0, -float(v))

    return sorted(typed_rows, key=_key)


def _summarize_for_supervisor(
    question: str, row_count: int, artifacts: list[dict[str, Any]],
) -> str:
    if not artifacts:
        return f'{row_count} rows for: {question}'
    return f'{artifacts[0]["kind"]}: {row_count} rows for: {question}'


def _result_json(
    *,
    status: str,
    summary: str,
    artifacts: list[dict[str, Any]],
    started: float,
    app_id: str,
    evidence: list[dict[str, Any]] | None = None,
    routing: dict[str, Any] | None = None,
) -> str:
    meta: dict[str, Any] = {
        'confidence': 0.8 if status == 'ok' else 0.0,
        'latency_ms': int((time.monotonic() - started) * 1000),
        'source_pack_id': app_id,
    }
    if routing is not None:
        meta['routing'] = routing
    return json.dumps({
        'kind': 'data',
        'status': status,
        'summary': summary,
        'evidence': evidence or [],
        'artifacts': artifacts,
        'state_delta': {},
        'meta': meta,
    }, default=str)


# ─────────────────────── evidence persistence ───────────────────────


async def _persist_sql_evidence(
    *,
    rows: list[dict[str, Any]],
    sql: str,
    sherlock_ctx: Any,
) -> list[dict[str, Any]]:
    """Write one ``platform.sherlock_evidence`` row per result row.

    Returns the EvidenceRef-shaped dicts the SpecialistResult ``evidence``
    field expects (``ref_id`` / ``source`` / ``locator`` / ``snippet``).
    Capped at ``_MAX_EVIDENCE_PER_QUERY`` to keep the ledger from
    ballooning on wide queries; the row count stays in the locator so
    callers can detect truncation.

    Persistence runs in its own session so the chart pipeline above is
    never blocked on the write. Failures log + return ``[]`` rather than
    surface to the LLM — citations downgrade gracefully.
    """
    if not rows:
        return []

    from app.database import async_session
    from app.models.sherlock_runtime import SherlockEvidence

    capped_rows = rows[:_MAX_EVIDENCE_PER_QUERY]
    truncated = len(rows) > _MAX_EVIDENCE_PER_QUERY

    refs: list[dict[str, Any]] = []
    try:
        async with async_session() as db:
            for index, row in enumerate(capped_rows):
                ref_id = uuid.uuid4()
                locator = {
                    'app_id': sherlock_ctx.app_id,
                    'sql': sql,
                    'row_index': index,
                    'row_count': len(rows),
                    'truncated': truncated,
                }
                snippet = json.dumps(row, default=str)[:_EVIDENCE_SNIPPET_CHARS]
                db.add(
                    SherlockEvidence(
                        ref_id=ref_id,
                        chat_session_id=sherlock_ctx.chat_session_id,
                        tenant_id=sherlock_ctx.tenant_id,
                        user_id=sherlock_ctx.user_id,
                        app_id=sherlock_ctx.app_id,
                        source='sql_row',
                        locator=locator,
                        snippet=snippet,
                    )
                )
                refs.append({
                    'ref_id': str(ref_id),
                    'source': 'sql_row',
                    'locator': locator,
                    'snippet': snippet,
                })
            await db.commit()
    except Exception:  # noqa: BLE001 — evidence is best-effort
        logger.exception('sherlock_v3 evidence persistence failed')
        return []
    return refs


# ─────────────────────── as_tool output extractor ───────────────────────


# Tool name we look for in the data_specialist's RunResult. The data_specialist
# has exactly one tool (``submit_sql``); the extractor still matches by name so
# a future second tool doesn't silently leak the wrong shape.
_SUBMIT_SQL_TOOL_NAME = 'submit_sql'


async def extract_data_specialist_output(run_result: Any) -> str:
    """Extract the SpecialistResult JSON from a data_specialist RunResult.

    Background — the architectural fix for the as_tool boundary loss
    (2026-05-10 investigation):

    When the supervisor calls ``data_specialist`` via ``Agent.as_tool``,
    the SDK's documented default is "the last message from the agent will
    be used" as the tool output. That means the supervisor receives the
    data_specialist LLM's final-answer prose — NOT the rich
    ``SpecialistResult`` JSON that ``submit_sql`` produced. Downstream
    that strips evidence_refs / artifact_refs / duration_ms / summary
    to defaults, and ``artifact_emitted`` never fires for chart payloads.

    This extractor walks the data_specialist's ``new_items`` in reverse,
    finds the most recent ``ToolCallOutputItem`` from ``submit_sql``,
    and returns its ``output`` (already a JSON string). The supervisor
    then receives that JSON; ``runtime.normalize_to_v3_events``'s
    ``_extract_specialist_result`` deserializes it; evidence/artifacts/
    latency/summary all populate; ``artifact_emitted`` fires per artifact.

    Fallback — if no submit_sql output exists (the LLM didn't call the
    tool), we return the agent's final-answer text. This preserves the
    SDK's default behavior so a clarifying-question turn still flows to
    the supervisor as plain text. Such turns produce no chart/evidence/
    duration on the wire, which is correct (none was generated).

    The extractor is async because ``Agent.as_tool``'s
    ``custom_output_extractor`` parameter is typed
    ``Callable[[RunResult | RunResultStreaming], Awaitable[str]]``.
    """
    new_items = list(getattr(run_result, 'new_items', []) or [])
    for item in reversed(new_items):
        if not _is_tool_output_for(item, _SUBMIT_SQL_TOOL_NAME):
            continue
        output = getattr(item, 'output', None)
        if isinstance(output, str) and output.strip():
            return output
        if isinstance(output, dict):
            return json.dumps(output, default=str)
    # Fallback: SDK default — last message text. Used when the LLM
    # answered without calling submit_sql (e.g., a clarifying question).
    final_output = getattr(run_result, 'final_output', None)
    return final_output if isinstance(final_output, str) else ''


def _is_tool_output_for(item: Any, tool_name: str) -> bool:
    """Return True iff ``item`` is a ToolCallOutputItem produced by ``tool_name``.

    SDK shape (post 2026-04 refresh): ``ToolCallOutputItem`` has a
    ``raw_item`` whose ``name`` (when emitted by the Responses API) names
    the tool. Older shapes name it via ``call_id`` matched against a
    preceding ``ToolCallItem``; we accept either path so a SDK minor
    bump doesn't break the extractor silently.
    """
    item_type = getattr(item, 'type', None)
    if item_type != 'tool_call_output_item':
        return False
    raw = getattr(item, 'raw_item', None)
    if isinstance(raw, dict):
        if raw.get('name') == tool_name:
            return True
    name_attr = getattr(raw, 'name', None)
    if isinstance(name_attr, str) and name_attr == tool_name:
        return True
    # data_specialist has only one tool; if the item is a tool output and
    # we couldn't read a name from raw_item, assume it's submit_sql. This
    # is safe today (one tool) and surfaces a hint via a routing log line
    # if a second tool is ever added.
    return True


# ─────────────────────── agent build ───────────────────────


def build_data_specialist(
    client: openai.AsyncAzureOpenAI,
    app_id: str,
    *,
    grounding: GroundingContext | None = None,
) -> Agent:
    """Construct the data_specialist Agent for one app.

    Every app must have a curated workbench catalog
    (``semantic_models/<app>.yaml`` in workbench shape). The prompt sees
    only that curated surface, and joins, columns, and grain are enforced
    by the bouncer at submit_sql time.

    The agent has ONE tool: ``submit_sql``. No second LLM call.
    """
    from app.services.chat_engine.sql_agent import MAX_RESULT_ROWS
    from app.services.chat_engine.workbench_catalog import (
        load_workbench_catalog_strict,
        workbench_to_prompt_inputs,
    )

    instructions_block: str | None = None
    grounding_header: str | None = None

    catalog = load_workbench_catalog_strict(app_id)
    schema_context, allowed_tables, role_hints, exemplars = (
        workbench_to_prompt_inputs(catalog)
    )
    if grounding is not None:
        instructions_block = grounding.instructions_block or None
    grounding_header = (
        'WORKBENCH CATALOG IN EFFECT — the schema below is the '
        'curated set of tables and logical columns. Joins listed '
        'under `relations:` are the ONLY allowed joins; the bouncer '
        'rejects any other. Submit `declared_grain` matching the '
        'output rows and `expected_row_bound` from '
        "{single|small|medium|large|unbounded}."
    )

    system_prompt = build_data_specialist_prompt(
        app_id=app_id,
        schema_context=schema_context,
        allowed_tables=allowed_tables,
        column_role_hints=role_hints,
        exemplars=exemplars,
        max_rows=MAX_RESULT_ROWS,
        grounding_header=grounding_header,
        instructions_block=instructions_block,
    )

    return Agent(
        name='sherlock-data-specialist',
        instructions=system_prompt,
        model=OpenAIResponsesModel(specialist_model(), client),
        model_settings=ModelSettings(
            tool_choice='auto',
            parallel_tool_calls=False,
            reasoning=Reasoning(effort='low'),
        ),
        tools=[
            FunctionTool(
                name='submit_sql',
                description=(
                    'Validate + execute + chart the SQL you generated. '
                    'Returns a SpecialistResult JSON. Call once per turn; '
                    'on status=error you may regenerate and call once more.'
                ),
                params_json_schema=_SUBMIT_SQL_SCHEMA,
                on_invoke_tool=_make_submit_sql_handler(grounding),
                strict_json_schema=True,
            ),
        ],
    )
