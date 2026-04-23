"""Schema-discovery helpers for selective Sherlock catalog exploration."""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import String as SAString
from sqlalchemy import asc, cast, desc, func, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics_facts import AnalyticsCriterionFact, AnalyticsEvalFact, AnalyticsRunFact
from app.models.eval_run import EvalRun
from app.services.access_control import readable_scope_clause
from app.services.chat_engine import reason_codes
from app.services.chat_engine.artifact import ToolEnvelope, build_envelope, error_envelope
from app.services.chat_engine.data_surfaces import app_access_clause_for_surfaces
from app.services.chat_engine.manifest import get_manifest
from app.services.chat_engine.sql_agent import load_app_config, load_semantic_model

_COMMENT_FIELD_PATTERN = re.compile(
    r'(?P<field>Role|DataType|SemanticType|Values|Synonyms|Unit|Granularities|Ordering|MeasureKind|Chartable)\s*:\s*',
    re.IGNORECASE,
)
_SIMPLE_IDENTIFIER_PATTERN = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
_JSON_PATH_PATTERN = re.compile(r"(->>|->)\s*'([^']+)'")
_DATE_PATTERN = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_TIMESTAMP_PATTERN = re.compile(r'^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}')

_ORM_REGISTRY: dict[str, Any] = {
    'AnalyticsRunFact': AnalyticsRunFact,
    'AnalyticsEvalFact': AnalyticsEvalFact,
    'AnalyticsCriterionFact': AnalyticsCriterionFact,
    'EvalRun': EvalRun,
}


def get_catalog_model_map(app_id: str) -> dict[str, Any]:
    """Return {table_name: ORM class} for tables declared in the app manifest."""
    manifest = get_manifest(app_id)
    return {
        table_name: _ORM_REGISTRY[table.orm]
        for table_name, table in manifest.catalog_tables.items()
        if table.orm in _ORM_REGISTRY
    }


def parse_column_comment(comment_text: str | None) -> dict[str, Any]:
    """Parse the structured comment convention used for catalog metadata."""
    if not comment_text or not str(comment_text).strip():
        return {
            'description': '',
            'role': None,
            'data_type': None,
            'semantic_type': None,
            'values': [],
            'synonyms': [],
            'unit': None,
            'granularities': [],
            'ordering': [],
            'measure_kind': None,
            'chartable': None,
            'pre_aggregated': False,
            'raw': comment_text or '',
        }

    raw = str(comment_text).strip()
    matches = list(_COMMENT_FIELD_PATTERN.finditer(raw))
    description_end = matches[0].start() if matches else len(raw)
    description = raw[:description_end].strip().rstrip('.')

    parsed: dict[str, Any] = {
        'description': description,
        'role': None,
        'data_type': None,
        'semantic_type': None,
        'values': [],
        'synonyms': [],
        'unit': None,
        'granularities': [],
        'ordering': [],
        'measure_kind': None,
        'chartable': None,
        'pre_aggregated': 'pre-aggregated' in raw.lower(),
        'raw': raw,
    }

    _scalar_fields = {'role', 'datatype', 'semantictype', 'unit', 'measurekind', 'chartable'}
    _field_key_map = {
        'datatype': 'data_type',
        'semantictype': 'semantic_type',
        'measurekind': 'measure_kind',
    }
    for index, match in enumerate(matches):
        field = match.group('field').lower()
        value_start = match.end()
        value_end = matches[index + 1].start() if index + 1 < len(matches) else len(raw)
        value = re.sub(r'(?i)\bpre-aggregated\b\.?', '', raw[value_start:value_end]).strip().rstrip('.')
        if not value:
            continue
        target = _field_key_map.get(field, field)
        if field in _scalar_fields:
            if field == 'chartable':
                parsed[target] = value.strip().lower() == 'true'
            elif field in ('role', 'datatype', 'semantictype', 'measurekind'):
                parsed[target] = value.lower()
            else:
                parsed[target] = value
        else:
            parsed[target] = [
                item.strip()
                for item in value.split(',')
                if item.strip()
            ]
    return parsed


