"""Canonical report service for Voice Rx evaluations."""

from __future__ import annotations

from sqlalchemy import select

from app.models.application import Application
from app.models.eval_run import EvaluationRun
from app.schemas.app_config import AppConfig as AppConfigSchema
from app.schemas.app_analytics_config import AppAnalyticsConfig
from app.services.reports.base_report_service import BaseReportService
from app.services.reports.contracts.data_quality import DataQualityReport
from app.services.reports.contracts.run_report import PlatformReportMetadata, PlatformRunReportPayload
from app.services.reports.document_composer import compose_document
from app.services.reports.report_composer import compose_run_report


def _as_percent(value: float | int | None) -> float:
    if value is None:
        return 0.0
    numeric = float(value)
    return numeric * 100 if 0 <= numeric <= 1 else numeric


class VoiceRxReportService(BaseReportService):
    payload_model = PlatformRunReportPayload

    async def _build_payload(
        self,
        run: EvaluationRun,
        source_data: dict,
        llm_provider: str | None = None,
        llm_model: str | None = None,
        include_narrative: bool = True,
    ) -> PlatformRunReportPayload:
        del source_data, llm_provider, llm_model, include_narrative

        analytics_config = await self._load_analytics_config(run.app_id)
        summary = run.summary or {}
        result = run.result or {}
        critique = result.get('critique', {}) or {}
        severity_distribution = summary.get('severity_distribution', {}) or {}
        flow_type = summary.get('flow_type', 'unknown')
        completeness = summary.get('completeness', 'unknown')
        total_items = int(summary.get('total_items', 0) or 0)
        overall_accuracy = _as_percent(summary.get('overall_accuracy'))
        extraction_recall = _as_percent(summary.get('extraction_recall'))
        extraction_precision = _as_percent(summary.get('extraction_precision'))
        overall_score = _as_percent(summary.get('overall_score'))

        # Phase 2 — surface partial runs honestly: voice-rx cards default to 0
        # when their summary keys are missing, which is indistinguishable from
        # a real zero. The finalizer in _compose_single_run_payload reads
        # data_quality.missing_inputs and lights the banner.
        missing_inputs: list[str] = []
        if summary.get('overall_accuracy') is None:
            missing_inputs.append('summary.overall_accuracy')
        if summary.get('extraction_recall') is None:
            missing_inputs.append('summary.extraction_recall')
        if summary.get('extraction_precision') is None:
            missing_inputs.append('summary.extraction_precision')
        if summary.get('overall_score') is None:
            missing_inputs.append('summary.overall_score')
        if not result:
            missing_inputs.append('run.result')

        example_items = []
        for item in critique.get('segments', [])[:5]:
            example_items.append(
                {
                    'itemId': str(item.get('segmentIndex', len(example_items))),
                    'label': f'Segment {item.get("segmentIndex", len(example_items))}',
                    'score': None,
                    'summary': item.get('critique', '') or 'No critique available',
                    'details': {
                        'severity': item.get('severity'),
                        'likelyCorrect': item.get('likelyCorrect'),
                    },
                }
            )
        if not example_items:
            for item in critique.get('fieldCritiques', [])[:5]:
                example_items.append(
                    {
                        'itemId': str(item.get('fieldName', len(example_items))),
                        'label': str(item.get('fieldName', 'Field')),
                        'score': None,
                        'summary': item.get('critique', '') or 'No critique available',
                        'details': {
                            'severity': item.get('severity'),
                            'match': item.get('match'),
                        },
                    }
                )

        metadata = PlatformReportMetadata(
            app_id=run.app_id,
            run_id=str(run.id),
            run_name=(run.batch_metadata or {}).get('name'),
            eval_type=run.eval_type,
            created_at=run.created_at.isoformat() if run.created_at else '',
            computed_at=run.completed_at.isoformat() if run.completed_at else (run.created_at.isoformat() if run.created_at else ''),
            llm_provider=run.llm_provider,
            llm_model=run.llm_model,
            narrative_model=None,
            cache_key=f'{run.app_id}:{run.id}:single_run',
        )

        section_payloads = {
            'voice-rx-summary': [
                {
                    'key': 'overall-accuracy',
                    'label': 'Overall Accuracy',
                    'value': f'{overall_accuracy:.1f}%',
                    'tone': 'positive' if overall_accuracy >= 90 else 'warning' if overall_accuracy >= 75 else 'negative',
                },
                {
                    'key': 'total-items',
                    'label': 'Items Evaluated',
                    'value': str(total_items),
                    'tone': 'neutral',
                },
                {
                    'key': 'critical-errors',
                    'label': 'Critical Errors',
                    'value': str(summary.get('critical_errors', 0) or 0),
                    'tone': 'negative' if (summary.get('critical_errors', 0) or 0) > 0 else 'positive',
                },
                {
                    'key': 'completeness',
                    'label': 'Completeness',
                    'value': str(completeness).replace('_', ' ').title(),
                    'tone': 'neutral',
                },
            ],
            'voice-rx-overview': {
                'message': (
                    f'Flow type: {flow_type}. '
                    f'Run completeness: {completeness}. '
                    f"Minor/moderate/critical errors: {summary.get('minor_errors', 0) or 0}/"
                    f"{summary.get('moderate_errors', 0) or 0}/{summary.get('critical_errors', 0) or 0}."
                ),
                'tone': 'warning' if summary.get('critical_errors', 0) else 'positive',
            },
            'voice-rx-metrics': [
                {
                    'key': 'overall-accuracy',
                    'label': 'Overall Accuracy',
                    'value': overall_accuracy,
                    'maxValue': 100,
                    'tone': 'positive' if overall_accuracy >= 90 else 'warning' if overall_accuracy >= 75 else 'negative',
                },
                {
                    'key': 'extraction-recall',
                    'label': 'Extraction Recall',
                    'value': extraction_recall,
                    'maxValue': 100,
                    'tone': 'positive' if extraction_recall >= 90 else 'warning' if extraction_recall >= 75 else 'negative',
                },
                {
                    'key': 'extraction-precision',
                    'label': 'Extraction Precision',
                    'value': extraction_precision,
                    'maxValue': 100,
                    'tone': 'positive' if extraction_precision >= 90 else 'warning' if extraction_precision >= 75 else 'negative',
                },
                {
                    'key': 'overall-score',
                    'label': 'Judge Overall Score',
                    'value': overall_score,
                    'maxValue': 100,
                    'tone': 'positive' if overall_score >= 90 else 'warning' if overall_score >= 75 else 'negative',
                },
            ],
            'voice-rx-severity': [
                {
                    'key': 'severity',
                    'label': 'Severity Distribution',
                    'categories': list(severity_distribution.keys()) or ['CRITICAL', 'MODERATE', 'MINOR'],
                    'values': [severity_distribution.get(key, 0) for key in (list(severity_distribution.keys()) or ['CRITICAL', 'MODERATE', 'MINOR'])],
                }
            ],
            'voice-rx-exemplars': example_items,
            'voice-rx-issues': {
                'issues': [
                    {
                        'title': 'Critical error volume',
                        'area': 'Accuracy',
                        'priority': 'P0' if (summary.get('critical_errors', 0) or 0) > 0 else 'P2',
                        'summary': f"{summary.get('critical_errors', 0) or 0} critical discrepancies detected.",
                    },
                    {
                        'title': 'Moderate error volume',
                        'area': 'Accuracy',
                        'priority': 'P1' if (summary.get('moderate_errors', 0) or 0) > 0 else 'P2',
                        'summary': f"{summary.get('moderate_errors', 0) or 0} moderate discrepancies detected.",
                    },
                ],
                'recommendations': [
                    {
                        'priority': 'P0' if overall_accuracy < 85 else 'P1',
                        'title': 'Review discrepant transcript segments',
                        'action': 'Audit the highlighted discrepancies and tighten the evaluation prompt against repeated mismatch patterns.',
                    }
                ],
            },
        }

        sections = compose_run_report(
            metadata=metadata,
            section_configs=analytics_config.single_run.sections,
            section_payloads=section_payloads,
            export_document=compose_document(
                title='placeholder',
                subtitle=None,
                metadata={},
                sections=[],
                export_config=analytics_config.single_run.export,
                composition_theme=analytics_config.single_run.theme,
            ),
        ).sections

        export_document = compose_document(
            title=metadata.run_name or 'Voice Rx Report',
            subtitle='Voice Rx single-run report',
            metadata={
                'Run ID': metadata.run_id,
                'Created': metadata.created_at,
                'Model': metadata.llm_model,
            },
            sections=sections,
            export_config=analytics_config.single_run.export,
            composition_theme=analytics_config.single_run.theme,
        )

        payload = compose_run_report(
            metadata=metadata,
            section_configs=analytics_config.single_run.sections,
            section_payloads=section_payloads,
            export_document=export_document,
        )
        if missing_inputs:
            payload = payload.model_copy(
                update={'data_quality': DataQualityReport(missing_inputs=missing_inputs)},
            )
        return payload

    async def _load_analytics_config(self, app_id: str) -> AppAnalyticsConfig:
        app_row = await self.db.scalar(
            select(Application).where(
                Application.slug == app_id,
                Application.is_active == True,
            )
        )
        if not app_row:
            raise ValueError(f'App not found: {app_id}')
        app_config = AppConfigSchema.model_validate(app_row.config or {})
        return app_config.analytics
