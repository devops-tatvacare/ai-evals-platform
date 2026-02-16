"""Meal Summary Correctness Evaluator (async).

Ported from kaira-evals/src/evaluators/correctness_evaluator.py.
"""
from typing import List, Optional

from app.services.evaluators.llm_base import BaseLLMProvider
from app.services.evaluators.models import (
    ChatMessage, ConversationThread, CorrectnessEvaluation, RuleCompliance,
)
from app.services.evaluators.rule_catalog import get_rules_for_correctness, PromptRule

CORRECTNESS_JUDGE_PROMPT = """You are a strict nutritional accuracy auditor for a health chatbot.
You will receive a USER INPUT and the BOT RESPONSE.  Your job is to evaluate whether the
meal summary in the bot response is factually defensible.

## IMPORTANT: Image-based meals
When the user message is tagged with [IMAGE ATTACHED], the user sent a photo of their food.
The bot analyzed the image to identify foods and quantities — you do NOT have access to the
original image.  In these cases:
- You CANNOT verify food-quantity coherence (Check 3) because the ground truth is in the image, not in the text.
- You CANNOT flag food names as "hallucinated" or "mismatched" — the bot identified them from the image.
- You CAN still check calorie sanity (Check 1) and arithmetic consistency (Check 2).
- If the calories and arithmetic are plausible, verdict should be **PASS** even if the user text
  is vague (e.g. "Log this meal for me").
- Only fail image-based meals for genuinely implausible calorie values or broken arithmetic.

## Checks to perform

### 1. Calorie Sanity
- Is the **total calorie** value plausible for the foods and quantities described?
- A single food item should rarely exceed 2000 Kcal.
- A single meal total should rarely exceed 4000 Kcal.
- Values like 10,000+ Kcal for everyday foods are ALWAYS wrong.

### 2. Internal Arithmetic Consistency
- Do the **per-item calorie values add up** to the stated total? (tolerance ±15 Kcal or ±5%, whichever is larger)
- Do the **macros roughly account** for the calories?  Protein×4 + Carbs×4 + Fat×9 ≈ Total Calories (tolerance ±20%).

### 3. Food-Quantity Coherence
- Does the **quantity shown in the response** match what the user stated?
- **SKIP this check if the user message has [IMAGE ATTACHED]** — food names come from the image, not text.

## Verdict (pick exactly one)
- **PASS** — All applicable checks pass.
- **SOFT_FAIL** — Minor issues.
- **HARD_FAIL** — Clear nutritional inaccuracy.
- **CRITICAL** — Order-of-magnitude calorie error or dangerous mis-statement.
- **NOT_APPLICABLE** — The bot response is NOT a meal summary.

## Production prompt rules
Evaluate whether the bot response follows the specific production prompt rules listed below.

## JSON output schema
Return ONLY valid JSON:
{
  "verdict": "PASS | SOFT_FAIL | HARD_FAIL | CRITICAL | NOT_APPLICABLE",
  "calorie_sanity": {"plausible": true/false, "stated_total_kcal": <number or null>, "expected_range_low": <number or null>, "expected_range_high": <number or null>, "reason": "<brief>"},
  "arithmetic_consistency": {"consistent": true/false, "items_sum_kcal": <number or null>, "stated_total_kcal": <number or null>, "macro_calories_estimate": <number or null>, "reason": "<brief>"},
  "quantity_coherence": {"coherent": true/false, "mismatches": ["<description>"]},
  "reasoning": "<2-3 sentence overall assessment>",
  "rule_compliance": [{"rule_id": "<exact rule_id>", "followed": true | false, "evidence": "<1 sentence>"}]
}"""


CORRECTNESS_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["PASS", "SOFT_FAIL", "HARD_FAIL", "CRITICAL", "NOT_APPLICABLE"]},
        "calorie_sanity": {
            "type": "object",
            "properties": {
                "plausible": {"type": "boolean"}, "stated_total_kcal": {"type": "number"},
                "expected_range_low": {"type": "number"}, "expected_range_high": {"type": "number"},
                "reason": {"type": "string"},
            },
            "required": ["plausible", "reason"],
        },
        "arithmetic_consistency": {
            "type": "object",
            "properties": {
                "consistent": {"type": "boolean"}, "items_sum_kcal": {"type": "number"},
                "stated_total_kcal": {"type": "number"}, "macro_calories_estimate": {"type": "number"},
                "reason": {"type": "string"},
            },
            "required": ["consistent", "reason"],
        },
        "quantity_coherence": {
            "type": "object",
            "properties": {"coherent": {"type": "boolean"}, "mismatches": {"type": "array", "items": {"type": "string"}}},
            "required": ["coherent", "mismatches"],
        },
        "reasoning": {"type": "string"},
        "rule_compliance": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"rule_id": {"type": "string"}, "followed": {"type": "boolean"}, "evidence": {"type": "string"}},
                "required": ["rule_id", "followed", "evidence"],
            },
        },
    },
    "required": ["verdict", "calorie_sanity", "arithmetic_consistency", "quantity_coherence", "reasoning", "rule_compliance"],
}