def build_catalog_allowlist(app_id: str) -> list[str]:
    """Allowed catalog tables for ``app_id`` — sourced from the manifest only.

    Phase 9: the semantic-model fallback was removed. The manifest is the
    single owner of the allow-list; callers MUST pass ``app_id``.
    """

    return sorted(get_catalog_model_map(app_id).keys())


# table_name -> ORM class. Used by the catalog tools' runtime lookups
# (``catalog_values`` / ``catalog_sample``) and by ``sql_agent``'s
# ``data_check`` helper. Manifest-driven; the entries here mirror the
# declared ``catalog_tables`` across all registered manifests.
_ORM_REGISTRY_TO_TABLE = {
    'analytics_run_facts': AnalyticsRunFact,
    'analytics_eval_facts': AnalyticsEvalFact,
    'analytics_criterion_facts': AnalyticsCriterionFact,
    'eval_runs': EvalRun,
}


async def catalog_inspect(
    *,
    table: str,
    column: str | None,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    app_config: dict[str, Any] | None = None,
    semantic_model: dict[str, Any] | None = None,
) -> ToolEnvelope:
    access_error = _validate_app_access(auth=auth, app_id=app_id)
    if access_error is not None:
        return access_error

    active_app_config, active_semantic_model = await _load_catalog_context(
        db=db,
        app_id=app_id,
        app_config=app_config,
        semantic_model=semantic_model,
    )
    validation_error = _validate_table_access(
        table=table,
        column=column,
        app_id=app_id,
    )
    if validation_error is not None:
        return validation_error

    params: dict[str, Any] = {'table': table}
    column_filter = ''
    if column:
        params['column'] = column
        column_filter = ' AND c.column_name = :column'

    column_result = await db.execute(
        text(
            f"""
            SELECT
                c.column_name,
                c.data_type,
                c.udt_name,
                c.is_nullable,
                c.column_default,
                pgd.description
            FROM information_schema.columns c
            LEFT JOIN pg_catalog.pg_statio_all_tables st
                ON st.schemaname = c.table_schema
               AND st.relname = c.table_name
            LEFT JOIN pg_catalog.pg_description pgd
                ON pgd.objoid = st.relid
               AND pgd.objsubid = c.ordinal_position
            WHERE c.table_schema = 'public'
              AND c.table_name = :table
              {column_filter}
            ORDER BY c.ordinal_position
            """
        ),
        params,
    )
    pk_result = await db.execute(
        text(
            """
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = 'public'
              AND tc.table_name = :table
              AND tc.constraint_type = 'PRIMARY KEY'
            ORDER BY kcu.ordinal_position
            """
        ),
        {'table': table},
    )
    index_result = await db.execute(
        text(
            """
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = :table
            ORDER BY indexname
            """
        ),
        {'table': table},
    )

    primary_key = [
        _row_value(row, 'column_name', 0)
        for row in pk_result.all()
    ]
    primary_key_set = {value for value in primary_key if value}

    columns = []
    for row in column_result.all():
        column_name = str(_row_value(row, 'column_name', 0) or '')
        data_type = str(_row_value(row, 'udt_name', 2) or _row_value(row, 'data_type', 1) or '')
        raw_comment = _row_value(row, 'description', 5) or ''
        parsed_comment = parse_column_comment(raw_comment)
        is_jsonb = data_type.lower() == 'jsonb'
        column_payload = {
            'name': column_name,
            'data_type': data_type,
            'nullable': str(_row_value(row, 'is_nullable', 3)).upper() == 'YES',
            'default': _row_value(row, 'column_default', 4),
            'comment': raw_comment,
            'comment_metadata': parsed_comment,
            'is_primary_key': column_name in primary_key_set,
            'is_jsonb': is_jsonb,
        }
        if is_jsonb:
            column_payload['sample_hint'] = 'use catalog_sample to inspect structure'
        columns.append(column_payload)

    indexes = [
        {
            'name': _row_value(row, 'indexname', 0),
            'columns': _extract_index_columns(str(_row_value(row, 'indexdef', 1) or '')),
            'definition': _row_value(row, 'indexdef', 1),
        }
        for row in index_result.all()
    ]
    payload = {
        'table': table,
        'column': column or None,
        'primary_key': [value for value in primary_key if value],
        'indexes': indexes,
        'columns': columns,
    }
    return build_envelope(
        status='ok',
        summary=f'{table} · {len(columns)} cols',
        kind='read',
        capability='analytics',
        counts={'rows': 0, 'records': len(columns), 'affected': 0},
        payload=payload,
    )


