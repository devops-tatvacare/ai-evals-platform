"""Shared config-driven Sherlock data surfaces and raw evidence access."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import String as SAString
from sqlalchemy import cast, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eval_run import AdversarialEvaluation, ApiLog, EvalRun, ThreadEvaluation
from app.services.access_control import readable_scope_clause
from app.services.chat_engine.manifest import get_manifest

_DEFAULT_LIMIT = 10
_MAX_LIMIT = 25
_MAX_TEXT_LENGTH = 1200
_SUPPORTED_SOURCES = {
    'eval_runs',
    'api_logs',
    'thread_evaluations',
    'adversarial_evaluations',
}


def app_access_clause_for_surfaces(model: Any, auth: Any):
    from sqlalchemy.sql import false, true

    if getattr(auth, 'is_owner', False):
        return true()
    app_access = getattr(auth, 'app_access', frozenset())
    if not app_access:
        return false()
    return model.app_id.in_(tuple(sorted(app_access)))


def get_chat_config(app_config: dict[str, Any] | None) -> dict[str, Any]:
    chat_config = ((app_config or {}).get('chat') or {})
    return chat_config if isinstance(chat_config, dict) else {}


def get_data_surfaces(
    app_id_or_config: str | dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Return the configured data surfaces for an app.

    Canonical call: ``get_data_surfaces(app_id)`` — reads the manifest.
    Legacy shape ``get_data_surfaces(app_config)`` is still accepted while
    callers are migrated; a dict argument is treated as a full app_config
    and we fall back to the old DB-backed parser.
    """
    if isinstance(app_id_or_config, str):
        return _surfaces_from_manifest(app_id_or_config)
    return _surfaces_from_app_config(app_id_or_config)


def _surfaces_from_manifest(app_id: str) -> list[dict[str, Any]]:
    try:
        manifest = get_manifest(app_id)
    except KeyError:
        return []
    surfaces: list[dict[str, Any]] = []
    for s in manifest.data_surfaces:
        if s.backed_by not in _SUPPORTED_SOURCES:
            continue
        entity_field_map = dict(s.entity_field_map)
        # Legacy behaviour: if entity_types declares a type not mirrored in the
        # map (e.g. {thread_id} with no explicit map), assume an identity map.
        for entity_type in s.entity_types:
            entity_field_map.setdefault(entity_type, entity_type)
        surfaces.append({
            'key': s.key,
            'description': s.description or '',
            'source': s.backed_by,
            'entity_field_map': entity_field_map,
            'fields': list(s.fields),
            'default_limit': _normalize_limit(s.default_limit),
        })
    return surfaces


def _surfaces_from_app_config(app_config: dict[str, Any] | None) -> list[dict[str, Any]]:
    raw_surfaces = get_chat_config(app_config).get('dataSurfaces')
    if raw_surfaces is None:
        raw_surfaces = get_chat_config(app_config).get('data_surfaces')
    if not isinstance(raw_surfaces, list):
        return []

    surfaces: list[dict[str, Any]] = []
    for item in raw_surfaces:
        if not isinstance(item, dict):
            continue
        source = str(item.get('source', '')).strip()
        key = str(item.get('key', '')).strip()
        if not key or source not in _SUPPORTED_SOURCES:
            continue
        raw_entity_map = item.get('entityFieldMap', item.get('entity_field_map', {}))
        entity_field_map = raw_entity_map if isinstance(raw_entity_map, dict) else {}
        raw_fields = item.get('fields', [])
        surfaces.append({
            'key': key,
            'description': str(item.get('description', '')).strip(),
            'source': source,
            'entity_field_map': {
                str(entity_type): str(field)
                for entity_type, field in entity_field_map.items()
                if entity_type and field
            },
            'fields': [str(field) for field in raw_fields if field],
            'default_limit': _normalize_limit(item.get('defaultLimit', item.get('default_limit', _DEFAULT_LIMIT))),
        })
    return surfaces


