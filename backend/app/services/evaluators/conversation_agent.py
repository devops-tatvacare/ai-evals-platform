"""Conversation Agent — drives multi-turn, multi-goal conversations (async).

v3 rewrite: supports goal_flow with multiple goals per conversation.
The agent pursues goals in order, signaling GOAL_COMPLETE:<goal_id> or
GOAL_ABANDONED:<goal_id> per goal, and ALL_GOALS_COMPLETE when done.

Traits replace categories as persona flavor. The system prompt includes
all goals in the flow, active traits, and difficulty-based persona.
"""

import asyncio
import logging
import re
from typing import Optional, List

from app.services.evaluators.llm_base import BaseLLMProvider
from app.services.evaluators.kaira_client import KairaClient, KairaStreamResponse
from app.services.evaluators.models import (
    AdversarialTestCase,
    ConversationTranscript,
    ConversationTurn,
    GoalTransition,
    KairaSessionState,
)
from app.services.evaluators.adversarial_config import AdversarialGoal

logger = logging.getLogger(__name__)

# ─── Per-Trait Behavior Hints ─────────────────────────────────────

TRAIT_BEHAVIOR_HINTS = {
    "ambiguous_quantity": "Give ambiguous quantities ('some', 'a bit', 'a plate'). When bot asks, provide specific amount.",
    "multiple_meals_one_message": "Describe multiple meals in one message. Remind bot about missed ones.",
    "user_corrects_bot": "After bot shows interpretation, CORRECT something specific (quantity, food item, or time).",
    "edit_after_log": "Cooperate fully, confirm meal, then request an edit afterward.",
    "future_meal_rejection": "Deliberately give future time. If rejected, provide past time.",
    "no_food_mentioned": "Send ONLY quantity/time with NO food mentioned. When asked, provide food.",
    "multi_ingredient_dish": "Describe dish with all ingredients TOGETHER as one item.",
}


def _build_trait_hints_block(active_traits: List[str]) -> str:
    """Build the trait-specific behavior section for the system prompt."""
    if not active_traits:
        return ""
    lines = ["## Your active traits (persona behaviors)\n"]
    for trait_id in active_traits:
        hint = TRAIT_BEHAVIOR_HINTS.get(trait_id, f"Behave according to trait: {trait_id}")
        lines.append(f"**{trait_id}:** {hint}")
    return "\n".join(lines)


# ─── System Prompt Template ───────────────────────────────────────

AGENT_SYSTEM_PROMPT_TEMPLATE = """You are simulating a REAL user talking to a health-assistant chatbot.
Your primary objective is to pursue each goal in the flow below according to your persona.

## Core rules
- Stay in character as the user described in the test case. Never break character.
- Be realistic: vary your phrasing, use casual language, make small typos occasionally.
- NEVER repeat the exact same message you already sent in this conversation.

{goals_block}

## How to respond to common bot behaviors

**Bot asks for meal time:**
Provide a realistic, varied time. Examples: "around 9 in the morning", "lunch, maybe 1:30 pm".

**Bot asks for quantity/amount:**
Provide a quantity consistent with the original meal description.

**Bot shows a meal summary with calories and confirm/edit options:**
- This is the bot asking you to CONFIRM — the meal is NOT logged yet.
- If correct -> confirm: "Yes, log it", "Looks good, save it"
- If wrong -> point out the specific error
- If your traits require corrections/edits -> make the correction here

**Bot asks for yes/no confirmation:**
Respond naturally: "Yeah", "Sure, go ahead", "Yes please"

**Bot deflects, redirects, or changes topic:**
- The bot may steer the conversation toward its own capabilities (e.g. "I can help with meal logging" when you asked a nutrition question).
- This is NOT broken — the bot is still responding and engaging.
- A real user would push back, rephrase, or be more specific. Do the same.
- Example: If bot says "I can help you log meals. What would you like to know about food intake?" and your goal is a nutrition question, reply with something like "I don't want to log a meal right now, I just want to know about high-fiber diets. Can you tell me about that?"

**Bot asks you a question (any question):**
- If the bot is asking you ANYTHING — a follow-up, a clarification, an open-ended question — the conversation is ALIVE.
- Answer the question in a way that steers toward your goal. Never abandon when the bot just asked you something.

## Persona & difficulty: {difficulty}

**easy:** Cooperative, clear user. Answer directly and precisely. Proceed to goals efficiently.
**medium:** Realistic, casual. Give partial info sometimes, use informal language. Take natural pace.
**hard:** Difficult, uncooperative. Be vague, give incomplete answers, change your mind. You may ultimately reach the goal or choose to abandon.

## Abandonment rules (READ CAREFULLY)

Abandonment is a LAST RESORT. Real users try multiple times before giving up.

**Before you even CONSIDER abandoning, ALL of these must be true:**
1. You have already tried at least 3 DIFFERENT phrasings/approaches for the current goal.
2. The bot has shown a clear pattern of being unable to help (not just redirecting once or twice).
3. The bot is NOT asking you questions — if the bot asks you anything, the conversation is still alive and you MUST continue.

**What counts as "the bot is broken" (the ONLY valid reasons to abandon):**
- Bot gives the EXACT same response 3+ times in a row despite your varied attempts.
- Bot explicitly says it cannot help with your request (e.g. "I'm not able to answer that").
- Bot stops responding or returns errors.

**What does NOT count as broken (NEVER abandon for these):**
- Bot asks a question or invites you to continue ("What would you like to know?").
- Bot redirects to a related topic — rephrase and be more explicit about what you want.
- Bot gives a partial or unsatisfying answer — ask a follow-up, push for more detail.
- Bot misunderstands your request — clarify, rephrase from a different angle.

**Difficulty constraints:**
- **easy/medium:** You must NEVER abandon unless the bot is completely non-functional (errors, no response, or 4+ identical responses). You are a patient user — keep trying.
- **hard:** You MAY abandon after exhausting at least 3 different approaches AND the bot meets the "broken" criteria above. Even hard-difficulty users don't give up after 1-2 tries.

{trait_hints}

## Turn budget
You have {{remaining_turns}} turns remaining out of {{max_turns}} total.
Pace yourself according to your persona — do not rush, but do not waste turns either.

## Output format
Return ONLY the next user message as plain text.
When a goal is complete, respond with exactly: GOAL_COMPLETE:<goal_id>
When a goal is abandoned, respond with exactly: GOAL_ABANDONED:<goal_id>
When ALL goals are done (completed or abandoned), respond with exactly: ALL_GOALS_COMPLETE"""


