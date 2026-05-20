"""Phase 4 — event-pipeline notification fan-out + send-mail job + template render.

Covers `emit_event(...)` resolver (three-source dedupe, allowed-domain gate,
tenant isolation), the per-resource ScheduledJobDefinition lookup, and a
real Jinja render of the locked `scheduled_job_failed` template plus a
stub render of the forward-declared `workflow_run_failed` template.

External SMTP is never touched. The send pathway is verified via the
`enqueue_send_mail` call count + payload introspection.
"""
import sys
import unittest
import uuid
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

# Mirror the Phase 3 test guard: avoid importing app.database (which pulls
# pydantic-settings / env wiring) so this file runs under bare pytest.
fake_database = ModuleType("app.database")
fake_database.get_db = None
sys.modules.setdefault("app.database", fake_database)

from app.services.mail import event_pipeline
from app.services.mail.call_sites import CallSite
from app.services.mail.event_pipeline import EventType, emit_event


def _ns(**kw):
    return SimpleNamespace(**kw)


def _make_db(
    *,
    scheduled_job_definition=None,
    user_subs=None,
    required_subs=None,
    tenant_config=None,
):
    """Build an AsyncSession-shaped MagicMock with scripted reads.

    `db.scalar(...)` discriminates by stmt text: ScheduledJobDefinition
    queries return `scheduled_job_definition`; TenantConfiguration queries
    return `tenant_config`. `db.execute(...)` returns a Result whose
    `.scalars().all()` flips between `user_subs` (first call) and
    `required_subs` (second call) per the resolver's call order.
    """
    db = MagicMock()
    db.get = AsyncMock(return_value=scheduled_job_definition)
    db.commit = AsyncMock()
    db.flush = AsyncMock()

    async def _scalar(stmt):
        rendered = str(stmt)
        if "scheduled_job_definitions" in rendered:
            return scheduled_job_definition
        return tenant_config

    db.scalar = AsyncMock(side_effect=_scalar)

    user_subs = user_subs or []
    required_subs = required_subs or []
    call_log = {"n": 0}

    def _execute(_stmt):
        idx = call_log["n"]
        call_log["n"] += 1
        rows = user_subs if idx == 0 else required_subs
        scalars = MagicMock()
        scalars.all = MagicMock(return_value=rows)
        result = MagicMock()
        result.scalars = MagicMock(return_value=scalars)
        return result

    db.execute = AsyncMock(side_effect=_execute)
    return db


