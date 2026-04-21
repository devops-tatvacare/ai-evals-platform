"""Helpers for durable Sherlock scratchpad state."""
from __future__ import annotations

import json
import re
from typing import Any

_MAX_ANALYSIS_COLUMNS = 8
_MAX_ANALYSIS_PREVIEW_ROWS = 3
_TEMPORAL_NAME_PATTERN = re.compile(
    r'(date|time|month|week|year|quarter|day|period|created|updated)',
    re.IGNORECASE,
)
_ISO_DATE_PATTERN = re.compile(
    r'^\d{4}[-/]\d{2}([-/]\d{2})?([T ]\d{2}:\d{2}(:\d{2})?)?',
)
_FOLLOWUP_REFERENCE_PHRASES = (
    'latest run',
    'this run',
    'that run',
    'same run',
    'latest evaluation',
    'latest result',
    'that result',
    'this result',
    'same result',
    'those results',
    'these results',
    'failures',
    'violations',
)
_FOLLOWUP_REFERENCE_WORDS = (
    'that',
    'this',
    'it',
    'those',
    'these',
    'same',
    'previous',
    'above',
    'below',
)
_CARRY_FORWARD_PREFIXES = (
    'now ',
    'and ',
    'also ',
    'what about ',
    'show that ',
    'break that ',
    'group that ',
    'show me that ',
)


def default_scratchpad() -> dict[str, Any]:
    return {
        'findings': [],
        'composed_report': None,
        'errors': [],
        'discovery': None,
        'lookups': {},
        'resolved_entities': {},
        'active_filters': {},
        'discovered_schema': {
            'tables_inspected': [],
            'columns_by_table': {},
            'relations_found': [],
            'json_structures': {},
        },
        'last_analysis': None,
        'analysis_history': [],
        'last_evidence': None,
        'last_data_check': None,
    }