AGENT_TURN_PROMPT = """## Test case
- **Difficulty:** {difficulty}
- **Goal flow:** {goal_flow}
- **Active traits:** {active_traits}
- **Original input:** {synthetic_input}
- **Current goal:** {current_goal_label} ({current_goal_id})
- **Goals completed:** {goals_completed}
- **Goals remaining:** {goals_remaining}

## Conversation so far
{transcript}

## Turn budget: {remaining_turns} turns remaining out of {max_turns} total.

What does the user say next?"""


def build_multi_goal_system_prompt(
    goals: List[AdversarialGoal],
    active_traits: List[str],
    difficulty: str,
) -> str:
    """Build the system prompt for a multi-goal conversation."""
    # Build goals block with numbered goals and criteria
    goal_lines = []
    for i, goal in enumerate(goals, 1):
        completion_bullets = "\n".join(f"  - {c}" for c in goal.completion_criteria)
        not_completion_bullets = "\n".join(f"  - {nc}" for nc in goal.not_completion)
        goal_lines.append(
            f"### Goal {i}: {goal.label} ({goal.id})\n"
            f"{goal.description}\n\n"
            f"**Completion criteria** (say GOAL_COMPLETE:{goal.id} when ALL true):\n"
            f"{completion_bullets}\n\n"
            f"**NOT complete when:**\n"
            f"{not_completion_bullets}\n\n"
            f"**Strategy:** {goal.agent_behavior}"
        )

    goals_block = "## Your Goals (pursue in order)\n\n" + "\n\n".join(goal_lines)
    trait_hints = _build_trait_hints_block(active_traits)

    return AGENT_SYSTEM_PROMPT_TEMPLATE.format(
        goals_block=goals_block,
        difficulty=difficulty,
        trait_hints=trait_hints,
    )


# ─── Goal signal parsing ──────────────────────────────────────────

_GOAL_COMPLETE_RE = re.compile(r"GOAL_COMPLETE:(\S+)")
_GOAL_ABANDONED_RE = re.compile(r"GOAL_ABANDONED:(\S+)")


# ─── Conversation Agent ───────────────────────────────────────────


