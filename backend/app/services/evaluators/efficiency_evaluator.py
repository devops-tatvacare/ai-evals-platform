"""Conversation Efficiency & Recovery Evaluator (async).

Ported from kaira-evals/src/evaluators/efficiency_evaluator.py.
"""
from typing import List, Optional

from app.services.evaluators.llm_base import BaseLLMProvider
from app.services.evaluators.models import ConversationThread, EfficiencyEvaluation, RuleCompliance
from app.services.evaluators.rule_catalog import get_rules_for_efficiency, PromptRule

EFFICIENCY_JUDGE_SYSTEM_PROMPT = """You are a conversation-quality auditor for a health-assistant chatbot that logs meals.

You will receive a complete conversation thread. Your job is to produce a structured evaluation of the conversation's efficiency, task outcome, and rule compliance.

CONTEXT

The ideal meal-logging flow completes in 2 turns: the user describes food, the bot shows a summary with confirmation action chips, done. Any turn beyond that is friction. Friction is either justified (user failed to provide required information) or unjustified (bot made an error).

CORRECT BOT BEHAVIORS (do NOT count as friction):
- Asking for meal time when the user did not provide one
- Asking for quantity when the user's description is ambiguous
- Rejecting a future meal time
- Asking what food the user wants to log when only quantity or time was given
- Treating a composite dish (e.g. "porridge with almonds and honey") as a single item
- Asking for confirmation before logging

BOT ERRORS (count as friction, cause = "bot"):
- Re-asking for time or quantity that the user already provided
- Accepting a future meal time without questioning it
- Guessing or assuming a food item when the user only gave quantity or time
- Splitting a composite dish into separate line items
- Showing incorrect calorie values or extracting the wrong food
- Ignoring a user correction or repeating the same mistake after correction

EVALUATION TASKS

1. TASK COMPLETION
Determine whether the user's intended action completed correctly. A task is complete ONLY when the correct data was logged. If the bot said "logged" but used wrong quantities, wrong foods, or ignored a user correction, task_completed MUST be false.

2. FRICTION ANALYSIS
For every turn after the first two, assign cause "user" or "bot" with a one-sentence description. If a turn exists only because the bot made an error in the previous turn, cause is "bot".

3. RECOVERY QUALITY
If the user corrected the bot at any point during the conversation:
- "good": Bot applied the correction immediately and correctly in the next response.
- "partial": Bot fixed some aspects but not all, or needed multiple attempts.
- "failed": Bot ignored the correction, repeated the same error, or introduced a new one.
- "not_needed": The user never corrected the bot.

4. FAILURE REASON
If task_completed is false, state the specific root cause in one sentence. If task_completed is true, return an empty string. Do not speculate; describe only what is observable in the transcript.

VERDICT CRITERIA

Apply exactly one verdict per the rules below. Do not interpolate between levels. Evaluate both axes independently: (1) did the bot make errors? (2) did the task complete?

- EFFICIENT: Task completed correctly in 2 turns or fewer. No friction of any kind. Bot behaved correctly.
- ACCEPTABLE: Task completed correctly but took more than 2 turns. Every extra turn was caused by the user not providing required information. The bot behaved correctly throughout.
- INCOMPLETE: Task did NOT complete, but the bot made NO errors in the available turns. The conversation data is truncated, the user chose not to continue (e.g. clicked edit then stopped), or the user abandoned for reasons unrelated to bot behavior. Use this when there is no evidence of bot error causing the incompletion.
- FRICTION: At least one extra turn was caused by a bot error, but the conversation eventually recovered and reached a correct outcome, or the bot error did not prevent task completion.
- BROKEN: A bot error directly caused task failure. The bot ignored a user correction and persisted the same error, OR the bot logged incorrect data despite the user pointing out the mistake, OR the user abandoned the conversation because the bot could not recover from its own error. Requires evidence of bot error in the transcript.

OUTPUT FORMAT

Return strictly valid JSON with no surrounding text, no markdown fencing, no commentary. Every field is required."""