async def catalog_relations(
    *,
    table: str,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    app_config: dict[str, Any] | None = None,
    semantic_model: dict[str, Any] | None = None,
) -> ToolEnvelope:
    access_error = _validate_app_access(auth=auth, app_id=app_id)
    if access_error is not None:
        return access_error

    active_app_config, active_semantic_model = await _load_catalog_context(
        db=db,
        app_id=app_id,
        app_config=app_config,
        semantic_model=semantic_model,
    )
    validation_error = _validate_table_access(
        table=table,
        column=None,
        app_id=app_id,
    )
    if validation_error is not None:
        return validation_error

    relation_result = await db.execute(
        text(
            """
            SELECT
                tc.constraint_name,
                kcu.table_name AS source_table,
                kcu.column_name AS source_column,
                ccu.table_name AS target_table,
                ccu.column_name AS target_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
            WHERE tc.table_schema = 'public'
              AND tc.constraint_type = 'FOREIGN KEY'
              AND (kcu.table_name = :table OR ccu.table_name = :table)
            ORDER BY kcu.table_name, kcu.column_name
            """
        ),
        {'table': table},
    )

    relations = []
    for row in relation_result.all():
        source_table = str(_row_value(row, 'source_table', 1) or '')
        source_column = str(_row_value(row, 'source_column', 2) or '')
        target_table = str(_row_value(row, 'target_table', 3) or '')
        target_column = str(_row_value(row, 'target_column', 4) or '')
        outgoing = source_table == table
        relations.append({
            'constraint_name': _row_value(row, 'constraint_name', 0),
            'source_table': source_table,
            'source_column': source_column,
            'target_table': target_table,
            'target_column': target_column,
            'direction': 'outgoing' if outgoing else 'incoming',
            'cardinality': 'many:1' if outgoing else '1:many',
            'join_expression': f'{source_table}.{source_column} = {target_table}.{target_column}',
        })

    return build_envelope(
        status='ok',
        summary=f'{table} · {len(relations)} relations',
        kind='read',
        capability='analytics',
        counts={'rows': 0, 'records': len(relations), 'affected': 0},
        payload={'table': table, 'relations': relations},
    )


async def catalog_values(
    *,
    table: str,
    column: str,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    search: str | None = '',
    limit: int = 20,
    app_config: dict[str, Any] | None = None,
    semantic_model: dict[str, Any] | None = None,
) -> ToolEnvelope:
    access_error = _validate_app_access(auth=auth, app_id=app_id)
    if access_error is not None:
        return access_error

    active_app_config, active_semantic_model = await _load_catalog_context(
        db=db,
        app_id=app_id,
        app_config=app_config,
        semantic_model=semantic_model,
    )
    validation_error = _validate_table_access(
        table=table,
        column=column,
        app_id=app_id,
    )
    if validation_error is not None:
        return validation_error

    from app.services.report_builder.analytics_pack import _ANALYTICS_PACK

    model = _ORM_REGISTRY_TO_TABLE[table]
    vocab = _ANALYTICS_PACK.tool_vocabulary(app_id, active_semantic_model)
    expression = _build_column_expression(model, column, vocab=vocab)
    if expression is None:
        return error_envelope(
            capability='analytics',
            reason_code=reason_codes.ENTITY_NOT_FOUND,
            summary=f'unknown column {column!r} on {table}',
            warnings=[f'Unsupported column expression for {table}: {column}'],
            payload={'table': table, 'column': column, 'reason': 'unknown_column'},
        )

    value_expr = cast(expression, SAString)
    count_expr = func.count()
    search_text = search.strip() if isinstance(search, str) else ''
    query = (
        select(value_expr.label('value'), count_expr.label('n'))
        .select_from(model)
        .where(
            *_catalog_scope_clauses(model, auth=auth, app_id=app_id),
            expression.isnot(None),
            value_expr != '',
        )
    )
    if search_text:
        query = query.where(value_expr.ilike(f'%{search_text}%'))
    query = query.group_by(value_expr).order_by(desc(count_expr), asc(value_expr)).limit(_normalize_limit(limit, default=20, maximum=100))

    result = await db.execute(query)
    values = [
        {
            'value': _serialize_value(_row_value(row, 'value', 0)),
            'count': int(_row_value(row, 'n', 1) or 0),
        }
        for row in result.all()
        if _row_value(row, 'value', 0) not in (None, '')
    ]
    return build_envelope(
        status='ok',
        summary=f'{column} · {len(values)} values',
        kind='read',
        capability='analytics',
        counts={'rows': 0, 'records': len(values), 'affected': 0},
        payload={
            'table': table,
            'column': column,
            'search': search_text or None,
            'values': values,
        },
    )