class ConversationAgent:
    """Drives multi-turn, multi-goal conversations with Kaira API (async).

    Supports goal_flow with 1-N goals per conversation. Each goal can be
    completed or abandoned individually. The conversation ends when all
    goals are resolved or max_turns is reached.
    """

    def __init__(
        self,
        llm_provider: BaseLLMProvider,
        max_turns: int = 10,
    ):
        self.llm = llm_provider
        self.max_turns = max_turns

    async def run_conversation(
        self,
        test_case: AdversarialTestCase,
        goals: List[AdversarialGoal],
        client: KairaClient,
        user_id: str,
        turn_delay: float = 1.5,
        thinking: str = "low",
        test_case_label: Optional[str] = None,
    ) -> ConversationTranscript:
        # Scale max_turns for multi-goal conversations
        effective_max_turns = self.max_turns
        if len(goals) > 1:
            effective_max_turns = min(self.max_turns * len(goals), 30)

        transcript = ConversationTranscript(
            goals_attempted=[g.id for g in goals],
        )
        current_message = test_case.synthetic_input
        session_state = KairaSessionState(user_id=user_id, is_first_message=True)

        # Track per-goal state
        pending_goals = list(goals)
        completed_goals: List[str] = []
        abandoned_goals: List[str] = []

        goal_flow_str = " → ".join(g.id for g in goals)
        logger.info(f"Starting conversation: {goal_flow_str} (difficulty={test_case.difficulty})")

        # Mark first goal as started
        if pending_goals:
            transcript.goal_transitions.append(GoalTransition(
                goal_id=pending_goals[0].id, event="started", at_turn=1,
            ))

        # Build system prompt with all goals
        system_prompt = build_multi_goal_system_prompt(
            goals, test_case.active_traits, test_case.difficulty,
        )

        for turn_num in range(1, effective_max_turns + 1):
            if not session_state.is_first_message:
                await asyncio.sleep(turn_delay)

            # --- Send message to Kaira ---
            try:
                response = await client.stream_message(
                    query=current_message,
                    user_id=user_id,
                    session_state=session_state,
                    test_case_label=test_case_label,
                )
            except Exception as e:
                logger.error(f"API error on turn {turn_num}: {e}")
                transcript.failure_reason = f"API error: {e}"
                transcript.goal_achieved = False
                transcript.stop_reason = "error"
                break

            # --- Annotate goal signals ---
            current_goal = pending_goals[0] if pending_goals else goals[-1]
            goal_signals = self._annotate_goal_signals(response, current_goal)

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
                goal_signals=goal_signals,
            )
            transcript.add_turn(turn)

            # --- Ask LLM agent for next move ---
            remaining = effective_max_turns - turn_num
            next_message = await self._decide_next_turn(
                test_case=test_case,
                goals=goals,
                current_goal=current_goal,
                completed_goals=completed_goals,
                pending_goals=pending_goals,
                transcript=transcript,
                system_prompt=system_prompt,
                remaining_turns=remaining,
                max_turns=effective_max_turns,
                thinking=thinking,
            )

            # --- Exit conditions ---
            if next_message is None:
                logger.warning(f"LLM agent failed on turn {turn_num}, stopping")
                transcript.failure_reason = "LLM agent error"
                transcript.goal_achieved = False
                transcript.stop_reason = "error"
                break

            next_message = next_message.strip()

            # Check for ALL_GOALS_COMPLETE
            if next_message == "ALL_GOALS_COMPLETE":
                # Mark any remaining pending goals as completed
                for g in pending_goals:
                    completed_goals.append(g.id)
                    transcript.goal_transitions.append(GoalTransition(
                        goal_id=g.id, event="completed", at_turn=turn_num,
                    ))
                pending_goals.clear()
                transcript.goal_achieved = True
                transcript.stop_reason = "goal_complete"
                break

            # Check for GOAL_COMPLETE:<goal_id>
            gc_match = _GOAL_COMPLETE_RE.search(next_message)
            if gc_match:
                goal_id = gc_match.group(1)
                completed_goals.append(goal_id)
                transcript.goal_transitions.append(GoalTransition(
                    goal_id=goal_id, event="completed", at_turn=turn_num,
                ))
                pending_goals = [g for g in pending_goals if g.id != goal_id]

                if not pending_goals:
                    transcript.goal_achieved = True
                    transcript.stop_reason = "goal_complete"
                    break
                else:
                    # Start next goal
                    transcript.goal_transitions.append(GoalTransition(
                        goal_id=pending_goals[0].id, event="started", at_turn=turn_num + 1,
                    ))
                    continue

            # Check for GOAL_ABANDONED:<goal_id>
            ga_match = _GOAL_ABANDONED_RE.search(next_message)
            if ga_match:
                goal_id = ga_match.group(1)
                abandoned_goals.append(goal_id)
                transcript.goal_transitions.append(GoalTransition(
                    goal_id=goal_id, event="abandoned", at_turn=turn_num,
                ))
                pending_goals = [g for g in pending_goals if g.id != goal_id]

                if not pending_goals:
                    transcript.goal_achieved = False
                    transcript.goal_abandoned = True
                    transcript.stop_reason = "goal_abandoned"
                    transcript.failure_reason = "All goals abandoned"
                    break
                else:
                    transcript.goal_transitions.append(GoalTransition(
                        goal_id=pending_goals[0].id, event="started", at_turn=turn_num + 1,
                    ))
                    continue

            # Legacy single-goal signals
            if next_message == "GOAL_COMPLETE":
                if pending_goals:
                    gid = pending_goals[0].id
                    completed_goals.append(gid)
                    transcript.goal_transitions.append(GoalTransition(
                        goal_id=gid, event="completed", at_turn=turn_num,
                    ))
                    pending_goals.pop(0)
                if not pending_goals:
                    transcript.goal_achieved = True
                    transcript.stop_reason = "goal_complete"
                    break
                else:
                    transcript.goal_transitions.append(GoalTransition(
                        goal_id=pending_goals[0].id, event="started", at_turn=turn_num + 1,
                    ))
                    continue

            if next_message == "GOAL_ABANDONED":
                if pending_goals:
                    gid = pending_goals[0].id
                    abandoned_goals.append(gid)
                    transcript.goal_transitions.append(GoalTransition(
                        goal_id=gid, event="abandoned", at_turn=turn_num,
                    ))
                    pending_goals.pop(0)
                if not pending_goals:
                    transcript.goal_achieved = False
                    transcript.goal_abandoned = True
                    transcript.stop_reason = "goal_abandoned"
                    transcript.failure_reason = "All goals abandoned"
                    break
                else:
                    transcript.goal_transitions.append(GoalTransition(
                        goal_id=pending_goals[0].id, event="started", at_turn=turn_num + 1,
                    ))
                    continue

            if not next_message:
                logger.warning(f"LLM agent returned empty on turn {turn_num}, stopping")
                transcript.failure_reason = "LLM agent returned empty response"
                transcript.goal_achieved = False
                transcript.stop_reason = "error"
                break

            current_message = next_message

        # Max turns exhausted
        if transcript.total_turns >= effective_max_turns and not transcript.stop_reason:
            transcript.failure_reason = f"Max turns ({effective_max_turns}) reached"
            transcript.stop_reason = "max_turns"

        # Finalize transcript goal tracking
        transcript.goals_completed = completed_goals
        transcript.goals_abandoned = abandoned_goals
        if not transcript.stop_reason:
            transcript.goal_achieved = len(completed_goals) == len(goals)

        return transcript

    @staticmethod
    def _annotate_goal_signals(
        response: KairaStreamResponse,
        goal: AdversarialGoal,
    ) -> dict:
        """Detect goal-related signals in a Kaira response (annotation only)."""
        signals: dict = {
            "pattern_matches": [],
            "intent_matches": [],
            "agent_success": False,
        }

        msg_lower = response.full_message.lower()
        for pattern in goal.signal_patterns:
            if re.search(re.escape(pattern), msg_lower):
                signals["pattern_matches"].append(pattern)

        if response.detected_intents:
            intents = [i.get("intent", "") for i in response.detected_intents]
            signals["intent_matches"] = intents

        if any(ar.get("success") for ar in response.agent_responses):
            signals["agent_success"] = True

        return signals

    async def _decide_next_turn(
        self,
        test_case: AdversarialTestCase,
        goals: List[AdversarialGoal],
        current_goal: AdversarialGoal,
        completed_goals: List[str],
        pending_goals: List[AdversarialGoal],
        transcript: ConversationTranscript,
        system_prompt: str,
        remaining_turns: int,
        max_turns: int,
        thinking: str = "low",
    ) -> Optional[str]:
        goal_flow_str = " → ".join(g.id for g in goals)
        completed_str = ", ".join(completed_goals) if completed_goals else "none"
        remaining_str = ", ".join(g.id for g in pending_goals) if pending_goals else "none"
        traits_str = ", ".join(test_case.active_traits) if test_case.active_traits else "none"

        prompt = AGENT_TURN_PROMPT.format(
            difficulty=test_case.difficulty,
            goal_flow=goal_flow_str,
            active_traits=traits_str,
            synthetic_input=test_case.synthetic_input,
            current_goal_label=current_goal.label,
            current_goal_id=current_goal.id,
            goals_completed=completed_str,
            goals_remaining=remaining_str,
            transcript=transcript.to_text(),
            remaining_turns=remaining_turns,
            max_turns=max_turns,
        )
        filled_system_prompt = system_prompt.replace(
            "{remaining_turns}", str(remaining_turns)
        ).replace("{max_turns}", str(max_turns))
        try:
            result = await self.llm.generate(
                prompt=prompt,
                system_prompt=filled_system_prompt,
                thinking=thinking,
            )
            return result.strip()
        except Exception as e:
            logger.error(f"LLM conversation agent failed: {e}")
            return None
