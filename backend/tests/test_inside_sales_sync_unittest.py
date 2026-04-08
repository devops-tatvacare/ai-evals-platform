import os
import sys
import uuid
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.services import inside_sales_sync as sync_service  # noqa: E402


class _FakeSession:
    def __init__(self, latest_successful=None):
        self.latest_successful = latest_successful
        self.added = []
        self.executed = []
        self.commits = 0
        self.refreshes = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        self.commits += 1

    async def refresh(self, _item):
        self.refreshes += 1

    async def scalar(self, _statement):
        return self.latest_successful

    async def execute(self, statement):
        self.executed.append(statement)
        return None


class InsideSalesSyncRequestTests(unittest.TestCase):
    def test_parse_sync_request_validates_targeted_call_requirements(self):
        with self.assertRaisesRegex(ValueError, "targeted call sync requires both date_from and date_to"):
            sync_service.parse_inside_sales_sync_request({
                "app_id": "inside-sales",
                "source_family": "calls",
                "sync_mode": "targeted",
                "targeted_source_id": "activity-1",
            })

    def test_resolve_incremental_window_uses_latest_successful_watermark(self):
        latest = type(
            "LatestRun",
            (),
            {"watermark_to": "2026-04-07 00:00:00"},
        )()

        date_from, date_to = sync_service._resolve_incremental_window(
            sync_service.InsideSalesSyncRequest(
                app_id="inside-sales",
                source_family="calls",
                sync_mode="incremental",
                source_system="lsq",
            ),
            latest,
        )

        self.assertEqual(date_from, "2026-04-07 00:00:00")
        self.assertTrue(isinstance(date_to, str) and len(date_to) >= 19)


class InsideSalesMirrorRowBuilderTests(unittest.TestCase):
    def test_build_call_mirror_row_sets_normalized_fields(self):
        synced_at = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)
        row = sync_service.build_call_mirror_row(
            {
                "ProspectActivityId": "activity-1",
                "RelatedProspectId": "prospect-1",
                "CreatedBy": "agent-1",
                "CreatedByName": " Agent Amy ",
                "CreatedByEmailAddress": "amy@example.com",
                "ActivityEvent": 21,
                "Status": "Answered",
                "mx_Custom_2": "2026-04-08 09:00:00",
                "mx_Custom_3": "180",
                "mx_Custom_4": "https://example.com/recording.mp3",
                "mx_Custom_1": "Lead Amy",
                "ActivityEvent_Note": '{"SourceData":{"SourceNumber":"9999999999","CallNotes":"Interested","CallSessionId":"session-1"}}',
                "CreatedOn": "2026-04-08 09:00:00",
            },
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id="inside-sales",
            source_system="lsq",
            synced_at=synced_at,
        )

        self.assertEqual(row["activity_id"], "activity-1")
        self.assertEqual(row["agent_name_normalized"], "agent amy")
        self.assertEqual(row["status_normalized"], "answered")
        self.assertTrue(row["has_recording"])

    def test_build_lead_mirror_row_sets_derived_fields(self):
        synced_at = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)
        row = sync_service.build_lead_mirror_row(
            {
                "ProspectID": "prospect-1",
                "FirstName": "Lead",
                "LastName": "One",
                "Phone": "9999999999",
                "EmailAddress": "lead@example.com",
                "ProspectStage": "New Lead",
                "mx_City": "Mumbai",
                "mx_Age_Group": "31-40",
                "mx_utm_disease": "Diabetes",
                "mx_Do_you_remember_your_HbA1c_levels": "6.5",
                "mx_Are_you_open_to_investing_in_this_paid_program_of": "Yes",
                "mx_RNR_Count": "2",
                "mx_Answered_Call_Count": "3",
                "CreatedOn": "2026-04-01 09:00:00",
                "ProspectActivityDate_Min": "2026-04-01 10:00:00",
                "ProspectActivityDate_Max": "2026-04-07 10:00:00",
                "OwnerIdName": "Agent Amy",
                "Source": "Campaign",
                "SourceCampaign": "April",
            },
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id="inside-sales",
            source_system="lsq",
            synced_at=synced_at,
        )

        self.assertEqual(row["prospect_stage_normalized"], "new lead")
        self.assertEqual(row["mql_score"], 5)
        self.assertEqual(row["total_dials"], 5)
        self.assertEqual(row["connect_rate"], 60.0)


class InsideSalesSyncJobTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_inside_sales_source_sync_targeted_lead_creates_and_completes_sync_run(self):
        fake_session = _FakeSession()

        with patch.object(sync_service, '_async_session_factory', return_value=fake_session), patch.object(
            sync_service,
            'fetch_lead_by_id',
            new=AsyncMock(return_value={
                "ProspectID": "prospect-1",
                "FirstName": "Lead",
                "ProspectStage": "New Lead",
                "mx_RNR_Count": "0",
                "mx_Answered_Call_Count": "1",
                "CreatedOn": "2026-04-01 09:00:00",
                "ProspectActivityDate_Min": "2026-04-01 09:05:00",
                "ProspectActivityDate_Max": "2026-04-01 09:05:00",
            }),
        ), patch.object(
            sync_service,
            'upsert_lead_mirror_rows',
            new=AsyncMock(return_value=1),
        ), patch(
            'app.services.job_worker.update_job_progress',
            new=AsyncMock(),
        ), patch(
            'app.services.job_worker.is_job_cancelled',
            new=AsyncMock(return_value=False),
        ):
            result = await sync_service.run_inside_sales_source_sync(
                'job-1',
                {
                    'app_id': 'inside-sales',
                    'source_family': 'leads',
                    'sync_mode': 'targeted',
                    'targeted_source_id': 'prospect-1',
                },
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
            )

        self.assertEqual(result['source_family'], 'leads')
        self.assertEqual(result['records_upserted'], 1)
        self.assertEqual(fake_session.added[0].status, 'completed')


if __name__ == '__main__':
    unittest.main()
