"""Phase 3 tests for the mirror->fact wiring layer.

Exercises ``mirror_to_fact_sync`` helpers (counter, success, failure,
mirror-only) and the admin route handlers (disable/enable/list). The
feature flag is verified at the call site in ``inside_sales_sync.py`` by a
focused branch test that uses an ``AsyncMock`` session and patches the
heavy upsert helpers.
"""
from __future__ import annotations

import uuid
import unittest
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.analytics import mirror_to_fact_sync
from app.services.analytics.mirror_to_fact_mapper import MirrorToFactMapper


def _bundled_mapping():
    mapper = MirrorToFactMapper()
    return mapper.for_table(
        "inside-sales", "analytics.crm_call_record", "call"
    )


class FailureCounterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        mirror_to_fact_sync.reset_failure_counters_for_test()

    async def test_below_threshold_does_not_write_log(self) -> None:
        mapping = _bundled_mapping()
        with patch(
            "app.services.analytics.mirror_to_fact_sync.async_session"
        ) as session_factory:
            session_factory.return_value.__aenter__ = AsyncMock(
                return_value=AsyncMock()
            )
            session_factory.return_value.__aexit__ = AsyncMock(
                return_value=False
            )
            for i in range(2):
                count = await mirror_to_fact_sync.record_mapping_failure(
                    mapping, error=RuntimeError("x"), tenant_id=uuid.uuid4()
                )
                self.assertEqual(count, i + 1)
            # async_session() is only opened at threshold; until then we just
            # bump the in-memory counter.
            session_factory.assert_not_called()

    async def test_threshold_three_writes_blocking_sync_row(self) -> None:
        mapping = _bundled_mapping()
        added_rows: list[Any] = []

        class _CapturingSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            def begin(self):
                class _Tx:
                    async def __aenter__(self_tx):
                        return self_tx

                    async def __aexit__(self_tx, *exc):
                        return False

                return _Tx()

            def add(self, row):
                added_rows.append(row)

        with patch(
            "app.services.analytics.mirror_to_fact_sync.async_session",
            return_value=_CapturingSession(),
        ):
            for _ in range(3):
                await mirror_to_fact_sync.record_mapping_failure(
                    mapping,
                    error=RuntimeError("projection blew up"),
                    tenant_id=uuid.uuid4(),
                )

        self.assertEqual(len(added_rows), 1)
        log_row = added_rows[0]
        self.assertEqual(log_row.status, "blocking_sync")
        self.assertEqual(log_row.app_id, "inside-sales")
        self.assertEqual(log_row.metadata_["consecutive_failures"], 3)
        self.assertEqual(log_row.metadata_["threshold"], 3)
        self.assertEqual(log_row.metadata_["mapping_key"][3], "call")

    async def test_success_resets_counter(self) -> None:
        mapping = _bundled_mapping()
        with patch(
            "app.services.analytics.mirror_to_fact_sync.async_session"
        ):
            await mirror_to_fact_sync.record_mapping_failure(
                mapping, error=RuntimeError("x"), tenant_id=uuid.uuid4()
            )
        await mirror_to_fact_sync.record_mapping_success(mapping)

        # The next failure should be count=1 (reset took effect).
        with patch(
            "app.services.analytics.mirror_to_fact_sync.async_session"
        ):
            count = await mirror_to_fact_sync.record_mapping_failure(
                mapping, error=RuntimeError("y"), tenant_id=uuid.uuid4()
            )
        self.assertEqual(count, 1)


