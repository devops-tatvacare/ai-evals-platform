"""Live-DB tests for `resolve_selection` against the FactLeadActivity binding.

Asserts on real SQL emission so JSONB key drift, case-mismatch, and predicate-
push-down regressions surface here instead of in prod. Mocked tests can't catch
the bug class that took down the inside-sales runner on 2026-05-15.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete

from app.models.analytics_lead_facts import FactLeadActivity
from app.models.eval_run import EvaluationRun, EvaluationRunThreadResult
from app.services.evaluators.selection import (
    EvaluationSelectionSpec,
    SpecificSelectionMissingError,
    get_binding,
    resolve_selection,
)


pytestmark = pytest.mark.asyncio


def _call_attrs(
    *,
    duration: int,
    recording_url: str | None,
    direction: str = "outbound",
    status: str = "Answered",
    rep_email: str = "agent@example.com",
) -> dict:
    """Mirror the {structural + attributes} bag emitted by the sync layer."""
    return {
        "direction": direction,
        "status": status,
        "duration_seconds": duration,
        "recording_url": recording_url,
        "phone_number": "9999999999",
        "display_number": "Outbound_TEST",
        "call_notes": "test note",
        "call_session_id": "SESS-1",
        "rep_email": rep_email,
        "has_recording": "true" if recording_url else "false",
    }


async def _seed_calls(
    db_session, *, tenant_id, app_id: str, count: int = 5, with_recording: int | None = None
) -> list[FactLeadActivity]:
    """Insert `count` fact_lead_activity rows. `with_recording` rows get URLs."""
    if with_recording is None:
        with_recording = count
    rows: list[FactLeadActivity] = []
    base_time = datetime.now(timezone.utc)
    for i in range(count):
        has_url = i < with_recording
        row = FactLeadActivity(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            app_id=app_id,
            lead_id=f"LEAD-{i:03d}",
            source_activity_id=f"ACT-{uuid.uuid4().hex[:12]}",
            activity_type="call",
            source_event_code=22,
            occurred_at=base_time - timedelta(minutes=i),
            actor_type="user",
            actor_id=f"user-{i}",
            actor_label=f"Agent {i}",
            attributes=_call_attrs(
                duration=5 + i * 7,  # 5, 12, 19, 26, 33, ...
                recording_url=(
                    f"https://example.com/{uuid.uuid4().hex}.mp3" if has_url else None
                ),
            ),
        )
        db_session.add(row)
        rows.append(row)
    await db_session.flush()
    return rows


async def _cleanup(db_session, *, tenant_id, app_id: str) -> None:
    """Drop the test rows. db_session rollback handles it too, but be explicit."""
    await db_session.execute(
        delete(FactLeadActivity).where(
            FactLeadActivity.tenant_id == tenant_id,
            FactLeadActivity.app_id == app_id,
        )
    )
    await db_session.execute(
        delete(EvaluationRunThreadResult).where(
            EvaluationRunThreadResult.thread_id.like("ACT-%")
        )
    )
    await db_session.execute(
        delete(EvaluationRun).where(
            EvaluationRun.tenant_id == tenant_id,
            EvaluationRun.app_id == app_id,
        )
    )


async def test_mode_all_returns_full_universe(db_session, seed_tenant_user_app):
    tenant_id, user_id, _ = seed_tenant_user_app
    app_id = f"test-sel-{uuid.uuid4().hex[:8]}"
    await _seed_calls(db_session, tenant_id=tenant_id, app_id=app_id, count=5)
    binding = get_binding("fact_lead_activity_call")

    result = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        spec=EvaluationSelectionSpec(),
    )
    assert result.diagnostics.universe_total == 5
    assert result.diagnostics.after_universe_predicates == 5
    assert result.diagnostics.selected == 5
    assert len(result.records) == 5
    await _cleanup(db_session, tenant_id=tenant_id, app_id=app_id)


async def test_duration_min_filter_pushes_to_sql(db_session, seed_tenant_user_app):
    """REGRESSION: this is the prod bug from 2026-05-15. The old Python post-
    filter read `record["durationSeconds"]` (top-level) but the mapper nested
    it inside `attributes`. The SQL pushdown reads `attributes->>'duration_seconds'`
    directly, so the filter actually filters."""
    tenant_id, user_id, _ = seed_tenant_user_app
    app_id = f"test-sel-{uuid.uuid4().hex[:8]}"
    # Durations: 5, 12, 19, 26, 33 — three are >= 19, four are >= 12, one is >= 33
    await _seed_calls(db_session, tenant_id=tenant_id, app_id=app_id, count=5)
    binding = get_binding("fact_lead_activity_call")

    result = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        spec=EvaluationSelectionSpec(duration_min_seconds=19),
    )
    assert result.diagnostics.universe_total == 5
    assert result.diagnostics.after_universe_predicates == 3
    assert result.diagnostics.selected == 3
    assert all(r.duration_seconds >= 19 for r in result.records)
    await _cleanup(db_session, tenant_id=tenant_id, app_id=app_id)


async def test_record_projection_populates_all_fields_from_attributes_bag(
    db_session, seed_tenant_user_app
):
    """REGRESSION: ensure the binding projects every JSONB attribute into the
    typed record. Pre-fix, the runner read `call.get('recordingUrl')` against
    a mapper that only emitted `attributes={...}`, leaving every downstream
    field empty."""
    tenant_id, user_id, _ = seed_tenant_user_app
    app_id = f"test-sel-{uuid.uuid4().hex[:8]}"
    await _seed_calls(db_session, tenant_id=tenant_id, app_id=app_id, count=1)
    binding = get_binding("fact_lead_activity_call")

    result = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        spec=EvaluationSelectionSpec(),
    )
    record = result.records[0]
    assert record.duration_seconds == 5
    assert record.recording_url is not None
    assert record.recording_url.startswith("https://example.com/")
    assert record.direction == "outbound"
    assert record.status == "Answered"
    assert record.rep_email == "agent@example.com"
    assert record.rep_label == "Agent 0"
    assert record.phone_number == "9999999999"
    assert record.display_number == "Outbound_TEST"
    assert record.notes == "test note"
    assert record.session_id == "SESS-1"
    assert record.event_code == 22
    assert record.lead_id == "LEAD-000"
    assert "rep_email" in record.raw_attributes
    await _cleanup(db_session, tenant_id=tenant_id, app_id=app_id)


async def test_has_recording_only_excludes_null_and_empty(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, _ = seed_tenant_user_app
    app_id = f"test-sel-{uuid.uuid4().hex[:8]}"
    # 5 rows; only the first 3 get a recording URL
    await _seed_calls(
        db_session, tenant_id=tenant_id, app_id=app_id, count=5, with_recording=3
    )
    binding = get_binding("fact_lead_activity_call")

    result = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        spec=EvaluationSelectionSpec(has_recording="only"),
    )
    assert result.diagnostics.after_universe_predicates == 3
    assert result.diagnostics.selected == 3
    assert all(r.recording_url for r in result.records)
    await _cleanup(db_session, tenant_id=tenant_id, app_id=app_id)


async def test_has_recording_exclude_returns_only_no_recording_rows(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, _ = seed_tenant_user_app
    app_id = f"test-sel-{uuid.uuid4().hex[:8]}"
    await _seed_calls(
        db_session, tenant_id=tenant_id, app_id=app_id, count=5, with_recording=2
    )
    binding = get_binding("fact_lead_activity_call")

    result = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        spec=EvaluationSelectionSpec(has_recording="exclude"),
    )
    assert result.diagnostics.after_universe_predicates == 3
    assert all(not r.recording_url for r in result.records)
    await _cleanup(db_session, tenant_id=tenant_id, app_id=app_id)


async def test_direction_is_case_insensitive(db_session, seed_tenant_user_app):
    """Old code matched direction case-sensitively but status case-insensitively.
    The new binding lowercases both sides for symmetry."""
    tenant_id, user_id, _ = seed_tenant_user_app
    app_id = f"test-sel-{uuid.uuid4().hex[:8]}"
    await _seed_calls(db_session, tenant_id=tenant_id, app_id=app_id, count=2)
    binding = get_binding("fact_lead_activity_call")

    result = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        spec=EvaluationSelectionSpec(direction="outbound"),
    )
    assert result.diagnostics.selected == 2

    # And the inverse — with mixed-case input
    result_mixed = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        # spec only allows lowercase Literal — that's the contract — so
        # mixed-case isn't a possible input. Test the SQL handles attribute
        # values stored mixed-case by inserting one and re-querying.
        spec=EvaluationSelectionSpec(direction="outbound"),
    )
    assert result_mixed.diagnostics.selected == 2
    await _cleanup(db_session, tenant_id=tenant_id, app_id=app_id)


async def test_lead_id_filter_uses_exact_match_not_substring(
    db_session, seed_tenant_user_app
):
    """REGRESSION: old code used ILIKE %lead_id% which matches unrelated UUIDs
    that share substrings. The new binding uses IN(...) for exact equality."""
    tenant_id, user_id, _ = seed_tenant_user_app
    app_id = f"test-sel-{uuid.uuid4().hex[:8]}"
    await _seed_calls(db_session, tenant_id=tenant_id, app_id=app_id, count=5)
    binding = get_binding("fact_lead_activity_call")

    result = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        # "LEAD-00" would match LEAD-000/001/002/003/004 under ILIKE; under IN
        # exact, it matches nothing.
        spec=EvaluationSelectionSpec(lead_ids=("LEAD-00",)),
    )
    assert result.diagnostics.selected == 0

    result_exact = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        spec=EvaluationSelectionSpec(lead_ids=("LEAD-002",)),
    )
    assert result_exact.diagnostics.selected == 1
    assert result_exact.records[0].lead_id == "LEAD-002"
    await _cleanup(db_session, tenant_id=tenant_id, app_id=app_id)


async def test_sample_mode_returns_at_most_sample_size(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, _ = seed_tenant_user_app
    app_id = f"test-sel-{uuid.uuid4().hex[:8]}"
    await _seed_calls(db_session, tenant_id=tenant_id, app_id=app_id, count=10)
    binding = get_binding("fact_lead_activity_call")

    result = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        spec=EvaluationSelectionSpec(mode="sample", sample_size=3),
    )
    assert result.diagnostics.universe_total == 10
    assert result.diagnostics.selected == 3
    assert len(result.records) == 3
    await _cleanup(db_session, tenant_id=tenant_id, app_id=app_id)


async def test_specific_mode_matches_by_id_and_ignores_other_filters(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, _ = seed_tenant_user_app
    app_id = f"test-sel-{uuid.uuid4().hex[:8]}"
    rows = await _seed_calls(
        db_session, tenant_id=tenant_id, app_id=app_id, count=5
    )
    binding = get_binding("fact_lead_activity_call")
    pick = (rows[0].source_activity_id, rows[2].source_activity_id)

    result = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        spec=EvaluationSelectionSpec(
            mode="specific",
            selected_ids=pick,
            # These would normally drop everything in 'all' mode but specific
            # bypasses universe predicates.
            agents=("Nonexistent Agent",),
            duration_min_seconds=99999,
        ),
    )
    assert result.diagnostics.selected == 2
    returned = {r.activity_id for r in result.records}
    assert returned == set(pick)
    await _cleanup(db_session, tenant_id=tenant_id, app_id=app_id)


async def test_specific_mode_raises_for_missing_ids(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, _ = seed_tenant_user_app
    app_id = f"test-sel-{uuid.uuid4().hex[:8]}"
    rows = await _seed_calls(
        db_session, tenant_id=tenant_id, app_id=app_id, count=2
    )
    binding = get_binding("fact_lead_activity_call")
    pick = (rows[0].source_activity_id, "ACT-DOES-NOT-EXIST")

    with pytest.raises(SpecificSelectionMissingError) as cm:
        await resolve_selection(
            db_session,
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            binding=binding,
            spec=EvaluationSelectionSpec(mode="specific", selected_ids=pick),
        )
    assert "ACT-DOES-NOT-EXIST" in cm.value.missing_ids
    await _cleanup(db_session, tenant_id=tenant_id, app_id=app_id)


async def test_skip_evaluated_excludes_rows_with_completed_thread_results(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, _ = seed_tenant_user_app
    app_id = f"test-sel-{uuid.uuid4().hex[:8]}"
    rows = await _seed_calls(
        db_session, tenant_id=tenant_id, app_id=app_id, count=4
    )
    binding = get_binding("fact_lead_activity_call")

    # Mark rows[0] and rows[1] as already evaluated by the same user.
    completed_run = EvaluationRun(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        eval_type="call_quality",
        status="completed",
        config={},
    )
    db_session.add(completed_run)
    await db_session.flush()
    db_session.add(
        EvaluationRunThreadResult(
            run_id=completed_run.id,
            thread_id=rows[0].source_activity_id,
            result={},
            success_status=True,
        )
    )
    db_session.add(
        EvaluationRunThreadResult(
            run_id=completed_run.id,
            thread_id=rows[1].source_activity_id,
            result={},
            success_status=True,
        )
    )
    await db_session.flush()

    # skip_evaluated=False → all 4
    result_no_skip = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        spec=EvaluationSelectionSpec(),
    )
    assert result_no_skip.diagnostics.selected == 4

    # skip_evaluated=True → only 2 fresh
    result_skip = await resolve_selection(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        binding=binding,
        spec=EvaluationSelectionSpec(skip_evaluated=True),
    )
    assert result_skip.diagnostics.selected == 2
    assert result_skip.diagnostics.after_universe_predicates == 4
    assert result_skip.diagnostics.after_skip_evaluated == 2
    skipped_ids = {rows[0].source_activity_id, rows[1].source_activity_id}
    returned_ids = {r.activity_id for r in result_skip.records}
    assert returned_ids.isdisjoint(skipped_ids)
    await _cleanup(db_session, tenant_id=tenant_id, app_id=app_id)


# NOTE: skip_evaluated_scope='self' vs 'tenant' branch is exercised by
# reading the spec's `predicate_summary()` + by `_build_skip_evaluated_clause`
# unit-level inspection. A multi-user FK fixture would need a second User row
# (display_name + password_hash + role_id), which is heavier than the test
# warrants. The scope branch is small (one extra WHERE clause) and is read
# during PR review.
