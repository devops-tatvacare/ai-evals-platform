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
from app.services.sherlock_v3.exemplars import exemplars_for

logger = logging.getLogger(__name__)


# Cap evidence writes per query so a 200-row result set doesn't dump 200 rows
# into ``sherlock_evidence``. Evidence is for citation, not for warehousing —
# the supervisor only needs enough refs to back the prose.
_MAX_EVIDENCE_PER_QUERY = 50
_EVIDENCE_SNIPPET_CHARS = 500


_SUBMIT_SQL_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['sql', 'chart_title', 'output_columns'],
    'properties': {
        'sql': {
            'type': 'string',
            'description': (
                'A read-only PostgreSQL SELECT (or CTE WITH … SELECT). MUST '
                'filter the active table on :tenant_id and :app_id. No DDL, '
                'no DML, no comments, no information_schema/pg_*. See the '
                'system prompt for the full safety contract.'
            ),
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


async def _submit_sql_handler(ctx: ToolContext[Any], args: str) -> str:
    """Validate + execute + chart the LLM's SQL. No second LLM call.

    On validation failure or execution error, returns status='error'
    with the reason; the data_specialist's prompt instructs it to retry
    once, regenerating the SQL to avoid the same error.
    """
    started = time.monotonic()
    parsed = json.loads(args) if args.strip() else {}
    sherlock_ctx = ctx.context

    sql_raw = (parsed.get('sql') or '').strip()
    chart_title = (parsed.get('chart_title') or '').strip()
    output_columns = parsed.get('output_columns') or []

    if not sql_raw:
        return _result_json(
            status='error',
            summary='submit_sql called with empty sql.',
            artifacts=[],
            started=started,
            app_id=sherlock_ctx.app_id,
        )

    from app.database import async_session
    from app.services.chat_engine.sql_agent import (
        SQLValidationError,
        UUIDParamRegistry,
        execute_query,
        load_app_config,
        load_semantic_model,
        prepare_query,
        validate_sql,
        validate_sql_columns_against_manifest,
    )

    app_id = sherlock_ctx.app_id

    try:
        async with async_session() as db:
            app_config = await load_app_config(db, app_id)
        semantic_model = load_semantic_model(app_id, app_config=app_config)

        sql = validate_sql(sql_raw, semantic_model)
        validate_sql_columns_against_manifest(sql, app_id=app_id)

        safe_sql, params = prepare_query(
            sql,
            sherlock_ctx,
            app_id,
            semantic_model,
            uuid_registry=UUIDParamRegistry(),
        )
        async with async_session() as db:
            rows = await execute_query(safe_sql, params, db)

        question = sherlock_ctx.scratch.get('user_message', '') or chart_title

        artifacts = _build_artifact_list(
            rows=rows,
            output_columns=list(output_columns),
            question=question,
            sql_used=safe_sql,
            chart_title=chart_title,
            app_id=app_id,
        )

        evidence = await _persist_sql_evidence(
            rows=rows,
            sql=safe_sql,
            sherlock_ctx=sherlock_ctx,
        )

        if not rows:
            return _result_json(
                status='empty',
                summary=f'No rows for: {question}',
                artifacts=artifacts,
                evidence=evidence,
                started=started,
                app_id=app_id,
            )

        return _result_json(
            status='ok',
            summary=_summarize_for_supervisor(question, len(rows), artifacts),
            artifacts=artifacts,
            evidence=evidence,
            started=started,
            app_id=app_id,
        )
    except SQLValidationError as exc:
        return _result_json(
            status='error',
            summary=f'SQL validation failed: {exc}',
            artifacts=[],
            started=started,
            app_id=app_id,
        )
    except Exception as exc:  # noqa: BLE001 — top-level tool boundary
        logger.exception('sherlock_v3 submit_sql tool crashed')
        return _result_json(
            status='error',
            summary=f'{type(exc).__name__}: {exc}',
            artifacts=[],
            started=started,
            app_id=app_id,
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
) -> str:
    return json.dumps({
        'kind': 'data',
        'status': status,
        'summary': summary,
        'evidence': evidence or [],
        'artifacts': artifacts,
        'state_delta': {},
        'meta': {
            'confidence': 0.8 if status == 'ok' else 0.0,
            'latency_ms': int((time.monotonic() - started) * 1000),
            'source_pack_id': app_id,
        },
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


# ─────────────────────── agent build ───────────────────────


def build_data_specialist(client: openai.AsyncAzureOpenAI, app_id: str) -> Agent:
    """Construct the data_specialist Agent for one app.

    The system prompt bakes in:
      - Schema (rendered from ``load_semantic_model`` + ``_build_schema_context``)
      - Allowed tables list
      - Column role hints (from the same comment_metadata sql_agent used)
      - Verified-query exemplars (from ``exemplars.py``)
      - Safety + output contract

    The agent has ONE tool: ``submit_sql``. It validates + executes +
    charts the SQL the LLM emitted. No second LLM call.
    """
    from app.services.chat_engine.sql_agent import (
        MAX_RESULT_ROWS,
        _allowed_tables,
        _build_schema_context,
        _column_role_hints,
        load_semantic_model,
    )

    semantic_model = load_semantic_model(app_id)
    schema_context = _build_schema_context(semantic_model, None)
    allowed_tables = sorted(_allowed_tables(semantic_model))
    role_hints = _column_role_hints(schema_context, app_id=app_id)
    exemplars = exemplars_for(app_id)

    system_prompt = build_data_specialist_prompt(
        app_id=app_id,
        schema_context=schema_context,
        allowed_tables=allowed_tables,
        column_role_hints=role_hints,
        exemplars=exemplars,
        max_rows=MAX_RESULT_ROWS,
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
                on_invoke_tool=_submit_sql_handler,
                strict_json_schema=True,
            ),
        ],
    )