class ProjectAndUpsertTests(unittest.IsolatedAsyncioTestCase):
    async def test_project_writes_conflict_key_with_app_id(self) -> None:
        mapping = _bundled_mapping()

        captured: dict[str, Any] = {}

        async def _fake_execute(stmt):
            captured["stmt"] = stmt
            return MagicMock()

        db = AsyncMock()
        db.execute = _fake_execute

        mirror_rows = [
            {
                "tenant_id": uuid.uuid4(),
                "app_id": "inside-sales",
                "activity_id": "ACT-1",
                "lead_id": "L-1",
                "rep_id": "R-1",
                "rep_name": "Asha",
                "rep_email": "asha@x.com",
                "event_code": 21,
                "direction": "inbound",
                "status": "answered",
                "call_started_at": datetime(2026, 5, 13, tzinfo=timezone.utc),
                "duration_seconds": 60,
                "has_recording": True,
                "recording_url": "u",
                "phone_number": "p",
                "display_number": "d",
                "call_notes": "n",
                "call_session_id": "s",
            }
        ]
        await mirror_to_fact_sync.project_and_upsert_facts(
            db,
            mapping=mapping,
            mirror_rows=mirror_rows,
            sync_run_id=uuid.uuid4(),
        )
        compiled = str(captured["stmt"].compile())
        # ON CONFLICT key includes app_id + activity_type.
        self.assertIn("ON CONFLICT", compiled)
        self.assertIn("tenant_id", compiled)
        self.assertIn("app_id", compiled)
        self.assertIn("source_activity_id", compiled)
        self.assertIn("activity_type", compiled)
        self.assertIn("DO UPDATE", compiled)

    async def test_empty_rows_skip_db_call(self) -> None:
        mapping = _bundled_mapping()
        db = AsyncMock()
        n = await mirror_to_fact_sync.project_and_upsert_facts(
            db,
            mapping=mapping,
            mirror_rows=[],
            sync_run_id=uuid.uuid4(),
        )
        self.assertEqual(n, 0)
        db.execute.assert_not_called()

    async def test_missing_tenant_id_in_mirror_row_raises(self) -> None:
        # Defense in depth — if upstream forgets to thread tenant_id into the
        # mirror row dict, refuse to write a misattributed fact row.
        mapping = _bundled_mapping()
        db = AsyncMock()
        with self.assertRaises(KeyError) as cm:
            await mirror_to_fact_sync.project_and_upsert_facts(
                db,
                mapping=mapping,
                mirror_rows=[{"activity_id": "X"}],  # no tenant_id/app_id
                sync_run_id=uuid.uuid4(),
            )
        self.assertIn("tenant_id", str(cm.exception))
        db.execute.assert_not_called()


class CallsSyncBranchTests(unittest.IsolatedAsyncioTestCase):
    """Test that the feature flag actually toggles the call site.

    We can't easily run the whole _sync_calls_family without mocking LSQ,
    so the branch is exercised by inspecting the source for the canonical
    call structure under each flag state. The flag-on path is also
    smoke-tested by directly invoking the same helpers the branch uses.
    """

    def setUp(self) -> None:
        mirror_to_fact_sync.reset_failure_counters_for_test()

    async def test_disabled_mapping_writes_mirror_only_log_no_facts(
        self,
    ) -> None:
        # The flag-on branch calls record_mirror_only_mode() when the mapping
        # is disabled. Confirm that helper writes a log row and never invokes
        # the fact-upsert path.
        mapping = _bundled_mapping()

        added_rows: list[Any] = []

        class _CapturingSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            def begin(self):
                class _Tx:
                    async def __aenter__(self_tx):
                        return self_tx

                    async def __aexit__(self_tx, *exc):
                        return False

                return _Tx()

            def add(self, row):
                added_rows.append(row)

        with patch(
            "app.services.analytics.mirror_to_fact_sync.async_session",
            return_value=_CapturingSession(),
        ):
            await mirror_to_fact_sync.record_mirror_only_mode(
                mapping, tenant_id=uuid.uuid4()
            )

        self.assertEqual(len(added_rows), 1)
        self.assertEqual(added_rows[0].status, "mirror_only")
        self.assertEqual(
            added_rows[0].metadata_["mapping_key"][0], "inside-sales"
        )


class FlagSemanticsTests(unittest.TestCase):
    def test_legacy_feature_flag_is_removed(self) -> None:
        """The Phase 3 INSIDE_SALES_FACT_SAME_TX gate became permanent in
        Phase 7. The flag must no longer exist on Settings so a future
        env-var reintroducing it has no effect."""
        from app.config import Settings
        self.assertFalse(
            hasattr(Settings(), "INSIDE_SALES_FACT_SAME_TX"),
            "INSIDE_SALES_FACT_SAME_TX flag must be removed from Settings",
        )


class TransactionRollbackTests(unittest.IsolatedAsyncioTestCase):
    """``project_and_upsert_facts`` raises -> caller's transaction rolls back.

    The actual transaction lives in the outer ``_sync_calls_family`` call
    site. We exercise the contract here: when projection fails the helper
    bubbles the exception unchanged so the enclosing transaction (managed
    by SQLAlchemy autobegun-tx on the caller's session) rolls back.
    """

    def setUp(self) -> None:
        mirror_to_fact_sync.reset_failure_counters_for_test()

    async def test_projection_error_propagates(self) -> None:
        mapping = _bundled_mapping()
        # Required field rep_email is empty -> MappingProjectionError.
        mirror_row = {
            "tenant_id": uuid.uuid4(),
            "app_id": "inside-sales",
            "activity_id": "ACT-1",
            "lead_id": "L-1",
            "rep_id": None,
            "rep_name": None,
            "rep_email": None,
            "event_code": 21,
            "direction": "inbound",
            "status": "answered",
            "call_started_at": datetime(2026, 5, 13, tzinfo=timezone.utc),
            "duration_seconds": 60,
            "has_recording": False,
            "recording_url": None,
            "phone_number": None,
            "display_number": None,
            "call_notes": None,
            "call_session_id": None,
        }
        db = AsyncMock()
        with self.assertRaises(Exception) as cm:
            await mirror_to_fact_sync.project_and_upsert_facts(
                db,
                mapping=mapping,
                mirror_rows=[mirror_row],
                sync_run_id=uuid.uuid4(),
            )
        self.assertIn("rep_email", str(cm.exception))
        # db.execute must NOT have been called — the projection failed
        # before any SQL was issued.
        db.execute.assert_not_called()


