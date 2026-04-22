"""Shared Sherlock entity resolution over semantic dimensions and raw surfaces."""
from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.chat_engine.data_surfaces import get_entity_resolvers, resolve_source_values
from app.services.chat_engine.sql_agent import _normalize_dimensions, load_app_config, load_semantic_model


def _dimension_lookup_map(semantic_model: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(dimension['name']).lower(): dimension
        for dimension in _normalize_dimensions(semantic_model)
    }


def _table_scope_columns(semantic_model: dict[str, Any], table_name: str) -> tuple[str, str]:
    tables = semantic_model.get('tables', {})
    table_config = tables.get(table_name, {}) if isinstance(tables, dict) else {}
    access = table_config.get('access_control', {}) if isinstance(table_config, dict) else {}
    tenant_column = access.get('tenant_column', 'tenant_id')
    app_column = access.get('app_column', 'app_id')
    return app_column, tenant_column


async def resolve_entity_matches(
    *,
    entity_type: str,
    search: str,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    app_config: dict[str, Any] | None = None,
    semantic_model: dict[str, Any] | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    from app.services.report_builder.analytics_pack import _ANALYTICS_PACK

    if not search.strip():
        return {
            'status': 'error',
            'error': 'Search value is required for entity resolution.',
            'reason': 'empty_search',
        }

    active_app_config = app_config if app_config is not None else await load_app_config(db, app_id)
    active_semantic_model = semantic_model or load_semantic_model(app_id, app_config=active_app_config)

    vocab = _ANALYTICS_PACK.tool_vocabulary(app_id, active_semantic_model)
    if not vocab.validate_entity_type(entity_type):
        return _ANALYTICS_PACK.entity_type_error_payload(entity_type, vocab)

    resolvers = get_entity_resolvers(active_app_config, entity_type=entity_type)
    if not resolvers:
        # Entity type is valid per the vocabulary but has no configured
        # resolver on the app config — fall back to the semantic dimension
        # with the same name (the vocabulary guarantees this exists).
        if entity_type.lower() in vocab.dimensions:
            resolvers = [{
                'key': entity_type,
                'entity_type': entity_type,
                'description': f'Resolve {entity_type} from the semantic model.',
                'source': 'semantic_dimension',
                'dimension': entity_type,
                'field': None,
                'match': 'contains',
                'limit': limit,
            }]

    matches: list[dict[str, Any]] = []
    for resolver in resolvers:
        resolver_limit = min(limit, resolver.get('limit', limit))
        if resolver['source'] == 'semantic_dimension' and resolver.get('dimension'):
            results = await _lookup_semantic_dimension_values(
                dimension=resolver['dimension'],
                search=search,
                match=resolver['match'],
                limit=resolver_limit,
                db=db,
                auth=auth,
                app_id=app_id,
                semantic_model=active_semantic_model,
            )
        elif resolver.get('field'):
            results = await resolve_source_values(
                source=resolver['source'],
                field=resolver['field'],
                search=search,
                match=resolver['match'],
                db=db,
                auth=auth,
                app_id=app_id,
                limit=resolver_limit,
            )
        else:
            results = []
        for result in results:
            value = result.get('value')
            if value in (None, ''):
                continue
            matches.append({
                'entity_type': resolver['entity_type'],
                'value': value,
                'count': result.get('count'),
                'source': resolver['source'],
                'resolver_key': resolver['key'],
                'description': resolver['description'],
                'match': resolver['match'],
            })

    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for match in matches:
        key = (match['entity_type'], str(match['value']))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(match)

    return {
        'status': 'ok',
        'entity_type': entity_type,
        'search': search,
        'matches': deduped[:limit],
        'available_entity_types': sorted(vocab.entity_types),
    }


async def _lookup_semantic_dimension_values(
    *,
    dimension: str,
    search: str,
    match: str,
    limit: int,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    semantic_model: dict[str, Any],
) -> list[dict[str, Any]]:
    dimensions = _dimension_lookup_map(semantic_model)
    dimension_def = dimensions.get(dimension.lower())
    if not dimension_def:
        return []

    table_name = dimension_def['table']
    expression = dimension_def['expression']
    app_column, tenant_column = _table_scope_columns(semantic_model, table_name)
    params: dict[str, Any] = {
        'app_id': app_id,
        'tenant_id': str(getattr(auth, 'tenant_id', '')),
        'limit': limit,
    }
    search_clause = ''
    normalized_search = search.strip()
    if normalized_search:
        if match == 'exact':
            params['search'] = normalized_search
            search_clause = f' AND ({expression})::text = :search'
        elif match == 'prefix':
            params['search'] = f'{normalized_search}%'
            search_clause = f' AND ({expression})::text ILIKE :search'
        else:
            params['search'] = f'%{normalized_search}%'
            search_clause = f' AND ({expression})::text ILIKE :search'

    result = await db.execute(
        text(
            f"""
            SELECT {expression} AS value, COUNT(*) AS n
            FROM {table_name}
            WHERE {app_column} = :app_id
              AND {tenant_column} = :tenant_id
              AND ({expression}) IS NOT NULL
              AND ({expression})::text <> ''
              {search_clause}
            GROUP BY 1
            ORDER BY 2 DESC, 1 ASC
            LIMIT :limit
            """
        ),
        params,
    )
    return [
        {'value': row[0], 'count': row[1], 'source': 'semantic_dimension'}
        for row in result.all()
        if row[0] not in (None, '')
    ]
