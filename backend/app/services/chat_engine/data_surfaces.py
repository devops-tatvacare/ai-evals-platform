"""Shared config-driven Sherlock data surfaces and raw evidence access."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import String as SAString
from sqlalchemy import cast, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eval_run import (
    EvaluationRun,
    EvaluationRunAdversarialResult,
    EvaluationRunApiCallLog,
    EvaluationRunThreadResult,
)
from app.services.access_control import readable_scope_clause
from app.services.chat_engine.manifest import get_manifest

_DEFAULT_LIMIT = 10
_MAX_LIMIT = 25
_MAX_TEXT_LENGTH = 1200
_SUPPORTED_SOURCES = {
    'evaluation_runs',
    'evaluation_run_api_call_logs',
    'evaluation_run_thread_results',
    'evaluation_run_adversarial_results',
}


def app_access_clause_for_surfaces(model: Any, auth: Any):
    from sqlalchemy.sql import false, true

    if getattr(auth, 'is_owner', False):
        return true()
    app_access = getattr(auth, 'app_access', frozenset())
    if not app_access:
        return false()
    return model.app_id.in_(tuple(sorted(app_access)))


def get_data_surfaces(
    app_id_or_config: str | dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Return the configured data surfaces for an app.

    M2: the manifest is the authoritative surface source. Dict-shaped
    callers (legacy ``App.config`` path) return an empty list — the
    legacy fallback is gone.
    """
    if isinstance(app_id_or_config, str):
        return _surfaces_from_manifest(app_id_or_config)
    return []


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

    if source == 'evaluation_runs':
        records = await _fetch_evaluation_runs(
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
    elif source == 'evaluation_run_api_call_logs':
        records = await _fetch_api_call_logs(
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
    elif source == 'evaluation_run_thread_results':
        records = await _fetch_thread_results(
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
    elif source == 'evaluation_run_adversarial_results':
        records = await _fetch_adversarial_results(
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

    if source == 'evaluation_runs':
        query = (
            select(value_expr.label('value'), count_expr.label('n'))
            .select_from(EvaluationRun)
            .where(
                readable_scope_clause(EvaluationRun, auth),
                app_access_clause_for_surfaces(EvaluationRun, auth),
                EvaluationRun.app_id == app_id,
                column.isnot(None),
                value_expr != '',
            )
        )
    elif source == 'evaluation_run_api_call_logs':
        query = (
            select(value_expr.label('value'), count_expr.label('n'))
            .select_from(EvaluationRunApiCallLog)
            .join(EvaluationRun, EvaluationRunApiCallLog.run_id == EvaluationRun.id)
            .where(
                readable_scope_clause(EvaluationRun, auth),
                app_access_clause_for_surfaces(EvaluationRun, auth),
                EvaluationRun.app_id == app_id,
                column.isnot(None),
                value_expr != '',
            )
        )
    elif source == 'evaluation_run_thread_results':
        query = (
            select(value_expr.label('value'), count_expr.label('n'))
            .select_from(EvaluationRunThreadResult)
            .join(EvaluationRun, EvaluationRunThreadResult.run_id == EvaluationRun.id)
            .where(
                readable_scope_clause(EvaluationRun, auth),
                app_access_clause_for_surfaces(EvaluationRun, auth),
                EvaluationRun.app_id == app_id,
                column.isnot(None),
                value_expr != '',
            )
        )
    else:
        query = (
            select(value_expr.label('value'), count_expr.label('n'))
            .select_from(EvaluationRunAdversarialResult)
            .join(EvaluationRun, EvaluationRunAdversarialResult.run_id == EvaluationRun.id)
            .where(
                readable_scope_clause(EvaluationRun, auth),
                app_access_clause_for_surfaces(EvaluationRun, auth),
                EvaluationRun.app_id == app_id,
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
    if source == 'evaluation_runs':
        mapping = {
            'run_id': cast(EvaluationRun.id, SAString),
            # EvaluationRun.batch_metadata is a plain JSON column (not JSONB), so
            # the ``.astext`` accessor is unavailable. ``json_extract_path_text``
            # works on both JSON and JSONB and returns TEXT directly.
            'run_name': cast(func.json_extract_path_text(EvaluationRun.batch_metadata, 'name'), SAString),
            'eval_type': EvaluationRun.eval_type,
            'status': EvaluationRun.status,
            'error_message': EvaluationRun.error_message,
            'created_at': cast(EvaluationRun.created_at, SAString),
        }
        return mapping.get(field)
    if source == 'evaluation_run_api_call_logs':
        mapping = {
            'run_id': cast(EvaluationRunApiCallLog.run_id, SAString),
            'thread_id': EvaluationRunApiCallLog.thread_id,
            'provider': EvaluationRunApiCallLog.provider,
            'model': EvaluationRunApiCallLog.model,
            'method': EvaluationRunApiCallLog.method,
            'prompt': EvaluationRunApiCallLog.prompt,
            'response': EvaluationRunApiCallLog.response,
            'error': EvaluationRunApiCallLog.error,
            'created_at': cast(EvaluationRunApiCallLog.created_at, SAString),
        }
        return mapping.get(field)
    if source == 'evaluation_run_thread_results':
        mapping = {
            'run_id': cast(EvaluationRunThreadResult.run_id, SAString),
            'thread_id': EvaluationRunThreadResult.thread_id,
            'worst_correctness': EvaluationRunThreadResult.worst_correctness,
            'efficiency_verdict': EvaluationRunThreadResult.efficiency_verdict,
            'intent_accuracy': cast(EvaluationRunThreadResult.intent_accuracy, SAString),
            'success_status': cast(EvaluationRunThreadResult.success_status, SAString),
            'created_at': cast(EvaluationRunThreadResult.created_at, SAString),
        }
        return mapping.get(field)
    if source == 'evaluation_run_adversarial_results':
        mapping = {
            'run_id': cast(EvaluationRunAdversarialResult.run_id, SAString),
            'difficulty': EvaluationRunAdversarialResult.difficulty,
            'verdict': EvaluationRunAdversarialResult.verdict,
            'goal_achieved': cast(EvaluationRunAdversarialResult.goal_achieved, SAString),
            'total_turns': cast(EvaluationRunAdversarialResult.total_turns, SAString),
            'created_at': cast(EvaluationRunAdversarialResult.created_at, SAString),
        }
        return mapping.get(field)
    return None


def _apply_entity_filter(query: Any, *, source: str, entity_field_map: dict[str, str], entity_type: str | None, entity_value: str | None):
    if not entity_type or not entity_value:
        return query
    field = entity_field_map.get(entity_type)
    if not field:
        raise ValueError(
            f"Surface backed by {source!r} does not declare a filter column "
            f"for entity_type={entity_type!r}. Declared mappings: "
            f"{sorted(entity_field_map.keys())!r}. Fix the manifest's "
            f"entity_field_map or call with a supported entity_type."
        )
    column = _source_field_expression(source, field)
    if column is None:
        raise ValueError(
            f"Surface backed by {source!r} has a manifest mapping "
            f"{entity_type!r} -> {field!r}, but the backing ORM exposes no "
            f"column by that name. Fix the manifest or the surface SQL bindings."
        )
    return query.where(_match_condition(cast(column, SAString), entity_value, 'prefix'))


def _apply_run_filter(query: Any, *, source: str, run_id: str | None):
    if not run_id:
        return query
    run_value = run_id.strip()
    if not run_value:
        return query
    if source == 'evaluation_runs':
        return query.where(cast(EvaluationRun.id, SAString).ilike(f'{run_value}%'))
    if source == 'evaluation_run_api_call_logs':
        return query.where(cast(EvaluationRunApiCallLog.run_id, SAString).ilike(f'{run_value}%'))
    if source == 'evaluation_run_thread_results':
        return query.where(cast(EvaluationRunThreadResult.run_id, SAString).ilike(f'{run_value}%'))
    if source == 'evaluation_run_adversarial_results':
        return query.where(cast(EvaluationRunAdversarialResult.run_id, SAString).ilike(f'{run_value}%'))
    return query


async def _fetch_evaluation_runs(
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
        select(EvaluationRun)
        .where(
            readable_scope_clause(EvaluationRun, auth),
            app_access_clause_for_surfaces(EvaluationRun, auth),
            EvaluationRun.app_id == app_id,
        )
        .order_by(desc(EvaluationRun.created_at))
        .limit(limit)
    )
    query = _apply_entity_filter(query, source='evaluation_runs', entity_field_map=entity_field_map, entity_type=entity_type, entity_value=entity_value)
    query = _apply_run_filter(query, source='evaluation_runs', run_id=run_id)
    result = await db.execute(query)
    return [_serialize_evaluation_run(run, fields) for run in result.scalars().all()]


async def _fetch_api_call_logs(
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
        select(EvaluationRunApiCallLog, EvaluationRun)
        .join(EvaluationRun, EvaluationRunApiCallLog.run_id == EvaluationRun.id)
        .where(
            readable_scope_clause(EvaluationRun, auth),
            app_access_clause_for_surfaces(EvaluationRun, auth),
            EvaluationRun.app_id == app_id,
        )
        .order_by(desc(EvaluationRunApiCallLog.created_at))
        .limit(limit)
    )
    query = _apply_entity_filter(query, source='evaluation_run_api_call_logs', entity_field_map=entity_field_map, entity_type=entity_type, entity_value=entity_value)
    query = _apply_run_filter(query, source='evaluation_run_api_call_logs', run_id=run_id)
    result = await db.execute(query)
    return [_serialize_api_call_log(api_log, evaluation_run, fields) for api_log, evaluation_run in result.all()]


async def _fetch_thread_results(
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
        select(EvaluationRunThreadResult, EvaluationRun)
        .join(EvaluationRun, EvaluationRunThreadResult.run_id == EvaluationRun.id)
        .where(
            readable_scope_clause(EvaluationRun, auth),
            app_access_clause_for_surfaces(EvaluationRun, auth),
            EvaluationRun.app_id == app_id,
        )
        .order_by(desc(EvaluationRunThreadResult.created_at))
        .limit(limit)
    )
    query = _apply_entity_filter(query, source='evaluation_run_thread_results', entity_field_map=entity_field_map, entity_type=entity_type, entity_value=entity_value)
    query = _apply_run_filter(query, source='evaluation_run_thread_results', run_id=run_id)
    result = await db.execute(query)
    return [_serialize_thread_result(row, evaluation_run, fields) for row, evaluation_run in result.all()]


async def _fetch_adversarial_results(
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
        select(EvaluationRunAdversarialResult, EvaluationRun)
        .join(EvaluationRun, EvaluationRunAdversarialResult.run_id == EvaluationRun.id)
        .where(
            readable_scope_clause(EvaluationRun, auth),
            app_access_clause_for_surfaces(EvaluationRun, auth),
            EvaluationRun.app_id == app_id,
        )
        .order_by(desc(EvaluationRunAdversarialResult.created_at))
        .limit(limit)
    )
    query = _apply_entity_filter(query, source='evaluation_run_adversarial_results', entity_field_map=entity_field_map, entity_type=entity_type, entity_value=entity_value)
    query = _apply_run_filter(query, source='evaluation_run_adversarial_results', run_id=run_id)
    result = await db.execute(query)
    return [_serialize_adversarial_result(row, evaluation_run, fields) for row, evaluation_run in result.all()]


def _serialize_evaluation_run(run: EvaluationRun, fields: list[str]) -> dict[str, Any]:
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


def _serialize_api_call_log(api_log: EvaluationRunApiCallLog, evaluation_run: EvaluationRun, fields: list[str]) -> dict[str, Any]:
    raw_record = {
        'run_id': str(api_log.run_id) if api_log.run_id else '',
        'run_name': ((evaluation_run.batch_metadata or {}).get('name') or ''),
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


def _serialize_thread_result(row: EvaluationRunThreadResult, evaluation_run: EvaluationRun, fields: list[str]) -> dict[str, Any]:
    raw_record = {
        'run_id': str(row.run_id),
        'run_name': ((evaluation_run.batch_metadata or {}).get('name') or ''),
        'thread_id': row.thread_id,
        'worst_correctness': row.worst_correctness,
        'efficiency_verdict': row.efficiency_verdict,
        'intent_accuracy': row.intent_accuracy,
        'success_status': row.success_status,
        'result': _serialize_blob(row.result),
        'created_at': _serialize_datetime(row.created_at),
    }
    return _select_fields(raw_record, fields)


def _serialize_adversarial_result(row: EvaluationRunAdversarialResult, evaluation_run: EvaluationRun, fields: list[str]) -> dict[str, Any]:
    raw_record = {
        'run_id': str(row.run_id),
        'run_name': ((evaluation_run.batch_metadata or {}).get('name') or ''),
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