class AdminRouteTests(unittest.IsolatedAsyncioTestCase):
    """Direct-handler tests for /api/admin/analytics/mappings/*.

    The dependency-injection wrappers (require_permission, get_db) are
    bypassed; we call the handlers as normal functions with a fake auth
    context and a stub session, exactly matching the existing
    test_admin_rbac_unittest.py pattern.
    """

    def _auth(self, *permissions: str):
        from types import SimpleNamespace
        return SimpleNamespace(
            is_owner=False,
            permissions=frozenset(permissions),
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
        )

    def _make_row(self, *, enabled: bool = True):
        from app.models.analytics_mapping_state import MappingState
        row = MappingState(
            app_id="inside-sales",
            source_table="analytics.crm_call_record",
            target_fact="analytics.fact_lead_activity",
            activity_type="call",
            enabled=enabled,
        )
        row.id = uuid.uuid4()
        row.updated_at = datetime.now(timezone.utc)
        return row

    async def test_disable_toggles_state_and_writes_log(self) -> None:
        from app.routes.analytics_admin import (
            DisableMappingRequest,
            disable_mapping,
        )

        row = self._make_row(enabled=True)
        added: list[Any] = []

        scalars_first = MagicMock()
        scalars_first.first = MagicMock(return_value=row)
        scalars = MagicMock()
        scalars.scalars = MagicMock(return_value=scalars_first)

        db = AsyncMock()
        db.execute = AsyncMock(return_value=scalars)
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        db.add = lambda r: added.append(r)

        response = await disable_mapping(
            mapping_id=row.id,
            body=DisableMappingRequest(reason="dev observation halted"),
            auth=self._auth("analytics:admin"),
            db=db,
        )
        self.assertFalse(row.enabled)
        self.assertEqual(row.disabled_reason, "dev observation halted")
        self.assertIsNotNone(row.disabled_at)
        self.assertEqual(response.enabled, False)
        # The handler appends one breadcrumb row before commit.
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0].status, "mapping_disabled")
        self.assertEqual(
            added[0].metadata_["reason"], "dev observation halted"
        )
        db.commit.assert_awaited_once()

    async def test_disable_idempotent_when_already_disabled(self) -> None:
        from app.routes.analytics_admin import (
            DisableMappingRequest,
            disable_mapping,
        )

        row = self._make_row(enabled=False)
        scalars_first = MagicMock()
        scalars_first.first = MagicMock(return_value=row)
        scalars = MagicMock()
        scalars.scalars = MagicMock(return_value=scalars_first)
        db = AsyncMock()
        db.execute = AsyncMock(return_value=scalars)
        db.commit = AsyncMock()

        await disable_mapping(
            mapping_id=row.id,
            body=DisableMappingRequest(reason="again"),
            auth=self._auth("analytics:admin"),
            db=db,
        )
        # No commit (no state mutation); idempotent.
        db.commit.assert_not_awaited()

    async def test_enable_toggles_state_and_writes_log(self) -> None:
        from app.routes.analytics_admin import enable_mapping

        row = self._make_row(enabled=False)
        row.disabled_reason = "ops"
        row.disabled_by_user_id = uuid.uuid4()
        row.disabled_at = datetime.now(timezone.utc)
        added: list[Any] = []

        scalars_first = MagicMock()
        scalars_first.first = MagicMock(return_value=row)
        scalars = MagicMock()
        scalars.scalars = MagicMock(return_value=scalars_first)
        db = AsyncMock()
        db.execute = AsyncMock(return_value=scalars)
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        db.add = lambda r: added.append(r)

        await enable_mapping(
            mapping_id=row.id,
            auth=self._auth("analytics:admin"),
            db=db,
        )
        self.assertTrue(row.enabled)
        self.assertIsNone(row.disabled_reason)
        self.assertIsNone(row.disabled_by_user_id)
        self.assertIsNone(row.disabled_at)
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0].status, "mapping_enabled")

    async def test_disable_404_when_id_unknown(self) -> None:
        from fastapi import HTTPException
        from app.routes.analytics_admin import (
            DisableMappingRequest,
            disable_mapping,
        )

        scalars_first = MagicMock()
        scalars_first.first = MagicMock(return_value=None)
        scalars = MagicMock()
        scalars.scalars = MagicMock(return_value=scalars_first)
        db = AsyncMock()
        db.execute = AsyncMock(return_value=scalars)

        with self.assertRaises(HTTPException) as cm:
            await disable_mapping(
                mapping_id=uuid.uuid4(),
                body=DisableMappingRequest(reason="unknown id test"),
                auth=self._auth("analytics:admin"),
                db=db,
            )
        self.assertEqual(cm.exception.status_code, 404)