class CorrectnessEvaluator:
    """Evaluates nutritional correctness of meal summary responses (async)."""

    def __init__(self, llm_provider: BaseLLMProvider):
        self.llm = llm_provider

    async def evaluate_message(
        self, message: ChatMessage,
        conversation_history: Optional[List[ChatMessage]] = None,
    ) -> CorrectnessEvaluation:
        if not message.is_meal_summary:
            return CorrectnessEvaluation(
                message=message, verdict="NOT APPLICABLE", reasoning="Response is not a meal summary.",
            )

        has_image_context = message.has_image
        if not has_image_context and conversation_history:
            for m in conversation_history[-2:]:
                if m.has_image:
                    has_image_context = True
                    break

        history_block = ""
        if conversation_history:
            for i, m in enumerate(conversation_history[-4:], 1):
                img_tag = " [IMAGE ATTACHED]" if m.has_image else ""
                history_block += f"Turn {i} — User: {m.query_text}{img_tag}\nBot: {m.final_response_message[:300]}\n\n"

        img_tag = " [IMAGE ATTACHED]" if message.has_image else ""
        image_note = ""
        if has_image_context:
            image_note = (
                "\n**NOTE:** This meal was identified from a user-uploaded image. "
                "Only check calorie sanity and arithmetic.\n"
            )

        rules = get_rules_for_correctness()
        rules_block = self._format_rules(rules)

        eval_prompt = (
            f"### Conversation history (for context)\n{history_block}\n"
            f"### Current turn\n**User input:** {message.query_text}{img_tag}\n\n"
            f"**Bot response:**\n{message.final_response_message}\n\n"
            f"{image_note}{rules_block}\n"
            "Evaluate the bot response now. Check EACH rule above."
        )

        result = await self.llm.generate_json(
            prompt=eval_prompt,
            system_prompt=CORRECTNESS_JUDGE_PROMPT,
            json_schema=CORRECTNESS_JSON_SCHEMA,
        )
        return self._parse_result(message, result, has_image_context=has_image_context)

    async def evaluate_thread(self, thread: ConversationThread) -> List[CorrectnessEvaluation]:
        results = []
        for i, msg in enumerate(thread.messages):
            history = thread.messages[:i] if i > 0 else None
            results.append(await self.evaluate_message(msg, history))
        return results

    @staticmethod
    def _format_rules(rules: List[PromptRule]) -> str:
        if not rules:
            return ""
        lines = ["### Production prompt rules to evaluate", "For EACH rule, include a rule_compliance entry.\n"]
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

    @staticmethod
    def _parse_result(message: ChatMessage, raw: dict, has_image_context: bool = False) -> CorrectnessEvaluation:
        verdict = raw.get("verdict", "SOFT FAIL").replace("_", " ")
        if verdict not in ("PASS", "SOFT FAIL", "HARD FAIL", "CRITICAL", "NOT APPLICABLE"):
            verdict = "SOFT FAIL"

        reasoning = raw.get("reasoning", "")

        if has_image_context:
            qc = raw.get("quantity_coherence", {})
            if not qc.get("coherent", True) and verdict in ("HARD FAIL", "CRITICAL"):
                calorie_ok = raw.get("calorie_sanity", {}).get("plausible", True)
                arithmetic_ok = raw.get("arithmetic_consistency", {}).get("consistent", True)
                if calorie_ok and arithmetic_ok:
                    verdict = "PASS"
                    reasoning = f"[Image-based meal — quantity coherence check skipped] {reasoning}"

        rules = get_rules_for_correctness()
        rule_compliance = CorrectnessEvaluator._parse_rule_compliance(raw.get("rule_compliance", []), rules)

        return CorrectnessEvaluation(
            message=message, verdict=verdict,
            calorie_sanity=raw.get("calorie_sanity", {}),
            arithmetic_consistency=raw.get("arithmetic_consistency", {}),
            quantity_coherence=raw.get("quantity_coherence", {}),
            reasoning=reasoning, has_image_context=has_image_context,
            rule_compliance=rule_compliance,
        )
