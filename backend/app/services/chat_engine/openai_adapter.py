"""
OpenAI-native chat adapter.
Messages are plain dicts in OpenAI Chat Completions format.
Also handles Azure OpenAI (same SDK, different client constructor).
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.services.chat_engine.types import ToolCall

logger = logging.getLogger(__name__)


class OpenAIAdapter:
    """
    Adapter for OpenAI and Azure OpenAI.
    Messages are stored as OpenAI Chat Completions message dicts.
    """

    def __init__(
        self,
        *,
        model: str,
        api_key: str,
        azure: bool = False,
        azure_endpoint: str = "",
        api_version: str = "2025-03-01-preview",
    ):
        import openai

        self._model = model
        if azure:
            self._client = openai.AsyncAzureOpenAI(
                api_key=api_key,
                azure_endpoint=azure_endpoint,
                api_version=api_version,
            )
        else:
            self._client = openai.AsyncOpenAI(api_key=api_key)

    async def send(
        self,
        messages: list[Any],
        tools: list[dict[str, Any]],
        system: str,
        temperature: float,
    ) -> Any:
        openai_tools = []
        for t in tools:
            func = t.get("function", t)
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": func["name"],
                    "description": func.get("description", ""),
                    "parameters": func.get("inputSchema", func.get("parameters", {})),
                },
            })

        full_messages = [{"role": "system", "content": system}, *messages]

        return await self._client.chat.completions.create(
            model=self._model,
            messages=full_messages,  # type: ignore[arg-type]
            tools=openai_tools,
            temperature=temperature,
        )

    async def send_stream(
        self,
        messages: list[Any],
        tools: list[dict[str, Any]],
        system: str,
        temperature: float,
    ):
        openai_tools = []
        for t in tools:
            func = t.get("function", t)
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": func["name"],
                    "description": func.get("description", ""),
                    "parameters": func.get("inputSchema", func.get("parameters", {})),
                },
            })

        full_messages = [{"role": "system", "content": system}, *messages]
        stream = await self._client.chat.completions.create(
            model=self._model,
            messages=full_messages,  # type: ignore[arg-type]
            tools=openai_tools,
            temperature=temperature,
            stream=True,
        )

        content_parts: list[str] = []
        tool_parts: dict[int, dict[str, Any]] = {}

        async for chunk in stream:
            for choice in chunk.choices:
                delta = choice.delta
                if delta.content:
                    content_parts.append(delta.content)
                    yield {"type": "text_delta", "delta": delta.content}
                if delta.tool_calls:
                    for tool_call in delta.tool_calls:
                        index = getattr(tool_call, "index", 0) or 0
                        acc = tool_parts.setdefault(index, {"id": "", "name": "", "arguments": ""})
                        if getattr(tool_call, "id", None):
                            acc["id"] = tool_call.id
                        func = getattr(tool_call, "function", None)
                        if func:
                            if getattr(func, "name", None):
                                acc["name"] = func.name
                            if getattr(func, "arguments", None):
                                acc["arguments"] += func.arguments

        message: dict[str, Any] = {
            "role": "assistant",
            "content": "".join(content_parts) or None,
        }
        tool_calls: list[ToolCall] = []
        if tool_parts:
            message["tool_calls"] = []
            for index in sorted(tool_parts):
                tool = tool_parts[index]
                message["tool_calls"].append(
                    {
                        "id": tool["id"],
                        "type": "function",
                        "function": {
                            "name": tool["name"],
                            "arguments": tool["arguments"],
                        },
                    }
                )
                try:
                    arguments = json.loads(tool["arguments"]) if tool["arguments"] else {}
                except json.JSONDecodeError:
                    arguments = {}
                tool_calls.append(
                    ToolCall(
                        id=tool["id"],
                        name=tool["name"],
                        arguments=arguments,
                    )
                )

        yield {"type": "response", "response": {"message": message, "tool_calls": tool_calls}}

    def build_user_message(self, text: str) -> dict:
        return {"role": "user", "content": text}

    def build_tool_result(self, tool_call: ToolCall, result: str) -> dict:
        return {"role": "tool", "tool_call_id": tool_call.id, "content": result}

    def build_tool_results(self, tool_calls: list[ToolCall], results: list[str]) -> list[dict]:
        return [
            self.build_tool_result(tool_call, result)
            for tool_call, result in zip(tool_calls, results, strict=True)
        ]

    def extract_response_message(self, response: Any) -> dict:
        """Extract message dict from OpenAI ChatCompletion response."""
        if isinstance(response, dict) and "message" in response:
            return response["message"]
        msg = response.choices[0].message
        d: dict[str, Any] = {"role": msg.role, "content": msg.content}
        if msg.tool_calls:
            d["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in msg.tool_calls
            ]
        return d

    def extract_tool_calls(self, response: Any) -> list[ToolCall]:
        if isinstance(response, dict) and "tool_calls" in response:
            return response["tool_calls"]
        msg = response.choices[0].message
        if not msg.tool_calls:
            return []
        return [
            ToolCall(
                id=tc.id,
                name=tc.function.name,
                arguments=json.loads(tc.function.arguments) if tc.function.arguments else {},
            )
            for tc in msg.tool_calls
        ]

    def extract_text(self, response: Any) -> str:
        if isinstance(response, dict) and "message" in response:
            return response["message"].get("content") or ""
        return response.choices[0].message.content or ""

    def _parse_tool_calls_from_message(self, msg: dict) -> list[ToolCall]:
        """Parse ToolCall objects from a stored message dict. Used for inspection."""
        tc_list = msg.get("tool_calls", [])
        result = []
        for tc in tc_list:
            func = tc.get("function", {})
            args_raw = func.get("arguments", "{}")
            try:
                args = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
            except json.JSONDecodeError:
                args = {}
            result.append(ToolCall(id=tc.get("id", ""), name=func.get("name", ""), arguments=args))
        return result

    def serialize(self, messages: list[Any]) -> list[dict]:
        return list(messages)

    def deserialize(self, data: list[dict]) -> list[Any]:
        return list(data)
