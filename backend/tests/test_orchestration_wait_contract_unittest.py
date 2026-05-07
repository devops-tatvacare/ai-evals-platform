"""Phase 11 — logic.wait contract tests."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

import app.services.orchestration.nodes  # noqa: F401 — register handlers
from app.services.orchestration.node_registry import resolve_handler
from app.services.orchestration.nodes.logic_wait import expected_output_ids_for_config


def _wait_config(**kwargs):
    handler = resolve_handler(workflow_type="*", node_type="logic.wait")
    return handler.config_schema(**kwargs)


def test_legacy_duration_only_coerces_to_duration_mode():
    cfg = _wait_config(duration_hours=4)
    assert cfg.mode == "duration"
    assert cfg.duration_hours == 4


def test_legacy_until_datetime_only_coerces_to_until_mode():
    cfg = _wait_config(until_datetime=datetime(2026, 5, 1, 12, tzinfo=timezone.utc))
    assert cfg.mode == "until_datetime"


def test_explicit_duration_mode():
    cfg = _wait_config(mode="duration", duration_hours=2.5)
    assert cfg.mode == "duration"
    assert cfg.duration_hours == 2.5


def test_explicit_event_mode_requires_correlation():
    with pytest.raises(Exception):
        _wait_config(mode="event", event_name="lead_replied")
    cfg = _wait_config(
        mode="event",
        event_name="lead_replied",
        correlation={"recipient_id_field": "lead_id"},
    )
    assert cfg.mode == "event"


def test_event_or_timeout_requires_timeout_hours():
    with pytest.raises(Exception):
        _wait_config(
            mode="event_or_timeout",
            event_name="lead_replied",
            correlation={"recipient_id_field": "lead_id"},
        )
    cfg = _wait_config(
        mode="event_or_timeout",
        event_name="lead_replied",
        correlation={"recipient_id_field": "lead_id"},
        timeout_hours=24,
    )
    assert cfg.timeout_hours == 24


def test_no_mode_and_no_legacy_fields_raises():
    with pytest.raises(Exception):
        _wait_config()


def test_expected_output_ids_per_mode():
    assert expected_output_ids_for_config({"mode": "duration", "duration_hours": 4}) == ["wakeup"]
    assert expected_output_ids_for_config({"mode": "until_datetime"}) == ["wakeup"]
    assert expected_output_ids_for_config({"mode": "event"}) == ["event"]
    assert expected_output_ids_for_config({"mode": "event_or_timeout"}) == ["event", "timeout"]
    # Legacy (no mode key) -> wakeup
    assert expected_output_ids_for_config({"duration_hours": 4}) == ["wakeup"]
    with pytest.raises(ValueError):
        expected_output_ids_for_config({"mode": "absurd"})
