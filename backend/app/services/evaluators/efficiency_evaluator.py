"""Conversation Efficiency & Recovery Evaluator (async).

Ported from kaira-evals/src/evaluators/efficiency_evaluator.py.
"""
from typing import List, Optional

from app.services.evaluators.llm_base import BaseLLMProvider
from app.services.evaluators.models import ConversationThread, EfficiencyEvaluation, RuleCompliance
from app.services.evaluators.rule_catalog import get_rules_for_efficiency, PromptRule

EFFICIENCY_JUDGE_PROMPT = """You are an expert conversation-quality auditor for a health-assistant chatbot
that logs meals.  You will receive a COMPLETE conversation thread (all turns, in order).

## Context about this chatbot
- The ideal meal-logging flow is **2 turns**: user describes food → bot shows summary + confirm chip → done.
- Extra turns may happen because:
  (a) The user genuinely didn't provide required info (time, quantity) — this is ACCEPTABLE friction.
  (b) The bot failed to parse the user's input correctly — this is BOT friction.
  (c) The bot produced wrong calorie / nutrition values and the user corrected it — this is BOT friction.
  (d) The bot showed wrong foods, wrong quantities, or duplicated items — this is BOT friction.

## Production rules — CORRECT vs INCORRECT bot behaviors

**CORRECT behaviors (NOT friction — do NOT penalize these):**
- Bot asking for meal TIME when user didn't provide it
- Bot asking for QUANTITY when ambiguous
- Bot rejecting future times
- Bot asking what FOOD when user only provides quantity or time
- Bot treating composite dishes as single items
- Bot asking for confirmation before logging

**BOT ERRORS (these ARE friction — penalize these):**
- Bot asking for time/quantity that was ALREADY provided
- Bot accepting future times without questioning
- Bot assuming/guessing food when user only gave quantity or time
- Bot splitting composite dishes into separate items
- Bot showing wrong calorie values or wrong food extraction
- Bot ignoring user corrections or repeating the same error

## Your evaluation tasks

### 1. Task Completion
Did the user achieve what they wanted?

### 2. Friction Analysis
For each turn beyond the first two, determine: user caused or bot caused?

### 3. Recovery Quality
When the user corrected the bot, did it fix the issue?

### 4. Abandonment Root Cause
If conversation ended WITHOUT successful logging, why?

## Verdict
- **EFFICIENT** — ≤2 turns, clean completion.
- **ACCEPTABLE** — Extra turns, but ALL caused by genuinely missing user info.
- **FRICTION** — At least one extra turn caused by bot error.
- **BROKEN** — User correction wasn't applied, or abandoned due to bot failure.

## JSON output
Return ONLY valid JSON:
{
  "verdict": "EFFICIENT | ACCEPTABLE | FRICTION | BROKEN",
  "task_completed": true/false,
  "friction_turns": [{"turn": <number>, "cause": "user | bot", "description": "<1 sentence>"}],
  "recovery_quality": "good | partial | failed | not_needed",
  "abandonment_reason": "<empty string if completed>",
  "reasoning": "<2-3 sentence assessment>",
  "rule_compliance": [{"rule_id": "<exact rule_id>", "followed": true | false, "evidence": "<1 sentence>"}]
}"""


EFFICIENCY_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["EFFICIENT", "ACCEPTABLE", "FRICTION", "BROKEN"]},
        "task_completed": {"type": "boolean"},
        "friction_turns": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "turn": {"type": "integer"},
                    "cause": {"type": "string", "enum": ["user", "bot"]},
                    "description": {"type": "string"},
                },
                "required": ["turn", "cause", "description"],
            },
        },
        "recovery_quality": {"type": "string", "enum": ["good", "partial", "failed", "not_needed"]},
        "abandonment_reason": {"type": "string"},
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
    "required": ["verdict", "task_completed", "friction_turns", "recovery_quality", "abandonment_reason", "reasoning", "rule_compliance"],
}


class EfficiencyEvaluator:
    """Evaluates conversation efficiency and recovery (async)."""

    def __init__(self, llm_provider: BaseLLMProvider):
        self.llm = llm_provider

    async def evaluate_thread(self, thread: ConversationThread) -> EfficiencyEvaluation:
        transcript = self._format_transcript(thread)
        rules = get_rules_for_efficiency()
        rules_block = self._format_rules(rules)

        eval_prompt = (
            f"### Conversation thread ({thread.message_count} turns, {thread.duration_seconds:.0f}s)\n\n"
            f"{transcript}\n\n{rules_block}\n"
            "Evaluate this conversation now. Check EACH rule above."
        )

        try:
            result = await self.llm.generate_json(
                prompt=eval_prompt,
                system_prompt=EFFICIENCY_JUDGE_PROMPT,
                json_schema=EFFICIENCY_JSON_SCHEMA,
            )
            return self._parse_result(thread, result, rules)
        except Exception as e:
            return EfficiencyEvaluation(
                thread=thread, verdict="FRICTION", task_completed=False,
                reasoning=f"Judge error: {e}",
            )

    @staticmethod
    def _format_transcript(thread: ConversationThread) -> str:
        lines = []
        for i, msg in enumerate(thread.messages, 1):
            ts = msg.timestamp.strftime("%H:%M:%S")
            img_tag = " [image attached]" if msg.has_image else ""
            lines.append(
                f"**Turn {i}** ({ts}) [{msg.intent_detected}/{msg.intent_query_type}]\n"
                f"  User: {msg.query_text}{img_tag}\n"
                f"  Bot: {msg.final_response_message[:1200]}"
                + ("..." if len(msg.final_response_message) > 1200 else "")
            )
        return "\n\n".join(lines)

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
    def _parse_result(thread: ConversationThread, raw: dict, rules: Optional[List[PromptRule]] = None) -> EfficiencyEvaluation:
        verdict = raw.get("verdict", "FRICTION")
        if verdict not in ("EFFICIENT", "ACCEPTABLE", "FRICTION", "BROKEN"):
            verdict = "FRICTION"

        rule_compliance = []
        if rules:
            rule_compliance = EfficiencyEvaluator._parse_rule_compliance(
                raw.get("rule_compliance", []), rules,
            )

        recovery_quality = raw.get("recovery_quality", "not needed").upper().replace("_", " ")
        friction_turns = raw.get("friction_turns", [])
        for ft in friction_turns:
            if "cause" in ft:
                ft["cause"] = ft["cause"].upper().replace("_", " ")

        return EfficiencyEvaluation(
            thread=thread, verdict=verdict,
            task_completed=raw.get("task_completed", False),
            friction_turns=friction_turns,
            recovery_quality=recovery_quality,
            abandonment_reason=raw.get("abandonment_reason", ""),
            reasoning=raw.get("reasoning", ""),
            rule_compliance=rule_compliance,
        )
