import unittest

from fastapi import HTTPException
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from app.config import settings
from app.routes.reports import (
    _compose_pdf_footer_template,
    _compose_pdf_header_template,
    _pdf_export_failure_detail,
    _resolve_pdf_render_base_url,
    build_pdf_running_meta,
)
from app.services.reports.cache_validation import (
    load_cached_payload_or_raise,
    partition_valid_single_run_payloads,
)
from app.services.reports.contracts.run_report import PlatformRunReportPayload


def _valid_run_payload() -> dict:
    return {
        'schemaVersion': 'v1',
        'metadata': {
            'appId': 'inside-sales',
            'runId': 'run-123',
            'runName': 'Inside Sales Batch',
            'evalType': 'call_quality',
            'createdAt': '2026-04-01T10:00:00+00:00',
            'computedAt': '2026-04-01T10:05:00+00:00',
        },
        'sections': [
            {
                'id': 'inside-sales-summary',
                'type': 'summary_cards',
                'title': 'Summary',
                'variant': 'overview',
                'data': [
                    {'key': 'avg-qa-score', 'label': 'Average QA Score', 'value': '91', 'tone': 'positive'},
                ],
            },
        ],
        'exportDocument': {
            'schemaVersion': 'v1',
            'title': 'Inside Sales Batch',
            'theme': {
                'accent': '#1d4ed8',
                'accentMuted': '#dbeafe',
                'border': '#cbd5e1',
                'textPrimary': '#0f172a',
                'textSecondary': '#475569',
                'background': '#ffffff',
            },
            'blocks': [
                {'id': 'cover', 'type': 'cover', 'title': 'Inside Sales Batch', 'subtitle': 'Single-run report', 'metadata': {}},
            ],
        },
    }


def _legacy_run_payload() -> dict:
    return {
        'metadata': {
            'appId': 'inside-sales',
            'runId': 'run-legacy',
            'runName': 'Legacy Inside Sales Batch',
            'evalType': 'call_quality',
            'createdAt': '2026-04-01T10:00:00+00:00',
        },
        'runSummary': {
            'totalCalls': 5,
            'evaluatedCalls': 5,
            'avgQaScore': 91,
            'avgCompliancePassRate': 1,
        },
    }


class ReportsRouteHelperTests(unittest.TestCase):
    def test_pdf_render_base_url_prefers_internal_override(self):
        original_app_base_url = settings.APP_BASE_URL
        original_pdf_render_base_url = settings.PDF_RENDER_BASE_URL
        settings.APP_BASE_URL = 'http://public.example'
        settings.PDF_RENDER_BASE_URL = 'http://frontend:5173/'
        try:
            self.assertEqual(_resolve_pdf_render_base_url(), 'http://frontend:5173')
        finally:
            settings.APP_BASE_URL = original_app_base_url
            settings.PDF_RENDER_BASE_URL = original_pdf_render_base_url

    def test_pdf_render_base_url_falls_back_to_app_base_url(self):
        original_app_base_url = settings.APP_BASE_URL
        original_pdf_render_base_url = settings.PDF_RENDER_BASE_URL
        settings.APP_BASE_URL = 'http://public.example/'
        settings.PDF_RENDER_BASE_URL = ''
        try:
            self.assertEqual(_resolve_pdf_render_base_url(), 'http://public.example')
        finally:
            settings.APP_BASE_URL = original_app_base_url
            settings.PDF_RENDER_BASE_URL = original_pdf_render_base_url

    def test_pdf_export_timeout_detail_is_sanitized(self):
        detail = _pdf_export_failure_detail(
            PlaywrightTimeoutError(
                'Page.goto: Timeout 45000ms exceeded. Call log: navigating to "http://host/print/report-runs/1?token=secret"'
            )
        )

        self.assertEqual(
            detail,
            'PDF generation timed out while waiting for the report print page to finish loading.',
        )
        self.assertNotIn('token=', detail)

    def test_pdf_export_generic_failure_detail_is_sanitized(self):
        detail = _pdf_export_failure_detail(Exception('boom'))

        self.assertEqual(
            detail,
            'PDF generation failed while rendering the report print view.',
        )

    def test_load_cached_payload_or_raise_accepts_canonical_run_payload(self):
        payload = load_cached_payload_or_raise(
            PlatformRunReportPayload.model_validate,
            _valid_run_payload(),
            detail='should not fail',
            log_message='test log',
        )

        self.assertEqual(payload.metadata.computed_at, '2026-04-01T10:05:00+00:00')
        self.assertEqual(payload.sections[0].id, 'inside-sales-summary')

    def test_load_cached_payload_or_raise_converts_validation_error_to_conflict(self):
        with self.assertRaises(HTTPException) as ctx:
            load_cached_payload_or_raise(
                PlatformRunReportPayload.model_validate,
                _legacy_run_payload(),
                detail='Cached report is outdated. Regenerate the report.',
                log_message='test log',
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail, 'Cached report is outdated. Regenerate the report.')


