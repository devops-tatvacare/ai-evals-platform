"""Unit tests pinning Kaira widget grammar wire formats and chunk dispatch.

These tests are the canonical guard against accidental drift from the upstream
contract documented at docs/investigations/kaira-widget-payload-handling.md and
the registry source at backend/app/services/evaluators/kaira_widget_grammar.py.

If a wire string changes upstream, this test file changes here AND its TS
mirror at src/__tests__/services/kaira/widgetGrammar.test.ts in the same commit.
"""

from __future__ import annotations

import json
import unittest

from app.services.evaluators.kaira_widget_grammar import (
    KairaWidget,
    WIDGET_REGISTRY,
    all_sentinel_markers,
    confirm_message_for,
    is_known_kind,
    widget_from_chunk,
)


class TestRegistryShape(unittest.TestCase):
    def test_known_kinds(self) -> None:
        self.assertEqual(
            set(WIDGET_REGISTRY.keys()),
            {"food_card", "food_card_batch", "bp_card", "vitals_card"},
        )

    def test_food_card_batch_is_derived(self) -> None:
        self.assertEqual(WIDGET_REGISTRY["food_card_batch"].chunk_types, ())
        self.assertEqual(WIDGET_REGISTRY["food_card_batch"].is_batch_of, "food_card")


class TestWidgetFromChunk(unittest.TestCase):
    def test_food_card_single(self) -> None:
        chunk = {"type": "food_card", "data": {"items": [{"name": "apple"}], "consumed_at": "x", "consumed_label": "y"}}
        w = widget_from_chunk(chunk)
        self.assertIsNotNone(w)
        assert w is not None  # for type-checker
        self.assertEqual(w.kind, "food_card")
        self.assertTrue(w.is_known)

    def test_food_card_batch_promotion(self) -> None:
        chunk = {
            "type": "food_card",
            "data": {"isBatch": True, "sessions": [{"items": [], "consumed_at": "", "consumed_label": ""}]},
        }
        w = widget_from_chunk(chunk)
        assert w is not None
        self.assertEqual(w.kind, "food_card_batch")
        self.assertEqual(w.raw_chunk_type, "food_card")

    def test_bp_card(self) -> None:
        w = widget_from_chunk({"type": "bp_card", "data": {"systolic": 120, "diastolic": 80}})
        assert w is not None
        self.assertEqual(w.kind, "bp_card")

    def test_vitals_card(self) -> None:
        w = widget_from_chunk({"type": "vitals_card", "data": {"weight_kg": 70}})
        assert w is not None
        self.assertEqual(w.kind, "vitals_card")

    def test_control_chunks_return_none(self) -> None:
        for t in ("classification", "token", "done", "error"):
            self.assertIsNone(widget_from_chunk({"type": t}))

    def test_unknown_chunk_forward_compat(self) -> None:
        w = widget_from_chunk({"type": "medication_card", "data": {"drug": "metformin"}})
        assert w is not None
        self.assertEqual(w.kind, "medication_card")
        self.assertFalse(w.is_known)


class TestConfirmMessageWireFormat(unittest.TestCase):
    """Pin the exact bytes that go on the wire — drift will break upstream."""

    def test_food_card_single_wire(self) -> None:
        data = {"items": [{"name": "apple", "qty": "1 piece"}], "consumed_at": "2026-05-08T11:00:00", "consumed_label": "Today"}
        widget = KairaWidget(kind="food_card", data=data, raw_chunk_type="food_card")
        wire, descriptor = confirm_message_for(widget)
        # Must be the upstream-accepted action-log grammar wrapping the food_card in a list
        self.assertEqual(wire, f"update_meal & log_meal - {json.dumps([data])}")
        self.assertEqual(descriptor["label"], "Yes log this meal")
        self.assertEqual(descriptor["verbs"], ["update_meal", "log_meal"])

    def test_food_card_batch_wire_unwraps_sessions(self) -> None:
        sessions = [
            {"items": [{"name": "idli"}], "consumed_at": "2026-05-08T08:00:00", "consumed_label": "Today · Breakfast"},
            {"items": [{"name": "dal"}], "consumed_at": "2026-05-08T13:30:00", "consumed_label": "Today · Lunch"},
        ]
        data = {"isBatch": True, "sessions": sessions}
        widget = KairaWidget(kind="food_card_batch", data=data, raw_chunk_type="food_card")
        wire, descriptor = confirm_message_for(widget)
        # Critical: batch wire must send the bare sessions list, not [{isBatch...}]
        self.assertEqual(wire, f"update_meal & log_meal - {json.dumps(sessions)}")
        self.assertNotIn("isBatch", wire)
        self.assertEqual(descriptor["label"], "Yes log all meals")

    def test_bp_card_wire_is_button_text(self) -> None:
        widget = KairaWidget(kind="bp_card", data={"systolic": 125, "diastolic": 80}, raw_chunk_type="bp_card")
        wire, descriptor = confirm_message_for(widget)
        self.assertEqual(wire, "yes log this bp reading")
        self.assertEqual(descriptor["label"], "Yes log this BP reading")
        self.assertNotIn("verbs", descriptor)  # literal-text confirms have no verbs

    def test_vitals_card_wire_is_button_text(self) -> None:
        widget = KairaWidget(kind="vitals_card", data={"weight_kg": 70}, raw_chunk_type="vitals_card")
        wire, descriptor = confirm_message_for(widget)
        self.assertEqual(wire, "yes, save these")
        self.assertEqual(descriptor["label"], "Yes, save these")

    def test_unknown_widget_raises(self) -> None:
        widget = KairaWidget(kind="medication_card", data={}, raw_chunk_type="medication_card", is_known=False)
        with self.assertRaises(ValueError):
            confirm_message_for(widget)


class TestSentinelMarkers(unittest.TestCase):
    def test_all_widget_markers_present(self) -> None:
        markers = all_sentinel_markers()
        widget_kinds = {m["kind"] for m in markers if m["is_widget"]}
        self.assertEqual(widget_kinds, {"food_card", "food_card_batch", "bp_card", "vitals_card"})

    def test_session_state_is_strip_only(self) -> None:
        markers = all_sentinel_markers()
        ss = [m for m in markers if m["open"] == "___SESSION_STATE___"]
        self.assertEqual(len(ss), 1)
        self.assertFalse(ss[0]["is_widget"])
        self.assertEqual(ss[0]["close"], "___END_SS___")


class TestIsKnownKind(unittest.TestCase):
    def test_known(self) -> None:
        for k in ("food_card", "food_card_batch", "bp_card", "vitals_card"):
            self.assertTrue(is_known_kind(k))

    def test_unknown(self) -> None:
        self.assertFalse(is_known_kind("medication_card"))
        self.assertFalse(is_known_kind(""))


if __name__ == "__main__":
    unittest.main()