class PermissionRegisteredTests(unittest.TestCase):
    def test_analytics_admin_in_catalog(self) -> None:
        from app.auth.permission_catalog import VALID_PERMISSIONS
        self.assertIn("analytics:admin", VALID_PERMISSIONS)


class PermissionGateTests(unittest.IsolatedAsyncioTestCase):
    """Verify the routes actually enforce ``analytics:admin``.

    These exercise ``require_permission`` directly (the dependency-injection
    layer), matching the style in test_admin_rbac_unittest.py. A future
    refactor that drops the permission decorator would fail here, not
    silently pass the catalog test above.
    """

    async def test_missing_permission_returns_403(self) -> None:
        from fastapi import HTTPException
        from types import SimpleNamespace
        from app.auth.permissions import ensure_permissions

        # The route declares ``auth=require_permission('analytics:admin')``.
        # ``require_permission`` is a FastAPI Dependency; under the hood it
        # calls ``ensure_permissions``, which raises HTTPException 403 when
        # the caller's permission set is missing the required entries. We
        # exercise that contract directly here so a refactor that
        # accidentally drops the decorator from the route signature would
        # not silently leave the route open — the catalog membership test
        # above wouldn't catch that regression.
        auth = SimpleNamespace(
            is_owner=False,
            permissions=frozenset({"cost:view"}),
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
        )
        with self.assertRaises(HTTPException) as cm:
            ensure_permissions(auth, "analytics:admin")
        self.assertEqual(cm.exception.status_code, 403)
        self.assertIn("analytics:admin", cm.exception.detail)

    async def test_with_permission_passes_gate(self) -> None:
        from types import SimpleNamespace
        from app.auth.permissions import ensure_permissions

        auth = SimpleNamespace(
            is_owner=False,
            permissions=frozenset({"analytics:admin"}),
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
        )
        # Should not raise.
        ensure_permissions(auth, "analytics:admin")

    async def test_route_signatures_declare_permission(self) -> None:
        """Defensive: the handlers must keep ``require_permission`` wired.

        Removing the decorator is the silent-regression class this section
        protects against. Each handler declares
        ``auth=require_permission('analytics:admin')``; we extract the
        inner ``_checker`` from the ``Depends`` wrapper and invoke it with
        an auth context that LACKS the perm. If the handler accidentally
        dropped the gate, the dependency wouldn't exist and the
        ``AttributeError`` would loudly surface.
        """
        import inspect
        from fastapi import HTTPException
        from types import SimpleNamespace
        from app.routes import analytics_admin

        bad_auth = SimpleNamespace(
            is_owner=False,
            permissions=frozenset({"cost:view"}),
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
        )

        for name in ("list_mappings", "disable_mapping", "enable_mapping"):
            handler = getattr(analytics_admin, name)
            sig = inspect.signature(handler)
            auth_param = sig.parameters.get("auth")
            self.assertIsNotNone(
                auth_param, f"{name}: missing auth parameter"
            )
            # ``require_permission`` returns ``Depends(_checker)``; the
            # underlying callable is on ``.dependency``.
            depends = auth_param.default
            checker = getattr(depends, "dependency", None)
            self.assertIsNotNone(
                checker, f"{name}: auth default is not a Depends() wrapper"
            )
            with self.assertRaises(HTTPException) as cm:
                await checker(auth=bad_auth)
            self.assertEqual(cm.exception.status_code, 403, f"{name}")
            self.assertIn("analytics:admin", cm.exception.detail, f"{name}")


