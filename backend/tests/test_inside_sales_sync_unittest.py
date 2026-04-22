import uuid
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

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

    def begin(self):
        return _FakeTransaction()


class _FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


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

    def test_build_manual_refresh_job_params_uses_incremental_after_first_success(self):
        params = sync_service.build_manual_refresh_job_params(
            source_family='calls',
            has_successful_sync=True,
            date_from='2026-04-01 00:00:00',
            date_to='2026-04-08 23:59:59',
            event_codes='21,22',
        )

        self.assertEqual(params['sync_mode'], 'incremental')
        self.assertEqual(params['event_codes'], '21,22')
        self.assertNotIn('date_from', params)
        self.assertNotIn('date_to', params)

    def test_build_manual_refresh_job_params_requires_window_before_first_success(self):
        with self.assertRaisesRegex(ValueError, 'date_from and date_to are required'):
            sync_service.build_manual_refresh_job_params(
                source_family='leads',
                has_successful_sync=False,
                date_from=None,
                date_to='2026-04-08 23:59:59',
            )


class InsideSalesSourceRowBuilderTests(unittest.TestCase):
    def test_build_call_source_row_sets_normalized_fields(self):
        synced_at = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)
        row = sync_service.build_call_source_row(
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

    def test_build_lead_source_row_sets_derived_fields(self):
        synced_at = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)
        row = sync_service.build_lead_source_row(
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

        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["prospect_stage_normalized"], "new lead")
        self.assertEqual(row["mql_score"], 5)
        self.assertEqual(row["total_dials"], 5)
        self.assertEqual(row["connect_rate"], 60.0)

    def test_build_call_source_row_created_on_fallback_prefers_call_start_timestamp(self):
        """When CreatedOn is missing, created_on should fall back to mx_Custom_2."""
        synced_at = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)
        row = sync_service.build_call_source_row(
            {
                "ProspectActivityId": "activity-1",
                "RelatedProspectId": "prospect-1",
                "ActivityEvent": 21,
                "mx_Custom_2": "2026-04-08 09:00:00",
                # No CreatedOn field
            },
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id="inside-sales",
            source_system="lsq",
            synced_at=synced_at,
        )

        self.assertEqual(row["created_on"], datetime(2026, 4, 8, 9, 0, tzinfo=timezone.utc))

    def test_build_call_source_row_created_on_fallback_uses_created_on_when_call_start_missing(self):
        synced_at = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)
        row = sync_service.build_call_source_row(
            {
                "ProspectActivityId": "activity-1",
                "RelatedProspectId": "prospect-1",
                "ActivityEvent": 21,
                "CreatedOn": "2026-04-08 09:05:00",
                # No mx_Custom_2
            },
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id="inside-sales",
            source_system="lsq",
            synced_at=synced_at,
        )

        self.assertEqual(row["created_on"], datetime(2026, 4, 8, 9, 5, tzinfo=timezone.utc))

    def test_build_lead_source_row_created_on_fallback_uses_modified_on_when_created_on_missing(self):
        synced_at = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)
        row = sync_service.build_lead_source_row(
            {
                "ProspectID": "prospect-1",
                "ProspectStage": "New Lead",
                "mx_RNR_Count": "0",
                "mx_Answered_Call_Count": "1",
                # No CreatedOn, but ModifiedOn present
                "ModifiedOn": "2026-04-05 10:30:00",
            },
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id="inside-sales",
            source_system="lsq",
            synced_at=synced_at,
        )

        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["created_on"], datetime(2026, 4, 5, 10, 30, tzinfo=timezone.utc))

    def test_build_lead_source_row_created_on_fallback_skips_and_warns_when_all_timestamps_missing(self):
        synced_at = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)
        with self.assertLogs('app.services.inside_sales_sync', level='WARNING') as captured:
            row = sync_service.build_lead_source_row(
                {
                    "ProspectID": "prospect-no-timestamp",
                    "ProspectStage": "New Lead",
                    "mx_RNR_Count": "0",
                    "mx_Answered_Call_Count": "0",
                    # No CreatedOn, no ModifiedOn
                },
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                app_id="inside-sales",
                source_system="lsq",
                synced_at=synced_at,
            )

        self.assertIsNone(row)
        self.assertTrue(any('lead_skipped_missing_timestamp' in message for message in captured.output))


