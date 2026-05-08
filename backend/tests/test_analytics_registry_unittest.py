"""unittest coverage for backend analytics profile registry wiring."""

import unittest

REGISTRY_IMPORT_ERROR = None

try:
    from app.services.reports.analytics_profiles.registry import (
        get_analytics_profile,
        list_analytics_profiles,
    )
except Exception as exc:  # pragma: no cover - environment-dependent optional deps
    REGISTRY_IMPORT_ERROR = exc
    get_analytics_profile = None
    list_analytics_profiles = None


@unittest.skipIf(
    REGISTRY_IMPORT_ERROR is not None,
    f'analytics profile registry imports optional backend deps not installed in this environment: {REGISTRY_IMPORT_ERROR}',
)
class AnalyticsRegistryTests(unittest.TestCase):
    def test_kaira_profile_exposes_expected_runtime_components(self):
        profile = get_analytics_profile('kaira_v1')
        self.assertIsNotNone(profile)
        assert profile is not None
        self.assertIsNotNone(profile.report_service_cls)
        self.assertIsNotNone(profile.report_payload_model)
        self.assertIsNotNone(profile.cross_run_adapter)
        self.assertIsNotNone(profile.cross_run_summary_narrator_cls)
        self.assertIsNotNone(profile.cross_run_summary_model)

    def test_inside_sales_profile_exposes_expected_runtime_components(self):
        profile = get_analytics_profile('inside_sales_v1')
        self.assertIsNotNone(profile)
        assert profile is not None
        self.assertIsNotNone(profile.report_service_cls)
        self.assertIsNotNone(profile.report_payload_model)
        self.assertIsNotNone(profile.cross_run_adapter)
        self.assertIsNotNone(profile.cross_run_summary_narrator_cls)
        self.assertIsNotNone(profile.cross_run_summary_model)

    def test_voice_rx_profile_is_explicit_and_runtime_enabled(self):
        profile = get_analytics_profile('voice_rx_v1')
        self.assertIsNotNone(profile)
        assert profile is not None
        self.assertIsNotNone(profile.report_service_cls)
        self.assertIsNotNone(profile.report_payload_model)

    def test_unknown_profile_has_no_registry_entry(self):
        self.assertIsNone(get_analytics_profile('unknown_v1'))

    def test_registry_lists_all_seeded_profiles(self):
        keys = {profile.key for profile in list_analytics_profiles()}
        self.assertEqual(keys, {'kaira_v1', 'inside_sales_v1', 'voice_rx_v1'})


if __name__ == '__main__':
    unittest.main()
