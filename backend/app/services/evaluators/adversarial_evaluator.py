"""Adversarial Input Stress Test Evaluator (async).

Ported from kaira-evals/src/evaluators/adversarial_evaluator.py.
"""
import asyncio
import logging
from typing import List, Optional, Callable, Awaitable

from app.services.evaluators.llm_base import BaseLLMProvider
from app.services.evaluators.models import (
    AdversarialTestCase, AdversarialEvaluation,
    ConversationTranscript, RuleCompliance,
)
from app.services.evaluators.rule_catalog import get_rules_for_category, PromptRule
from app.services.evaluators.kaira_client import KairaClient
from app.services.evaluators.conversation_agent import ConversationAgent

logger = logging.getLogger(__name__)

# ─── Phase 1: Generation prompt ──────────────────────────────────

ADVERSARIAL_GEN_PROMPT = """You are a QA engineer designing adversarial test inputs for a health-assistant
chatbot that logs meals. Generate test cases that stress-test the system's ability to handle
tricky user inputs.

## CRITICAL: What "synthetic_input" means
synthetic_input is the user's OPENING message — the very first thing sent to the chatbot.
NEVER put multi-turn behavior into synthetic_input. It must be a single, self-contained first message.

## Categories

### 1. quantity_ambiguity
Inputs with unusual, informal, or ambiguous quantities.

### 2. multi_meal_single_message
Multiple meals/times in a single message.

### 3. correction_contradiction
Initial ambiguous meal description (agent corrects in later turn).

### 4. edit_after_confirmation
Normal meal description (agent confirms then requests edit).

### 5. future_time_rejection
User provides future time for meal.

### 6. contextual_without_context
ONLY quantity/time with no food mentioned.

### 7. composite_dish
Composite dish with multiple ingredients as ONE item.

## Difficulty levels
- **easy**: Straightforward, one minor ambiguity.
- **medium**: Moderately tricky, casual language.
- **hard**: Genuinely adversarial, multiple ambiguities.

## Instructions
- Generate exactly {count} test cases across all 7 categories (roughly evenly distributed).
- Distribute difficulty roughly evenly.
- Specify goal_type: "meal_logged" for meal tests, "question_answered" for QnA tests.

## JSON output
Return ONLY valid JSON:
{{
  "test_cases": [
    {{
      "category": "<category>",
      "synthetic_input": "<user's FIRST message only>",
      "expected_behavior": "<what the system should do>",
      "difficulty": "easy | medium | hard",
      "goal_type": "meal_logged"
    }}
  ]
}}"""

ADVERSARIAL_LIVE_JUDGE_PROMPT = """You are evaluating a health-assistant chatbot based on a REAL conversation transcript.

## Your task
1. Review the ACTUAL CONVERSATION TRANSCRIPT below.
2. For EACH production rule listed, determine if the system FOLLOWED or VIOLATED it.
3. Evaluate whether the system handled the adversarial input correctly overall.
4. Check if the goal was achieved.

## Verdict
- **PASS** — Handled correctly, goal achieved.
- **SOFT_FAIL** — Minor issues, goal achieved.
- **HARD_FAIL** — Clear failure.
- **CRITICAL** — Dangerous failure.

## Difficulty calibration
- **easy** — Zero tolerance. Any failure is concerning.
- **medium** — Minor issues acceptable. SOFT_FAIL is fine if goal achieved.
- **hard** — SOFT_FAIL is a good result. Only HARD_FAIL/CRITICAL means system broke.

## JSON output
Return ONLY valid JSON:
{
  "verdict": "PASS | SOFT_FAIL | HARD_FAIL | CRITICAL",
  "failure_modes": ["<each failure mode detected>"],
  "reasoning": "<2-3 sentence assessment>",
  "goal_achieved": true | false,
  "rule_compliance": [{"rule_id": "<exact rule_id>", "followed": true | false, "evidence": "<1 sentence>"}]
}"""

ADVERSARIAL_GEN_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "test_cases": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "enum": [
                        "quantity_ambiguity", "multi_meal_single_message",
                        "correction_contradiction", "edit_after_confirmation",
                        "future_time_rejection", "contextual_without_context", "composite_dish",
                    ]},
                    "synthetic_input": {"type": "string"},
                    "expected_behavior": {"type": "string"},
                    "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
                    "goal_type": {"type": "string"},
                },
                "required": ["category", "synthetic_input", "expected_behavior", "difficulty", "goal_type"],
            },
        },
    },
    "required": ["test_cases"],
}

ADVERSARIAL_JUDGE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["PASS", "SOFT_FAIL", "HARD_FAIL", "CRITICAL"]},
        "failure_modes": {"type": "array", "items": {"type": "string"}},
        "reasoning": {"type": "string"},
        "goal_achieved": {"type": "boolean"},
        "rule_compliance": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"rule_id": {"type": "string"}, "followed": {"type": "boolean"}, "evidence": {"type": "string"}},
                "required": ["rule_id", "followed", "evidence"],
            },
        },
    },
    "required": ["verdict", "failure_modes", "reasoning", "goal_achieved", "rule_compliance"],
}


ProgressCallback = Optional[Callable[[int, int, str], Awaitable[None]]]