class PruneRowsUnitTests(unittest.IsolatedAsyncioTestCase):
    """Prune helper tenant/app/source-family scoping + delete emission."""

    async def test_prune_is_tenant_app_source_family_scoped(self):
        from app.services.inside_sales_queries import prune_rows_older_than

        class _Result:
            rowcount = 3

        executed = []

        class _Session:
            async def execute(self, stmt):
                executed.append(stmt)
                return _Result()

        cutoff = datetime(2026, 4, 15, tzinfo=timezone.utc)
        count = await prune_rows_older_than(
            _Session(),
            tenant_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
            app_id="inside-sales",
            source_family="calls",
            cutoff=cutoff,
        )
        self.assertEqual(count, 3)
        compiled = str(executed[0].compile(
            dialect=__import__('sqlalchemy').dialects.postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        ))
        self.assertIn("DELETE FROM source_call_records", compiled)
        self.assertIn("source_call_records.tenant_id =", compiled)
        self.assertIn("source_call_records.app_id = 'inside-sales'", compiled)
        self.assertIn("source_call_records.created_on <", compiled)
        self.assertIn("source_call_records.created_on IS NOT NULL", compiled)

    async def test_prune_rejects_unknown_source_family(self):
        from app.services.inside_sales_queries import prune_rows_older_than

        class _Session:
            async def execute(self, stmt):  # pragma: no cover — should not be called
                raise AssertionError("execute should not run for unknown family")

        with self.assertRaises(ValueError):
            await prune_rows_older_than(
                _Session(),
                tenant_id=uuid.uuid4(),
                app_id="inside-sales",
                source_family="invalid",
                cutoff=datetime.now(timezone.utc),
            )


class ScheduledRunProvenanceTests(unittest.IsolatedAsyncioTestCase):
    """PR4: persist `is_scheduled_run` + `job_id` on `source_sync_runs` and
    route prune only through scheduled runs."""

    def test_create_sync_run_signature_accepts_provenance(self):
        import inspect as _inspect
        from app.services import inside_sales_sync as svc

        sig = _inspect.signature(svc._create_sync_run)
        self.assertIn("job_id", sig.parameters)
        self.assertIn("is_scheduled_run", sig.parameters)

    async def _run_sync(self, *, is_scheduled_run: bool) -> tuple[_FakeSession, AsyncMock]:
        """Helper: run the end-to-end sync with stubbed LSQ + upsert + prune."""
        fake_session = _FakeSession()
        prune_mock = AsyncMock(return_value=0)
        # Stub the leads-family path (smaller, deterministic).
        with patch.object(sync_service, "_async_session_factory", return_value=fake_session), \
             patch.object(sync_service, "fetch_leads", new=AsyncMock(return_value={"leads": [], "has_more": False})), \
             patch.object(sync_service, "upsert_lead_source_rows", new=AsyncMock(return_value=0)), \
             patch("app.services.inside_sales_queries.prune_rows_older_than", new=prune_mock), \
             patch("app.services.job_worker.update_job_progress", new=AsyncMock(return_value=None)), \
             patch("app.services.job_worker.is_job_cancelled", new=AsyncMock(return_value=False)):
            await sync_service.run_inside_sales_source_sync(
                job_id=str(uuid.uuid4()),
                params={
                    "app_id": "inside-sales",
                    "source_family": "leads",
                    "sync_mode": "date_range",
                    "date_from": "2026-04-01 00:00:00",
                    "date_to": "2026-04-21 00:00:00",
                    "is_scheduled_run": is_scheduled_run,
                },
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
            )
        return fake_session, prune_mock

    async def test_scheduled_sync_prunes_old_rows(self):
        _session, prune_mock = await self._run_sync(is_scheduled_run=True)
        prune_mock.assert_awaited_once()
        # Prune scope kwargs
        call_kwargs = prune_mock.await_args.kwargs
        self.assertEqual(call_kwargs["app_id"], "inside-sales")
        self.assertEqual(call_kwargs["source_family"], "leads")
        self.assertIn("cutoff", call_kwargs)

    async def test_ondemand_sync_does_not_prune(self):
        _session, prune_mock = await self._run_sync(is_scheduled_run=False)
        prune_mock.assert_not_awaited()

    async def test_sync_run_persists_is_scheduled_run_and_job_id(self):
        fake_session, _prune = await self._run_sync(is_scheduled_run=True)
        # `_create_sync_run` adds a `SourceSyncRun` with our provenance.
        from app.models.source_records import SourceSyncRun

        sync_rows = [item for item in fake_session.added if isinstance(item, SourceSyncRun)]
        self.assertEqual(len(sync_rows), 1)
        self.assertTrue(sync_rows[0].is_scheduled_run)
        self.assertIsNotNone(sync_rows[0].job_id)


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
            'upsert_lead_source_rows',
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
