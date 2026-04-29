import uuid
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

from app.services import inside_sales_sync as sync_service  # noqa: E402


class _FakeSession:
    """Fake AsyncSession that models SQLAlchemy's autobegin + begin() semantics.

    Real behavior modeled here so test doubles catch nested-begin bugs:
      - `execute` / `scalar` / `flush` / `refresh` / `commit` implicitly start
        a transaction (autobegin) when none is active.
      - `commit()` / `rollback()` end it.
      - `begin()` while a transaction is already active raises
        `InvalidRequestError: A transaction is already begun on this Session`,
        matching production behavior. Historical fakes silently allowed nested
        begin(), which is exactly how the PR4 boundary-sync transaction bug
        slipped through.
    """

    def __init__(self, latest_successful=None):
        self.latest_successful = latest_successful
        self.added = []
        self.executed = []
        self.commits = 0
        self.refreshes = 0
        self._in_transaction = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def _autobegin(self):
        self._in_transaction = True

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        self.commits += 1
        self._in_transaction = False

    async def rollback(self):
        self._in_transaction = False

    async def refresh(self, _item):
        self._autobegin()
        self.refreshes += 1

    async def flush(self):
        self._autobegin()

    async def scalar(self, _statement):
        self._autobegin()
        return self.latest_successful

    async def execute(self, statement):
        self._autobegin()
        self.executed.append(statement)
        return None

    def begin(self):
        if self._in_transaction:
            from sqlalchemy.exc import InvalidRequestError
            raise InvalidRequestError("A transaction is already begun on this Session.")
        return _FakeTransaction(self)


