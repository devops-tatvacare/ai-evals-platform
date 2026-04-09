"""
LLM adapters for the report builder chat.
Each adapter wraps a provider's native SDK for chat with function calling.
Credentials resolved via shared settings_helper.
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


class ChatResponse:
    __slots__ = ("content", "tool_calls")

    def __init__(self, content: str = "", tool_calls: list[dict] | None = None):
        self.content = content
        self.tool_calls = tool_calls or []


async def _resolve_credentials(provider: str, tenant_id: str, user_id: str) -> dict:
    from app.services.evaluators.settings_helper import get_llm_settings_from_db
    return await get_llm_settings_from_db(
        tenant_id=tenant_id, user_id=user_id,
        provider_override=provider, auth_intent="interactive",
    )


# ── Gemini ────────────────────────────────────────────────────────

async def chat_gemini(
    *, model: str, system_instruction: str,
    messages: list[dict[str, Any]], tools: list[dict[str, Any]],
    temperature: float, tenant_id: str, user_id: str,
) -> ChatResponse:
    from google.genai import types as genai_types
    from app.services.evaluators.llm_base import GeminiProvider, create_llm_provider

    creds = await _resolve_credentials("gemini", tenant_id, user_id)
    provider = create_llm_provider(
        provider="gemini", api_key=creds.get("api_key", ""),
        model_name=model, temperature=temperature,
        service_account_path=creds.get("service_account_path", ""),
    )
    assert isinstance(provider, GeminiProvider)

    # Build tool declarations
    declarations = []
    for tool in tools:
        func = tool.get("function", tool)
        declarations.append(genai_types.FunctionDeclaration(
            name=func["name"],
            description=func.get("description", ""),
            parameters_json_schema=func.get("parameters"),
        ))
    gemini_tools = [genai_types.Tool(function_declarations=declarations)] if declarations else None

    # Convert messages to Gemini contents
    contents: list[genai_types.Content] = []
    for msg in messages:
        role = msg.get("role", "")
        if role == "system":
            continue
        elif role == "user":
            contents.append(genai_types.Content(
                role="user",
                parts=[genai_types.Part.from_text(text=msg.get("content", ""))],
            ))
        elif role == "assistant":
            tc_list = msg.get("tool_calls")
            if tc_list:
                parts = []
                for tc in tc_list:
                    func = tc.get("function", {})
                    try:
                        args = json.loads(func.get("arguments", "{}"))
                    except Exception:
                        args = {}
                    parts.append(genai_types.Part.from_function_call(
                        name=func.get("name", ""), args=args,
                    ))
                contents.append(genai_types.Content(role="model", parts=parts))
            else:
                content = msg.get("content", "")
                if content:
                    contents.append(genai_types.Content(
                        role="model",
                        parts=[genai_types.Part.from_text(text=content)],
                    ))
        elif role == "tool":
            try:
                result = json.loads(msg.get("content", "{}"))
            except Exception:
                result = {"result": msg.get("content", "")}
            contents.append(genai_types.Content(
                role="user",
                parts=[genai_types.Part.from_function_response(
                    name="tool_result", response=result,
                )],
            ))

    config = genai_types.GenerateContentConfig(
        temperature=temperature,
        system_instruction=system_instruction,
        tools=gemini_tools,
        automatic_function_calling=genai_types.AutomaticFunctionCallingConfig(disable=True),
    )

    resp = await provider.client.aio.models.generate_content(
        model=model, contents=contents, config=config,
    )

    # Parse response
    if resp.function_calls:
        return ChatResponse(tool_calls=[
            {
                "id": f"call_{i}",
                "function": {
                    "name": fc.name,
                    "arguments": json.dumps(dict(fc.args) if fc.args else {}),
                },
            }
            for i, fc in enumerate(resp.function_calls)
        ])

    return ChatResponse(content=resp.text or "")


# ── OpenAI / Azure ────────────────────────────────────────────────

async def chat_openai(
    *, model: str, system_instruction: str,
    messages: list[dict[str, Any]], tools: list[dict[str, Any]],
    temperature: float, tenant_id: str, user_id: str,
    azure: bool = False,
) -> ChatResponse:
    import openai

    creds = await _resolve_credentials("azure_openai" if azure else "openai", tenant_id, user_id)

    if azure:
        client = openai.AsyncAzureOpenAI(
            api_key=creds.get("api_key", ""),
            azure_endpoint=creds.get("azure_endpoint", ""),
            api_version=creds.get("api_version", "2025-03-01-preview"),
        )
    else:
        client = openai.AsyncOpenAI(api_key=creds.get("api_key", ""))

    openai_tools = [
        {"type": "function", "function": {
            "name": (t.get("function", t))["name"],
            "description": (t.get("function", t)).get("description", ""),
            "parameters": (t.get("function", t)).get("parameters", {}),
        }}
        for t in tools
    ]

    resp = await client.chat.completions.create(
        model=model, messages=messages,  # type: ignore[arg-type]
        tools=openai_tools, temperature=temperature,
    )

    choice = resp.choices[0]
    if choice.message.tool_calls:
        return ChatResponse(tool_calls=[
            {"id": tc.id, "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
            for tc in choice.message.tool_calls
        ])

    return ChatResponse(content=choice.message.content or "")


# ── Anthropic ─────────────────────────────────────────────────────

async def chat_anthropic(
    *, model: str, system_instruction: str,
    messages: list[dict[str, Any]], tools: list[dict[str, Any]],
    temperature: float, tenant_id: str, user_id: str,
) -> ChatResponse:
    import anthropic

    creds = await _resolve_credentials("anthropic", tenant_id, user_id)
    client = anthropic.AsyncAnthropic(api_key=creds.get("api_key", ""))

    filtered = [m for m in messages if m.get("role") != "system"]
    anthropic_tools = [
        {"name": (t.get("function", t))["name"],
         "description": (t.get("function", t)).get("description", ""),
         "input_schema": (t.get("function", t)).get("parameters", {})}
        for t in tools
    ]

    resp = await client.messages.create(
        model=model, system=system_instruction,
        messages=filtered, tools=anthropic_tools,  # type: ignore[arg-type]
        temperature=temperature, max_tokens=4096,
    )

    tool_calls, text_parts = [], []
    for block in resp.content:
        if block.type == "text":
            text_parts.append(block.text)
        elif block.type == "tool_use":
            tool_calls.append({
                "id": block.id,
                "function": {"name": block.name, "arguments": json.dumps(block.input)},
            })

    if tool_calls:
        return ChatResponse(content="".join(text_parts), tool_calls=tool_calls)
    return ChatResponse(content="".join(text_parts))


# ── Dispatcher ────────────────────────────────────────────────────

ADAPTERS = {
    "gemini": chat_gemini,
    "openai": chat_openai,
    "azure_openai": lambda **kw: chat_openai(**kw, azure=True),
    "anthropic": chat_anthropic,
}


async def chat_completion(
    *, provider: str, model: str, system_instruction: str,
    messages: list[dict[str, Any]], tools: list[dict[str, Any]],
    temperature: float = 0.3, tenant_id: str, user_id: str,
) -> ChatResponse:
    adapter = ADAPTERS.get(provider)
    if not adapter:
        raise ValueError(f"Unsupported provider: {provider}")
    return await adapter(
        model=model, system_instruction=system_instruction,
        messages=messages, tools=tools, temperature=temperature,
        tenant_id=tenant_id, user_id=user_id,
    )