async def catalog_sample(
    *,
    table: str,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    column: str | None = None,
    limit: int = 5,
    app_config: dict[str, Any] | None = None,
    semantic_model: dict[str, Any] | None = None,
) -> ToolEnvelope:
    access_error = _validate_app_access(auth=auth, app_id=app_id)
    if access_error is not None:
        return access_error

    active_app_config, active_semantic_model = await _load_catalog_context(
        db=db,
        app_id=app_id,
        app_config=app_config,
        semantic_model=semantic_model,
    )
    validation_error = _validate_table_access(
        table=table,
        column=column,
        app_id=app_id,
    )
    if validation_error is not None:
        return validation_error

    from app.services.report_builder.analytics_pack import _ANALYTICS_PACK

    model = _ORM_REGISTRY_TO_TABLE[table]
    vocab = _ANALYTICS_PACK.tool_vocabulary(app_id, active_semantic_model)
    normalized_limit = _normalize_limit(limit, default=5, maximum=25)

    if column:
        raw_column = _resolve_simple_column(model, column, vocab=vocab)
        if raw_column is not None and _is_jsonb_column(raw_column):
            query = (
                select(raw_column.label(column))
                .select_from(model)
                .where(
                    *_catalog_scope_clauses(model, auth=auth, app_id=app_id),
                    raw_column.isnot(None),
                )
                .limit(normalized_limit)
            )
            result = await db.execute(query)
            json_values = [
                _row_value(row, column, 0)
                for row in result.all()
                if _row_value(row, column, 0) not in (None, '')
            ]
            json_structure, sample_values = detect_jsonb_structure(json_values)
            return build_envelope(
                status='ok',
                summary=f'{column} · JSON structure',
                kind='read',
                capability='analytics',
                counts={'rows': 0, 'records': len(json_values), 'affected': 0},
                payload={
                    'table': table,
                    'column': column,
                    'json_structure': json_structure,
                    'sample_values': sample_values,
                    'sample_count': len(json_values),
                },
            )

        expression = _build_column_expression(model, column, vocab=vocab)
        if expression is None:
            return error_envelope(
                capability='analytics',
                reason_code=reason_codes.ENTITY_NOT_FOUND,
                summary=f'unknown column {column!r} on {table}',
                warnings=[f'Unsupported column expression for {table}: {column}'],
                payload={'table': table, 'column': column, 'reason': 'unknown_column'},
            )
        query = (
            select(expression.label('value'))
            .select_from(model)
            .where(
                *_catalog_scope_clauses(model, auth=auth, app_id=app_id),
                expression.isnot(None),
            )
            .limit(normalized_limit)
        )
        result = await db.execute(query)
        sample_rows = [
            {'value': _serialize_value(_row_value(row, 'value', 0))}
            for row in result.all()
        ]
        return build_envelope(
            status='ok',
            summary=f'{table} · {len(sample_rows)} samples',
            kind='read',
            capability='analytics',
            counts={'rows': 0, 'records': len(sample_rows), 'affected': 0},
            payload={'table': table, 'column': column, 'sample_rows': sample_rows},
        )

    query = (
        select(model)
        .where(*_catalog_scope_clauses(model, auth=auth, app_id=app_id))
        .limit(normalized_limit)
    )
    result = await db.execute(query)
    sample_rows = [
        _serialize_record(row)
        for row in result.scalars().all()
    ]
    return build_envelope(
        status='ok',
        summary=f'{table} · {len(sample_rows)} samples',
        kind='read',
        capability='analytics',
        counts={'rows': 0, 'records': len(sample_rows), 'affected': 0},
        payload={'table': table, 'column': None, 'sample_rows': sample_rows},
    )


