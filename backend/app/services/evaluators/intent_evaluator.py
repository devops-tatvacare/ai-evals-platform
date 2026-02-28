"""Intent classification evaluator (async).

Ported from kaira-evals/src/evaluators/intent_evaluator.py.

The valid agent and query_type enums are extracted from the system prompt at
init time.  The system prompt is the single source of truth — it contains
lines like:
  "CRITICAL: You can ONLY classify to these agents: FoodAgent, CgmAgent, ..."
  "Agents: FoodAgent, CgmAgent, FoodInsightAgent, General, Greeting"
  'Query types: "logging" (recording data) or "question" (asking info)'

If parsing fails, hardcoded Kaira defaults are used as a safety net.
"""
import logging
import re
from typing import List, Optional

from app.services.evaluators.llm_base import BaseLLMProvider
from app.services.evaluators.models import ChatMessage, IntentEvaluation

logger = logging.getLogger(__name__)

# ─── Canonical Kaira defaults (fallback when system prompt parsing fails) ─────

KAIRA_DEFAULT_AGENTS = [
    "FoodAgent",
    "CgmAgent",
    "FoodInsightAgent",
    "General",
    "Greeting",
]

KAIRA_DEFAULT_QUERY_TYPES = [
    "logging",
    "question",
]


def _normalize_intent(value: str) -> str:
    """Normalize intent string for comparison.

    Strips whitespace, lowercases, and collapses underscores/spaces so that
    'Meal_Logger', 'MealLogger', and 'meal logger' all compare equal.
    """
    return value.strip().lower().replace("_", "").replace(" ", "")


def _parse_agents_from_prompt(system_prompt: str) -> List[str]:
    """Extract agent enum values from the system prompt text.

    Looks for patterns like:
      "classify to these agents: FoodAgent, CgmAgent, ..."
      "Agents: FoodAgent, CgmAgent, FoodInsightAgent, General, Greeting"
      "ONLY classify to these agents: X, Y, Z"
    """
    if not system_prompt:
        return []

    # Pattern: optional "classify to these" prefix, then "agents:" followed by
    # comma-separated PascalCase/camelCase identifiers.
    pattern = (
        r'(?:classify\s+(?:to\s+)?(?:these\s+)?)?'
        r'agents\s*:\s*'
        r'([A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)+)'
    )
    matches = re.findall(pattern, system_prompt, re.IGNORECASE)

    if not matches:
        return []

    # Use the last match (the definitive list, not a preamble mention)
    agents_str = matches[-1]
    agents = [a.strip() for a in agents_str.split(",") if a.strip()]

    if agents:
        logger.info("Parsed %d agents from system prompt: %s", len(agents), agents)

    return agents


def _parse_query_types_from_prompt(system_prompt: str) -> List[str]:
    """Extract query_type enum values from the system prompt text.

    Looks for patterns like:
      'Query types: "logging" (recording data) or "question" (asking info)'
      'query_type: "logging|question"'
    """
    if not system_prompt:
        return []

    # Pattern 1: Query types: "X" ... or "Y" ...
    # Extracts quoted words after "Query types:"
    m = re.search(r'query\s*types?\s*:', system_prompt, re.IGNORECASE)
    if m:
        # Grab the rest of the line (or until next newline)
        rest = system_prompt[m.end():].split("\n")[0]
        quoted = re.findall(r'"([a-z_]+)"', rest)
        if quoted:
            logger.info("Parsed %d query_types from system prompt: %s", len(quoted), quoted)
            return quoted

    # Pattern 2: "logging|question" inside query_type field description
    pipe_match = re.search(r'query_type["\s:]*["\']([a-z_]+(?:\|[a-z_]+)+)["\']', system_prompt, re.IGNORECASE)
    if pipe_match:
        types = pipe_match.group(1).split("|")
        logger.info("Parsed %d query_types from pipe notation: %s", len(types), types)
        return types

    return []


def _build_json_schema(
    valid_intents: Optional[List[str]] = None,
    valid_query_types: Optional[List[str]] = None,
) -> dict:
    """Build intent JSON schema, constraining enum values when available."""
    agent_prop: dict = {"type": "string"}
    if valid_intents:
        agent_prop["enum"] = sorted(valid_intents)

    qtype_prop: dict = {"type": "string"}
    if valid_query_types:
        qtype_prop["enum"] = sorted(valid_query_types)

    return {
        "type": "object",
        "description": "Intent classification result for a single user query, including predicted agent, query type, confidence, and reasoning.",
        "properties": {
            "predicted_agent": {
                **agent_prop,
                "description": "The predicted intent/agent category for this user query. Must be one of the allowed agent values from the system prompt.",
            },
            "query_type": {
                **qtype_prop,
                "description": "The query type classification (e.g. 'logging' for recording data, 'question' for asking information).",
            },
            "confidence": {
                "type": "number",
                "description": "Confidence score between 0.0 and 1.0 indicating how certain the classification is.",
            },
            "reasoning": {
                "type": "string",
                "description": "Brief explanation of why this agent and query type were chosen, citing specific query keywords or context.",
            },
            "all_predictions": {
                "type": "object",
                "description": "Optional map of all considered agent categories to their confidence scores. Keys are agent names, values are floats 0.0-1.0.",
            },
        },
        "required": ["predicted_agent", "query_type", "confidence", "reasoning"],
    }