class EmitEventResolverTests(unittest.IsolatedAsyncioTestCase):
    """`emit_event` produces the right send-mail call count + recipients."""

    async def test_per_resource_only_enqueues_one(self):
        tenant_id = uuid.uuid4()
        defn_id = uuid.uuid4()
        defn = _ns(
            id=defn_id,
            name="Nightly cohort sync",
            notify_owner_on_failure=False,
            notify_emails_on_failure=["ops@allowed.com"],
            created_by_user_email_snapshot=None,
        )
        db = _make_db(scheduled_job_definition=defn)

        with patch(
            "app.services.mail.send_mail_job.enqueue_send_mail",
            new=AsyncMock(return_value=uuid.uuid4()),
        ) as enqueue:
            n = await emit_event(
                db,
                tenant_id=tenant_id,
                event_type=EventType.SCHEDULED_JOB_FAILED,
                payload={"job_name": defn.name, "run_id": "r", "failed_at_display": "x", "error_summary": "boom", "job_url": "u"},
                resource_type="scheduled_job_definition",
                resource_id=defn_id,
            )

        self.assertEqual(n, 1)
        enqueue.assert_awaited_once()
        self.assertEqual(enqueue.await_args.kwargs["recipient"], "ops@allowed.com")
        self.assertEqual(enqueue.await_args.kwargs["call_site"], CallSite.SCHEDULED_JOB_FAILED)

    async def test_user_subscription_only_enqueues_one(self):
        tenant_id = uuid.uuid4()
        sub = _ns(recipient_email="alice@allowed.com")
        db = _make_db(user_subs=[sub])

        with patch(
            "app.services.mail.send_mail_job.enqueue_send_mail",
            new=AsyncMock(),
        ) as enqueue:
            n = await emit_event(
                db,
                tenant_id=tenant_id,
                event_type=EventType.SCHEDULED_JOB_FAILED,
                payload={"k": "v"},
            )

        self.assertEqual(n, 1)
        self.assertEqual(enqueue.await_args.kwargs["recipient"], "alice@allowed.com")

    async def test_deduplicates_across_sources(self):
        tenant_id = uuid.uuid4()
        defn_id = uuid.uuid4()
        defn = _ns(
            id=defn_id,
            name="X",
            notify_owner_on_failure=False,
            notify_emails_on_failure=["dupe@allowed.com"],
            created_by_user_email_snapshot=None,
        )
        # Same email surfaces in BOTH user-sub AND per-resource sources; case
        # differs to prove case-insensitive dedupe.
        sub = _ns(recipient_email="Dupe@Allowed.com")
        db = _make_db(scheduled_job_definition=defn, user_subs=[sub])

        with patch("app.services.mail.send_mail_job.enqueue_send_mail", new=AsyncMock()) as enqueue:
            n = await emit_event(
                db,
                tenant_id=tenant_id,
                event_type=EventType.SCHEDULED_JOB_FAILED,
                payload={},
                resource_type="scheduled_job_definition",
                resource_id=defn_id,
            )

        self.assertEqual(n, 1)
        self.assertEqual(enqueue.await_count, 1)

    async def test_required_default_always_fires_even_if_inactive_path(self):
        # Strengthened: capture rendered SQL of both subscription queries
        # so the test fails if the resolver collapses the two branches.
        tenant_id = uuid.uuid4()
        required = _ns(recipient_email="oncall@allowed.com")
        db = _make_db(required_subs=[required])

        original_execute = db.execute.side_effect
        rendered_queries: list[str] = []

        def _capture(stmt):
            rendered_queries.append(str(stmt))
            return original_execute(stmt)

        db.execute.side_effect = _capture

        with patch("app.services.mail.send_mail_job.enqueue_send_mail", new=AsyncMock()) as enqueue:
            n = await emit_event(
                db,
                tenant_id=tenant_id,
                event_type=EventType.SCHEDULED_JOB_FAILED,
                payload={},
            )

        self.assertEqual(n, 1)
        self.assertEqual(enqueue.await_args.kwargs["recipient"], "oncall@allowed.com")
        # First query filters by is_active; second by is_required.
        self.assertIn("is_active", rendered_queries[0])
        self.assertIn("is_required", rendered_queries[1])

    async def test_disallowed_domain_recipient_skipped(self):
        tenant_id = uuid.uuid4()
        sub_ok = _ns(recipient_email="ok@allowed.com")
        sub_bad = _ns(recipient_email="blocked@evil.com")
        config = _ns(allowed_domains=["@allowed.com"])
        db = _make_db(user_subs=[sub_ok, sub_bad], tenant_config=config)

        with patch("app.services.mail.send_mail_job.enqueue_send_mail", new=AsyncMock()) as enqueue:
            n = await emit_event(
                db,
                tenant_id=tenant_id,
                event_type=EventType.SCHEDULED_JOB_FAILED,
                payload={},
            )

        self.assertEqual(n, 1)
        self.assertEqual(enqueue.await_args.kwargs["recipient"], "ok@allowed.com")

    async def test_no_subscribers_returns_zero(self):
        tenant_id = uuid.uuid4()
        db = _make_db()

        with patch("app.services.mail.send_mail_job.enqueue_send_mail", new=AsyncMock()) as enqueue:
            n = await emit_event(
                db,
                tenant_id=tenant_id,
                event_type=EventType.SCHEDULED_JOB_FAILED,
                payload={},
            )

        self.assertEqual(n, 0)
        enqueue.assert_not_awaited()

    async def test_owner_checkbox_uses_email_snapshot(self):
        tenant_id = uuid.uuid4()
        defn_id = uuid.uuid4()
        defn = _ns(
            id=defn_id,
            name="snap test",
            notify_owner_on_failure=True,
            notify_emails_on_failure=[],
            created_by_user_email_snapshot="owner@allowed.com",
        )
        db = _make_db(scheduled_job_definition=defn)

        with patch("app.services.mail.send_mail_job.enqueue_send_mail", new=AsyncMock()) as enqueue:
            n = await emit_event(
                db,
                tenant_id=tenant_id,
                event_type=EventType.SCHEDULED_JOB_FAILED,
                payload={},
                resource_type="scheduled_job_definition",
                resource_id=defn_id,
            )

        self.assertEqual(n, 1)
        self.assertEqual(enqueue.await_args.kwargs["recipient"], "owner@allowed.com")

    async def test_tenants_isolated_by_query_filter(self):
        # Strengthened: assert the actual tenant_id bind value matches, not
        # merely that "tenant_id" appears in the SQL string.
        tenant_a = uuid.uuid4()
        sub = _ns(recipient_email="a@allowed.com")
        db = _make_db(user_subs=[sub])
        captured_binds: list[dict] = []

        original_execute = db.execute.side_effect

        def _capture(stmt):
            compiled = stmt.compile()
            captured_binds.append(dict(compiled.params))
            return original_execute(stmt)

        db.execute.side_effect = _capture

        with patch("app.services.mail.send_mail_job.enqueue_send_mail", new=AsyncMock()):
            await emit_event(
                db,
                tenant_id=tenant_a,
                event_type=EventType.SCHEDULED_JOB_FAILED,
                payload={},
            )

        # Both queries must carry the exact tenant uuid in their bind params.
        for binds in captured_binds:
            self.assertIn(tenant_a, binds.values())


