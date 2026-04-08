import os
import sys
import unittest
import uuid
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.services import inside_sales_dataset_resolver as resolver  # noqa: E402


class _FakeAsyncScalarResult:
    def __init__(self, values):
        self._values = values

    def __iter__(self):
        return iter(self._values)


class _FakeSession:
    def __init__(self, values):
        self._values = values

    async def scalars(self, _statement):
        return _FakeAsyncScalarResult(self._values)


class InsideSalesDatasetResolverTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolve_call_dataset_page_filters_before_pagination(self):
        async def fake_fetch_call_activities(*, page: int, **_kwargs):
            if page == 1:
                return {
                    'activities': [
                        {'activityId': f'page1-{index}', 'agentName': 'Agent A', 'callStartTime': f'2026-01-01 00:{index:02d}:00'}
                        for index in range(100)
                    ]
                }
            if page == 2:
                return {
                    'activities': [
                        {'activityId': f'page2-{index}', 'agentName': 'Agent B', 'callStartTime': f'2026-01-02 00:0{index}:00'}
                        for index in range(3)
                    ]
                }
            return {'activities': []}

        with patch.object(resolver, 'fetch_call_activities', side_effect=fake_fetch_call_activities), patch.object(
            resolver,
            'normalize_activity',
            side_effect=lambda activity: {
                'activityId': activity['activityId'],
                'agentName': activity['agentName'],
                'callStartTime': activity['callStartTime'],
                'createdOn': activity['callStartTime'],
                'durationSeconds': 30,
                'direction': 'outbound',
                'status': 'answered',
                'recordingUrl': 'https://example.com/audio.mp3',
                'prospectId': 'lead-1',
            },
        ):
            page = await resolver.resolve_call_dataset_page(
                resolver.InsideSalesCallFilters(
                    date_from='2026-01-01 00:00:00',
                    date_to='2026-01-03 00:00:00',
                    agents=('Agent B',),
                ),
                page=1,
                page_size=50,
            )

        self.assertEqual(page.total, 3)
        self.assertEqual(len(page.records), 3)
        self.assertTrue(all(record['agentName'] == 'Agent B' for record in page.records))

    async def test_resolve_call_selection_uses_exact_agent_matching_and_user_scoped_skip_evaluated(self):
        async def fake_fetch_call_activities(*, page: int, **_kwargs):
            if page == 1:
                return {
                    'activities': [
                        {'activityId': 'exact-agent', 'agentName': 'Agent Amy', 'recordingUrl': 'https://example.com/a.mp3'},
                        {'activityId': 'partial-agent', 'agentName': 'Agent Amy Johnson', 'recordingUrl': 'https://example.com/b.mp3'},
                        {'activityId': 'already-evaluated', 'agentName': 'Agent Amy', 'recordingUrl': 'https://example.com/c.mp3'},
                        {'activityId': 'no-recording', 'agentName': 'Agent Amy', 'recordingUrl': ''},
                    ]
                }
            return {'activities': []}

        with patch.object(resolver, 'fetch_call_activities', side_effect=fake_fetch_call_activities), patch.object(
            resolver,
            'normalize_activity',
            side_effect=lambda activity: {
                'activityId': activity['activityId'],
                'agentName': activity['agentName'],
                'callStartTime': '2026-01-01 00:00:00',
                'createdOn': '2026-01-01 00:00:00',
                'durationSeconds': 45,
                'direction': 'outbound',
                'status': 'answered',
                'recordingUrl': activity['recordingUrl'],
                'prospectId': 'lead-1',
            },
        ):
            selection = await resolver.resolve_call_selection(
                resolver.InsideSalesCallFilters(
                    date_from='2026-01-01 00:00:00',
                    date_to='2026-01-03 00:00:00',
                    agents=('Agent Amy',),
                ),
                selection_mode='all',
                selected_call_ids=[],
                sample_size=20,
                skip_evaluated=True,
                min_duration_seconds=None,
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                db=_FakeSession(['already-evaluated']),
            )

        self.assertEqual([record['activityId'] for record in selection.records], ['exact-agent'])
        self.assertEqual(selection.skipped_evaluated, 1)
        self.assertEqual(selection.skipped_no_recording, 1)

    async def test_resolve_lead_dataset_page_filters_before_pagination(self):
        async def fake_fetch_leads(*, page: int, **_kwargs):
            if page == 1:
                return {
                    'leads': [{'id': f'cold-{index}', 'stage': 'cold'} for index in range(100)],
                    'has_more': True,
                }
            if page == 2:
                return {
                    'leads': [
                        {'id': 'hot-1', 'stage': 'hot'},
                        {'id': 'hot-2', 'stage': 'hot'},
                    ],
                    'has_more': False,
                }
            return {'leads': [], 'has_more': False}

        with patch.object(resolver, 'fetch_leads', side_effect=fake_fetch_leads), patch.object(
            resolver,
            'normalize_lead',
            side_effect=lambda raw: {
                'prospectId': raw['id'],
                'firstName': 'Lead',
                'lastName': raw['id'],
                'phone': '9999999999',
                'prospectStage': raw['stage'],
                'city': 'Delhi',
                'ageGroup': None,
                'condition': 'Diabetes',
                'hba1cBand': None,
                'intentToPay': None,
                'agentName': 'Agent B',
                'rnrCount': 0,
                'answeredCount': 1,
                'createdOn': '2026-01-01 00:00:00',
                'lastActivityOn': '2026-01-02 00:00:00',
                'firstActivityOn': '2026-01-01 00:10:00',
                'source': 'Campaign',
                'sourceCampaign': 'Campaign 1',
            },
        ), patch.object(
            resolver,
            'compute_mql_score',
            return_value=(4, {'scored': True}),
        ), patch.object(
            resolver,
            'compute_lead_metrics',
            return_value={
                'total_dials': 1,
                'connect_rate': 1.0,
                'frt_seconds': 120,
                'lead_age_days': 2,
                'days_since_last_contact': 1,
            },
        ):
            page = await resolver.resolve_lead_dataset_page(
                resolver.InsideSalesLeadFilters(
                    date_from='2026-01-01 00:00:00',
                    date_to='2026-01-03 00:00:00',
                    stage=('hot',),
                ),
                page=1,
                page_size=50,
            )

        self.assertEqual(page.total, 2)
        self.assertEqual([record['prospectId'] for record in page.records], ['hot-1', 'hot-2'])