def get_entity_resolvers(
    app_config: dict[str, Any] | None,
    *,
    entity_type: str | None = None,
) -> list[dict[str, Any]]:
    raw_resolvers = get_chat_config(app_config).get('entityResolvers')
    if raw_resolvers is None:
        raw_resolvers = get_chat_config(app_config).get('entity_resolvers')
    if not isinstance(raw_resolvers, list):
        return []

    wanted_entity = entity_type.lower() if entity_type else None
    resolvers: list[dict[str, Any]] = []
    for item in raw_resolvers:
        if not isinstance(item, dict):
            continue
        resolver_entity = str(item.get('entityType', item.get('entity_type', ''))).strip()
        source = str(item.get('source', '')).strip()
        if not resolver_entity or not source:
            continue
        if wanted_entity and resolver_entity.lower() != wanted_entity:
            continue
        if source != 'semantic_dimension' and source not in _SUPPORTED_SOURCES:
            continue
        resolvers.append({
            'key': str(item.get('key', resolver_entity)).strip() or resolver_entity,
            'entity_type': resolver_entity,
            'description': str(item.get('description', '')).strip(),
            'source': source,
            'field': str(item.get('field', '')).strip() or None,
            'dimension': str(item.get('dimension', '')).strip() or None,
            'match': _normalize_match(item.get('match')),
            'limit': _normalize_limit(item.get('limit', _DEFAULT_LIMIT)),
        })
    return resolvers


def build_surface_catalog(
    app_id_or_config: str | dict[str, Any] | None,
) -> list[dict[str, Any]]:
    return [
        {
            'key': surface['key'],
            'description': surface['description'],
            'source': surface['source'],
            'entity_types': sorted(surface['entity_field_map'].keys()),
            'fields': list(surface['fields']),
            'default_limit': surface['default_limit'],
        }
        for surface in get_data_surfaces(app_id_or_config)
    ]


def get_surface_by_key(
    app_id_or_config: str | dict[str, Any] | None,
    surface_key: str,
) -> dict[str, Any] | None:
    for surface in get_data_surfaces(app_id_or_config):
        if surface['key'] == surface_key:
            return surface
    return None