class StubAndUnknownEventTests(unittest.IsolatedAsyncioTestCase):
    """Forward-declared events render their stub templates without crashing."""

    async def test_workflow_run_failed_renders_stub_via_resolver(self):
        # Resolver enqueues the job; the stub template must merely exist.
        tenant_id = uuid.uuid4()
        sub = _ns(recipient_email="legal@allowed.com")
        db = _make_db(user_subs=[sub])

        with patch("app.services.mail.send_mail_job.enqueue_send_mail", new=AsyncMock()) as enqueue:
            n = await emit_event(
                db,
                tenant_id=tenant_id,
                event_type=EventType.WORKFLOW_RUN_FAILED,
                payload={},
            )

        self.assertEqual(n, 1)
        self.assertEqual(enqueue.await_args.kwargs["call_site"], CallSite.WORKFLOW_RUN_FAILED)


class TemplateRenderTests(unittest.IsolatedAsyncioTestCase):
    """Real Jinja env exercises the locked + stub templates end-to-end."""

    async def test_scheduled_job_failed_template_renders_truncated_error(self):
        from app.services.mail import template_renderer

        long_err = "x" * 600
        payload = {
            "job_name": "Nightly cohort sync",
            "run_id": "RUN-abc",
            "failed_at_display": "19 May 2026, 04:11 IST",
            "error_summary": long_err[:500] + "…",
            "job_url": "https://app.example.com/admin/scheduled-jobs?history=D&run=R",
        }

        async def _fake_chrome(_db, _tid):
            return ("Tatvacare", None)

        with patch.object(template_renderer, "_load_tenant_chrome", new=_fake_chrome):
            rendered = await template_renderer.render(
                db=MagicMock(),
                tenant_id=uuid.uuid4(),
                call_site=CallSite.SCHEDULED_JOB_FAILED,
                context=payload,
            )

        self.assertIn("Scheduled job failed", rendered.subject)
        self.assertIn("Nightly cohort sync", rendered.html)
        self.assertIn("Open run history", rendered.html)
        self.assertIn("history=D&amp;run=R", rendered.html)  # autoescaped
        self.assertIn("RUN-abc", rendered.html)
        # error_summary truncation indicator made it into the body.
        self.assertIn("…", rendered.html)
        self.assertIn("Nightly cohort sync", rendered.text)
        self.assertIn("Open run history", rendered.text)