class AdversarialEvaluator:
    """Generates adversarial test cases and evaluates against LIVE Kaira API (async)."""

    def __init__(self, llm_provider: BaseLLMProvider):
        self.llm = llm_provider
        self.conversation_agent = ConversationAgent(llm_provider)

    async def generate_test_cases(self, count: int = 15) -> List[AdversarialTestCase]:
        gen_prompt = ADVERSARIAL_GEN_PROMPT.replace("{count}", str(count))
        try:
            raw = await self.llm.generate_json(
                prompt=gen_prompt, json_schema=ADVERSARIAL_GEN_JSON_SCHEMA,
            )
            items = raw.get("test_cases", self._extract_list(raw))
            cases = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                cases.append(AdversarialTestCase(
                    category=item.get("category", "quantity_ambiguity"),
                    synthetic_input=item.get("synthetic_input", str(item)),
                    expected_behavior=item.get("expected_behavior", ""),
                    difficulty=item.get("difficulty", "medium").upper(),
                    goal_type=item.get("goal_type", "meal_logged"),
                ))
            return cases[:count]
        except Exception as e:
            logger.error(f"Failed to generate adversarial test cases: {e}")
            raise RuntimeError(f"Failed to generate adversarial test cases: {e}") from e

    @staticmethod
    def _extract_list(raw) -> list:
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            for key in ("test_cases", "cases", "items", "results"):
                if key in raw and isinstance(raw[key], list):
                    return raw[key]
        return []

    async def run_live_stress_test(
        self, user_id: str, count: int = 15,
        kaira_auth_token: str = "", kaira_api_url: str = "",
        turn_delay: float = 1.5, case_delay: float = 3.0,
        progress_callback: ProgressCallback = None,
        cancellation_check: Optional[Callable[[], Awaitable[None]]] = None,
    ) -> List[AdversarialEvaluation]:
        if not user_id:
            raise ValueError("user_id is required for live stress tests")

        if progress_callback:
            await progress_callback(0, count, "Generating test cases...")

        cases = await self.generate_test_cases(count)
        results = []
        client = KairaClient(auth_token=kaira_auth_token, base_url=kaira_api_url)

        for i, tc in enumerate(cases, 1):
            # Cooperative cancellation check
            if cancellation_check:
                await cancellation_check()

            if i > 1:
                await asyncio.sleep(case_delay)

            logger.info(f"Running live test {i}/{count}: {tc.category}")
            if progress_callback:
                await progress_callback(i, count, f"{tc.category}: running conversation...")

            transcript = await self.conversation_agent.run_conversation(
                test_case=tc, client=client, user_id=user_id, turn_delay=turn_delay,
            )

            if progress_callback:
                await progress_callback(i, count, f"{tc.category}: judging transcript...")

            evaluation = await self._evaluate_transcript(tc, transcript)
            results.append(evaluation)
            logger.info(f"  -> {evaluation.verdict} (Goal: {evaluation.goal_achieved})")

        return results

    async def _evaluate_transcript(
        self, test_case: AdversarialTestCase, transcript: ConversationTranscript,
    ) -> AdversarialEvaluation:
        rules = get_rules_for_category(test_case.category)
        rules_section = self._format_rules_for_judge(rules)

        eval_prompt = (
            f"### Adversarial test case\n"
            f"**Category:** {test_case.category}\n"
            f"**Difficulty:** {test_case.difficulty}\n"
            f"**Expected behavior:** {test_case.expected_behavior}\n"
            f"**Goal type:** {test_case.goal_type}\n\n"
            f"{rules_section}\n"
            f"### ACTUAL CONVERSATION TRANSCRIPT ({transcript.total_turns} turns)\n"
            f"{transcript.to_text()}\n\n"
            f"**Goal achieved (by agent):** {transcript.goal_achieved}\n"
            f"**Abandonment reason:** {transcript.abandonment_reason or 'N/A'}\n\n"
            "Now judge the system's performance. Evaluate EACH rule above."
        )

        try:
            result = await self.llm.generate_json(
                prompt=eval_prompt,
                system_prompt=ADVERSARIAL_LIVE_JUDGE_PROMPT,
                json_schema=ADVERSARIAL_JUDGE_JSON_SCHEMA,
            )
            rule_compliance = self._parse_rule_compliance(result.get("rule_compliance", []), rules)
            return AdversarialEvaluation(
                test_case=test_case, transcript=transcript,
                verdict=result.get("verdict", "HARD FAIL").replace("_", " "),
                failure_modes=result.get("failure_modes", []),
                reasoning=result.get("reasoning", ""),
                goal_achieved=result.get("goal_achieved", transcript.goal_achieved),
                rule_compliance=rule_compliance,
            )
        except Exception as e:
            logger.error(f"Judge evaluation failed: {e}")
            return AdversarialEvaluation(
                test_case=test_case, transcript=transcript,
                verdict="HARD FAIL", failure_modes=["JUDGE_ERROR"],
                reasoning=f"Judge evaluation error: {e}", goal_achieved=False,
            )

    @staticmethod
    def _format_rules_for_judge(rules: List[PromptRule]) -> str:
        if not rules:
            return ""
        lines = ["### Production prompt rules to evaluate",
                  "For EACH rule, include a rule_compliance entry in your response.\n"]
        for i, r in enumerate(rules, 1):
            lines.append(f"{i}. **{r.rule_id}** [{r.section}]\n   {r.rule_text}")
        return "\n".join(lines)

    @staticmethod
    def _parse_rule_compliance(raw_compliance: list, rules: List[PromptRule]) -> List[RuleCompliance]:
        section_map = {r.rule_id: r.section for r in rules}
        compliance = []
        for item in raw_compliance:
            if not isinstance(item, dict):
                continue
            rid = item.get("rule_id", "")
            compliance.append(RuleCompliance(
                rule_id=rid, section=section_map.get(rid, ""),
                followed=bool(item.get("followed", True)), evidence=item.get("evidence", ""),
            ))
        returned_ids = {c.rule_id for c in compliance}
        for r in rules:
            if r.rule_id not in returned_ids:
                compliance.append(RuleCompliance(
                    rule_id=r.rule_id, section=r.section,
                    followed=True, evidence="Not evaluated by judge",
                ))
        return compliance