class IntentEvaluator:
    """Evaluates intent classification using LLM-as-judge (async).

    Valid agent and query_type enums are resolved in priority order:
    1. Explicitly passed valid_intents / valid_query_types (caller override)
    2. Parsed from system_prompt text
    3. Kaira defaults (KAIRA_DEFAULT_AGENTS / KAIRA_DEFAULT_QUERY_TYPES)
    """

    def __init__(
        self,
        llm_provider: BaseLLMProvider,
        system_prompt: str = "",
        valid_intents: Optional[List[str]] = None,
        valid_query_types: Optional[List[str]] = None,
    ):
        self.llm = llm_provider
        self.system_prompt = system_prompt or ""  # F2: coerce None to empty string

        # Resolve valid intents: explicit > parsed from prompt > Kaira defaults
        if valid_intents:
            self.valid_intents = valid_intents
        else:
            parsed = _parse_agents_from_prompt(system_prompt)
            if parsed:
                self.valid_intents = parsed
            else:
                self.valid_intents = list(KAIRA_DEFAULT_AGENTS)
                if system_prompt:
                    logger.warning(
                        "Could not parse agent enum from system prompt, "
                        "falling back to Kaira defaults: %s",
                        self.valid_intents,
                    )

        # Resolve valid query types: explicit > parsed from prompt > Kaira defaults
        if valid_query_types:
            self.valid_query_types = valid_query_types
        else:
            parsed_qt = _parse_query_types_from_prompt(system_prompt)
            if parsed_qt:
                self.valid_query_types = parsed_qt
            else:
                self.valid_query_types = list(KAIRA_DEFAULT_QUERY_TYPES)

        self._json_schema = _build_json_schema(self.valid_intents, self.valid_query_types)

    async def evaluate_message(
        self, message: ChatMessage,
        conversation_history: Optional[List[ChatMessage]] = None,
        thinking: str = "low",
    ) -> IntentEvaluation:
        history_context = ""
        if conversation_history:
            history_context = "Conversation History:\n"
            for i, msg in enumerate(conversation_history[-3:], 1):
                history_context += f"Turn {i}: User: {msg.query_text}\n"
                history_context += f"        Bot: {msg.final_response_message[:100]}...\n\n"

        # Build enum constraint instructions for the prompt
        intent_constraint = ""
        if self.valid_intents:
            intent_constraint += (
                f"\n\nIMPORTANT — predicted_agent MUST be one of these exact values: "
                f"{self.valid_intents}"
            )
        if self.valid_query_types:
            intent_constraint += (
                f"\nIMPORTANT — query_type MUST be one of these exact values: "
                f"{self.valid_query_types}"
            )

        eval_prompt = f"""{history_context}
User Query: "{message.query_text}"

Classify this query according to the system prompt. Return a JSON response with your
independent classification — do NOT guess or assume what the production system chose.{intent_constraint}"""

        result = await self.llm.generate_json(
            prompt=eval_prompt,
            system_prompt=self.system_prompt,
            json_schema=self._json_schema,
            thinking=thinking,
        )

        predicted_intent = result.get("predicted_agent", "Unknown")
        predicted_query_type = result.get("query_type", "unknown")
        confidence = result.get("confidence", 0.0)
        reasoning = result.get("reasoning", "")
        all_predictions = result.get("all_predictions", {})

        # Normalized comparison as safety net (handles residual case/underscore drift)
        is_correct_intent = _normalize_intent(predicted_intent) == _normalize_intent(message.intent_detected)

        # F7: Skip query_type comparison when ground truth is missing/empty
        gt_query_type = (message.intent_query_type or "").strip()
        if not gt_query_type:
            is_correct_query_type = None  # ground truth unavailable
        else:
            is_correct_query_type = _normalize_intent(predicted_query_type) == _normalize_intent(gt_query_type)

        return IntentEvaluation(
            message=message,
            predicted_intent=predicted_intent,
            predicted_query_type=predicted_query_type,
            confidence=confidence,
            is_correct_intent=is_correct_intent,
            is_correct_query_type=is_correct_query_type,
            reasoning=reasoning,
            all_predictions=all_predictions,
        )

    async def evaluate_thread(
        self, messages: List[ChatMessage], thinking: str = "low",
    ) -> List[IntentEvaluation]:
        evaluations = []
        for i, message in enumerate(messages):
            history = messages[:i] if i > 0 else None
            eval_result = await self.evaluate_message(message, history, thinking=thinking)
            evaluations.append(eval_result)
        return evaluations