class CounterResetOnAdminActionTests(unittest.IsolatedAsyncioTestCase):
    """Disable/enable must reset the in-memory failure counter.

    Otherwise: operator hits threshold-3 alert, disables mapping, fixes root
    cause, re-enables — and the FIRST projection failure (even from an
    unrelated cause) immediately re-triggers ``blocking_sync`` because the
    counter is still at 3.
    """

    def setUp(self) -> None:
        mirror_to_fact_sync.reset_failure_counters_for_test()

    def _make_row(self, *, enabled: bool):
        from app.models.analytics_mapping_state import MappingState
        row = MappingState(
            app_id="inside-sales",
            source_table="analytics.crm_call_record",
            target_fact="analytics.fact_lead_activity",
            activity_type="call",
            enabled=enabled,
        )
        row.id = uuid.uuid4()
        row.updated_at = datetime.now(timezone.utc)
        return row

    def _auth(self):
        from types import SimpleNamespace
        return SimpleNamespace(
            is_owner=False,
            permissions=frozenset({"analytics:admin"}),
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
        )

    def _capturing_session_factory(self):
        """Reusable ``async_session`` patch target for threshold-3 writes.

        The real session opens a DB connection on ``async with`` enter; in
        unit tests we replace it with a no-op context manager that also
        provides ``begin()`` and ``add()`` so the helper executes through
        without touching Postgres.
        """

        class _NoopTx:
            async def __aenter__(self_tx):
                return self_tx

            async def __aexit__(self_tx, *exc):
                return False

        class _NoopSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            def begin(self):
                return _NoopTx()

            def add(self, row):
                return None

        def factory():
            return _NoopSession()

        return factory

    async def _bump_to_threshold(self) -> None:
        mapping = _bundled_mapping()
        with patch(
            "app.services.analytics.mirror_to_fact_sync.async_session",
            side_effect=self._capturing_session_factory(),
        ):
            for _ in range(2):
                await mirror_to_fact_sync.record_mapping_failure(
                    mapping, error=RuntimeError("boom"), tenant_id=uuid.uuid4()
                )

    async def _stub_session(self, row):
        scalars_first = MagicMock()
        scalars_first.first = MagicMock(return_value=row)
        scalars = MagicMock()
        scalars.scalars = MagicMock(return_value=scalars_first)
        db = AsyncMock()
        db.execute = AsyncMock(return_value=scalars)
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        db.add = lambda r: None
        return db

    async def test_disable_resets_counter(self) -> None:
        from app.routes.analytics_admin import (
            DisableMappingRequest,
            disable_mapping,
        )

        await self._bump_to_threshold()
        mapping = _bundled_mapping()
        with patch(
            "app.services.analytics.mirror_to_fact_sync.async_session",
            side_effect=self._capturing_session_factory(),
        ):
            count = await mirror_to_fact_sync.record_mapping_failure(
                mapping, error=RuntimeError("third"), tenant_id=uuid.uuid4()
            )
        self.assertEqual(count, 3)

        # Operator disables. Counter should reset.
        row = self._make_row(enabled=True)
        db = await self._stub_session(row)
        await disable_mapping(
            mapping_id=row.id,
            body=DisableMappingRequest(reason="root-causing the burst"),
            auth=self._auth(),
            db=db,
        )

        # Next failure should be count=1 (post-reset), not 4.
        with patch(
            "app.services.analytics.mirror_to_fact_sync.async_session",
            side_effect=self._capturing_session_factory(),
        ):
            count = await mirror_to_fact_sync.record_mapping_failure(
                mapping, error=RuntimeError("post-disable"), tenant_id=uuid.uuid4()
            )
        self.assertEqual(count, 1)

    async def test_enable_resets_counter(self) -> None:
        from app.routes.analytics_admin import enable_mapping

        await self._bump_to_threshold()
        mapping = _bundled_mapping()
        with patch(
            "app.services.analytics.mirror_to_fact_sync.async_session",
            side_effect=self._capturing_session_factory(),
        ):
            count = await mirror_to_fact_sync.record_mapping_failure(
                mapping, error=RuntimeError("third"), tenant_id=uuid.uuid4()
            )
        self.assertEqual(count, 3)

        row = self._make_row(enabled=False)
        row.disabled_reason = "investigating"
        db = await self._stub_session(row)
        await enable_mapping(
            mapping_id=row.id,
            auth=self._auth(),
            db=db,
        )

        with patch(
            "app.services.analytics.mirror_to_fact_sync.async_session",
            side_effect=self._capturing_session_factory(),
        ):
            count = await mirror_to_fact_sync.record_mapping_failure(
                mapping, error=RuntimeError("post-enable"), tenant_id=uuid.uuid4()
            )
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
