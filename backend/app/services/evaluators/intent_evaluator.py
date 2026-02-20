"""Intent classification evaluator (async).

Ported from kaira-evals/src/evaluators/intent_evaluator.py.
"""
from typing import List, Optional

from app.services.evaluators.llm_base import BaseLLMProvider
from app.services.evaluators.models import ChatMessage, IntentEvaluation

INTENT_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "predicted_agent": {"type": "string"},
        "query_type": {"type": "string"},
        "confidence": {"type": "number"},
        "reasoning": {"type": "string"},
        "all_predictions": {"type": "object"},
    },
    "required": ["predicted_agent", "query_type", "confidence", "reasoning"],
}


class IntentEvaluator:
    """Evaluates intent classification using LLM-as-judge (async)."""

    def __init__(self, llm_provider: BaseLLMProvider, system_prompt: str = ""):
        self.llm = llm_provider
        self.system_prompt = system_prompt

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

        eval_prompt = f"""{history_context}
User Query: "{message.query_text}"

Classify this query according to the system prompt. Return a JSON response with your
independent classification — do NOT guess or assume what the production system chose."""

        result = await self.llm.generate_json(
            prompt=eval_prompt,
            system_prompt=self.system_prompt,
            json_schema=INTENT_JSON_SCHEMA,
            thinking=thinking,
        )

        predicted_intent = result.get("predicted_agent", "Unknown")
        predicted_query_type = result.get("query_type", "unknown")
        confidence = result.get("confidence", 0.0)
        reasoning = result.get("reasoning", "")
        all_predictions = result.get("all_predictions", {})

        return IntentEvaluation(
            message=message,
            predicted_intent=predicted_intent,
            predicted_query_type=predicted_query_type,
            confidence=confidence,
            is_correct_intent=predicted_intent == message.intent_detected,
            is_correct_query_type=predicted_query_type == message.intent_query_type,
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