class _FakeTransaction:
    def __init__(self, session: "_FakeSession"):
        self._session = session

    async def __aenter__(self):
        self._session._in_transaction = True
        return self

    async def __aexit__(self, exc_type, exc, tb):
        # Simulate commit-on-success, rollback-on-exception.
        self._session._in_transaction = False
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

    def test_resolve_incremental_window_applies_overlap_minutes(self):
        """Overlap shifts date_from backward by N minutes to catch late
        mutations LSQ's CreatedOn-bound filter cannot surface otherwise."""
        latest = type(
            "LatestRun",
            (),
            {"watermark_to": "2026-04-20 12:00:00"},
        )()

        date_from, _date_to = sync_service._resolve_incremental_window(
            sync_service.InsideSalesSyncRequest(
                app_id="inside-sales",
                source_family="calls",
                sync_mode="incremental",
                source_system="lsq",
            ),
            latest,
            overlap_minutes=60,
        )
        self.assertEqual(date_from, "2026-04-20 11:00:00")

    def test_parse_sync_request_accepts_overlap_minutes(self):
        req = sync_service.parse_inside_sales_sync_request({
            "app_id": "inside-sales",
            "source_family": "calls",
            "sync_mode": "incremental",
            "overlap_minutes": 60,
        })
        self.assertEqual(req.overlap_minutes, 60)

    def test_parse_sync_request_rejects_negative_overlap_minutes(self):
        with self.assertRaisesRegex(ValueError, "overlap_minutes"):
            sync_service.parse_inside_sales_sync_request({
                "app_id": "inside-sales",
                "source_family": "calls",
                "sync_mode": "incremental",
                "overlap_minutes": -1,
            })

    def test_parse_sync_request_rejects_overlap_over_cap(self):
        with self.assertRaisesRegex(ValueError, "exceed"):
            sync_service.parse_inside_sales_sync_request({
                "app_id": "inside-sales",
                "source_family": "leads",
                "sync_mode": "incremental",
                "overlap_minutes": 99999,
            })

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
    def test_build_call_source_row_preserves_raw_text_columns(self):
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
        # No more shadow normalized columns — raw values are preserved.
        self.assertNotIn("agent_name_normalized", row)
        self.assertNotIn("status_normalized", row)
        self.assertEqual(row["status"], "Answered")
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
        self.assertEqual(row["prospect_stage"], "New Lead")
        # No shadow normalized columns.
        self.assertNotIn("prospect_stage_normalized", row)
        self.assertNotIn("city_normalized", row)
        self.assertNotIn("agent_name_normalized", row)
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
        self.assertIn("DELETE FROM analytics.crm_call_record", compiled)
        self.assertIn("analytics.crm_call_record.tenant_id =", compiled)
        self.assertIn("analytics.crm_call_record.app_id = 'inside-sales'", compiled)
        self.assertIn("analytics.crm_call_record.created_on <", compiled)
        self.assertIn("crm_call_record.created_on IS NOT NULL", compiled)

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
    """After the LSQ-ETL retention contract change, scheduled runs are
    pure provenance: ``is_scheduled_run`` + ``job_id`` land on the
    ``log_crm_source_sync`` row but the scheduled path does **not** prune
    and does **not** force a 7-day hot window."""

    def test_sync_run_builder_signature_accepts_provenance(self):
        import inspect as _inspect
        from app.services import inside_sales_sync as svc

        sig = _inspect.signature(svc._build_sync_run)
        self.assertIn("job_id", sig.parameters)
        self.assertIn("is_scheduled_run", sig.parameters)

    async def _run_sync(
        self,
        *,
        is_scheduled_run: bool,
        sync_mode: str = "date_range",
        latest_successful=None,
        extra_params: dict | None = None,
    ) -> tuple[_FakeSession, AsyncMock]:
        """Helper: run the end-to-end sync with stubbed LSQ + upsert + prune."""
        fake_session = _FakeSession(latest_successful=latest_successful)
        prune_mock = AsyncMock(return_value=0)
        params = {
            "app_id": "inside-sales",
            "source_family": "leads",
            "sync_mode": sync_mode,
            "is_scheduled_run": is_scheduled_run,
        }
        if sync_mode == "date_range":
            params["date_from"] = "2026-04-01 00:00:00"
            params["date_to"] = "2026-04-21 00:00:00"
        if extra_params:
            params.update(extra_params)
        # Stub the leads-family path (smaller, deterministic).
        with patch.object(sync_service, "_async_session_factory", return_value=fake_session), \
             patch.object(sync_service, "fetch_leads", new=AsyncMock(return_value={"leads": [], "has_more": False})), \
             patch.object(sync_service, "upsert_lead_source_rows", new=AsyncMock(return_value=0)), \
             patch("app.services.inside_sales_queries.prune_rows_older_than", new=prune_mock), \
             patch("app.services.job_worker.update_job_progress", new=AsyncMock(return_value=None)), \
             patch("app.services.job_worker.is_job_cancelled", new=AsyncMock(return_value=False)):
            await sync_service.run_inside_sales_source_sync(
                job_id=str(uuid.uuid4()),
                params=params,
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
            )
        return fake_session, prune_mock

    async def test_scheduled_sync_does_not_prune_old_rows(self):
        """Retention contract: scheduled runs never delete older source rows."""
        _session, prune_mock = await self._run_sync(is_scheduled_run=True)
        prune_mock.assert_not_awaited()

    async def test_ondemand_sync_does_not_prune(self):
        _session, prune_mock = await self._run_sync(is_scheduled_run=False)
        prune_mock.assert_not_awaited()

    async def test_scheduled_incremental_uses_watermark_window_not_seven_day_window(self):
        """Scheduled incremental runs follow the watermark (with overlap),
        not a rolling [now-7d, now] override."""
        from app.models.source_records import LogCrmSourceSync

        latest = type(
            "LatestRun",
            (),
            {"watermark_to": "2026-04-20 12:00:00"},
        )()
        fake_session, _prune = await self._run_sync(
            is_scheduled_run=True,
            sync_mode="incremental",
            latest_successful=latest,
        )
        sync_rows = [item for item in fake_session.added if isinstance(item, LogCrmSourceSync)]
        self.assertEqual(len(sync_rows), 1)
        # Leads incremental default overlap is 10 min; the watermark must
        # land at (latest_watermark - 10 min), NOT at (now - 7d).
        self.assertEqual(sync_rows[0].watermark_from, "2026-04-20T11:50:00+00:00")

    async def test_sync_run_persists_is_scheduled_run_and_job_id(self):
        fake_session, _prune = await self._run_sync(is_scheduled_run=True)
        # `_create_sync_run` adds a `LogCrmSourceSync` with our provenance.
        from app.models.source_records import LogCrmSourceSync

        sync_rows = [item for item in fake_session.added if isinstance(item, LogCrmSourceSync)]
        self.assertEqual(len(sync_rows), 1)
        self.assertTrue(sync_rows[0].is_scheduled_run)
        self.assertIsNotNone(sync_rows[0].job_id)