def _serialize_scalar(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _ordered_columns(rows: list[dict[str, Any]]) -> list[str]:
    columns: list[str] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in row.keys():
            key_text = str(key)
            if key_text not in seen:
                seen.add(key_text)
                columns.append(key_text)
    return columns


def _compact_row(row: dict[str, Any], columns: list[str]) -> dict[str, Any]:
    return {
        column: _serialize_scalar(row[column])
        for column in columns[:_MAX_ANALYSIS_COLUMNS]
        if column in row
    }


def _is_numeric_value(value: Any) -> bool:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return True
    if isinstance(value, str):
        try:
            float(value)
            return True
        except (TypeError, ValueError):
            return False
    return False


def _is_temporal_value(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return bool(_ISO_DATE_PATTERN.match(value.strip()))


def _infer_column_types(
    columns: list[str],
    rows: list[dict[str, Any]],
    *,
    dimensions: list[dict[str, Any]] | None = None,
) -> dict[str, str]:
    ordered_dimensions = {
        str(dimension.get('name', ''))
        for dimension in (dimensions or [])
        if isinstance(dimension, dict) and dimension.get('ordering')
    }

    inferred: dict[str, str] = {}
    for column in columns:
        if column in ordered_dimensions:
            inferred[column] = 'ordered_categorical'
            continue

        values = [
            row[column]
            for row in rows
            if isinstance(row, dict) and column in row and row[column] is not None
        ]
        if not values:
            inferred[column] = 'categorical'
            continue
        if all(_is_numeric_value(value) for value in values):
            inferred[column] = 'numeric'
            continue
        if _TEMPORAL_NAME_PATTERN.search(column) or all(_is_temporal_value(value) for value in values):
            inferred[column] = 'temporal'
            continue
        inferred[column] = 'categorical'
    return inferred


def build_analysis_snapshot(
    result: dict[str, Any],
    dimensions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    rows = result.get('data', [])
    if not isinstance(rows, list):
        rows = []
    normalized_rows = [row for row in rows if isinstance(row, dict)]
    columns = _ordered_columns(normalized_rows)
    preview_rows = [
        _compact_row(row, columns)
        for row in normalized_rows[:_MAX_ANALYSIS_PREVIEW_ROWS]
    ]
    focus = preview_rows[0] if preview_rows else {}
    row_count = result.get('row_count')
    if not isinstance(row_count, int):
        row_count = len(normalized_rows)

    column_entries = result.get('columns', [])
    columns_metadata = [
        entry
        for entry in column_entries
        if isinstance(entry, dict) and entry.get('name')
    ]
    if columns_metadata:
        columns = [str(entry['name']) for entry in columns_metadata]
        column_types = {}
        for entry in columns_metadata:
            role = str(entry.get('role') or 'dimension')
            if role == 'measure':
                column_types[str(entry['name'])] = 'numeric'
            elif role == 'temporal':
                column_types[str(entry['name'])] = 'temporal'
            elif role == 'ordered_categorical':
                column_types[str(entry['name'])] = 'ordered_categorical'
            else:
                column_types[str(entry['name'])] = 'categorical'
    else:
        column_types = _infer_column_types(columns, normalized_rows, dimensions=dimensions)
        columns_metadata = []

    return {
        'question': str(result.get('question', '')).strip(),
        'row_count': row_count,
        'sql_used': result.get('sql_used'),
        'columns': columns,
        'columns_metadata': columns_metadata,
        'data': normalized_rows,
        'preview_rows': preview_rows,
        'focus': focus,
        'column_types': column_types,
        # Phase 5: kind-discriminated hint for the next turn's scratchpad.
        # ``None`` when the typed contract wasn't produced (e.g. data_check).
        'chart_summary': _chart_summary_from_result(result),
        'warnings': result.get('warnings', []),
        'applied_filters': result.get('applied_filters', {}),
    }


def _chart_summary_from_result(result: dict[str, Any]) -> dict[str, Any] | None:
    """Derive a compact ``{kind, mark?, reason_code?, warning?}`` summary.

    Runs the same chartability gate + chart-type picker used by the live
    chart-payload orchestrator, so the scratchpad hint for the next turn
    matches what the user actually saw. Pure — no LLM, no I/O.
    """
    typed_rows = result.get('data')
    raw_cols = result.get('typed_columns')
    if not isinstance(typed_rows, list) or not isinstance(raw_cols, list):
        return None

    from app.services.chat_engine.chartability_gate import evaluate as evaluate_gate
    from app.services.chat_engine.chart_type_picker import pick as pick_chart
    from app.services.chat_engine.result_set_typer import TypedColumn, TypedResultSet

    columns: list[TypedColumn] = []
    for raw in raw_cols:
        if not isinstance(raw, dict):
            continue
        name = raw.get('name')
        role = raw.get('role')
        data_type = raw.get('data_type')
        if not (name and role and data_type):
            continue
        try:
            columns.append(
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
        except Exception:
            return None
    clean_rows = [r for r in typed_rows if isinstance(r, dict)]
    typed = TypedResultSet(columns=columns, rows=clean_rows)
    gate = evaluate_gate(typed)

    summary: dict[str, Any] = {'kind': _gate_to_kind(gate.fallback)}
    if gate.reason_code:
        summary['reason_code'] = gate.reason_code
    if gate.warning:
        summary['warning'] = gate.warning
    if gate.chartable:
        try:
            picked = pick_chart(typed)
            summary['mark'] = picked.mark
        except ValueError:
            # Picker refused despite gate approval — fall back to table kind
            # so the scratchpad hint matches what the orchestrator will emit.
            summary['kind'] = 'table'
            summary['reason_code'] = 'CG_EMIT_FAILED'
    return summary


def _gate_to_kind(fallback: str) -> str:
    if fallback == 'empty':
        return 'empty'
    if fallback == 'kpi':
        return 'kpi'
    if fallback == 'summary':
        return 'summary'
    if fallback == 'table':
        return 'table'
    # 'chart' or 'chart_with_warning'
    return 'chart'


def push_analysis_snapshot(scratchpad: dict[str, Any], snapshot: dict[str, Any], *, max_entries: int = 5) -> None:
    history = scratchpad.setdefault('analysis_history', [])
    if not isinstance(history, list):
        history = []
    history.append(snapshot)
    scratchpad['analysis_history'] = history[-max_entries:]
    scratchpad['last_analysis'] = snapshot


def remember_resolved_entities(
    scratchpad: dict[str, Any],
    *,
    entity_type: str,
    search: str,
    matches: list[dict[str, Any]],
) -> None:
    resolved_entities = scratchpad.setdefault('resolved_entities', {})
    if not isinstance(resolved_entities, dict):
        resolved_entities = {}
    resolved_entities[entity_type] = {
        'search': search,
        'matches': matches[:10],
    }
    scratchpad['resolved_entities'] = resolved_entities


def remember_last_evidence(
    scratchpad: dict[str, Any],
    *,
    surface_key: str,
    record_count: int,
    entity_type: str | None,
    entity_value: str | None,
) -> None:
    scratchpad['last_evidence'] = {
        'surface_key': surface_key,
        'record_count': record_count,
        'entity_type': entity_type,
        'entity_value': entity_value,
    }


def remember_active_filters(
    scratchpad: dict[str, Any],
    filters: dict[str, Any] | None,
) -> None:
    scratchpad['active_filters'] = copy_filters(filters)


def copy_filters(filters: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(filters, dict):
        return {}
    copied: dict[str, Any] = {}
    for key, value in filters.items():
        if isinstance(value, dict):
            copied[str(key)] = {
                str(inner_key): _serialize_scalar(inner_value)
                for inner_key, inner_value in value.items()
            }
        elif isinstance(value, list):
            copied[str(key)] = [_serialize_scalar(item) for item in value]
        else:
            copied[str(key)] = _serialize_scalar(value)
    return copied


def remember_data_check(
    scratchpad: dict[str, Any],
    payload: dict[str, Any],
) -> None:
    scratchpad['last_data_check'] = {
        'table': payload.get('table'),
        'filters': copy_filters(payload.get('filters')),
        'row_count': int(payload.get('row_count', 0) or 0),
        'min_created_at': payload.get('min_created_at'),
        'max_created_at': payload.get('max_created_at'),
    }
    remember_active_filters(scratchpad, payload.get('filters'))


def remember_catalog_inspection(
    scratchpad: dict[str, Any],
    *,
    table: str,
    columns: list[dict[str, Any]],
) -> None:
    discovered = scratchpad.setdefault('discovered_schema', default_scratchpad()['discovered_schema'])
    if not isinstance(discovered, dict):
        discovered = default_scratchpad()['discovered_schema']
    tables = discovered.setdefault('tables_inspected', [])
    if table not in tables:
        tables.append(table)
    columns_by_table = discovered.setdefault('columns_by_table', {})
    columns_by_table[table] = columns[:50]
    discovered['tables_inspected'] = tables[-10:]
    discovered['columns_by_table'] = columns_by_table
    scratchpad['discovered_schema'] = discovered


def remember_catalog_relations(
    scratchpad: dict[str, Any],
    relations: list[dict[str, Any]],
) -> None:
    discovered = scratchpad.setdefault('discovered_schema', default_scratchpad()['discovered_schema'])
    if not isinstance(discovered, dict):
        discovered = default_scratchpad()['discovered_schema']
    existing = discovered.setdefault('relations_found', [])
    if not isinstance(existing, list):
        existing = []
    existing.extend(relation for relation in relations if isinstance(relation, dict))
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for relation in existing:
        key = (
            str(relation.get('constraint_name') or ''),
            str(relation.get('join_expression') or ''),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(relation)
    discovered['relations_found'] = deduped[-20:]
    scratchpad['discovered_schema'] = discovered


def remember_json_structure(
    scratchpad: dict[str, Any],
    *,
    table: str,
    column: str,
    json_structure: dict[str, Any],
) -> None:
    discovered = scratchpad.setdefault('discovered_schema', default_scratchpad()['discovered_schema'])
    if not isinstance(discovered, dict):
        discovered = default_scratchpad()['discovered_schema']
    json_structures = discovered.setdefault('json_structures', {})
    json_structures[f'{table}.{column}'] = json_structure
    discovered['json_structures'] = json_structures
    scratchpad['discovered_schema'] = discovered


def get_latest_resolved_entity_value(
    scratchpad: dict[str, Any] | None,
    entity_type: str,
) -> str | None:
    if not isinstance(scratchpad, dict):
        return None
    resolved_entities = scratchpad.get('resolved_entities', {})
    if not isinstance(resolved_entities, dict):
        return None
    entity_payload = resolved_entities.get(entity_type)
    if not isinstance(entity_payload, dict):
        return None
    matches = entity_payload.get('matches', [])
    if not isinstance(matches, list) or not matches:
        return None
    first_match = matches[0]
    if not isinstance(first_match, dict):
        return None
    value = first_match.get('value')
    return str(value) if value not in (None, '') else None


def _looks_like_run_snapshot(snapshot: dict[str, Any]) -> bool:
    columns = {str(column) for column in snapshot.get('columns', []) if column}
    focus = snapshot.get('focus') or {}
    run_keys = {'run_id', 'run_name', 'eval_type', 'run_date', 'date'}
    return bool(run_keys & columns) or any(key in focus for key in run_keys)


def select_analysis_snapshot(question: str, scratchpad: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(scratchpad, dict):
        return None

    history = scratchpad.get('analysis_history', [])
    if not isinstance(history, list):
        history = []
    snapshots = [snapshot for snapshot in history if isinstance(snapshot, dict)]
    last_analysis = scratchpad.get('last_analysis')
    if isinstance(last_analysis, dict):
        snapshots.append(last_analysis)
    if not snapshots:
        return None

    normalized = question.lower()
    if any(phrase in normalized for phrase in ('latest run', 'this run', 'that run', 'same run')):
        for snapshot in reversed(snapshots):
            if _looks_like_run_snapshot(snapshot):
                return snapshot

    return snapshots[-1]


def should_apply_analysis_context(question: str, last_analysis: dict[str, Any] | None) -> bool:
    if not last_analysis:
        return False
    normalized = f" {question.lower().strip()} "
    if any(phrase in normalized for phrase in _FOLLOWUP_REFERENCE_PHRASES):
        return True
    if any(question.lower().strip().startswith(prefix) for prefix in _CARRY_FORWARD_PREFIXES):
        return True
    return any(f' {word} ' in normalized for word in _FOLLOWUP_REFERENCE_WORDS)


def build_followup_analysis_context(last_analysis: dict[str, Any] | None) -> str | None:
    if not last_analysis:
        return None

    lines = ['Prior analysis context:']
    question = str(last_analysis.get('question', '')).strip()
    if question:
        lines.append(f'- Previous question: {question}')

    columns = [str(column) for column in last_analysis.get('columns', []) if column]
    if columns:
        lines.append(f"- Result columns: {', '.join(columns[:_MAX_ANALYSIS_COLUMNS])}")

    focus = last_analysis.get('focus') or {}
    if isinstance(focus, dict) and focus:
        lines.append(f'- Top row values: {json.dumps(focus, ensure_ascii=True, sort_keys=True)}')

    preview_rows = last_analysis.get('preview_rows') or []
    if isinstance(preview_rows, list) and preview_rows:
        lines.append(
            f'- Result preview: {json.dumps(preview_rows[:_MAX_ANALYSIS_PREVIEW_ROWS], ensure_ascii=True, sort_keys=True)}'
        )

    lines.append('- Reuse exact values from this context when the new question refers to the same run, result, or breakdown.')
    return '\n'.join(lines)


def build_data_query_context(
    question: str,
    scratchpad: dict[str, Any] | None,
) -> dict[str, Any]:
    if not isinstance(scratchpad, dict):
        return {}

    context: dict[str, Any] = {}
    discovered_schema = scratchpad.get('discovered_schema')
    if isinstance(discovered_schema, dict) and any(discovered_schema.values()):
        context['discovered_schema'] = discovered_schema

    last_analysis = select_analysis_snapshot(question, scratchpad)
    if should_apply_analysis_context(question, last_analysis):
        if isinstance(last_analysis, dict):
            context['prior_analysis'] = {
                'question': last_analysis.get('question'),
                'columns': last_analysis.get('columns', []),
                'preview_rows': last_analysis.get('preview_rows', []),
                'sql_used': last_analysis.get('sql_used'),
            }
        active_filters = scratchpad.get('active_filters')
        if isinstance(active_filters, dict) and active_filters:
            context['active_filters'] = copy_filters(active_filters)
        resolved_entities = scratchpad.get('resolved_entities')
        if isinstance(resolved_entities, dict) and resolved_entities:
            context['resolved_entities'] = resolved_entities

    return context


def build_resolved_entity_context(scratchpad: dict[str, Any] | None) -> str | None:
    if not isinstance(scratchpad, dict):
        return None

    resolved_entities = scratchpad.get('resolved_entities', {})
    last_evidence = scratchpad.get('last_evidence')
    if not isinstance(resolved_entities, dict) and not isinstance(last_evidence, dict):
        return None

    lines = ['Resolved entity context:']
    if isinstance(resolved_entities, dict):
        for entity_type, payload in list(resolved_entities.items())[-5:]:
            if not isinstance(payload, dict):
                continue
            matches = payload.get('matches', [])
            if not isinstance(matches, list) or not matches:
                continue
            values = [
                str(match.get('value'))
                for match in matches[:3]
                if isinstance(match, dict) and match.get('value') not in (None, '')
            ]
            if values:
                lines.append(f"- {entity_type}: {', '.join(values)}")

    if isinstance(last_evidence, dict) and last_evidence:
        surface_key = last_evidence.get('surface_key')
        record_count = last_evidence.get('record_count')
        entity_type = last_evidence.get('entity_type')
        entity_value = last_evidence.get('entity_value')
        lines.append(
            f'- Latest evidence: {surface_key} ({record_count} records'
            + (f' for {entity_type}={entity_value}' if entity_type and entity_value else '')
            + ')'
        )

    return '\n'.join(lines) if len(lines) > 1 else None
