"""
Gemini-native chat adapter.
Messages are google.genai.types.Content objects — preserved as-is from SDK responses.
Serialization uses Pydantic model_dump/model_validate for storage.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.services.chat_engine.types import ToolCall

logger = logging.getLogger(__name__)


class GeminiAdapter:
    """
    Adapter for Gemini (AI Studio and Vertex AI).
    Messages are stored as genai_types.Content objects.
    Thought signatures, function call metadata — everything preserved natively.
    """

    def __init__(
        self,
        *,
        model: str,
        api_key: str = "",
        service_account_path: str = "",
    ):
        from app.services.evaluators.llm_base import GeminiProvider, create_llm_provider

        self._model = model
        self._provider = create_llm_provider(
            provider="gemini",
            api_key=api_key,
            model_name=model,
            temperature=0,
            service_account_path=service_account_path,
        )
        assert isinstance(self._provider, GeminiProvider)

    async def send(
        self,
        messages: list[Any],
        tools: list[dict[str, Any]],
        system: str,
        temperature: float,
    ) -> Any:
        from google.genai import types as genai_types

        declarations = []
        for tool in tools:
            func = tool.get("function", tool)
            declarations.append(genai_types.FunctionDeclaration(
                name=func["name"],
                description=func.get("description", ""),
                parameters_json_schema=func.get("parameters"),
            ))
        gemini_tools = [genai_types.Tool(function_declarations=declarations)] if declarations else None

        config = genai_types.GenerateContentConfig(
            temperature=temperature,
            system_instruction=system,
            tools=gemini_tools,
            automatic_function_calling=genai_types.AutomaticFunctionCallingConfig(disable=True),
        )

        return await self._provider.client.aio.models.generate_content(
            model=self._model, contents=messages, config=config,
        )

    def build_user_message(self, text: str) -> Any:
        from google.genai import types as genai_types

        return genai_types.Content(
            role="user",
            parts=[genai_types.Part.from_text(text=text)],
        )

    def build_tool_result(self, tool_call: ToolCall, result: str) -> Any:
        from google.genai import types as genai_types

        try:
            parsed = json.loads(result)
        except (json.JSONDecodeError, TypeError):
            parsed = {"result": result}

        return genai_types.Content(
            role="tool",
            parts=[genai_types.Part.from_function_response(
                name=tool_call.name, response=parsed,
            )],
        )

    def extract_response_message(self, response: Any) -> Any:
        """Return the raw Content object from the response. Preserves thought signatures."""
        return response.candidates[0].content

    def extract_tool_calls(self, response: Any) -> list[ToolCall]:
        fc_list = response.function_calls
        if not fc_list:
            return []
        return [
            ToolCall(
                id=f"call_{i}",
                name=fc.name,
                arguments=dict(fc.args) if fc.args else {},
            )
            for i, fc in enumerate(fc_list)
        ]

    def extract_text(self, response: Any) -> str:
        """Extract text content, skipping thinking parts."""
        parts = response.candidates[0].content.parts
        text_parts = []
        for part in parts:
            if getattr(part, "thought", False):
                continue
            if part.text:
                text_parts.append(part.text)
        return "".join(text_parts) if text_parts else ""

    def serialize(self, messages: list[Any]) -> list[dict]:
        """Serialize Content objects to dicts via Pydantic model_dump."""
        return [msg.model_dump() for msg in messages]

    def deserialize(self, data: list[dict]) -> list[Any]:
        """Reconstruct Content objects from stored dicts via Pydantic model_validate."""
        from google.genai import types as genai_types

        return [genai_types.Content.model_validate(d) for d in data]
