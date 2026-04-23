"""
Executes tool calls from the LLM during report builder chat.

Phase 3 — every handler returns a validated §6.2 ``ToolEnvelopeModel`` via
``build_envelope`` / ``error_envelope``. The dispatcher materializes those
typed returns to JSON-safe dicts at the boundary and serializes them to the
outer agent verbatim; no prose substitution.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, cast

logger = logging.getLogger(__name__)

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.chat_engine import reason_codes
from app.services.chat_engine.artifact import ToolEnvelope, ToolEnvelopeModel, dump_tool_envelope

from app.services.report_builder.section_catalog import (
    get_section_detail as _catalog_get_section_detail,
    list_section_types as _catalog_list_section_types,
)

_DISCOVERY_VOLUME_LABELS = {
    'analytics_run_facts': 'runs',
    'analytics_eval_facts': 'evaluations',
    'analytics_criterion_facts': 'criteria',
}


def _materialize_tool_result(raw: Any) -> dict[str, Any]:
    """Convert typed handler returns to plain JSON-safe dicts at the boundary."""

    if isinstance(raw, ToolEnvelopeModel):
        return dump_tool_envelope(raw)
    if isinstance(raw, BaseModel):
        dumped = raw.model_dump(mode='json')
        return dumped if isinstance(dumped, dict) else {'value': dumped}
    return raw if isinstance(raw, dict) else {'value': raw}


def _app_access_clause_for_tools(model, auth):
    """App-access clause matching eval_runs routes pattern."""
    from app.services.chat_engine.data_surfaces import app_access_clause_for_surfaces

    return app_access_clause_for_surfaces(model, auth)


async def _load_active_semantic_model(db: AsyncSession, app_id: str) -> dict[str, Any]:
    from app.services.chat_engine.sql_agent import load_app_config, load_semantic_model

    return load_semantic_model(app_id, app_config=await load_app_config(db, app_id))


def _table_scope_columns(semantic_model: dict[str, Any], table_name: str) -> tuple[str, str]:
    tables = semantic_model.get('tables', {})
    table_config = tables.get(table_name, {}) if isinstance(tables, dict) else {}
    access = table_config.get('access_control', {}) if isinstance(table_config, dict) else {}
    tenant_column = access.get('tenant_column', 'tenant_id')
    app_column = access.get('app_column', 'app_id')
    return app_column, tenant_column


async def handle_discover(
    *,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    session: dict[str, Any] | None = None,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    from app.services.chat_engine.artifact import build_envelope
    from app.services.chat_engine.data_surfaces import build_surface_catalog, get_entity_resolvers
    from app.services.chat_engine.sql_agent import load_app_config
    from app.services.report_builder.analytics.vocabulary import build_tool_vocabulary

    scratchpad = (session or {}).get('scratchpad', {}) if session else {}
    cached = scratchpad.get('discovery')
    if isinstance(cached, dict) and cached.get('app_id') == app_id:
        cached_body = {**cached, 'cache_hit': True}
        return cast(dict[str, Any], build_envelope(
            status='ok',
            summary='cache hit',
            kind='discovery',
            capability='analytics',
            counts={'rows': 0, 'records': 0, 'affected': 0},
            payload=cached_body,
        ))

    app_config = await load_app_config(db, app_id)
    semantic_model = await _load_active_semantic_model(db, app_id)
    vocab = build_tool_vocabulary(app_id, semantic_model)
    surfaces = build_surface_catalog(app_id)
    resolver_entity_types = sorted({
        resolver['entity_type']
        for resolver in get_entity_resolvers(app_config)
    })
    metrics = semantic_model.get('metrics', {})
    params = {
        'app_id': app_id,
        'tenant_id': str(getattr(auth, 'tenant_id', '')),
        'limit': 25,
    }
    errors: list[str] = []
    dimension_payload: list[dict[str, Any]] = []
    volume: dict[str, int] = {}

    for dimension in vocab.dimensions.values():
        table_name = dimension.table
        expression = dimension.expression
        app_column, tenant_column = _table_scope_columns(semantic_model, table_name)
        try:
            result = await db.execute(
                text(
                    f"""
                    SELECT {expression} AS value, COUNT(*) AS n
                    FROM {table_name}
                    WHERE {app_column} = :app_id
                      AND {tenant_column} = :tenant_id
                      AND ({expression}) IS NOT NULL
                      AND ({expression})::text <> ''
                    GROUP BY 1
                    ORDER BY 2 DESC, 1 ASC
                    LIMIT :limit
                    """
                ),
                params,
            )
            values = [
                {'value': row[0], 'count': row[1]}
                for row in result.all()
                if row[0] not in (None, '')
            ]
            dimension_payload.append({
                'name': dimension.name,
                'description': dimension.description,
                'values': values,
            })
        except Exception as exc:
            errors.append(f"{dimension.name}: {exc}")

    tables = semantic_model.get('tables', {})
    if isinstance(tables, dict):
        for table_name in tables.keys():
            app_column, tenant_column = _table_scope_columns(semantic_model, table_name)
            try:
                result = await db.execute(
                    text(
                        f"""
                        SELECT COUNT(*) AS n
                        FROM {table_name}
                        WHERE {app_column} = :app_id
                          AND {tenant_column} = :tenant_id
                        """
                    ),
                    params,
                )
                volume[_DISCOVERY_VOLUME_LABELS.get(table_name, table_name)] = int(result.scalar() or 0)
            except Exception as exc:
                errors.append(f'{table_name}: {exc}')

    time_range = {}
    if 'analytics_run_facts' in tables:
        run_app_column, run_tenant_column = _table_scope_columns(semantic_model, 'analytics_run_facts')
        try:
            result = await db.execute(
                text(
                    f"""
                    SELECT
                        MIN(created_at)::date::text AS earliest,
                        MAX(created_at)::date::text AS latest
                    FROM analytics_run_facts
                    WHERE {run_app_column} = :app_id
                      AND {run_tenant_column} = :tenant_id
                    """
                ),
                params,
            )
            row = result.first()
            if row:
                time_range = {
                    'earliest': row[0],
                    'latest': row[1],
                }
        except Exception as exc:
            errors.append(f'time_range: {exc}')

    metric_payload = []
    if isinstance(metrics, dict):
        metric_payload = [
            {
                'name': name,
                'description': definition.get('description', ''),
            }
            for name, definition in metrics.items()
            if isinstance(definition, dict)
        ]

    from app.services.chat_engine.artifact import build_envelope, error_envelope

    payload_body: dict[str, Any] = {
        'app_id': app_id,
        'time_range': time_range,
        'volume': volume,
        'dimensions': sorted(dimension_payload, key=lambda item: item['name']),
        'metrics': metric_payload,
        'surfaces': surfaces,
        'entity_types': resolver_entity_types,
    }
    if errors:
        payload_body['errors'] = errors

    has_content = bool(dimension_payload or metric_payload or volume or time_range)
    if not has_content:
        return cast(dict[str, Any], error_envelope(
            capability='analytics',
            reason_code=reason_codes.DISCOVER_CACHE_STALE,
            summary='No discoverable data found for this app.',
            warnings=['No discoverable data found for this app.'] + errors,
            payload=payload_body,
        ))

    total_records = sum(int(v or 0) for v in volume.values())
    return cast(dict[str, Any], build_envelope(
        status='partial' if errors else 'ok',
        summary=f"{len(dimension_payload)} dims · {len(surfaces)} surfaces",
        kind='discovery',
        capability='analytics',
        warnings=errors or None,
        counts={'rows': 0, 'records': total_records, 'affected': 0},
        payload=payload_body,
    ))


async def handle_lookup(
    *,
    dimension: str,
    search: str | None = '',
    limit: int = 25,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    from app.services.chat_engine.artifact import build_envelope, error_envelope
    from app.services.report_builder.analytics.vocabulary import (
        build_tool_vocabulary,
        dimension_error_payload,
    )

    semantic_model = await _load_active_semantic_model(db, app_id)
    vocab = build_tool_vocabulary(app_id, semantic_model)
    resolution = vocab.resolve_dimension(dimension)
    if resolution.status != 'unique' or resolution.canonical is None:
        bespoke = dimension_error_payload(resolution, vocab)
        code = reason_codes.ENTITY_AMBIGUOUS if resolution.status == 'ambiguous' else reason_codes.ENTITY_NOT_FOUND
        return cast(dict[str, Any], error_envelope(
            capability='analytics',
            reason_code=code,
            summary=str(bespoke.get('error', 'dimension resolution failed'))[:120],
            warnings=[str(bespoke.get('error'))] if bespoke.get('error') else [],
            payload={k: v for k, v in bespoke.items() if k not in {'status', 'error'}},
        ))

    table_name = resolution.canonical.table
    expression = resolution.canonical.expression
    app_column, tenant_column = _table_scope_columns(semantic_model, table_name)
    params = {
        'app_id': app_id,
        'tenant_id': str(getattr(auth, 'tenant_id', '')),
        'limit': min(max(limit, 1), 100),
    }
    search_text = search.strip() if isinstance(search, str) else ''
    search_clause = ''
    if search_text:
        params['search'] = f"%{search_text}%"
        search_clause = f' AND ({expression})::text ILIKE :search'

    try:
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
        values = [
            {'value': row[0], 'count': row[1]}
            for row in result.all()
            if row[0] not in (None, '')
        ]
        return cast(dict[str, Any], build_envelope(
            status='ok',
            summary=f'{resolution.canonical.name} · {len(values)} values',
            kind='read',
            capability='analytics',
            counts={'rows': 0, 'records': len(values), 'affected': 0},
            payload={
                'dimension': resolution.canonical.name,
                'resolved_from': dimension if dimension.lower() != resolution.canonical.name.lower() else None,
                'search': search_text or None,
                'values': values,
            },
        ))
    except Exception as exc:
        return cast(dict[str, Any], error_envelope(
            capability='analytics',
            reason_code=reason_codes.TOOL_UNAVAILABLE,
            summary=f'Lookup failed for {dimension}',
            warnings=[f'Lookup failed for {dimension}: {exc}'],
            payload={'dimension': dimension},
        ))


async def handle_catalog_inspect(
    *,
    table: str,
    column: str | None = None,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    from app.services.chat_engine.catalog_tools import catalog_inspect

    return await catalog_inspect(
        table=table,
        column=column,
        db=db,
        auth=auth,
        app_id=app_id,
    )


async def handle_catalog_relations(
    *,
    table: str,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    from app.services.chat_engine.catalog_tools import catalog_relations

    return await catalog_relations(
        table=table,
        db=db,
        auth=auth,
        app_id=app_id,
    )


async def handle_catalog_values(
    *,
    table: str,
    column: str,
    search: str | None = '',
    limit: int = 20,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    from app.services.chat_engine.catalog_tools import catalog_values

    return await catalog_values(
        table=table,
        column=column,
        search=search,
        limit=limit,
        db=db,
        auth=auth,
        app_id=app_id,
    )


async def handle_catalog_sample(
    *,
    table: str,
    column: str | None = None,
    limit: int = 5,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    from app.services.chat_engine.catalog_tools import catalog_sample

    return await catalog_sample(
        table=table,
        column=column,
        limit=limit,
        db=db,
        auth=auth,
        app_id=app_id,
    )


async def handle_resolve_entity(
    *,
    entity_type: str,
    search: str,
    limit: int = 10,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    from app.services.chat_engine.artifact import build_envelope, error_envelope
    from app.services.chat_engine.entity_resolution import resolve_entity_matches

    raw = await resolve_entity_matches(
        entity_type=entity_type,
        search=search,
        limit=min(max(limit, 1), 25),
        db=db,
        auth=auth,
        app_id=app_id,
    )
    if raw.get('status') == 'error':
        mapped = reason_codes.ENTITY_OUT_OF_SCOPE
        if raw.get('reason') == 'unknown_entity_type':
            mapped = reason_codes.ENTITY_OUT_OF_SCOPE
        return cast(dict[str, Any], error_envelope(
            capability='analytics',
            reason_code=mapped,
            summary=str(raw.get('error', 'entity resolution failed'))[:120],
            warnings=[str(raw.get('error'))] if raw.get('error') else [],
            payload={k: v for k, v in raw.items() if k not in {'status', 'error', 'reason'}},
        ))
    matches = raw.get('matches') or []
    reason_code: str | None = None
    if not matches:
        reason_code = reason_codes.ENTITY_NOT_FOUND
    elif len(matches) > 1:
        reason_code = reason_codes.ENTITY_AMBIGUOUS
    return cast(dict[str, Any], build_envelope(
        status='ok',
        summary=f'{entity_type} · {len(matches)} matches',
        kind='resolution',
        capability='analytics',
        reason_code=reason_code,
        counts={'rows': 0, 'records': len(matches), 'affected': 0},
        payload={k: v for k, v in raw.items() if k != 'status'},
    ))


async def handle_get_surface_records(
    *,
    surface_key: str,
    entity_type: str | None = None,
    entity_value: str | None = None,
    run_id: str | None = None,
    limit: int | None = None,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    session: dict[str, Any] | None = None,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    from app.services.chat_engine.artifact import build_envelope, error_envelope
    from app.services.chat_engine.data_surfaces import (
        build_surface_catalog,
        fetch_surface_records,
        get_surface_by_key,
    )
    from app.services.chat_engine.sql_agent import load_app_config
    from app.services.report_builder.analytics.vocabulary import (
        build_tool_vocabulary,
        entity_type_error_payload,
    )
    from app.services.report_builder.scratchpad_state import get_latest_resolved_entity_value

    app_config = await load_app_config(db, app_id)
    surface = get_surface_by_key(app_id, surface_key)
    if not surface:
        available = [item['key'] for item in build_surface_catalog(app_id)]
        msg = (
            f"Unknown surface {surface_key!r} for app {app_id}. "
            f"Declared surfaces: {', '.join(available)}. "
            f"To add one, edit backend/app/services/chat_engine/manifests/{app_id}.yaml."
        )
        return cast(dict[str, Any], error_envelope(
            capability='analytics',
            reason_code=reason_codes.ENTITY_OUT_OF_SCOPE,
            summary=f'Unknown surface {surface_key!r}',
            warnings=[msg],
            payload={'surface_key': surface_key, 'available_surfaces': available},
        ))

    # Reject an entity_type that the surface does not accept. Previously this
    # silently degraded to an unfiltered query via data_surfaces._apply_entity_filter.
    if entity_type:
        semantic_model = await _load_active_semantic_model(db, app_id)
        vocab = build_tool_vocabulary(app_id, semantic_model)
        if not vocab.surface_accepts_entity_type(surface_key, entity_type):
            bespoke = entity_type_error_payload(entity_type, vocab, surface_key=surface_key)
            return cast(dict[str, Any], error_envelope(
                capability='analytics',
                reason_code=reason_codes.ENTITY_OUT_OF_SCOPE,
                summary=str(bespoke.get('error', 'entity_type out of scope'))[:120],
                warnings=[str(bespoke.get('error'))] if bespoke.get('error') else [],
                payload={k: v for k, v in bespoke.items() if k not in {'status', 'error'}},
            ))

    scratchpad = (session or {}).get('scratchpad', {}) if session else {}
    effective_entity_value = entity_value
    if entity_type and not effective_entity_value:
        effective_entity_value = get_latest_resolved_entity_value(scratchpad, entity_type)

    try:
        payload = await fetch_surface_records(
            surface=surface,
            db=db,
            auth=auth,
            app_id=app_id,
            entity_type=entity_type,
            entity_value=effective_entity_value,
            run_id=run_id,
            limit=limit,
        )
    except ValueError as exc:
        return cast(dict[str, Any], error_envelope(
            capability='analytics',
            reason_code=reason_codes.TOOL_UNAVAILABLE,
            summary=str(exc)[:120],
            warnings=[str(exc)],
            payload={'surface_key': surface_key},
        ))

    record_count = int(payload.get('record_count', 0) or 0)
    return cast(dict[str, Any], build_envelope(
        status='ok',
        summary=f'{surface_key} · {record_count} records',
        kind='read',
        capability='analytics',
        counts={'rows': 0, 'records': record_count, 'affected': 0},
        payload={
            'surface_key': surface_key,
            'entity_type': entity_type,
            'entity_value': effective_entity_value,
            **payload,
        },
    ))


async def _list_app_sections(
    *,
    app_id: str,
    db: AsyncSession,
) -> dict[str, Any]:
    """Look up analytics config for the app and return its declared sections."""
    try:
        from sqlalchemy import select
        from app.models.app import App

        result = await db.execute(
            select(App).where(App.slug == app_id, App.is_active.is_(True))
        )
        config = result.scalar_one_or_none()
        if not config:
            return {"error": f"No app config found for {app_id}"}

        analytics = (config.config or {}).get("analytics", {})
        single_run = analytics.get("singleRun", {})
        sections = single_run.get("sections", [])

        return {
            "app_id": app_id,
            "sections": [
                {
                    "id": s.get("id"),
                    "type": s.get("type"),
                    "title": s.get("title", ""),
                    "variant": s.get("variant", ""),
                }
                for s in sections
            ],
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


async def handle_blueprint_blocks(
    *,
    app_id: str | None = None,
    block_type: str | None = None,
    db: AsyncSession | None = None,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    """V2 blueprint block catalog — returns §6.2 envelopes directly."""
    from app.services.chat_engine.artifact import build_envelope, error_envelope

    if block_type:
        detail = _catalog_get_section_detail(block_type)
        if not detail:
            return cast(dict[str, Any], error_envelope(
                capability='report_builder',
                reason_code=reason_codes.BLUEPRINT_UNKNOWN_BLOCK_TYPE,
                summary=f'Unknown blueprint block: {block_type}',
                warnings=[f'Unknown blueprint block: {block_type}'],
                payload={'block_type': block_type},
            ))

        block = {
            'type': detail['key'],
            'label': detail['label'],
            'description': detail['description'],
            'use_when': detail['use_when'],
            'known_variants': detail.get('known_variants', []),
            'data_shape': detail.get('data_shape', {}),
        }
        if app_id and db is not None:
            app_sections = await _list_app_sections(app_id=app_id, db=db)
            supported_types = {
                section.get('type')
                for section in app_sections.get('sections', [])
                if isinstance(section, dict)
            }
            block['supported'] = block['type'] in supported_types
        return cast(dict[str, Any], build_envelope(
            status='ok',
            summary='1 blocks',
            kind='read',
            capability='report_builder',
            counts={'rows': 0, 'records': 1, 'affected': 0},
            payload={'blocks': [block]},
        ))

    blocks = [
        {
            'type': section['key'],
            'label': section['label'],
            'description': section['description'],
            'use_when': section['use_when'],
        }
        for section in _catalog_list_section_types()
    ]
    if app_id and db is not None:
        app_sections = await _list_app_sections(app_id=app_id, db=db)
        supported_types = {
            section.get('type')
            for section in app_sections.get('sections', [])
            if isinstance(section, dict)
        }
        for block in blocks:
            block['supported'] = block['type'] in supported_types
    return cast(dict[str, Any], build_envelope(
        status='ok',
        summary=f'{len(blocks)} blocks',
        kind='read',
        capability='report_builder',
        counts={'rows': 0, 'records': len(blocks), 'affected': 0},
        payload={'blocks': blocks},
    ))


async def handle_blueprint_compose(
    *,
    name: str,
    sections: list[dict],
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    """Validate section types and return a §6.2 envelope with a
    preview-ready blueprint in ``payload.blueprint``."""
    from app.services.chat_engine.artifact import build_envelope, error_envelope
    from app.services.report_builder.section_catalog import get_section_type

    errors: list[str] = []
    validated: list[dict] = []

    for section in sections:
        section_type = section.get("type", "")
        if not get_section_type(section_type):
            errors.append(f"Unknown section type: {section_type}")
            continue

        validated.append({
            "id": section.get("id", f"custom-{section_type}-{uuid.uuid4().hex[:6]}"),
            "type": section_type,
            "title": section.get("title", section_type.replace("_", " ").title()),
            "variant": section.get("variant", ""),
        })

    if errors:
        return cast(dict[str, Any], error_envelope(
            capability='report_builder',
            reason_code=reason_codes.BLUEPRINT_UNKNOWN_BLOCK_TYPE,
            summary='; '.join(errors)[:120],
            warnings=errors,
            payload={'validated_sections': validated, 'errors': errors},
        ))

    return cast(dict[str, Any], build_envelope(
        status='ok',
        summary=f'blueprint {name!r} composed',
        kind='artifact',
        capability='report_builder',
        counts={'rows': 0, 'records': len(validated), 'affected': 0},
        artifact={
            'type': 'blueprint',
            'contract': 'report_builder.blueprint.v1',
            'extras': {},
        },
        payload={
            'name': name,
            'sections': validated,
            'preview_ready': True,
            'blueprint': {'name': name, 'sections': validated},
        },
    ))


async def handle_save_template(
    *,
    report_name: str,
    sections: list[dict],
    db: AsyncSession,
    auth,
    app_id: str,
    session: dict[str, Any] | None = None,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    """Persist as a new ReportConfig row."""
    try:
        from app.models.report_config import ReportConfig

        report_id = f"custom-{uuid.uuid4().hex[:8]}"
        presentation_config = {
            "rendererId": "platform-default",
            "layoutGroups": [],
            "density": "default",
            "designTokens": {},
            "themeTokens": {},
            "sections": [
                {
                    "sectionId": s["id"],
                    "componentId": s["type"],
                    "title": s.get("title", ""),
                    "description": None,
                    "variant": s.get("variant", ""),
                    "printable": True,
                }
                for s in sections
            ],
        }
        export_config = {
            "enabled": True,
            "format": "pdf",
            "documentVariant": "platform-default",
            "sectionIds": [s["id"] for s in sections],
        }
        source_session_id = None
        if isinstance(session, dict) and session.get('chat_session_id'):
            source_session_id = uuid.UUID(str(session['chat_session_id']))

        config = ReportConfig(
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            app_id=app_id,
            report_id=report_id,
            scope="single_run",
            name=report_name,
            description=f"Custom report created via report builder",
            source_session_id=source_session_id,
            presentation_config=presentation_config,
            narrative_config={"enabled": False},
            export_config=export_config,
        )
        db.add(config)
        await db.flush()

        from app.services.chat_engine.artifact import build_envelope

        return cast(dict[str, Any], build_envelope(
            status='ok',
            summary=f'saved {report_name!r}',
            kind='mutate',
            capability='report_builder',
            counts={'rows': 0, 'records': 0, 'affected': 1},
            payload={
                'status': 'saved',
                'report_id': report_id,
                'report_name': report_name,
                'section_count': len(sections),
            },
        ))
    except Exception as e:
        from app.services.chat_engine.artifact import error_envelope

        return cast(dict[str, Any], error_envelope(
            capability='report_builder',
            reason_code=reason_codes.BLUEPRINT_SAVE_CONFLICT,
            summary='Database error',
            warnings=[f'Database error: {str(e)}'],
            payload={},
        ))


async def handle_blueprint_save(
    *,
    name: str,
    sections: list[dict],
    **kwargs: Any,
) -> ToolEnvelopeModel:
    from app.services.chat_engine.artifact import build_envelope

    envelope = await handle_save_template(report_name=name, sections=sections, **kwargs)
    if envelope.get('status') != 'ok':
        return envelope
    payload = envelope.get('payload') or {}
    return cast(dict[str, Any], build_envelope(
        status='ok',
        summary=f'blueprint {name!r} saved',
        kind='mutate',
        capability='report_builder',
        counts={'rows': 0, 'records': 0, 'affected': 1},
        payload={
            'status': 'saved',
            'blueprint_id': payload.get('report_id'),
            'name': payload.get('report_name'),
            'block_count': payload.get('section_count'),
        },
    ))


async def handle_blueprint_list(
    *,
    app_id: str | None = None,
    db: AsyncSession,
    auth,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    from sqlalchemy import desc, select

    from app.models.report_config import ReportConfig
    from app.services.access_control import readable_scope_clause
    from app.services.chat_engine.artifact import build_envelope

    query = (
        select(ReportConfig)
        .where(
            ReportConfig.scope == 'single_run',
            ReportConfig.status == 'active',
            readable_scope_clause(ReportConfig, auth),
        )
        .order_by(desc(ReportConfig.updated_at), desc(ReportConfig.created_at))
    )
    if app_id:
        query = query.where(ReportConfig.app_id == app_id)

    rows = (await db.execute(query)).scalars().all()
    blueprints = [
        {
            'id': row.report_id,
            'name': row.name,
            'block_count': len((row.presentation_config or {}).get('sections', [])),
            'created_at': row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]
    return cast(dict[str, Any], build_envelope(
        status='ok',
        summary=f'{len(blueprints)} blueprints',
        kind='read',
        capability='report_builder',
        counts={'rows': 0, 'records': len(blueprints), 'affected': 0},
        payload={'blueprints': blueprints},
    ))


async def handle_data_check(
    *,
    table: str,
    filters: dict[str, Any] | None = None,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    """Lightweight existence and coverage check for concrete table filters."""
    from app.services.chat_engine.artifact import build_envelope, error_envelope
    from app.services.chat_engine.sql_agent import data_check

    raw = await data_check(
        table=table,
        filters=filters,
        db=db,
        auth=auth,
        app_id=app_id,
    )
    if raw.get('status') == 'error':
        reason_code = raw.get('reason_code') or reason_codes.SQL_EXECUTION_ERROR
        return cast(dict[str, Any], error_envelope(
            capability='analytics',
            reason_code=reason_code,
            summary=str(raw.get('error', 'data_check failed'))[:120],
            warnings=[str(raw.get('error'))] if raw.get('error') else [],
            payload={k: v for k, v in raw.items() if k not in {'status'}},
        ))
    row_count = int(raw.get('row_count') or 0)
    return cast(dict[str, Any], build_envelope(
        status='ok',
        summary=f'{row_count} rows',
        kind='read',
        capability='analytics',
        counts={'rows': row_count, 'records': 0, 'affected': 0},
        payload={k: v for k, v in raw.items() if k not in {'status'}},
    ))


async def handle_data_query(
    *,
    question: str,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    provider: str | None = None,
    session: dict[str, Any] | None = None,
    **_kwargs: Any,
) -> ToolEnvelopeModel:
    """Sherlock v2 analytical query handler — returns the §6.2 envelope
    directly.

    The gate/picker decisions (``reason_code``, ``rendered_as``,
    ``top_n``) land on ``outcome`` before the handler returns. The
    dispatcher's wrapper sees a complete envelope and passes it through
    verbatim.
    """
    from app.services.chat_engine.artifact import build_envelope, error_envelope
    from app.services.chat_engine.sql_agent import data_query
    from app.services.report_builder.chat_handler import _build_analytics_chart_outcome
    from app.services.report_builder.scratchpad_state import build_data_query_context

    scratchpad = (session or {}).get('scratchpad', {}) if session else {}
    context = build_data_query_context(question, scratchpad)

    raw = await data_query(
        question=question,
        context=context or None,
        db=db,
        auth=auth,
        app_id=app_id,
        provider=provider,
    )

    if raw.get('status') == 'error':
        reason_code = raw.get('reason_code') or reason_codes.SQL_EXECUTION_ERROR
        err_text = str(raw.get('error') or 'SQL agent failed')
        return cast(dict[str, Any], error_envelope(
            capability='analytics',
            reason_code=reason_code,
            summary='query failed',
            warnings=[err_text],
            payload={'question': raw.get('question', question)},
        ))

    outcome = _build_analytics_chart_outcome(raw)
    if outcome is None:
        row_count = int(raw.get('row_count') or 0)
        return cast(dict[str, Any], build_envelope(
            status='ok',
            summary=f'{row_count} rows',
            kind='read',
            capability='analytics',
            counts={'rows': row_count, 'records': 0, 'affected': 0},
            payload={k: v for k, v in raw.items() if k != 'status'},
        ))

    row_count = int(raw.get('row_count') or outcome['row_count'])
    payload_body = {k: v for k, v in raw.items() if k != 'status'}
    payload_body['chart'] = outcome['chart_payload']
    return cast(dict[str, Any], build_envelope(
        status='ok',
        summary=f'{row_count} rows',
        kind='artifact',
        capability='analytics',
        reason_code=outcome['reason_code'],
        warnings=outcome['warnings'],
        counts={'rows': row_count, 'records': 0, 'affected': 0},
        artifact={
            'type': outcome['artifact_type'],
            'contract': 'analytics.chart.v1',
            'extras': {
                'rendered_as': outcome['rendered_as'],
                'top_n': outcome['top_n'],
            },
        },
        payload=payload_body,
    ))


# ---------------------------------------------------------------------------
# Phase 2: pack-aware wrapper that lifts a handler's raw bespoke dict into
# the §6.2 ``ToolEnvelope``. Every handler keeps its existing return shape;
# the dispatcher routes through this builder so the outer agent always
# observes a uniform envelope with ``outcome.reason_code`` +
# ``outcome.artifact`` + ``payload``. No prose substitution: gate/picker
# decisions are embedded verbatim.
# ---------------------------------------------------------------------------


_ANALYTICS_READ_TOOLS = frozenset({
    'lookup',
    'get_surface_records',
    'catalog_inspect',
    'catalog_relations',
    'catalog_values',
    'catalog_sample',
    'data_check',
})

_REPORT_BUILDER_READ_TOOLS = frozenset({
    'blueprint_blocks',
    'blueprint_list',
})

_REPORT_BUILDER_MUTATE_TOOLS = frozenset({
    'blueprint_save',
})


def _map_error_reason_code(tool_name: str, raw: dict[str, Any]) -> str:
    """Translate a handler's bespoke error dict into a Phase-2 reason code.

    Handlers returned free-form ``reason`` strings before Phase 2 and
    some still do; this mapping collapses them into the pack-registered
    frozensets from ``reason_codes.py`` without editing every handler.
    Unknown combinations degrade to ``TOOL_UNAVAILABLE`` (harness-shared).
    """
    raw_reason = str(raw.get('reason_code') or raw.get('reason') or '').strip()
    if (
        raw_reason in reason_codes.HARNESS_SHARED_REASON_CODES
        or raw_reason in reason_codes.ANALYTICS_REASON_CODES
        or raw_reason in reason_codes.REPORT_BUILDER_REASON_CODES
    ):
        return raw_reason
    mapping = {
        'unknown_surface': reason_codes.ENTITY_OUT_OF_SCOPE,
        'unknown_dimension': reason_codes.ENTITY_NOT_FOUND,
        'unknown_entity_type': reason_codes.ENTITY_OUT_OF_SCOPE,
        'ambiguous_dimension': reason_codes.ENTITY_AMBIGUOUS,
        'invalid_output_alias_contract': reason_codes.SQL_INVALID_OUTPUT_ALIAS_CONTRACT,
        'sql_validation_failed': reason_codes.SQL_VALIDATION_FAILED,
    }
    if raw_reason in mapping:
        return mapping[raw_reason]
    if tool_name == 'blueprint_compose':
        return reason_codes.BLUEPRINT_UNKNOWN_BLOCK_TYPE
    return reason_codes.TOOL_UNAVAILABLE


def _capability_for(tool_name: str) -> str:
    from app.services.chat_engine.capability_pack import resolve_pack_id_for_tool

    return resolve_pack_id_for_tool(tool_name) or 'harness'


def _wrap_handler_result_as_envelope(tool_name: str, raw: Any) -> dict[str, Any]:
    """Lift ``raw`` (typed envelope model or bespoke dict) into a ToolEnvelope.

    The wrap is pack-aware: analytics tools map to read/artifact/error
    envelopes with ``CG_*``/``SQL_*`` reason codes and the data_query
    chart artifact; report-builder tools map to read/mutate/artifact
    envelopes with ``BLUEPRINT_*`` codes; unclaimed tools fall through
    to a generic read envelope. No tool-name literals leak into the
    harness dispatcher — that branch lives here in tool_handlers.py.
    """
    from app.services.chat_engine.artifact import build_envelope, error_envelope
    from typing import cast as _cast

    # Phase-2 passthrough: a handler that already emits a §6.2 envelope
    # (``outcome`` + ``payload`` present) is trusted verbatim. Prevents
    # the wrapper from double-wrapping pre-envelope-shaped returns.
    raw_dict = _materialize_tool_result(raw)
    if 'outcome' in raw_dict and 'payload' in raw_dict:
        return _cast(dict[str, Any], raw_dict)

    # Handlers that don't know about envelopes return ``{'error': '...'}``
    # when the dispatcher's own catch path runs; map that uniformly.
    if 'error' in raw_dict and 'status' not in raw_dict:
        return _cast(dict[str, Any], dump_tool_envelope(error_envelope(
            capability=_cast(Any, _capability_for(tool_name)),
            reason_code=reason_codes.TOOL_UNAVAILABLE,
            summary=str(raw_dict.get('error'))[:120],
            warnings=[str(raw_dict.get('error'))],
            payload={},
        )))

    status = raw_dict.get('status')
    capability = _cast(Any, _capability_for(tool_name))

    if status == 'error':
        reason_code = _map_error_reason_code(tool_name, raw_dict)
        err_text = str(raw_dict.get('error') or raw_dict.get('errors') or 'tool failed')[:500]
        payload = {k: v for k, v in raw_dict.items() if k not in {'status', 'error', 'errors', 'reason', 'reason_code'}}
        return _cast(dict[str, Any], dump_tool_envelope(error_envelope(
            capability=capability,
            reason_code=reason_code,
            summary=err_text[:120],
            warnings=[err_text],
            payload=payload,
        )))

    # --- OK / saved paths ---------------------------------------------------
    if tool_name == 'data_query':
        from app.services.report_builder.chat_handler import _build_analytics_chart_outcome

        outcome = _build_analytics_chart_outcome(raw_dict)
        if outcome is None:
            row_count = int(raw_dict.get('row_count') or 0)
            return _cast(dict[str, Any], dump_tool_envelope(build_envelope(
                status='ok',
                summary=f'{row_count} rows',
                kind='read',
                capability='analytics',
                counts={'rows': row_count, 'records': 0, 'affected': 0},
                payload={
                    k: v for k, v in raw_dict.items()
                    if k not in {'status'}
                },
            )))
        row_count = int(raw_dict.get('row_count') or outcome['row_count'])
        payload = {k: v for k, v in raw_dict.items() if k not in {'status'}}
        payload['chart'] = outcome['chart_payload']
        return _cast(dict[str, Any], dump_tool_envelope(build_envelope(
            status='ok',
            summary=f'{row_count} rows',
            kind='artifact',
            capability='analytics',
            reason_code=outcome['reason_code'],
            warnings=outcome['warnings'],
            counts={'rows': row_count, 'records': 0, 'affected': 0},
            artifact={
                'type': outcome['artifact_type'],
                'contract': 'analytics.chart.v1',
                'extras': {
                    'rendered_as': outcome['rendered_as'],
                    'top_n': outcome['top_n'],
                },
            },
            payload=payload,
        )))

    if tool_name == 'blueprint_compose':
        payload = {k: v for k, v in raw_dict.items() if k not in {'status'}}
        payload['blueprint'] = {
            'name': raw_dict.get('name') or 'Untitled',
            'sections': raw_dict.get('sections') or [],
        }
        return _cast(dict[str, Any], dump_tool_envelope(build_envelope(
            status='ok',
            summary=f"blueprint '{raw_dict.get('name', 'Untitled')}' composed",
            kind='artifact',
            capability='report_builder',
            reason_code=None,
            counts={
                'rows': 0,
                'records': len(raw_dict.get('sections') or []),
                'affected': 0,
            },
            artifact={
                'type': 'blueprint',
                'contract': 'report_builder.blueprint.v1',
                'extras': {},
            },
            payload=payload,
        )))

    if tool_name == 'discover':
        payload = {k: v for k, v in raw_dict.items() if k not in {'status'}}
        return _cast(dict[str, Any], dump_tool_envelope(build_envelope(
            status='ok',
            summary='discovery complete',
            kind='discovery',
            capability='analytics',
            counts={
                'rows': 0,
                'records': sum(int(v or 0) for v in (raw_dict.get('volume') or {}).values()),
                'affected': 0,
            },
            payload=payload,
        )))

    if tool_name == 'resolve_entity':
        payload = {k: v for k, v in raw_dict.items() if k not in {'status'}}
        matches = raw_dict.get('matches') or []
        reason_code: str | None = None
        if not matches:
            reason_code = reason_codes.ENTITY_NOT_FOUND
        elif len(matches) > 1:
            reason_code = reason_codes.ENTITY_AMBIGUOUS
        return _cast(dict[str, Any], dump_tool_envelope(build_envelope(
            status='ok',
            summary=f'{len(matches)} match(es)',
            kind='resolution',
            capability='analytics',
            reason_code=reason_code,
            counts={'rows': 0, 'records': len(matches), 'affected': 0},
            payload=payload,
        )))

    if tool_name in _REPORT_BUILDER_MUTATE_TOOLS:
        payload = {k: v for k, v in raw_dict.items() if k not in {'status'}}
        return _cast(dict[str, Any], dump_tool_envelope(build_envelope(
            status='ok',
            summary='saved',
            kind='mutate',
            capability='report_builder',
            counts={'rows': 0, 'records': 0, 'affected': 1},
            payload=payload,
        )))

    if tool_name in _ANALYTICS_READ_TOOLS:
        payload = {k: v for k, v in raw_dict.items() if k not in {'status'}}
        rows_or_records = (
            raw_dict.get('row_count')
            or len(raw_dict.get('records') or [])
            or len(raw_dict.get('values') or [])
            or len(raw_dict.get('columns') or [])
        )
        return _cast(dict[str, Any], dump_tool_envelope(build_envelope(
            status='ok',
            summary=f'{int(rows_or_records or 0)} records',
            kind='read',
            capability='analytics',
            counts={
                'rows': int(raw_dict.get('row_count') or 0),
                'records': int(rows_or_records or 0),
                'affected': 0,
            },
            payload=payload,
        )))

    if tool_name in _REPORT_BUILDER_READ_TOOLS:
        payload = {k: v for k, v in raw_dict.items() if k not in {'status'}}
        return _cast(dict[str, Any], dump_tool_envelope(build_envelope(
            status='ok',
            summary='ok',
            kind='read',
            capability='report_builder',
            counts={
                'rows': 0,
                'records': len(raw_dict.get('blocks') or raw_dict.get('blueprints') or []),
                'affected': 0,
            },
            payload=payload,
        )))

    # Fallback: unknown-pack tool returning an ok dict — still wrap.
    payload = {k: v for k, v in raw_dict.items() if k not in {'status'}}
    return _cast(dict[str, Any], dump_tool_envelope(build_envelope(
        status='ok',
        summary='ok',
        kind='read',
        capability=capability,
        payload=payload,
    )))


TOOL_HANDLER_MAP = {
    'catalog_inspect': handle_catalog_inspect,
    'catalog_relations': handle_catalog_relations,
    'catalog_values': handle_catalog_values,
    'catalog_sample': handle_catalog_sample,
    'discover': handle_discover,
    'lookup': handle_lookup,
    'resolve_entity': handle_resolve_entity,
    'get_surface_records': handle_get_surface_records,
    # Report builder tools (action tools)
    'blueprint_blocks': handle_blueprint_blocks,
    'blueprint_compose': handle_blueprint_compose,
    'blueprint_save': handle_blueprint_save,
    'blueprint_list': handle_blueprint_list,
    # Sherlock v2 analytics
    "data_check": handle_data_check,
    "data_query": handle_data_query,
}


async def _validate_bounded_arguments(
    tool_name: str,
    arguments: dict[str, Any],
    *,
    db: AsyncSession,
    app_id: str,
) -> dict[str, Any] | None:
    """Reject bounded arguments that are not in the canonical vocabulary.

    Runs BEFORE the handler so contract violations never reach business
    logic. Validates: ``dimension`` (canonical name or declared synonym),
    ``entity_type`` (vocab-known, or surface-scoped when the call targets
    a surface), ``surface_key`` (manifest-declared), and ``block_type``
    (section catalog). ``table`` is validated by each catalog tool against
    its own allow-list, so it is intentionally skipped here.

    Returns ``None`` if every touched argument passes, or a structured
    error payload ready to be serialized as the tool result.
    """
    from app.services.chat_engine.sql_agent import load_app_config, load_semantic_model
    from app.services.report_builder.analytics.vocabulary import (
        build_tool_vocabulary,
        dimension_error_payload,
        entity_type_error_payload,
    )

    bounded_names = {'dimension', 'entity_type', 'surface_key', 'block_type'}
    if not any(name in arguments for name in bounded_names):
        return None

    app_config = await load_app_config(db, app_id)
    semantic_model = load_semantic_model(app_id, app_config=app_config)
    vocab = build_tool_vocabulary(app_id, semantic_model)

    if 'dimension' in arguments and isinstance(arguments['dimension'], str):
        resolution = vocab.resolve_dimension(arguments['dimension'])
        if resolution.status != 'unique':
            return dimension_error_payload(resolution, vocab)

    if 'surface_key' in arguments and isinstance(arguments['surface_key'], str):
        if arguments['surface_key'] not in vocab.surfaces:
            return {
                'status': 'error',
                'reason': 'unknown_surface',
                'error': (
                    f"Unknown surface_key {arguments['surface_key']!r}. "
                    f"Allowed: {sorted(vocab.surfaces.keys())!r}."
                ),
                'available_surfaces': sorted(vocab.surfaces.keys()),
            }

    if 'entity_type' in arguments and isinstance(arguments['entity_type'], str):
        entity_type = arguments['entity_type']
        surface_key = arguments.get('surface_key') if isinstance(arguments.get('surface_key'), str) else None
        if surface_key is not None:
            if not vocab.surface_accepts_entity_type(surface_key, entity_type):
                return entity_type_error_payload(entity_type, vocab, surface_key=surface_key)
        elif not vocab.validate_entity_type(entity_type):
            return entity_type_error_payload(entity_type, vocab)

    if 'block_type' in arguments and isinstance(arguments['block_type'], str):
        if arguments['block_type'] not in vocab.block_types:
            return {
                'status': 'error',
                'reason': 'unknown_block_type',
                'error': (
                    f"Unknown block_type {arguments['block_type']!r}. "
                    f"Allowed: {sorted(vocab.block_types.keys())!r}."
                ),
                'available_block_types': sorted(vocab.block_types.keys()),
            }

    return None


async def dispatch_tool_call(
    tool_name: str,
    arguments: dict[str, Any],
    *,
    db: AsyncSession,
    auth: "Any",
    app_id: str,
    provider: str | None = None,
    session: dict[str, Any] | None = None,
) -> str:
    """Route a tool call to its handler and return JSON string result."""
    import time

    from app.services.chat_engine.artifact import error_envelope
    from app.services.chat_engine.capability_pack import TypedArgumentError, resolve_pack_for_tool

    arguments = dict(arguments or {})
    start = time.monotonic()
    handler = TOOL_HANDLER_MAP.get(tool_name)
    if handler is None:
        # Plan §6.3 rule 3: every pack owns its own ``tool_handlers()``.
        # Generic fallback — any pack registered in
        # ``CAPABILITY_PACK_REGISTRY`` can contribute handlers without
        # editing this dispatcher. No pack-specific branch.
        pack = resolve_pack_for_tool(tool_name)
        if pack is not None:
            handler = pack.tool_handlers().get(tool_name)
    if not handler:
        await _log_tool_call(
            tool_name, arguments, auth, app_id,
            status="unknown_tool", execution_ms=0,
        )
        unknown_env = error_envelope(
            capability='harness',
            reason_code=reason_codes.TOOL_UNAVAILABLE,
            summary=f'Unknown tool: {tool_name}',
            warnings=[f'Unknown tool: {tool_name}'],
            payload={},
        )
        return json.dumps(dump_tool_envelope(unknown_env), default=str)

    pack = resolve_pack_for_tool(tool_name)
    if pack is not None:
        try:
            pack.validate_arguments(tool_name, arguments)
        except TypedArgumentError as exc:
            elapsed = (time.monotonic() - start) * 1000
            boundary_error = {
                'status': 'error',
                'reason': exc.reason_code,
                'reason_code': exc.reason_code,
                'error': str(exc),
            }
            logger.warning(
                'sherlock_contract_violation tool=%s reason=%s app_id=%s tenant_id=%s',
                tool_name,
                exc.reason_code,
                app_id,
                str(getattr(auth, 'tenant_id', '')),
                extra={
                    'event': 'sherlock_contract_violation',
                    'tool_name': tool_name,
                    'reason': exc.reason_code,
                    'app_id': app_id,
                    'tenant_id': str(getattr(auth, 'tenant_id', '')),
                    'arguments': arguments,
                },
            )
            envelope = _wrap_handler_result_as_envelope(tool_name, boundary_error)
            await _log_tool_call(
                tool_name, arguments, auth, app_id,
                status='invalid_argument', execution_ms=elapsed, result=boundary_error,
            )
            return json.dumps(envelope, default=str)

    # Tool-boundary strict validation. Any bounded argument that is not in
    # the canonical vocabulary is rejected here — no handler ever sees it.
    boundary_error = await _validate_bounded_arguments(
        tool_name, arguments, db=db, app_id=app_id,
    )
    if boundary_error is not None:
        elapsed = (time.monotonic() - start) * 1000
        # Contract-violation audit log. Structured fields match the
        # reason codes the boundary validator emits.
        logger.warning(
            'sherlock_contract_violation tool=%s reason=%s app_id=%s tenant_id=%s',
            tool_name,
            boundary_error.get('reason_code') or boundary_error.get('reason'),
            app_id,
            str(getattr(auth, 'tenant_id', '')),
            extra={
                'event': 'sherlock_contract_violation',
                'tool_name': tool_name,
                'reason': boundary_error.get('reason_code') or boundary_error.get('reason'),
                'app_id': app_id,
                'tenant_id': str(getattr(auth, 'tenant_id', '')),
                'arguments': arguments,
            },
        )
        envelope = _wrap_handler_result_as_envelope(tool_name, boundary_error)
        await _log_tool_call(
            tool_name, arguments, auth, app_id,
            status="invalid_argument", execution_ms=elapsed, result=boundary_error,
        )
        return json.dumps(envelope, default=str)

    # Context kwargs (db, auth, app_id, provider, session) take precedence over LLM-supplied args
    context: dict[str, Any] = dict(db=db, auth=auth, app_id=app_id, provider=provider, session=session)
    safe_args = {k: v for k, v in arguments.items() if k not in context}

    try:
        result = await handler(**safe_args, **context)
        normalized_result = _materialize_tool_result(result)
        elapsed = (time.monotonic() - start) * 1000
        envelope = _wrap_handler_result_as_envelope(tool_name, normalized_result)
        await _log_tool_call(
            tool_name, arguments, auth, app_id,
            status="ok", execution_ms=elapsed, result=envelope,
        )
        return json.dumps(envelope, default=str)
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        await _log_tool_call(
            tool_name, arguments, auth, app_id,
            status="error", execution_ms=elapsed, error=str(e),
        )
        envelope = error_envelope(
            capability='harness',
            reason_code=reason_codes.TOOL_UNAVAILABLE,
            summary=str(e)[:120],
            warnings=[str(e)],
            payload={},
        )
        return json.dumps(dump_tool_envelope(envelope), default=str)


async def _log_tool_call(
    tool_name: str,
    arguments: dict[str, Any],
    auth: Any,
    app_id: str,
    *,
    status: str,
    execution_ms: float = 0,
    result: Any = None,
    error: str | None = None,
) -> None:
    """Fire-and-forget logging to agent_tool_logs.

    Uses its own session so the insert commits independently of the
    caller's transaction.
    """
    try:
        from app.database import async_session as _log_session
        from app.models.analytics_log import AgentToolLog

        row_count = None
        generated_sql = None
        validated_sql = None
        cache_hit = False

        result_dict = _materialize_tool_result(result) if result is not None else None
        if isinstance(result_dict, dict):
            payload = result_dict.get('payload') if isinstance(result_dict.get('payload'), dict) else result_dict
            row_count = payload.get("row_count")
            generated_sql = payload.get("generated_sql")
            validated_sql = payload.get("sql_used")
            cache_hit = bool(payload.get("cache_hit", False))

        async with _log_session() as log_db:
            log = AgentToolLog(
                tenant_id=getattr(auth, "tenant_id", None),
                user_id=getattr(auth, "user_id", None),
                app_id=app_id,
                tool_name=tool_name,
                arguments=arguments,
                generated_sql=generated_sql,
                validated_sql=validated_sql,
                execution_ms=execution_ms,
                row_count=row_count,
                status=status,
                error_message=error[:2000] if error else None,
                cache_hit=cache_hit,
            )
            log_db.add(log)
            await log_db.commit()
    except Exception:
        pass  # Never fail the tool call because logging failed
