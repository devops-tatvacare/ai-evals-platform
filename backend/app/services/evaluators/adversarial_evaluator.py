"""Adversarial Input Stress Test Evaluator (async).

Ported from kaira-evals/src/evaluators/adversarial_evaluator.py.
Now data-driven: categories, rules, and generation prompts are built
dynamically from AdversarialConfig rather than hardcoded constants.
"""
import logging
from typing import List, Optional

from app.services.evaluators.llm_base import BaseLLMProvider
from app.services.evaluators.models import (
    AdversarialTestCase, AdversarialEvaluation,
    ConversationTranscript, RuleCompliance,
)
from app.services.evaluators.adversarial_config import (
    AdversarialConfig, AdversarialCategory, AdversarialRule,
    get_default_config,
)
from app.services.evaluators.conversation_agent import ConversationAgent
from app.services.evaluators.rule_catalog import PromptRule

logger = logging.getLogger(__name__)


# ─── Dynamic Prompt Builders ─────────────────────────────────────

def build_generation_prompt(
    categories: List[AdversarialCategory],
    count: int,
    extra_instructions: Optional[str] = None,
) -> str:
    """Build the test case generation prompt from enabled categories."""
    cat_sections = []
    for i, cat in enumerate(categories, 1):
        cat_sections.append(f"### {i}. {cat.id}\n{cat.description}")

    cat_block = "\n\n".join(cat_sections)
    cat_count = len(categories)

    extra = ""
    if extra_instructions and extra_instructions.strip():
        extra = f"\n\n## Additional instructions\n{extra_instructions.strip()}\n"

    return f"""You are a QA engineer designing adversarial test inputs for a health-assistant
chatbot that logs meals. Generate test cases that stress-test the system's ability to handle
tricky user inputs.

## CRITICAL: What "synthetic_input" means
synthetic_input is the user's OPENING message — the very first thing sent to the chatbot.
NEVER put multi-turn behavior into synthetic_input. It must be a single, self-contained first message.

## Categories

{cat_block}

## Difficulty levels
- **easy**: Straightforward, one minor ambiguity.
- **medium**: Moderately tricky, casual language.
- **hard**: Genuinely adversarial, multiple ambiguities.

## Instructions
- Generate exactly {count} test cases across all {cat_count} categories (roughly evenly distributed).
- Distribute difficulty roughly evenly.
- Specify goal_type: "meal_logged" for meal tests, "question_answered" for QnA tests.
{extra}
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


def build_gen_json_schema(categories: List[AdversarialCategory]) -> dict:
    """Build the JSON schema for generation output, with category enum from config."""
    return {
        "type": "object",
        "properties": {
            "test_cases": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "category": {
                            "type": "string",
                            "enum": [c.id for c in categories],
                        },
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


# ─── Judge Prompt (unchanged — rule-driven, not category-driven) ─

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


class AdversarialEvaluator:
    """Generates adversarial test cases and evaluates transcripts (async).

    The evaluator is a pure evaluation component — it generates test cases and
    judges transcripts. The runner (adversarial_runner.py) owns the orchestration
    loop, delays, progress callbacks, and error boundaries.

    Now config-driven: pass an AdversarialConfig to control which categories are
    tested and which rules are used for judging.
    """

    def __init__(self, llm_provider: BaseLLMProvider, config: Optional[AdversarialConfig] = None):
        self.llm = llm_provider
        self.config = config or get_default_config()
        self.conversation_agent = ConversationAgent(
            llm_provider,
            active_categories=self.config.enabled_category_ids,
        )

    async def generate_test_cases(
        self,
        count: int = 15,
        thinking: str = "low",
        extra_instructions: Optional[str] = None,
    ) -> List[AdversarialTestCase]:
        categories = self.config.enabled_categories
        gen_prompt = build_generation_prompt(categories, count, extra_instructions)
        gen_schema = build_gen_json_schema(categories)

        try:
            raw = await self.llm.generate_json(
                prompt=gen_prompt, json_schema=gen_schema,
                thinking=thinking,
            )
            items = raw.get("test_cases", self._extract_list(raw))
            cases = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                cases.append(AdversarialTestCase(
                    category=item.get("category", categories[0].id if categories else "unknown"),
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

    def get_rules_for_category(self, category: str) -> List[PromptRule]:
        """Get rules for a category from config, returning them as PromptRule dataclasses."""
        config_rules = self.config.rules_for_category(category)
        return [
            PromptRule(
                rule_id=r.rule_id, section=r.section,
                rule_text=r.rule_text, categories=r.categories,
            )
            for r in config_rules
        ]

    async def evaluate_transcript(
        self, test_case: AdversarialTestCase, transcript: ConversationTranscript,
        thinking: str = "low",
    ) -> AdversarialEvaluation:
        """Judge a conversation transcript. Raises on LLM failure."""
        rules = self.get_rules_for_category(test_case.category)
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

        result = await self.llm.generate_json(
            prompt=eval_prompt,
            system_prompt=ADVERSARIAL_LIVE_JUDGE_PROMPT,
            json_schema=ADVERSARIAL_JUDGE_JSON_SCHEMA,
            thinking=thinking,
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
