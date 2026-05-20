import unittest
import uuid
from unittest.mock import AsyncMock, patch

from app.schemas.app_analytics_config import AnalyticsAssetKeys
from app.services.reports.asset_resolver import resolve_report_assets, resolve_report_config_assets
from app.services.reports.config_models import NarrativeAssetKeys


class ReportAssetResolverTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolve_report_assets_prefers_settings_prompt_references(self):
        prompt_references = {
            "intent_classification": "Intent prompt",
            "meal_summary_spec": "Meal summary prompt",
        }
        side_effect = [
            {"promptReferences": prompt_references},
            None,
            None,
        ]

        with patch(
            "app.services.reports.asset_resolver._resolve_setting_value",
            new=AsyncMock(side_effect=side_effect),
        ):
            assets = await resolve_report_assets(
                None,
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                app_id="kaira-bot",
                asset_keys=AnalyticsAssetKeys(prompt_references_key="report-prompt-references"),
            )

        self.assertEqual(assets.prompt_references, prompt_references)

    async def test_resolve_report_assets_uses_cascade_resolved_narrative_prompt(self):
        """Phase 4 — the Python-literal fallback at _narrative_defaults_for_app
        is gone. The narrative template comes exclusively from the cascade
        (private → tenant shared → SYSTEM-shared)."""
        seeded_prompt = "You are a kaira QA analyst. Summarize the run."
        with patch(
            "app.services.reports.asset_resolver._resolve_setting_value",
            new=AsyncMock(side_effect=[None, {"systemPrompt": seeded_prompt}, None]),
        ):
            assets = await resolve_report_assets(
                None,
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                app_id="kaira-bot",
                asset_keys=AnalyticsAssetKeys(
                    prompt_references_key="report-prompt-references",
                    narrative_template_key="report-narrative-template",
                ),
            )

        self.assertEqual(assets.prompt_references, {})
        self.assertEqual(assets.narrative_template, seeded_prompt)

    async def test_resolve_report_assets_returns_none_when_cascade_misses(self):
        """No more Python-literal fallback — if the cascade has no row, the
        narrative template is None and the caller's data_quality marker fires."""
        with patch(
            "app.services.reports.asset_resolver._resolve_setting_value",
            new=AsyncMock(side_effect=[None, None, None]),
        ):
            assets = await resolve_report_assets(
                None,
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                app_id="kaira-bot",
                asset_keys=AnalyticsAssetKeys(
                    prompt_references_key="report-prompt-references",
                    narrative_template_key="report-narrative-template",
                ),
            )

        self.assertEqual(assets.prompt_references, {})
        self.assertIsNone(assets.narrative_template)

    async def test_resolve_report_config_assets_uses_cascade_resolved_system_prompt(self):
        seeded_prompt = "You are a sales QA analyst generating coaching insights."
        with patch(
            "app.services.reports.asset_resolver._resolve_setting_value",
            new=AsyncMock(side_effect=[None, {"systemPrompt": seeded_prompt}, None]),
        ):
            assets = await resolve_report_config_assets(
                None,
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                app_id="inside-sales",
                asset_keys=NarrativeAssetKeys(
                    system_prompt_key="inside-sales-report-narrative-template",
                ),
            )

        self.assertEqual(assets.prompt_references, {})
        self.assertEqual(assets.system_prompt, seeded_prompt)

    async def test_resolve_report_config_assets_returns_none_when_cascade_misses(self):
        with patch(
            "app.services.reports.asset_resolver._resolve_setting_value",
            new=AsyncMock(side_effect=[None, None, None]),
        ):
            assets = await resolve_report_config_assets(
                None,
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                app_id="inside-sales",
                asset_keys=NarrativeAssetKeys(
                    system_prompt_key="inside-sales-report-narrative-template",
                ),
            )

        self.assertEqual(assets.prompt_references, {})
        self.assertIsNone(assets.system_prompt)
