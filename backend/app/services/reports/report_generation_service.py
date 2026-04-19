"""Generic report generation orchestration for phases 4-6."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import desc, select

from app.database import async_session
from app.models.app import App
from app.models.eval_run import EvalRun
from app.models.report_artifact import ReportArtifact
from app.models.report_run import ReportRun
from app.schemas.app_config import AppConfig as AppConfigSchema
from app.services.reports.asset_resolver import resolve_report_config_assets
from app.services.reports.config_models import (
    ExportConfig,
    NarrativeConfig,
    PresentationConfig,
    PresentationSectionConfig,
)
from app.services.reports.contracts.cross_run_report import PlatformCrossRunPayload
from app.services.reports.contracts.run_report import PlatformRunReportPayload
from app.services.reports.document_composer import compose_document
from app.services.reports.narrative_executor import execute_narrative_generation
from app.services.reports.report_composer import compose_cross_run_report, compose_run_report
from app.services.reports.report_config_resolver import resolve_report_config
from app.services.reports.report_run_store import ensure_report_run, persist_report_artifact
from app.services.reports.analytics_profiles.registry import get_analytics_profile
from app.services.reports.cache_validation import partition_valid_single_run_payloads
from app.services.access_control import readable_scope_clause
from app.services.reports.contracts.run_report import PlatformReportPresentation
from app.services.evaluators.llm_base import LoggingLLMWrapper, create_llm_provider
from app.services.evaluators.runner_utils import save_api_log, make_usage_callback
from app.services.evaluators.settings_helper import get_llm_settings_from_db


def _serialize_section_payloads(sections) -> dict[str, Any]:
    payloads: dict[str, Any] = {}
    for section in sections:
        payloads[section.id] = section.model_dump(by_alias=True)['data']
    return payloads


def _default_presentation_sections(section_configs) -> list[PresentationSectionConfig]:
    return [
        PresentationSectionConfig(
            section_id=section.id,
            component_id=section.type,
            title=section.title,
            description=section.description,
            variant=section.variant,
            printable=section.printable,
        )
        for section in section_configs
    ]


def _effective_presentation_sections(
    presentation_config: PresentationConfig,
    fallback_section_configs,
) -> list[PresentationSectionConfig]:
    if presentation_config.sections:
        return presentation_config.sections
    return _default_presentation_sections(fallback_section_configs)


def _default_single_run_layout_groups(
    section_configs: list[PresentationSectionConfig],
) -> list[dict[str, Any]]:
    if not section_configs:
        return []

    summary_component_ids = {
        'summary_cards',
        'metric_breakdown',
        'callout',
        'narrative',
        'issues_recommendations',
    }
    ordered_ids = [section.section_id for section in section_configs]
    summary_ids = [
        section.section_id
        for section in section_configs
        if section.component_id in summary_component_ids
    ]

    groups: list[dict[str, Any]] = []
    if summary_ids:
        groups.append({
            'id': 'summary-default',
            'tab': 'summary',
            'layout': 'stack',
            'sectionIds': summary_ids,
        })
    if ordered_ids:
        groups.append({
            'id': 'detailed-default',
            'tab': 'detailed',
            'layout': 'stack',
            'sectionIds': ordered_ids,
        })
    return groups


def _effective_layout_groups(
    presentation_config: PresentationConfig,
    section_configs: list[PresentationSectionConfig],
) -> list[dict[str, Any]]:
    if presentation_config.layout_groups:
        return presentation_config.layout_groups
    return _default_single_run_layout_groups(section_configs)


async def _load_run_and_profile(db, *, tenant_id: uuid.UUID, user_id: uuid.UUID, run_id: str):
    access_user = type(
        'AccessUser',
        (),
        {
            'tenant_id': tenant_id,
            'user_id': user_id,
            'app_access': frozenset(),
        },
    )()
    run = await db.scalar(
        select(EvalRun).where(
            EvalRun.id == uuid.UUID(run_id),
            readable_scope_clause(EvalRun, access_user),
        )
    )
    if run is None:
        raise ValueError(f'Eval run not found: {run_id}')

    app_row = await db.scalar(
        select(App).where(
            App.slug == run.app_id,
            App.is_active == True,
        )
    )
    if app_row is None:
        raise ValueError(f'App not found: {run.app_id}')

    analytics_config = AppConfigSchema.model_validate(app_row.config or {}).analytics
    profile = get_analytics_profile(analytics_config.profile)
    if profile is None or profile.report_service_cls is None:
        raise ValueError(f'Reporting is not enabled for app: {run.app_id}')
    return run, analytics_config, profile


async def _create_logging_llm(
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    report_id: str,
    provider_override: str | None,
    model_override: str | None,
):
    settings = await get_llm_settings_from_db(
        tenant_id=tenant_id,
        user_id=user_id,
        auth_intent='managed_job',
        provider_override=provider_override or None,
    )
    effective_provider = provider_override or settings['provider']
    effective_model = model_override or settings['selected_model']
    if not effective_model:
        return None, None, None

    provider = create_llm_provider(
        provider=effective_provider,
        api_key=settings['api_key'],
        model_name=effective_model,
        service_account_path=settings.get('service_account_path', ''),
        azure_endpoint=settings.get('azure_endpoint', ''),
        api_version=settings.get('api_version', ''),
    )
    try:
        report_uuid: uuid.UUID | None = uuid.UUID(str(report_id))
    except (ValueError, AttributeError, TypeError):
        report_uuid = None
    usage_cb = make_usage_callback(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        owner_type='report_run',
        owner_id=report_uuid,
        subsystem='report_builder',
    )
    llm = LoggingLLMWrapper(
        provider, log_callback=save_api_log, usage_callback=usage_cb,
    )
    llm.set_context(run_id=report_id, thread_id=f'{app_id}:{report_id}')
    return llm, effective_provider, effective_model


async def _compose_single_run_payload(
    db,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    run: EvalRun,
    report_run: ReportRun,
    report_config,
    llm_provider: str | None,
    llm_model: str | None,
):
    app_row = await db.scalar(
        select(App).where(
            App.slug == run.app_id,
            App.is_active == True,
        )
    )
    analytics_config = AppConfigSchema.model_validate(app_row.config or {}).analytics
    profile = get_analytics_profile(analytics_config.profile)
    builder = profile.report_service_cls(db, tenant_id=tenant_id, user_id=user_id)
    base_payload = await builder.build_payload_for_composer(
        str(run.id),
        llm_provider=llm_provider,
        llm_model=llm_model,
        include_narrative=False,
    )
    metadata = base_payload.metadata.model_copy(update={
        'computed_at': datetime.now(timezone.utc).isoformat(),
        'report_id': report_config.report_id,
        'report_name': report_config.name,
        'report_run_id': str(report_run.id),
    })
    section_payloads = _serialize_section_payloads(base_payload.sections)

    narrative_config = NarrativeConfig.model_validate(report_config.narrative_config or {})
    if narrative_config.enabled:
        resolved_assets = await resolve_report_config_assets(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=run.app_id,
            asset_keys=narrative_config.asset_keys,
        )
        llm, effective_provider, effective_model = await _create_logging_llm(
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=run.app_id,
            report_id=report_config.report_id,
            provider_override=llm_provider,
            model_override=llm_model,
        )
        if llm is not None:
            narrative_payloads = await execute_narrative_generation(
                llm=llm,
                report_id=report_config.report_id,
                report_kind='single_run',
                metadata=metadata,
                sections=base_payload.sections,
                narrative_config={
                    **report_config.narrative_config,
                    'resolvedAssets': {
                        'promptReferences': resolved_assets.prompt_references,
                        'systemPrompt': resolved_assets.system_prompt,
                        'glossary': resolved_assets.glossary,
                    },
                },
            )
            section_payloads.update(narrative_payloads)
            metadata = metadata.model_copy(
                update={
                    'llm_provider': effective_provider,
                    'llm_model': effective_model,
                    'narrative_model': effective_model,
                }
            )

    presentation_config = PresentationConfig.model_validate(report_config.presentation_config or {})
    export_config = ExportConfig.model_validate(report_config.export_config or {})
    presentation_sections = _effective_presentation_sections(
        presentation_config,
        analytics_config.single_run.sections,
    )
    layout_groups = _effective_layout_groups(presentation_config, presentation_sections)
    pre_sections = compose_run_report(
        metadata=metadata,
        presentation=PlatformReportPresentation(
            renderer_id=presentation_config.renderer_id or export_config.document_variant or report_config.report_id,
            layout_groups=layout_groups,
            density=presentation_config.density,
            design_tokens=presentation_config.design_tokens,
            theme_tokens=presentation_config.theme_tokens,
            sections=presentation_sections,
        ),
        section_configs=presentation_sections,
        section_payloads=section_payloads,
        export_document=compose_document(
            title='placeholder',
            subtitle=None,
            metadata={},
            sections=[],
            export_config=export_config,
            theme_tokens=presentation_config.theme_tokens,
        ),
    ).sections
    export_document = compose_document(
        title=metadata.run_name or 'Evaluation Report',
        subtitle=f'{run.app_id} single-run report',
        metadata={
            'Run ID': metadata.run_id,
            'Eval Type': metadata.eval_type,
            'Created': metadata.created_at,
            'Model': metadata.llm_model,
        },
        sections=pre_sections,
        export_config=export_config,
        theme_tokens=presentation_config.theme_tokens,
    )
    payload = compose_run_report(
        metadata=metadata,
        presentation=PlatformReportPresentation(
            renderer_id=presentation_config.renderer_id or export_config.document_variant or report_config.report_id,
            layout_groups=layout_groups,
            density=presentation_config.density,
            design_tokens=presentation_config.design_tokens,
            theme_tokens=presentation_config.theme_tokens,
            sections=presentation_sections,
        ),
        section_configs=presentation_sections,
        section_payloads=section_payloads,
        export_document=export_document,
    )
    return payload, metadata.llm_provider, metadata.llm_model


async def _load_latest_single_run_payloads(
    db,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    limit: int,
) -> list[tuple[dict, dict]]:
    single_run_config = await resolve_report_config(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        scope='single_run',
        report_id=None,
    )
    stmt = (
        select(ReportRun, ReportArtifact)
        .join(ReportArtifact, ReportArtifact.report_run_id == ReportRun.id)
        .where(
            readable_scope_clause(
                ReportRun,
                type(
                    'AccessUser',
                    (),
                    {
                        'tenant_id': tenant_id,
                        'user_id': user_id,
                        'app_access': frozenset({app_id}),
                    },
                )(),
            ),
            ReportRun.app_id == app_id,
            ReportRun.scope == 'single_run',
            ReportRun.report_id == single_run_config.report_id,
            ReportRun.status == 'completed',
            ReportRun.source_eval_run_id.is_not(None),
        )
        .order_by(desc(ReportRun.completed_at), desc(ReportArtifact.computed_at))
    )
    rows = (await db.execute(stmt)).all()

    unique_rows: list[tuple[dict, dict]] = []
    seen_run_ids: set[uuid.UUID] = set()
    for report_run, artifact in rows:
        if report_run.source_eval_run_id in seen_run_ids:
            continue
        seen_run_ids.add(report_run.source_eval_run_id)
        unique_rows.append(
            (
                {
                    'id': str(report_run.source_eval_run_id),
                },
                artifact.artifact_data,
            )
        )
        if len(unique_rows) >= limit:
            break
    return unique_rows


async def generate_single_run_report_artifact(
    job_id,
    params: dict,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict:
    run_id = params.get('run_id')
    if not run_id:
        raise ValueError('run_id is required')

    async with async_session() as db:
        report_run = None
        try:
            run, _analytics_config, _profile = await _load_run_and_profile(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                run_id=run_id,
            )
            report_config = await resolve_report_config(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                app_id=run.app_id,
                scope='single_run',
                report_id=params.get('report_id'),
            )
            report_run = await ensure_report_run(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                job_id=uuid.UUID(str(job_id)),
                report_config=report_config,
                source_eval_run_id=run.id,
                visibility=run.visibility,
                shared_by=run.shared_by,
                shared_at=run.shared_at,
                llm_provider=params.get('provider'),
                llm_model=params.get('model'),
            )
            payload, effective_provider, effective_model = await _compose_single_run_payload(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                run=run,
                report_run=report_run,
                report_config=report_config,
                llm_provider=params.get('provider'),
                llm_model=params.get('model'),
            )
            report_run.llm_provider = effective_provider
            report_run.llm_model = effective_model
            report_run.status = 'completed'
            report_run.completed_at = datetime.now(timezone.utc)
            artifact = await persist_report_artifact(
                db,
                report_run=report_run,
                artifact_data=payload.model_dump(by_alias=True),
                source_run_count=1,
                latest_source_run_at=run.created_at,
            )
            await db.commit()
            return {
                'report_run_id': str(report_run.id),
                'report_artifact_id': str(artifact.id),
                'run_id': run_id,
                'report_id': report_config.report_id,
                'duration_seconds': 0.0,
                'has_narrative': payload.metadata.narrative_model is not None,
            }
        except Exception:
            if report_run is not None:
                report_run.status = 'failed'
                report_run.completed_at = datetime.now(timezone.utc)
                await db.commit()
            raise


async def generate_cross_run_report_artifact(
    job_id,
    params: dict,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict:
    app_id = str(params.get('app_id') or '').strip()
    if not app_id:
        raise ValueError('app_id is required')

    limit = int(params.get('limit', 50) or 50)
    async with async_session() as db:
        report_run = None
        try:
            app_row = await db.scalar(
                select(App).where(
                    App.slug == app_id,
                    App.is_active == True,
                )
            )
            if app_row is None:
                raise ValueError(f'App not found: {app_id}')

            analytics_config = AppConfigSchema.model_validate(app_row.config or {}).analytics
            profile = get_analytics_profile(analytics_config.profile)
            if profile is None or profile.cross_run_adapter is None:
                raise ValueError(f'Cross-run reporting is not enabled for app: {app_id}')

            report_config = await resolve_report_config(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                app_id=app_id,
                scope='cross_run',
                report_id=params.get('report_id'),
            )
            report_run = await ensure_report_run(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                job_id=uuid.UUID(str(job_id)),
                report_config=report_config,
                source_eval_run_id=None,
                visibility=params.get('visibility'),
                llm_provider=params.get('provider'),
                llm_model=params.get('model'),
            )

            runs_data = await _load_latest_single_run_payloads(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                app_id=app_id,
                limit=limit,
            )
            if not runs_data:
                raise ValueError('No completed runs with generated reports found.')

            valid_rows, invalid_cached_reports = partition_valid_single_run_payloads(
                runs_data,
                PlatformRunReportPayload,
            )
            if not valid_rows:
                if invalid_cached_reports:
                    raise ValueError('Cached reports are outdated. Regenerate single-run reports before refreshing cross-run analytics.')
                raise ValueError('No completed runs with generated reports found.')

            total_runs_available = len(valid_rows)
            base_payload = profile.cross_run_adapter.aggregate(
                valid_rows,
                total_runs_available,
                analytics_config=analytics_config,
                app_id=app_id,
            )
            metadata = base_payload.metadata.model_copy(update={'computed_at': datetime.now(timezone.utc).isoformat()})
            section_payloads = _serialize_section_payloads(base_payload.sections)
            narrative_config = NarrativeConfig.model_validate(report_config.narrative_config or {})
            if narrative_config.enabled:
                resolved_assets = await resolve_report_config_assets(
                    db,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    app_id=app_id,
                    asset_keys=narrative_config.asset_keys,
                )
                llm, effective_provider, effective_model = await _create_logging_llm(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    app_id=app_id,
                    report_id=report_config.report_id,
                    provider_override=params.get('provider'),
                    model_override=params.get('model'),
                )
                if llm is not None:
                    section_payloads.update(
                        await execute_narrative_generation(
                            llm=llm,
                            report_id=report_config.report_id,
                            report_kind='cross_run',
                            metadata=metadata,
                            sections=base_payload.sections,
                            narrative_config={
                                **report_config.narrative_config,
                                'resolvedAssets': {
                                    'promptReferences': resolved_assets.prompt_references,
                                    'systemPrompt': resolved_assets.system_prompt,
                                    'glossary': resolved_assets.glossary,
                                },
                            },
                        )
                    )
                    metadata = metadata.model_copy(update={'cache_key': metadata.cache_key, 'computed_at': metadata.computed_at})
                    report_run.llm_provider = effective_provider
                    report_run.llm_model = effective_model

            presentation_config = PresentationConfig.model_validate(report_config.presentation_config or {})
            export_config = ExportConfig.model_validate(report_config.export_config or {})
            export_document = None
            if export_config.enabled:
                pre_sections = compose_cross_run_report(
                    metadata=metadata,
                    section_configs=_effective_presentation_sections(presentation_config, analytics_config.cross_run.sections),
                    section_payloads=section_payloads,
                    export_document=None,
                ).sections
                export_document = compose_document(
                    title=f'{app_id} cross-run report',
                    subtitle='Cross-run report',
                    metadata={
                        'App': app_id,
                        'Computed': metadata.computed_at,
                    },
                    sections=pre_sections,
                    export_config=export_config,
                    theme_tokens=presentation_config.theme_tokens,
                )
            payload = compose_cross_run_report(
                metadata=metadata,
                section_configs=_effective_presentation_sections(presentation_config, analytics_config.cross_run.sections),
                section_payloads=section_payloads,
                export_document=export_document,
            )
            report_run.status = 'completed'
            report_run.completed_at = datetime.now(timezone.utc)
            artifact = await persist_report_artifact(
                db,
                report_run=report_run,
                artifact_data=payload.model_dump(by_alias=True),
                source_run_count=payload.metadata.source_run_count,
                latest_source_run_at=None,
            )
            await db.commit()
            return {
                'report_run_id': str(report_run.id),
                'report_artifact_id': str(artifact.id),
                'app_id': app_id,
                'report_id': report_config.report_id,
                'duration_seconds': 0.0,
                'has_narrative': report_run.llm_model is not None,
            }
        except Exception:
            if report_run is not None:
                report_run.status = 'failed'
                report_run.completed_at = datetime.now(timezone.utc)
                await db.commit()
            raise