def detect_jsonb_structure(json_values: list[Any]) -> tuple[dict[str, Any], dict[str, list[Any]]]:
    samples: dict[str, list[Any]] = defaultdict(list)
    structure = _infer_json_structure(json_values, path='', samples=samples)
    normalized_structure = structure if isinstance(structure, dict) else {'value': structure}
    return normalized_structure, dict(samples)


async def _load_catalog_context(
    *,
    db: AsyncSession,
    app_id: str,
    app_config: dict[str, Any] | None,
    semantic_model: dict[str, Any] | None,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    active_app_config = app_config if app_config is not None else await load_app_config(db, app_id)
    active_semantic_model = semantic_model or load_semantic_model(app_id, app_config=active_app_config)
    return active_app_config, active_semantic_model


def _validate_table_access(
    *,
    table: str,
    column: str | None,
    app_id: str,
) -> ToolEnvelope | None:
    allowed_tables = build_catalog_allowlist(app_id=app_id)
    if table not in allowed_tables:
        msg = (
            f"Table {table!r} is not declared in the manifest for {app_id}. "
            f"Declared tables: {', '.join(allowed_tables)}. "
            f"To add it, edit backend/app/services/chat_engine/manifests/{app_id}.yaml."
        )
        return error_envelope(
            capability='analytics',
            reason_code=reason_codes.ENTITY_OUT_OF_SCOPE,
            summary=f'table {table!r} not declared',
            warnings=[msg],
            payload={'table': table, 'reason': 'unknown_table', 'available_tables': allowed_tables},
        )
    if column and not _SIMPLE_IDENTIFIER_PATTERN.match(column.split('->', 1)[0].strip()):
        msg = f'Invalid column expression: {column}'
        return error_envelope(
            capability='analytics',
            reason_code=reason_codes.ENTITY_NOT_FOUND,
            summary='invalid column expression',
            warnings=[msg],
            payload={'table': table, 'column': column, 'reason': 'invalid_column'},
        )
    return None


def _validate_app_access(*, auth: Any, app_id: str) -> ToolEnvelope | None:
    if getattr(auth, 'is_owner', False):
        return None
    if not hasattr(auth, 'app_access'):
        return None

    app_access = getattr(auth, 'app_access', frozenset()) or frozenset()
    if app_id in app_access:
        return None
    return error_envelope(
        capability='harness',
        reason_code=reason_codes.PERMISSION_DENIED,
        summary=f'app access denied for {app_id}',
        warnings=[f'App access denied for {app_id}'],
        payload={'app_id': app_id, 'reason': 'app_access_denied'},
    )


def _catalog_scope_clauses(model: Any, *, auth: Any, app_id: str) -> tuple[Any, ...]:
    if model is EvalRun:
        return (
            readable_scope_clause(EvalRun, auth),
            app_access_clause_for_surfaces(EvalRun, auth),
            EvalRun.app_id == app_id,
        )
    return (
        model.tenant_id == getattr(auth, 'tenant_id', None),
        model.app_id == app_id,
    )


# Aliases the LLM tends to use when naming a raw-table column that doesn't
# match the ORM attribute. e.g. Sherlock calls run_id on eval_runs, but the
# primary key on EvalRun is ``id``. Keep this list minimal — prefer teaching
# the semantic model over expanding this map.
_COLUMN_ALIASES: dict[Any, dict[str, str]] = {
    EvalRun: {'run_id': 'id'},
}


def _resolve_simple_column(model: Any, column: str, *, vocab: Any | None = None):
    if not _SIMPLE_IDENTIFIER_PATTERN.match(column):
        return None
    aliased = _COLUMN_ALIASES.get(model, {}).get(column, column)
    attr = getattr(model, aliased, None)
    if attr is not None:
        return attr

    # Manifest synonym fallback. The vocabulary maps an ORM class back to
    # its manifest table, and the manifest carries the declared synonyms.
    if vocab is not None:
        table_name = vocab.orm_to_table.get(type(model).__name__) or vocab.orm_to_table.get(model.__name__)
        if table_name:
            resolution = vocab.resolve_column(column, preferred_table=table_name)
            if resolution.status == 'unique' and resolution.canonical is not None:
                return getattr(model, resolution.canonical.column, None)
    return None


def _build_column_expression(model: Any, column: str, *, vocab: Any | None = None):
    simple_column = _resolve_simple_column(model, column, vocab=vocab)
    if simple_column is not None:
        return simple_column

    base_name, first_operator, _ = column.partition('->')
    base_name = base_name.strip()
    if not _SIMPLE_IDENTIFIER_PATTERN.match(base_name):
        return None

    base_column = _resolve_simple_column(model, base_name, vocab=vocab)
    if base_column is None or not _is_jsonb_column(base_column):
        return None

    matches = list(_JSON_PATH_PATTERN.finditer(column[len(base_name):]))
    if not matches:
        return None

    expression = base_column
    for index, match in enumerate(matches):
        operator, key = match.groups()
        if operator == '->>' and index != len(matches) - 1:
            return None
        expression = expression[key]
        if operator == '->>':
            expression = expression.astext
    return expression


def _is_jsonb_column(column: Any) -> bool:
    return isinstance(getattr(column, 'type', None), JSONB)


def _extract_index_columns(index_definition: str) -> list[str]:
    match = re.search(r'\((.*?)\)', index_definition)
    if not match:
        return []
    return [
        token.strip().strip('"')
        for token in match.group(1).split(',')
        if token.strip()
    ]


def _row_value(row: Any, key: str, fallback_index: int) -> Any:
    mapping = getattr(row, '_mapping', None)
    if mapping is not None and key in mapping:
        return mapping[key]
    if isinstance(row, dict):
        return row.get(key)
    try:
        return row[fallback_index]
    except Exception:
        return None


def _normalize_limit(value: Any, *, default: int, maximum: int) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = default
    return min(max(numeric, 1), maximum)


def _serialize_value(value: Any) -> Any:
    if isinstance(value, (datetime, date, UUID, Decimal)):
        return str(value)
    if isinstance(value, list):
        return [_serialize_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _serialize_value(item) for key, item in value.items()}
    return value


def _serialize_record(record: Any) -> dict[str, Any]:
    return {
        column.name: _serialize_value(getattr(record, column.name))
        for column in record.__table__.columns
    }


def _infer_json_structure(
    values: list[Any],
    *,
    path: str,
    samples: dict[str, list[Any]],
) -> Any:
    non_null = [value for value in values if value is not None]
    if not non_null:
        return 'null'

    if all(isinstance(value, dict) for value in non_null):
        keys = sorted({
            key
            for value in non_null
            for key in value.keys()
        })
        return {
            str(key): _infer_json_structure(
                [value.get(key) for value in non_null if key in value],
                path=f'{path}.{key}' if path else str(key),
                samples=samples,
            )
            for key in keys
        }

    if all(isinstance(value, list) for value in non_null):
        elements = [
            item
            for value in non_null
            for item in value
        ]
        element_path = f'{path}[0]' if path else '[0]'
        return [
            _infer_json_structure(elements, path=element_path, samples=samples)
            if elements else 'unknown'
        ]

    scalar_types = sorted({_infer_scalar_type(value) for value in non_null})
    sample_key = path or 'value'
    for value in non_null:
        serialized = _serialize_value(value)
        if serialized in samples[sample_key]:
            continue
        samples[sample_key].append(serialized)
        if len(samples[sample_key]) >= 3:
            break
    return scalar_types[0] if len(scalar_types) == 1 else f"mixed({', '.join(scalar_types)})"


def _infer_scalar_type(value: Any) -> str:
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, int):
        return 'integer'
    if isinstance(value, float):
        return 'number'
    if isinstance(value, dict):
        return 'object'
    if isinstance(value, list):
        return 'array'
    if isinstance(value, str):
        if _DATE_PATTERN.match(value):
            return 'date'
        if _TIMESTAMP_PATTERN.match(value):
            return 'timestamp'
        return 'text'
    if isinstance(value, datetime):
        return 'timestamp'
    if isinstance(value, date):
        return 'date'
    return type(value).__name__.lower()
