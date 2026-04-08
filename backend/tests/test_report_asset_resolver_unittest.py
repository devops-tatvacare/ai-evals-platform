import os
import sys
import unittest
import uuid
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.schemas.app_analytics_config import AnalyticsAssetKeys
from app.services.reports.asset_resolver import resolve_report_assets, resolve_report_config_assets
from app.services.reports.config_models import NarrativeAssetKeys
from app.services.reports.prompts.inside_sales_narrative_prompt import (
    INSIDE_SALES_NARRATIVE_SYSTEM_PROMPT,
)
from app.services.reports.prompts.narrative_prompt import NARRATIVE_SYSTEM_PROMPT


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

    async def test_resolve_report_assets_falls_back_to_default_system_prompt(self):
        with patch(
            "app.services.reports.asset_resolver._resolve_setting_value",
            new=AsyncMock(side_effect=[None, None, None]),
        ):
            assets = await resolve_report_assets(
                None,
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                app_id="kaira-bot",
                asset_keys=AnalyticsAssetKeys(prompt_references_key="report-prompt-references"),
            )

        self.assertEqual(assets.prompt_references, {})
        self.assertEqual(assets.narrative_template, NARRATIVE_SYSTEM_PROMPT)

    async def test_resolve_report_config_assets_falls_back_to_default_system_prompt(self):
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
        self.assertEqual(assets.system_prompt, INSIDE_SALES_NARRATIVE_SYSTEM_PROMPT)