async def fetch_surface_records(
    *,
    surface: dict[str, Any],
    db: AsyncSession,
    auth: Any,
    app_id: str,
    entity_type: str | None = None,
    entity_value: str | None = None,
    run_id: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    source = surface['source']
    limit = _normalize_limit(limit or surface.get('default_limit', _DEFAULT_LIMIT))

    if source == 'eval_runs':
        records = await _fetch_eval_runs(
            db=db,
            auth=auth,
            app_id=app_id,
            entity_type=entity_type,
            entity_value=entity_value,
            run_id=run_id,
            limit=limit,
            fields=surface['fields'],
            entity_field_map=surface['entity_field_map'],
        )
    elif source == 'api_logs':
        records = await _fetch_api_logs(
            db=db,
            auth=auth,
            app_id=app_id,
            entity_type=entity_type,
            entity_value=entity_value,
            run_id=run_id,
            limit=limit,
            fields=surface['fields'],
            entity_field_map=surface['entity_field_map'],
        )
    elif source == 'thread_evaluations':
        records = await _fetch_thread_evaluations(
            db=db,
            auth=auth,
            app_id=app_id,
            entity_type=entity_type,
            entity_value=entity_value,
            run_id=run_id,
            limit=limit,
            fields=surface['fields'],
            entity_field_map=surface['entity_field_map'],
        )
    elif source == 'adversarial_evaluations':
        records = await _fetch_adversarial_evaluations(
            db=db,
            auth=auth,
            app_id=app_id,
            entity_type=entity_type,
            entity_value=entity_value,
            run_id=run_id,
            limit=limit,
            fields=surface['fields'],
            entity_field_map=surface['entity_field_map'],
        )
    else:
        raise ValueError(f'Unsupported surface source: {source}')

    return {
        'surface': surface['key'],
        'source': source,
        'record_count': len(records),
        'records': records,
        'entity_types': sorted(surface['entity_field_map'].keys()),
    }


async def resolve_source_values(
    *,
    source: str,
    field: str,
    search: str,
    match: str,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    limit: int,
) -> list[dict[str, Any]]:
    column = _source_field_expression(source, field)
    if column is None:
        return []

    limit = _normalize_limit(limit)
    value_expr = cast(column, SAString)
    count_expr = func.count()

    if source == 'eval_runs':
        query = (
            select(value_expr.label('value'), count_expr.label('n'))
            .select_from(EvalRun)
            .where(
                readable_scope_clause(EvalRun, auth),
                app_access_clause_for_surfaces(EvalRun, auth),
                EvalRun.app_id == app_id,
                column.isnot(None),
                value_expr != '',
            )
        )
    elif source == 'api_logs':
        query = (
            select(value_expr.label('value'), count_expr.label('n'))
            .select_from(ApiLog)
            .join(EvalRun, ApiLog.run_id == EvalRun.id)
            .where(
                readable_scope_clause(EvalRun, auth),
                app_access_clause_for_surfaces(EvalRun, auth),
                EvalRun.app_id == app_id,
                column.isnot(None),
                value_expr != '',
            )
        )
    elif source == 'thread_evaluations':
        query = (
            select(value_expr.label('value'), count_expr.label('n'))
            .select_from(ThreadEvaluation)
            .join(EvalRun, ThreadEvaluation.run_id == EvalRun.id)
            .where(
                readable_scope_clause(EvalRun, auth),
                app_access_clause_for_surfaces(EvalRun, auth),
                EvalRun.app_id == app_id,
                column.isnot(None),
                value_expr != '',
            )
        )
    else:
        query = (
            select(value_expr.label('value'), count_expr.label('n'))
            .select_from(AdversarialEvaluation)
            .join(EvalRun, AdversarialEvaluation.run_id == EvalRun.id)
            .where(
                readable_scope_clause(EvalRun, auth),
                app_access_clause_for_surfaces(EvalRun, auth),
                EvalRun.app_id == app_id,
                column.isnot(None),
                value_expr != '',
            )
        )

    if search.strip():
        query = query.where(_match_condition(value_expr, search.strip(), match))

    result = await db.execute(
        query.group_by(value_expr).order_by(desc(count_expr), value_expr.asc()).limit(limit)
    )
    return [
        {'value': row[0], 'count': int(row[1] or 0), 'source': source}
        for row in result.all()
        if row[0] not in (None, '')
    ]


def _normalize_limit(value: Any) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = _DEFAULT_LIMIT
    return min(max(numeric, 1), _MAX_LIMIT)


def _normalize_match(value: Any) -> str:
    normalized = str(value or 'contains').strip().lower()
    if normalized not in {'exact', 'prefix', 'contains'}:
        return 'contains'
    return normalized


def _match_condition(column: Any, value: str, match: str):
    normalized = _normalize_match(match)
    if normalized == 'exact':
        return column == value
    if normalized == 'prefix':
        return column.ilike(f'{value}%')
    return column.ilike(f'%{value}%')


def _source_field_expression(source: str, field: str):
    if source == 'eval_runs':
        mapping = {
            'run_id': cast(EvalRun.id, SAString),
            # EvalRun.batch_metadata is a plain JSON column (not JSONB), so
            # the ``.astext`` accessor is unavailable. ``json_extract_path_text``
            # works on both JSON and JSONB and returns TEXT directly.
            'run_name': cast(func.json_extract_path_text(EvalRun.batch_metadata, 'name'), SAString),
            'eval_type': EvalRun.eval_type,
            'status': EvalRun.status,
            'error_message': EvalRun.error_message,
            'created_at': cast(EvalRun.created_at, SAString),
        }
        return mapping.get(field)
    if source == 'api_logs':
        mapping = {
            'run_id': cast(ApiLog.run_id, SAString),
            'thread_id': ApiLog.thread_id,
            'provider': ApiLog.provider,
            'model': ApiLog.model,
            'method': ApiLog.method,
            'prompt': ApiLog.prompt,
            'response': ApiLog.response,
            'error': ApiLog.error,
            'created_at': cast(ApiLog.created_at, SAString),
        }
        return mapping.get(field)
    if source == 'thread_evaluations':
        mapping = {
            'run_id': cast(ThreadEvaluation.run_id, SAString),
            'thread_id': ThreadEvaluation.thread_id,
            'worst_correctness': ThreadEvaluation.worst_correctness,
            'efficiency_verdict': ThreadEvaluation.efficiency_verdict,
            'intent_accuracy': cast(ThreadEvaluation.intent_accuracy, SAString),
            'success_status': cast(ThreadEvaluation.success_status, SAString),
            'created_at': cast(ThreadEvaluation.created_at, SAString),
        }
        return mapping.get(field)
    if source == 'adversarial_evaluations':
        mapping = {
            'run_id': cast(AdversarialEvaluation.run_id, SAString),
            'difficulty': AdversarialEvaluation.difficulty,
            'verdict': AdversarialEvaluation.verdict,
            'goal_achieved': cast(AdversarialEvaluation.goal_achieved, SAString),
            'total_turns': cast(AdversarialEvaluation.total_turns, SAString),
            'created_at': cast(AdversarialEvaluation.created_at, SAString),
        }
        return mapping.get(field)
    return None


def _apply_entity_filter(query: Any, *, source: str, entity_field_map: dict[str, str], entity_type: str | None, entity_value: str | None):
    if not entity_type or not entity_value:
        return query
    field = entity_field_map.get(entity_type)
    if not field:
        return query
    column = _source_field_expression(source, field)
    if column is None:
        return query
    return query.where(_match_condition(cast(column, SAString), entity_value, 'prefix'))


def _apply_run_filter(query: Any, *, source: str, run_id: str | None):
    if not run_id:
        return query
    run_value = run_id.strip()
    if not run_value:
        return query
    if source == 'eval_runs':
        return query.where(cast(EvalRun.id, SAString).ilike(f'{run_value}%'))
    if source == 'api_logs':
        return query.where(cast(ApiLog.run_id, SAString).ilike(f'{run_value}%'))
    if source == 'thread_evaluations':
        return query.where(cast(ThreadEvaluation.run_id, SAString).ilike(f'{run_value}%'))
    if source == 'adversarial_evaluations':
        return query.where(cast(AdversarialEvaluation.run_id, SAString).ilike(f'{run_value}%'))
    return query


async def _fetch_eval_runs(
    *,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    entity_type: str | None,
    entity_value: str | None,
    run_id: str | None,
    limit: int,
    fields: list[str],
    entity_field_map: dict[str, str],
) -> list[dict[str, Any]]:
    query = (
        select(EvalRun)
        .where(
            readable_scope_clause(EvalRun, auth),
            app_access_clause_for_surfaces(EvalRun, auth),
            EvalRun.app_id == app_id,
        )
        .order_by(desc(EvalRun.created_at))
        .limit(limit)
    )
    query = _apply_entity_filter(query, source='eval_runs', entity_field_map=entity_field_map, entity_type=entity_type, entity_value=entity_value)
    query = _apply_run_filter(query, source='eval_runs', run_id=run_id)
    result = await db.execute(query)
    return [_serialize_eval_run(run, fields) for run in result.scalars().all()]


async def _fetch_api_logs(
    *,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    entity_type: str | None,
    entity_value: str | None,
    run_id: str | None,
    limit: int,
    fields: list[str],
    entity_field_map: dict[str, str],
) -> list[dict[str, Any]]:
    query = (
        select(ApiLog, EvalRun)
        .join(EvalRun, ApiLog.run_id == EvalRun.id)
        .where(
            readable_scope_clause(EvalRun, auth),
            app_access_clause_for_surfaces(EvalRun, auth),
            EvalRun.app_id == app_id,
        )
        .order_by(desc(ApiLog.created_at))
        .limit(limit)
    )
    query = _apply_entity_filter(query, source='api_logs', entity_field_map=entity_field_map, entity_type=entity_type, entity_value=entity_value)
    query = _apply_run_filter(query, source='api_logs', run_id=run_id)
    result = await db.execute(query)
    return [_serialize_api_log(api_log, eval_run, fields) for api_log, eval_run in result.all()]


async def _fetch_thread_evaluations(
    *,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    entity_type: str | None,
    entity_value: str | None,
    run_id: str | None,
    limit: int,
    fields: list[str],
    entity_field_map: dict[str, str],
) -> list[dict[str, Any]]:
    query = (
        select(ThreadEvaluation, EvalRun)
        .join(EvalRun, ThreadEvaluation.run_id == EvalRun.id)
        .where(
            readable_scope_clause(EvalRun, auth),
            app_access_clause_for_surfaces(EvalRun, auth),
            EvalRun.app_id == app_id,
        )
        .order_by(desc(ThreadEvaluation.created_at))
        .limit(limit)
    )
    query = _apply_entity_filter(query, source='thread_evaluations', entity_field_map=entity_field_map, entity_type=entity_type, entity_value=entity_value)
    query = _apply_run_filter(query, source='thread_evaluations', run_id=run_id)
    result = await db.execute(query)
    return [_serialize_thread_evaluation(row, eval_run, fields) for row, eval_run in result.all()]


async def _fetch_adversarial_evaluations(
    *,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    entity_type: str | None,
    entity_value: str | None,
    run_id: str | None,
    limit: int,
    fields: list[str],
    entity_field_map: dict[str, str],
) -> list[dict[str, Any]]:
    query = (
        select(AdversarialEvaluation, EvalRun)
        .join(EvalRun, AdversarialEvaluation.run_id == EvalRun.id)
        .where(
            readable_scope_clause(EvalRun, auth),
            app_access_clause_for_surfaces(EvalRun, auth),
            EvalRun.app_id == app_id,
        )
        .order_by(desc(AdversarialEvaluation.created_at))
        .limit(limit)
    )
    query = _apply_entity_filter(query, source='adversarial_evaluations', entity_field_map=entity_field_map, entity_type=entity_type, entity_value=entity_value)
    query = _apply_run_filter(query, source='adversarial_evaluations', run_id=run_id)
    result = await db.execute(query)
    return [_serialize_adversarial_evaluation(row, eval_run, fields) for row, eval_run in result.all()]


def _serialize_eval_run(run: EvalRun, fields: list[str]) -> dict[str, Any]:
    raw_record = {
        'run_id': str(run.id),
        'run_name': ((run.batch_metadata or {}).get('name') or ''),
        'eval_type': run.eval_type,
        'status': run.status,
        'created_at': _serialize_datetime(run.created_at),
        'completed_at': _serialize_datetime(run.completed_at),
        'duration_ms': run.duration_ms,
        'error_message': run.error_message,
        'summary': _serialize_blob(run.summary),
    }
    return _select_fields(raw_record, fields)


def _serialize_api_log(api_log: ApiLog, eval_run: EvalRun, fields: list[str]) -> dict[str, Any]:
    raw_record = {
        'run_id': str(api_log.run_id) if api_log.run_id else '',
        'run_name': ((eval_run.batch_metadata or {}).get('name') or ''),
        'thread_id': api_log.thread_id or '',
        'provider': api_log.provider,
        'model': api_log.model,
        'method': api_log.method,
        'prompt': _truncate_text(api_log.prompt),
        'response': _truncate_text(api_log.response),
        'error': _truncate_text(api_log.error),
        'duration_ms': api_log.duration_ms,
        'tokens_in': api_log.tokens_in,
        'tokens_out': api_log.tokens_out,
        'created_at': _serialize_datetime(api_log.created_at),
    }
    return _select_fields(raw_record, fields)


def _serialize_thread_evaluation(row: ThreadEvaluation, eval_run: EvalRun, fields: list[str]) -> dict[str, Any]:
    raw_record = {
        'run_id': str(row.run_id),
        'run_name': ((eval_run.batch_metadata or {}).get('name') or ''),
        'thread_id': row.thread_id,
        'worst_correctness': row.worst_correctness,
        'efficiency_verdict': row.efficiency_verdict,
        'intent_accuracy': row.intent_accuracy,
        'success_status': row.success_status,
        'result': _serialize_blob(row.result),
        'created_at': _serialize_datetime(row.created_at),
    }
    return _select_fields(raw_record, fields)


def _serialize_adversarial_evaluation(row: AdversarialEvaluation, eval_run: EvalRun, fields: list[str]) -> dict[str, Any]:
    raw_record = {
        'run_id': str(row.run_id),
        'run_name': ((eval_run.batch_metadata or {}).get('name') or ''),
        'difficulty': row.difficulty,
        'verdict': row.verdict,
        'goal_achieved': row.goal_achieved,
        'goal_flow': _serialize_blob(row.goal_flow),
        'active_traits': _serialize_blob(row.active_traits),
        'total_turns': row.total_turns,
        'result': _serialize_blob(row.result),
        'created_at': _serialize_datetime(row.created_at),
    }
    return _select_fields(raw_record, fields)


def _select_fields(raw_record: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    if not fields:
        return raw_record
    selected = {field: raw_record.get(field) for field in fields if field in raw_record}
    return selected or raw_record


def _truncate_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value)
    if len(text) <= _MAX_TEXT_LENGTH:
        return text
    return f'{text[:_MAX_TEXT_LENGTH]}...'


def _serialize_blob(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    try:
        serialized = json.dumps(value, ensure_ascii=True, sort_keys=True)
    except TypeError:
        serialized = str(value)
    return _truncate_text(serialized)


def _serialize_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()