class LeadsModifiedOnContractTests(unittest.IsolatedAsyncioTestCase):
    """Lead incremental sync must filter AND sort by LSQ ``ModifiedOn`` so
    leads created outside the window but updated inside it are refreshed.
    Backfills (full/date_range) keep the ``CreatedOn`` contract."""

    async def _run_lead_sync(self, *, sync_mode: str, latest_successful=None) -> AsyncMock:
        fake_session = _FakeSession(latest_successful=latest_successful)
        fetch_mock = AsyncMock(return_value={"leads": [], "has_more": False})
        params = {
            "app_id": "inside-sales",
            "source_family": "leads",
            "sync_mode": sync_mode,
        }
        if sync_mode == "date_range":
            params["date_from"] = "2026-04-01 00:00:00"
            params["date_to"] = "2026-04-21 00:00:00"
        with patch.object(sync_service, "_async_session_factory", return_value=fake_session), \
             patch.object(sync_service, "fetch_leads", new=fetch_mock), \
             patch.object(sync_service, "upsert_lead_source_rows", new=AsyncMock(return_value=0)), \
             patch("app.services.job_worker.update_job_progress", new=AsyncMock(return_value=None)), \
             patch("app.services.job_worker.is_job_cancelled", new=AsyncMock(return_value=False)):
            await sync_service.run_inside_sales_source_sync(
                job_id=str(uuid.uuid4()),
                params=params,
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
            )
        return fetch_mock

    async def test_incremental_lead_sync_passes_modifiedon_filter_field(self):
        latest = type("L", (), {"watermark_to": "2026-04-20 12:00:00"})()
        fetch_mock = await self._run_lead_sync(
            sync_mode="incremental", latest_successful=latest
        )
        fetch_mock.assert_awaited()
        kwargs = fetch_mock.await_args.kwargs
        self.assertEqual(kwargs["filter_field"], "ModifiedOn")

    async def test_date_range_lead_sync_passes_createdon_filter_field(self):
        fetch_mock = await self._run_lead_sync(sync_mode="date_range")
        fetch_mock.assert_awaited()
        kwargs = fetch_mock.await_args.kwargs
        self.assertEqual(kwargs["filter_field"], "CreatedOn")

    async def test_incremental_lead_sync_refreshes_old_lead_modified_inside_window(self):
        """Probe-shaped case: a lead created months before the delta window
        but modified inside it must be fetched + upserted. This test asserts
        the LSQ filter is ModifiedOn so LSQ returns such a lead."""
        old_modified_lead = {
            "ProspectID": "prospect-old-modified",
            "FirstName": "Old",
            "ProspectStage": "Payment Received",
            "mx_RNR_Count": "0",
            "mx_Answered_Call_Count": "1",
            "CreatedOn": "2025-01-29 12:18:47",
            "ModifiedOn": "2026-04-24 08:51:05",
            "ProspectActivityDate_Min": "2025-01-29 12:20:00",
            "ProspectActivityDate_Max": "2026-04-24 08:51:05",
        }
        fake_session = _FakeSession(latest_successful=type(
            "L", (), {"watermark_to": "2026-04-24 06:00:00"}
        )())
        fetch_mock = AsyncMock(side_effect=[
            {"leads": [old_modified_lead], "has_more": False},
        ])
        upsert_mock = AsyncMock(return_value=1)
        with patch.object(sync_service, "_async_session_factory", return_value=fake_session), \
             patch.object(sync_service, "fetch_leads", new=fetch_mock), \
             patch.object(sync_service, "upsert_lead_source_rows", new=upsert_mock), \
             patch("app.services.job_worker.update_job_progress", new=AsyncMock(return_value=None)), \
             patch("app.services.job_worker.is_job_cancelled", new=AsyncMock(return_value=False)):
            result = await sync_service.run_inside_sales_source_sync(
                job_id=str(uuid.uuid4()),
                params={
                    "app_id": "inside-sales",
                    "source_family": "leads",
                    "sync_mode": "incremental",
                },
                tenant_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
            )
        self.assertEqual(fetch_mock.await_args.kwargs["filter_field"], "ModifiedOn")
        upsert_mock.assert_awaited_once()
        upserted_rows = upsert_mock.await_args.args[1]
        self.assertEqual(len(upserted_rows), 1)
        self.assertEqual(upserted_rows[0]["prospect_id"], "prospect-old-modified")
        self.assertEqual(result["records_upserted"], 1)