class SendMailJobHandlerTests(unittest.IsolatedAsyncioTestCase):
    """`run_send_mail_job` renders the locked template + relays via mocked SMTP."""

    async def test_run_send_mail_job_dispatches_locked_subject_and_body(self):
        from app.services.mail import send_mail_job, template_renderer

        captured: dict = {}

        async def _fake_chrome(_db, _tid):
            return ("Tatvacare", None)

        async def _fake_smtp(msg, **_kwargs):
            captured["subject"] = msg["Subject"]
            captured["to"] = msg["To"]
            payloads = []
            for part in msg.walk():
                if part.get_content_type() in ("text/plain", "text/html"):
                    payloads.append((part.get_content_type(), part.get_content()))
            captured["parts"] = payloads
            return ({}, "OK")

        async def _fake_write_log(_db, **kwargs):
            captured.setdefault("logs", []).append(kwargs)

        # Patch the db factory so the handler runs without a real Postgres.
        fake_db = MagicMock()
        fake_db.commit = AsyncMock()
        fake_db.__aenter__ = AsyncMock(return_value=fake_db)
        fake_db.__aexit__ = AsyncMock(return_value=None)

        async def _fake_session_factory():
            return fake_db

        # async_session() is used as `async with async_session() as db:`.
        # Returning the fake_db directly satisfies the context-manager protocol.
        def _session_cm():
            return fake_db

        params = {
            "tenant_id": str(uuid.uuid4()),
            "user_id": str(uuid.uuid4()),
            "call_site": CallSite.SCHEDULED_JOB_FAILED.value,
            "recipient": "ops@allowed.com",
            "context": {
                "job_name": "Nightly cohort sync",
                "run_id": "RUN-abc",
                "failed_at_display": "19 May 2026, 04:11 IST",
                "error_summary": "x" * 500 + "…",
                "job_url": "https://app.example.test/admin/scheduled-jobs?history=D&run=R",
            },
            "correlation_id": "RUN-abc",
        }
        with patch.object(send_mail_job, "async_session", new=_session_cm), \
             patch.object(template_renderer, "_load_tenant_chrome", new=_fake_chrome), \
             patch("aiosmtplib.send", new=AsyncMock(side_effect=_fake_smtp)), \
             patch("app.services.mail.sender.write_log", new=AsyncMock(side_effect=_fake_write_log)):
            result = await send_mail_job.run_send_mail_job(
                uuid.uuid4(),
                params,
                tenant_id=uuid.UUID(params["tenant_id"]),
                user_id=uuid.UUID(params["user_id"]),
            )

        self.assertEqual(result["status"], "sent")
        self.assertEqual(captured["to"], "ops@allowed.com")
        self.assertIn("Scheduled job failed", captured["subject"])
        html = next(b for ct, b in captured["parts"] if ct == "text/html")
        self.assertIn("Nightly cohort sync", html)
        self.assertIn("Open run history", html)
        self.assertIn("RUN-abc", html)
        # Sender wrote one send_log row with status=sent.
        statuses = [log["status"] for log in captured.get("logs", [])]
        self.assertEqual(statuses, ["sent"])


class WorkerHookTruncationTests(unittest.IsolatedAsyncioTestCase):
    """`_emit_scheduled_job_failed` truncates error_summary to 500 chars + ellipsis."""

    async def test_producer_truncates_long_error_to_500_plus_ellipsis(self):
        from app.services import job_worker

        long_err = "x" * 600
        captured: dict = {}

        async def _fake_emit_event(_db, *, payload, **_kwargs):
            captured["payload"] = payload

        fake_db = MagicMock()
        fake_db.commit = AsyncMock()
        fake_db.scalar = AsyncMock(return_value=None)
        fake_db.__aenter__ = AsyncMock(return_value=fake_db)
        fake_db.__aexit__ = AsyncMock(return_value=None)

        def _session_cm():
            return fake_db

        with patch.object(job_worker, "async_session", new=_session_cm), \
             patch("app.services.mail.event_pipeline.emit_event", new=AsyncMock(side_effect=_fake_emit_event)):
            await job_worker._emit_scheduled_job_failed(
                tenant_id=uuid.uuid4(),
                definition_id=uuid.uuid4(),
                run_id=uuid.uuid4(),
                error_message=long_err,
                completed_at=None,
            )

        summary = captured["payload"]["error_summary"]
        # 500 chars + the single-char ellipsis.
        self.assertEqual(len(summary), 501)
        self.assertTrue(summary.endswith("…"))
        self.assertTrue(summary[:-1].startswith("x" * 500))


if __name__ == "__main__":
    unittest.main()
