"""Full Sherlock Workbench rollout tests.

All Sherlock apps now use curated workbench catalogs. The old staged
cutover switch is gone, so these tests assert that app seeds no longer
carry it and each app builds the workbench prompt branch.
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.services.chat_engine.manifest import get_manifest
from app.services.chat_engine.manifest_validator import validate_workbench_against_manifest
from app.services.chat_engine.workbench_catalog import (
    _clear_catalog_cache_for_tests,
    load_workbench_catalog_strict,
)
from app.services.seed_defaults import APP_SEEDS
from app.services.sherlock_v3.data_specialist import build_data_specialist


SHERLOCK_APPS = ('inside-sales', 'voice-rx', 'kaira-bot')


def _seed_config(app_id: str) -> dict:
    for app in APP_SEEDS:
        if app['slug'] == app_id:
            return app['config']
    raise AssertionError(f'missing app seed: {app_id}')


class WorkbenchFullRolloutTests(unittest.TestCase):
    def test_seed_configs_have_no_cutover_switch(self) -> None:
        retired_key = 'workbench' + '_enabled'
        for app_id in SHERLOCK_APPS:
            with self.subTest(app_id=app_id):
                chat = _seed_config(app_id).get('chat', {})
                self.assertIsInstance(chat, dict)
                self.assertNotIn(retired_key, chat)

    def test_all_sherlock_apps_have_manifest_clean_catalogs(self) -> None:
        for app_id in SHERLOCK_APPS:
            with self.subTest(app_id=app_id):
                _clear_catalog_cache_for_tests()
                catalog = load_workbench_catalog_strict(app_id)
                self.assertGreaterEqual(len(catalog.verified_queries), 3)
                validate_workbench_against_manifest(catalog, get_manifest(app_id))

    def test_all_sherlock_apps_build_workbench_prompt(self) -> None:
        for app_id in SHERLOCK_APPS:
            with self.subTest(app_id=app_id):
                client = MagicMock()
                from agents.models.interface import Model
                model_stub = MagicMock(spec=Model)
                with patch(
                    'app.services.sherlock_v3.data_specialist.OpenAIResponsesModel',
                    return_value=model_stub,
                ):
                    agent = build_data_specialist(client, app_id, grounding=None)
                prompt = agent.instructions
                self.assertIsInstance(prompt, str)
                self.assertIn('WORKBENCH CATALOG IN EFFECT', prompt)


if __name__ == '__main__':
    unittest.main()