class WatermarkRetentionTests(unittest.IsolatedAsyncioTestCase):
    """A failed sync must leave the previous watermark in place so the
    next tick re-covers the same window."""

    async def test_failed_sync_does_not_advance_prior_watermark(self):
        from app.models.source_records import LogCrmSourceSync

        latest = SimpleNamespace(
            watermark_to="2026-04-20 12:00:00",
            completed_at=datetime(2026, 4, 20, 12, 0, tzinfo=timezone.utc),
        )
        fake_session = _FakeSession(latest_successful=latest)
        # Simulate fetch_leads failing mid-run.
        with patch.object(sync_service, "_async_session_factory", return_value=fake_session), \
             patch.object(sync_service, "fetch_leads", new=AsyncMock(side_effect=RuntimeError("lsq boom"))), \
             patch.object(sync_service, "upsert_lead_source_rows", new=AsyncMock(return_value=0)), \
             patch("app.services.job_worker.update_job_progress", new=AsyncMock(return_value=None)), \
             patch("app.services.job_worker.is_job_cancelled", new=AsyncMock(return_value=False)):
            with self.assertRaises(RuntimeError):
                await sync_service.run_inside_sales_source_sync(
                    job_id=str(uuid.uuid4()),
                    params={
                        "app_id": "inside-sales",
                        "source_family": "leads",
                        "sync_mode": "incremental",
                    },
                    tenant_id=uuid.uuid4(),
                    user_id=uuid.uuid4(),
                )
        sync_rows = [item for item in fake_session.added if isinstance(item, LogCrmSourceSync)]
        self.assertEqual(len(sync_rows), 1)
        self.assertEqual(sync_rows[0].status, "failed")
        # The failed run records the window it attempted, but the
        # next call to get_latest_successful_sync_run will still
        # pick up ``latest`` (status=completed), which has the
        # original watermark — i.e., the prior watermark is
        # preserved for the retry.
        self.assertEqual(latest.watermark_to, "2026-04-20 12:00:00")


class HashGuardedUpsertTests(unittest.IsolatedAsyncioTestCase):
    """Upsert statements must carry a
    ``WHERE target.source_record_hash IS DISTINCT FROM excluded.source_record_hash``
    clause so unchanged rows are true no-ops."""

    async def test_call_upsert_emits_hash_distinct_where_clause(self):
        from sqlalchemy.dialects import postgresql as _pg

        captured: list[Any] = []

        class _Sess:
            async def execute(self, stmt):
                captured.append(stmt)
                return None

        row = {
            "tenant_id": uuid.uuid4(),
            "app_id": "inside-sales",
            "source_system": "lsq",
            "activity_id": "activity-1",
            "prospect_id": "prospect-1",
            "event_code": 21,
            "direction": "inbound",
            "duration_seconds": 0,
            "has_recording": False,
            "source_record_hash": "abc",
            "first_synced_at": datetime.now(timezone.utc),
            "last_synced_at": datetime.now(timezone.utc),
            "last_seen_in_source_at": datetime.now(timezone.utc),
        }
        await sync_service.upsert_call_source_rows(_Sess(), [row])  # type: ignore[arg-type]
        self.assertEqual(len(captured), 1)
        compiled = str(
            captured[0].compile(
                dialect=_pg.dialect(),
                compile_kwargs={"literal_binds": True},
            )
        )
        # Conflict target must be the column list — not a named constraint —
        # so the upsert survives constraint renames (revision 0009 renamed
        # uq_source_call_records_tenant_app_activity → uq_crm_call_record_*).
        self.assertIn(
            "ON CONFLICT (tenant_id, app_id, activity_id)", compiled
        )
        self.assertNotIn("ON CONFLICT ON CONSTRAINT", compiled)
        self.assertIn("source_record_hash IS DISTINCT FROM", compiled)

    async def test_lead_upsert_emits_hash_distinct_where_clause(self):
        from sqlalchemy.dialects import postgresql as _pg

        captured: list[Any] = []

        class _Sess:
            async def execute(self, stmt):
                captured.append(stmt)
                return None

        row = {
            "tenant_id": uuid.uuid4(),
            "app_id": "inside-sales",
            "source_system": "lsq",
            "prospect_id": "prospect-1",
            "prospect_stage": "New Lead",
            "rnr_count": 0,
            "answered_count": 0,
            "total_dials": 0,
            "created_on": datetime.now(timezone.utc),
            "source_record_hash": "abc",
            "first_synced_at": datetime.now(timezone.utc),
            "last_synced_at": datetime.now(timezone.utc),
            "last_seen_in_source_at": datetime.now(timezone.utc),
        }
        await sync_service.upsert_lead_source_rows(_Sess(), [row])  # type: ignore[arg-type]
        self.assertEqual(len(captured), 1)
        compiled = str(
            captured[0].compile(
                dialect=_pg.dialect(),
                compile_kwargs={"literal_binds": True},
            )
        )
        # Conflict target must be the column list — not a named constraint —
        # so the upsert survives constraint renames (revision 0009 renamed
        # uq_source_lead_records_tenant_app_prospect → uq_crm_lead_record_*).
        self.assertIn(
            "ON CONFLICT (tenant_id, app_id, prospect_id)", compiled
        )
        self.assertNotIn("ON CONFLICT ON CONSTRAINT", compiled)
        self.assertIn("source_record_hash IS DISTINCT FROM", compiled)


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