EFFICIENCY_JSON_SCHEMA = {
    "type": "object",
    "description": "Structured evaluation of a single conversation thread's efficiency, task outcome, friction, recovery, and rule compliance.",
    "properties": {
        "verdict": {
            "type": "string",
            "enum": ["EFFICIENT", "ACCEPTABLE", "INCOMPLETE", "FRICTION", "BROKEN"],
            "description": "Overall efficiency verdict. EFFICIENT: completed correctly in 2 or fewer turns. ACCEPTABLE: extra turns all caused by user, task completed. INCOMPLETE: task did not complete but no bot error is present (truncated data, user stopped). FRICTION: at least one bot-caused extra turn but task completed. BROKEN: bot error directly caused task failure.",
        },
        "task_completed": {
            "type": "boolean",
            "description": "True ONLY if the user's intended action completed with correct data. False if the bot logged wrong data, ignored a correction, or the conversation ended without achieving the goal. A bot message containing 'logged' does NOT make this true if the logged data was incorrect.",
        },
        "friction_turns": {
            "type": "array",
            "description": "One entry per turn beyond the first two. Empty array if conversation was 2 turns or fewer.",
            "items": {
                "type": "object",
                "description": "A single friction turn analysis.",
                "properties": {
                    "turn": {
                        "type": "integer",
                        "description": "The 1-based turn number in the conversation.",
                    },
                    "cause": {
                        "type": "string",
                        "enum": ["user", "bot"],
                        "description": "Who caused this extra turn. 'user' if the user failed to provide required info. 'bot' if the bot made an error that necessitated the extra turn.",
                    },
                    "description": {
                        "type": "string",
                        "description": "One sentence explaining why this turn was needed.",
                    },
                },
                "required": ["turn", "cause", "description"],
            },
        },
        "recovery_quality": {
            "type": "string",
            "enum": ["good", "partial", "failed", "not_needed"],
            "description": "How well the bot recovered after a user correction. 'good': corrected immediately. 'partial': fixed some but not all issues. 'failed': ignored correction or repeated error. 'not_needed': user never corrected the bot.",
        },
        "failure_reason": {
            "type": "string",
            "description": "If task_completed is false, one sentence stating the root cause of failure. If task_completed is true, this MUST be an empty string.",
        },
        "reasoning": {
            "type": "string",
            "description": "Two to three sentence assessment of the overall conversation quality, covering what went well and what went wrong.",
        },
        "rule_compliance": {
            "type": "array",
            "description": "One entry per production rule provided in the prompt. Every rule must be evaluated.",
            "items": {
                "type": "object",
                "description": "Compliance check for a single production rule.",
                "properties": {
                    "rule_id": {
                        "type": "string",
                        "description": "The exact rule_id as provided in the rules list.",
                    },
                    "followed": {
                        "type": "boolean",
                        "description": "True if the bot followed this rule throughout the conversation. False if it violated the rule at any point.",
                    },
                    "evidence": {
                        "type": "string",
                        "description": "One sentence citing specific turn(s) or bot behavior as evidence.",
                    },
                },
                "required": ["rule_id", "followed", "evidence"],
            },
        },
    },
    "required": ["verdict", "task_completed", "friction_turns", "recovery_quality", "failure_reason", "reasoning", "rule_compliance"],
}


class EfficiencyEvaluator:
    """Evaluates conversation efficiency and recovery (async)."""

    def __init__(self, llm_provider: BaseLLMProvider):
        self.llm = llm_provider

    async def evaluate_thread(self, thread: ConversationThread, thinking: str = "low") -> EfficiencyEvaluation:
        transcript = self._format_transcript(thread)
        rules = get_rules_for_efficiency()
        rules_block = self._format_rules(rules)

        eval_prompt = (
            f"CONVERSATION THREAD: {thread.message_count} turns, {thread.duration_seconds:.0f} seconds\n\n"
            f"{transcript}\n\n"
            f"{rules_block}\n\n"
            "Evaluate this conversation. Produce a compliance entry for every rule listed above. "
            "Do not omit any rule. Do not invent rules not listed."
        )

        result = await self.llm.generate_json(
            prompt=eval_prompt,
            system_prompt=EFFICIENCY_JUDGE_SYSTEM_PROMPT,
            json_schema=EFFICIENCY_JSON_SCHEMA,
            thinking=thinking,
        )
        return self._parse_result(thread, result, rules)

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
        lines = [
            "PRODUCTION RULES TO EVALUATE",
            "You must include one rule_compliance entry for each rule below.\n",
        ]
        for i, r in enumerate(rules, 1):
            lines.append(f"{i}. {r.rule_id} [{r.section}]: {r.rule_text}")
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
        if verdict not in ("EFFICIENT", "ACCEPTABLE", "INCOMPLETE", "FRICTION", "BROKEN"):
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
            failure_reason=raw.get("failure_reason") or raw.get("abandonment_reason", ""),
            reasoning=raw.get("reasoning", ""),
            rule_compliance=rule_compliance,
        )
