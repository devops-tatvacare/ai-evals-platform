"""Tests for ConversationAgent widget capture, auto-confirm, and transcript shape."""

from __future__ import annotations

import asyncio
import unittest
from typing import List, Optional

from app.services.evaluators.conversation_agent import ConversationAgent
from app.services.evaluators.adversarial_config import AdversarialGoal
from app.services.evaluators.kaira_client import KairaStreamResponse
from app.services.evaluators.kaira_widget_grammar import KairaWidget
from app.services.evaluators.models import (
    AdversarialTestCase,
    KairaSessionState,
)


class _FakeLLM:
    """Returns a canned next-turn message regardless of prompt."""

    def __init__(self, replies: List[str]) -> None:
        self.replies = list(replies)
        self.call_count = 0

    def set_test_case_label(self, _label: Optional[str]) -> None:
        pass

    async def generate(self, prompt: str, system_prompt: str = "", thinking: str = "low") -> str:
        self.call_count += 1
        if not self.replies:
            return "ALL_GOALS_COMPLETE"
        return self.replies.pop(0)

    async def generate_json(self, **_kwargs):  # not used in this test (no tactics)
        return None

    def clone_for_thread(self, _label: str):
        return self


class _FakeKairaClient:
    """Records every call. Returns scripted KairaStreamResponse objects."""

    def __init__(self, scripted: List[KairaStreamResponse]) -> None:
        self.scripted = list(scripted)
        self.calls: List[dict] = []

    async def stream_message(self, query, user_id, session_state: KairaSessionState, test_case_label=None):
        self.calls.append({"kind": "stream", "query": query})
        # Mark session as established so subsequent turns send session_id
        session_state.new_session = False
        session_state.session_id = session_state.session_id or "sess_test"
        return self.scripted.pop(0)

    async def confirm_widget(self, widget: KairaWidget, user_id, session_state: KairaSessionState, test_case_label=None):
        self.calls.append({"kind": "confirm", "widget_kind": widget.kind, "data": widget.data})
        session_state.new_session = False
        session_state.session_id = session_state.session_id or "sess_test"
        return self.scripted.pop(0)


def _resp(full_message: str = "", widget: Optional[KairaWidget] = None) -> KairaStreamResponse:
    r = KairaStreamResponse(
        full_message=full_message,
        session_id="sess_test",
        classification={"intent": "food_logging", "agent": "FoodLoggingAgent", "confidence": 0.9, "session_id": "sess_test"},
        widget=widget,
        saw_done=True,
        stream_completed=True,
    )
    if widget:
        r.saw_widget = True
    return r


class TestFoodCardAutoConfirm(unittest.IsolatedAsyncioTestCase):
    async def test_food_card_single_auto_confirm(self) -> None:
        food_card = {"items": [{"name": "apple", "qty": "1 piece"}], "consumed_at": "x", "consumed_label": "y"}
        widget = KairaWidget(kind="food_card", data=food_card, raw_chunk_type="food_card")

        client = _FakeKairaClient([
            _resp(full_message="Here's the breakdown for your apple.", widget=widget),
            _resp(full_message="Logged successfully!"),
        ])
        llm = _FakeLLM(["GOAL_COMPLETE:meal_logged"])
        goal = AdversarialGoal(
            id="meal_logged", label="Meal logged", description="user logs a meal",
            completion_criteria=["meal logged"], not_completion=[], agent_behavior="describe a meal",
            signal_patterns=["logged"],
        )
        case = AdversarialTestCase(
            synthetic_input="I had an apple",
            expected_behavior="logs the meal",
            difficulty="EASY",
            persona_labels=["easy"],
            goal_flow=["meal_logged"],
        )

        agent = ConversationAgent(llm_provider=llm, max_turns=5)  # type: ignore[arg-type]
        transcript = await agent.run_conversation(
            test_case=case, goals=[goal], client=client,  # type: ignore[arg-type]
            user_id="user-test", turn_delay=0.0, thinking="low",
        )

        # Two turns: free-text, then auto-confirm
        self.assertEqual(len(transcript.turns), 2)

        t1 = transcript.turns[0]
        self.assertEqual(t1.user_message, "I had an apple")
        self.assertIsNotNone(t1.assistant_widget)
        self.assertEqual(t1.assistant_widget["kind"], "food_card")  # type: ignore[index]
        self.assertIsNone(t1.user_action)  # first turn was typed, not action

        t2 = transcript.turns[1]
        self.assertEqual(t2.user_message, "Yes log this meal")  # button label, not "Log meal"
        self.assertIsNotNone(t2.user_action)
        self.assertEqual(t2.user_action["kind"], "food_card")  # type: ignore[index]
        self.assertEqual(t2.user_action["label"], "Yes log this meal")  # type: ignore[index]
        self.assertEqual(t2.user_action["wire"], f"update_meal & log_meal - [{__import__('json').dumps(food_card)}]")  # type: ignore[index]

        # Persona LLM should have been skipped on the food-card turn
        # (one call for the post-confirm decision, not for the confirm itself).
        self.assertEqual(llm.call_count, 1)

        # Calls hit the right method: stream first, then confirm
        self.assertEqual(client.calls[0]["kind"], "stream")
        self.assertEqual(client.calls[1]["kind"], "confirm")
        self.assertEqual(client.calls[1]["widget_kind"], "food_card")