class PdfRunningMetaTests(unittest.TestCase):
    def _payload(self) -> PlatformRunReportPayload:
        return PlatformRunReportPayload.model_validate(_valid_run_payload())

    def test_running_meta_uses_run_name_for_header_title(self):
        meta = build_pdf_running_meta(self._payload())
        self.assertEqual(meta['title'], 'Inside Sales Batch')
        self.assertIn('call_quality', meta['subtitle'])
        self.assertIn('2026', meta['subtitle'])

    def test_running_meta_truncates_long_titles(self):
        raw = _valid_run_payload()
        raw['metadata']['runName'] = 'Q' * 250
        payload = PlatformRunReportPayload.model_validate(raw)

        meta = build_pdf_running_meta(payload)

        self.assertLessEqual(len(meta['title']), 100)
        self.assertTrue(meta['title'].endswith('…'))

    def test_header_template_escapes_user_supplied_title(self):
        html_meta = _compose_pdf_header_template(
            {'title': '<script>alert(1)</script>', 'subtitle': ''},
        )

        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', html_meta)
        self.assertNotIn('<script>', html_meta)

    def test_footer_template_includes_pagination_placeholders(self):
        footer = _compose_pdf_footer_template({'title': 'x', 'subtitle': 'eval · today'})

        self.assertIn('class="pageNumber"', footer)
        self.assertIn('class="totalPages"', footer)
        self.assertIn('eval · today', footer)

    def test_load_cached_payload_or_raise_converts_value_error_to_conflict(self):
        def _broken_loader(_payload: dict):
            raise ValueError('badly formed hexadecimal UUID string')

        with self.assertRaises(HTTPException) as ctx:
            load_cached_payload_or_raise(
                _broken_loader,
                {'metadata': {'runId': 'not-a-uuid'}},
                detail='Cached report is outdated. Regenerate the report.',
                log_message='test log',
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail, 'Cached report is outdated. Regenerate the report.')

    def test_partition_valid_single_run_payloads_skips_legacy_rows(self):
        valid_rows, invalid_count = partition_valid_single_run_payloads(
            [
                ({'id': 'run-valid'}, _valid_run_payload()),
                ({'id': 'run-legacy'}, _legacy_run_payload()),
            ],
            PlatformRunReportPayload,
        )

        self.assertEqual(invalid_count, 1)
        self.assertEqual(len(valid_rows), 1)
        self.assertEqual(valid_rows[0][0]['id'], 'run-valid')
        self.assertIn('computedAt', valid_rows[0][1]['metadata'])

    def test_partition_valid_single_run_payloads_skips_value_error_rows(self):
        class BrokenPayloadModel:
            @classmethod
            def model_validate(cls, _payload: dict):
                raise ValueError('badly formed hexadecimal UUID string')

        valid_rows, invalid_count = partition_valid_single_run_payloads(
            [
                ({'id': 'run-broken'}, {'metadata': {'runId': 'not-a-uuid'}}),
            ],
            BrokenPayloadModel,
        )

        self.assertEqual(invalid_count, 1)
        self.assertEqual(valid_rows, [])
