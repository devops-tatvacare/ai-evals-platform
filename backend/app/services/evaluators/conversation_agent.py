"""Conversation Agent — drives multi-turn conversations to goal completion (async).

Ported from kaira-evals/src/evaluators/conversation_agent.py.
"""
import asyncio
import logging
import re
from typing import Optional

from app.services.evaluators.llm_base import BaseLLMProvider
from app.services.evaluators.kaira_client import KairaClient, KairaStreamResponse
from app.services.evaluators.models import (
    AdversarialTestCase, ConversationTranscript, ConversationTurn,
    KairaSessionState,
)

logger = logging.getLogger(__name__)

AGENT_SYSTEM_PROMPT = """You are simulating a REAL user talking to a health-assistant chatbot.
Your job is to respond naturally and push the conversation toward the stated goal.

## Core rules
- Stay in character as the user described in the test case. Never break character.
- Be realistic: vary your phrasing, use casual language, make small typos occasionally.
- NEVER repeat the exact same message you already sent in this conversation.

## How to respond to common bot behaviors

**Bot asks for meal time:**
Provide a realistic, varied time. Examples: "around 9 in the morning", "lunch, maybe 1:30 pm".

**Bot asks for quantity/amount:**
Provide a quantity consistent with the original meal description.

**Bot shows a meal summary with calories:**
- If correct → confirm: "Yes, log it", "Looks good, save it"
- If wrong → point out the specific error

**Bot asks for yes/no confirmation:**
Respond naturally: "Yeah", "Sure, go ahead", "Yes please"

**Bot completes the task:**
Respond with exactly: GOAL_COMPLETE

## Difficulty-based behavior

**easy:** Cooperative, clear user. Answer directly and precisely.
**medium:** Realistic, casual. Give partial info, use informal language.
**hard:** Difficult, uncooperative. Be vague, give incomplete answers, change your mind.

## Category-specific behavior

**quantity_ambiguity:** Gave ambiguous quantity. When bot asks, provide specific amount.
**multi_meal_single_message:** Described multiple meals. Remind bot about missed ones.
**correction_contradiction:** After bot shows interpretation, CORRECT something specific.
**edit_after_confirmation:** Cooperate fully, confirm meal, then request an edit.
**future_time_rejection:** Deliberately give future time. If rejected, provide past time.
**contextual_without_context:** Send ONLY quantity/time with NO food. When asked, provide food.
**composite_dish:** Describe dish with all ingredients TOGETHER as one item.

## Output format
Return ONLY the next user message as plain text.
Return exactly "GOAL_COMPLETE" if the task is done."""

AGENT_TURN_PROMPT = """## Test case
- **Category:** {category}
- **Difficulty:** {difficulty}
- **Original input:** {synthetic_input}
- **Expected behavior:** {expected_behavior}
- **Goal:** {goal_type}

## Conversation so far
{transcript}

## Current turn number: {turn_number} of {max_turns}

What does the user say next?"""


class ConversationAgent:
    """Drives multi-turn conversations with Kaira API (async)."""

    def __init__(self, llm_provider: BaseLLMProvider, max_turns: int = 10):
        self.llm = llm_provider
        self.max_turns = max_turns

    async def run_conversation(
        self, test_case: AdversarialTestCase,
        client: KairaClient, user_id: str,
        turn_delay: float = 1.5,
        thinking: str = "low",
    ) -> ConversationTranscript:
        transcript = ConversationTranscript(goal_type=test_case.goal_type)
        current_message = test_case.synthetic_input
        session_state = KairaSessionState(user_id=user_id, is_first_message=True)

        logger.info(f"Starting conversation for test case: {test_case.category}")

        for turn_num in range(1, self.max_turns + 1):
            if not session_state.is_first_message:
                await asyncio.sleep(turn_delay)

            try:
                response = await client.stream_message(
                    query=current_message, user_id=user_id,
                    session_state=session_state,
                )
            except Exception as e:
                logger.error(f"API error on turn {turn_num}: {e}")
                transcript.abandonment_reason = f"API error: {e}"
                transcript.goal_achieved = False
                break

            detected_intent = None
            if response.detected_intents:
                detected_intent = response.detected_intents[0].get("intent")

            turn = ConversationTurn(
                turn_number=turn_num,
                user_message=current_message,
                bot_response=response.full_message,
                detected_intent=detected_intent,
                thread_id=response.thread_id,
                session_id=response.session_id,
                response_id=response.response_id,
            )
            transcript.add_turn(turn)

            # session_state is automatically updated by apply_chunk() during streaming

            goal_achieved = self._check_goal_completion(response, test_case.goal_type)
            if goal_achieved:
                logger.info(f"Goal achieved after {turn_num} turns")
                transcript.goal_achieved = True
                transcript.goal_type = test_case.goal_type
                break

            next_message = await self._decide_next_turn(test_case, transcript, thinking=thinking)
            if next_message == "GOAL_COMPLETE" or not next_message:
                transcript.goal_achieved = True
                break

            current_message = next_message

        if transcript.total_turns >= self.max_turns and not transcript.goal_achieved:
            transcript.abandonment_reason = f"Max turns ({self.max_turns}) reached"

        return transcript

    @staticmethod
    def _check_goal_completion(response: KairaStreamResponse, goal_type: str) -> bool:
        if response.detected_intents:
            intents = [i.get("intent", "") for i in response.detected_intents]
            if goal_type == "meal_logged" and "meal_confirmation" in intents:
                return True
            if goal_type == "question_answered" and any(
                i in intents for i in ("general_query", "nutrition_query")
            ):
                if len(response.full_message) > 50:
                    return True

        msg_lower = response.full_message.lower()
        if goal_type == "meal_logged":
            for pattern in (r"successfully logged", r"meal has been logged", r"logged your meal", r"saved to your diary"):
                if re.search(pattern, msg_lower):
                    return True
        elif goal_type == "question_answered":
            if any(p in msg_lower for p in ("hope this helps", "let me know if", "anything else")):
                return True

        return False

    async def _decide_next_turn(
        self, test_case: AdversarialTestCase, transcript: ConversationTranscript,
        thinking: str = "low",
    ) -> Optional[str]:
        prompt = AGENT_TURN_PROMPT.format(
            category=test_case.category,
            difficulty=test_case.difficulty,
            synthetic_input=test_case.synthetic_input,
            expected_behavior=test_case.expected_behavior,
            goal_type=test_case.goal_type,
            transcript=transcript.to_text(),
            turn_number=transcript.total_turns,
            max_turns=self.max_turns,
        )
        try:
            result = await self.llm.generate(
                prompt=prompt, system_prompt=AGENT_SYSTEM_PROMPT,
                thinking=thinking,
            )
            return result.strip()
        except Exception as e:
            logger.error(f"LLM conversation agent failed: {e}")
            return None