class TestBPCardAutoConfirm(unittest.IsolatedAsyncioTestCase):
    async def test_bp_card_uses_button_text(self) -> None:
        widget = KairaWidget(kind="bp_card", data={"systolic": 125, "diastolic": 80}, raw_chunk_type="bp_card")
        client = _FakeKairaClient([
            _resp(full_message="Here's your BP reading.", widget=widget),
            _resp(full_message="Logged successfully!"),
        ])
        llm = _FakeLLM(["GOAL_COMPLETE:bp_logged"])
        goal = AdversarialGoal(
            id="bp_logged", label="BP logged", description="user logs BP",
            completion_criteria=["bp logged"], not_completion=[], agent_behavior="ask for bp",
            signal_patterns=["logged"],
        )
        case = AdversarialTestCase(
            synthetic_input="my bp is 125 over 80",
            expected_behavior="logs the BP",
            difficulty="EASY",
            persona_labels=["easy"],
            goal_flow=["bp_logged"],
        )
        agent = ConversationAgent(llm_provider=llm, max_turns=5)  # type: ignore[arg-type]
        transcript = await agent.run_conversation(
            test_case=case, goals=[goal], client=client,  # type: ignore[arg-type]
            user_id="user-test", turn_delay=0.0, thinking="low",
        )
        # Wire on confirm turn must be the literal button text, NOT the meal action grammar
        confirm_call = next(c for c in client.calls if c["kind"] == "confirm")
        self.assertEqual(confirm_call["widget_kind"], "bp_card")
        # User-side action has the polished label
        t2 = transcript.turns[1]
        self.assertEqual(t2.user_action["label"], "Yes log this BP reading")  # type: ignore[index]
        self.assertEqual(t2.user_action["wire"], "yes log this bp reading")  # type: ignore[index]


class TestUnknownWidgetForwardCompat(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_widget_does_not_auto_confirm(self) -> None:
        # Future widget kind we don't recognize
        widget = KairaWidget(kind="medication_card", data={"drug": "metformin"}, raw_chunk_type="medication_card", is_known=False)
        client = _FakeKairaClient([
            _resp(full_message="Take this medication.", widget=widget),
            _resp(full_message="ok thanks for the info"),  # next persona-driven turn
        ])
        llm = _FakeLLM(["thanks!", "GOAL_COMPLETE:meal_logged"])
        goal = AdversarialGoal(
            id="meal_logged", label="Meal logged", description="user logs a meal",
            completion_criteria=["meal logged"], not_completion=[], agent_behavior="ok",
            signal_patterns=[],
        )
        case = AdversarialTestCase(
            synthetic_input="hello",
            expected_behavior="x",
            difficulty="EASY",
            persona_labels=["easy"],
            goal_flow=["meal_logged"],
        )
        agent = ConversationAgent(llm_provider=llm, max_turns=5)  # type: ignore[arg-type]
        transcript = await agent.run_conversation(
            test_case=case, goals=[goal], client=client,  # type: ignore[arg-type]
            user_id="user-test", turn_delay=0.0, thinking="low",
        )

        # Assistant turn should record the unknown widget (forensics)
        t1 = transcript.turns[0]
        self.assertIsNotNone(t1.assistant_widget)
        self.assertEqual(t1.assistant_widget["kind"], "medication_card")  # type: ignore[index]
        self.assertFalse(t1.assistant_widget["is_known"])  # type: ignore[index]

        # No confirm_widget call should have happened — only stream calls
        confirm_calls = [c for c in client.calls if c["kind"] == "confirm"]
        self.assertEqual(confirm_calls, [])


class TestTranscriptText(unittest.TestCase):
    def test_to_text_marks_widgets_and_actions(self) -> None:
        from app.services.evaluators.models import (
            ConversationTranscript, ConversationTurn,
        )
        transcript = ConversationTranscript()
        transcript.add_turn(ConversationTurn(
            turn_number=1, user_message="I had idli",
            bot_response="Here's the breakdown.",
            assistant_widget={"kind": "food_card", "data": {}, "is_known": True},
        ))
        transcript.add_turn(ConversationTurn(
            turn_number=2, user_message="Yes log this meal",
            bot_response="Logged!",
            user_action={"kind": "food_card", "label": "Yes log this meal", "wire": "update_meal & log_meal - [...]"},
        ))
        text = transcript.to_text()
        self.assertIn("[WIDGET: food_card]", text)
        self.assertIn("[ACTION: Yes log this meal", text)
        self.assertIn("(kind=food_card)", text)


if __name__ == "__main__":
    unittest.main()
