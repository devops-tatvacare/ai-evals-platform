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
                parameters_json_schema=func.get("inputSchema", func.get("parameters")),
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

    async def send_stream(
        self,
        messages: list[Any],
        tools: list[dict[str, Any]],
        system: str,
        temperature: float,
    ):
        from google.genai import types as genai_types

        declarations = []
        for tool in tools:
            func = tool.get("function", tool)
            declarations.append(genai_types.FunctionDeclaration(
                name=func["name"],
                description=func.get("description", ""),
                parameters_json_schema=func.get("inputSchema", func.get("parameters")),
            ))
        gemini_tools = [genai_types.Tool(function_declarations=declarations)] if declarations else None

        config = genai_types.GenerateContentConfig(
            temperature=temperature,
            system_instruction=system,
            tools=gemini_tools,
            automatic_function_calling=genai_types.AutomaticFunctionCallingConfig(disable=True),
        )

        stream = await self._provider.client.aio.models.generate_content_stream(
            model=self._model,
            contents=messages,
            config=config,
        )

        from google.genai import types as genai_types

        text_parts: list[str] = []
        tool_calls_by_index: dict[int, ToolCall] = {}
        final_content: Any | None = None
        role = "model"

        async for chunk in stream:
            candidate = getattr(chunk, "candidates", [None])[0]
            candidate_content = getattr(candidate, "content", None)
            if candidate_content is not None and getattr(candidate_content, "role", None):
                role = candidate_content.role
            if candidate_content is not None and getattr(candidate_content, "parts", None):
                final_content = candidate_content

            text_delta = getattr(chunk, "text", None)
            if text_delta:
                text_parts.append(text_delta)
                yield {"type": "text_delta", "delta": text_delta}

            function_calls = getattr(chunk, "function_calls", None) or []
            for index, function_call in enumerate(function_calls):
                tool_calls_by_index[index] = ToolCall(
                    id=function_call.id or f"call_{index}",
                    name=function_call.name or "",
                    arguments=dict(function_call.args) if function_call.args else {},
                )

        if final_content is None:
            final_content = genai_types.Content(
                role=role,
                parts=[genai_types.Part.from_text(text="".join(text_parts))] if text_parts else [],
            )

        yield {
            "type": "response",
            "response": {
                "message_content": final_content,
                "tool_calls": [tool_calls_by_index[index] for index in sorted(tool_calls_by_index)],
                "text": "".join(text_parts),
            },
        }

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
            role="user",
            parts=[
                genai_types.Part(
                    function_response=genai_types.FunctionResponse(
                        id=tool_call.id or None,
                        name=tool_call.name,
                        response=parsed,
                    )
                )
            ],
        )

    def build_tool_results(self, tool_calls: list[ToolCall], results: list[str]) -> list[Any]:
        from google.genai import types as genai_types

        parts = []
        for tool_call, result in zip(tool_calls, results, strict=True):
            try:
                parsed = json.loads(result)
            except (json.JSONDecodeError, TypeError):
                parsed = {"result": result}
            parts.append(
                genai_types.Part(
                    function_response=genai_types.FunctionResponse(
                        id=tool_call.id or None,
                        name=tool_call.name,
                        response=parsed,
                    )
                )
            )
        return [genai_types.Content(role="user", parts=parts)]

    def extract_response_message(self, response: Any) -> Any:
        """Return the raw Content object from the response. Preserves thought signatures."""
        if isinstance(response, dict) and "message_content" in response:
            return response["message_content"]
        return response.candidates[0].content

    def extract_tool_calls(self, response: Any) -> list[ToolCall]:
        if isinstance(response, dict) and "tool_calls" in response:
            return response["tool_calls"]
        fc_list = response.function_calls
        if not fc_list:
            return []
        return [
            ToolCall(
                id=fc.id or f"call_{i}",
                name=fc.name,
                arguments=dict(fc.args) if fc.args else {},
            )
            for i, fc in enumerate(fc_list)
        ]

    def extract_text(self, response: Any) -> str:
        """Extract text content, skipping thinking parts."""
        if isinstance(response, dict) and "text" in response:
            return response["text"]
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
