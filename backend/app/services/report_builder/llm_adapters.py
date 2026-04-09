"""
LLM adapters for the report builder chat.

Each adapter wraps a provider's native SDK for multi-turn chat with
function calling. Credential resolution uses the shared settings_helper.
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


# ── Response shape (same for all adapters) ────────────────────────

class ChatResponse:
    """Normalized chat response across providers."""
    __slots__ = ("content", "tool_calls")

    def __init__(self, content: str = "", tool_calls: list[dict] | None = None):
        self.content = content
        self.tool_calls = tool_calls or []


# ── Credential resolution (shared) ───────────────────────────────

async def _resolve_credentials(provider: str, tenant_id: str, user_id: str) -> dict:
    from app.services.evaluators.settings_helper import get_llm_settings_from_db
    return await get_llm_settings_from_db(
        tenant_id=tenant_id,
        user_id=user_id,
        provider_override=provider,
        auth_intent="interactive",
    )


# ── Gemini adapter ────────────────────────────────────────────────

async def chat_gemini(
    *,
    model: str,
    system_instruction: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    temperature: float,
    tenant_id: str,
    user_id: str,
) -> ChatResponse:
    """
    Multi-turn chat with function calling via google-genai SDK.
    Uses client.aio.chats for native thought-signature handling.
    """
    from google import genai
    from google.genai import types as genai_types
    from app.services.evaluators.llm_base import GeminiProvider, create_llm_provider

    creds = await _resolve_credentials("gemini", tenant_id, user_id)
    provider = create_llm_provider(
        provider="gemini",
        api_key=creds.get("api_key", ""),
        model_name=model,
        temperature=temperature,
        service_account_path=creds.get("service_account_path", ""),
    )
    assert isinstance(provider, GeminiProvider)
    client = provider.client

    # Build tool declarations
    declarations = []
    for tool in tools:
        func = tool.get("function", tool)  # support flat or wrapped
        declarations.append(genai_types.FunctionDeclaration(
            name=func["name"],
            description=func.get("description", ""),
            parameters_json_schema=func.get("parameters"),
        ))
    gemini_tools = [genai_types.Tool(function_declarations=declarations)]

    config = genai_types.GenerateContentConfig(
        temperature=temperature,
        system_instruction=system_instruction,
        tools=gemini_tools,
        automatic_function_calling=genai_types.AutomaticFunctionCallingConfig(disable=True),
    )

    # Create async chat — SDK manages history + thought signatures
    chat = client.aio.chats.create(model=model, config=config)

    # Replay prior turns into chat history (skip system — already in config)
    last_user_text = ""
    for msg in messages:
        role = msg.get("role", "")
        if role == "system":
            continue
        elif role == "user":
            last_user_text = msg.get("content", "")
            chat._curated_history.append(genai_types.Content(
                role="user",
                parts=[genai_types.Part.from_text(text=last_user_text)],
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
                chat._curated_history.append(genai_types.Content(role="model", parts=parts))
            else:
                content = msg.get("content", "")
                if content:
                    chat._curated_history.append(genai_types.Content(
                        role="model",
                        parts=[genai_types.Part.from_text(text=content)],
                    ))
        elif role == "tool":
            try:
                result = json.loads(msg.get("content", "{}"))
            except Exception:
                result = {"result": msg.get("content", "")}
            chat._curated_history.append(genai_types.Content(
                role="user",
                parts=[genai_types.Part.from_function_response(
                    name="tool_result", response=result,
                )],
            ))

    # Pop the last user message — send it via send_message
    if chat._curated_history and chat._curated_history[-1].role == "user":
        last = chat._curated_history.pop()
        if last.parts and hasattr(last.parts[0], "text"):
            last_user_text = last.parts[0].text or ""

    if not last_user_text:
        return ChatResponse()

    resp = await chat.send_message(last_user_text)

    # Convert to normalized response
    if resp.function_calls:
        tool_calls = []
        for i, fc in enumerate(resp.function_calls):
            tool_calls.append({
                "id": f"call_{i}",
                "function": {
                    "name": fc.name,
                    "arguments": json.dumps(dict(fc.args) if fc.args else {}),
                },
            })
        return ChatResponse(tool_calls=tool_calls)

    return ChatResponse(content=resp.text or "")


# ── OpenAI / Azure adapter ────────────────────────────────────────

async def chat_openai(
    *,
    model: str,
    system_instruction: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    temperature: float,
    tenant_id: str,
    user_id: str,
    azure: bool = False,
) -> ChatResponse:
    """
    Multi-turn chat with function calling via openai SDK.
    Messages are passed directly — OpenAI format is the native format.
    """
    import openai

    provider_name = "azure_openai" if azure else "openai"
    creds = await _resolve_credentials(provider_name, tenant_id, user_id)

    if azure:
        client = openai.AsyncAzureOpenAI(
            api_key=creds.get("api_key", ""),
            azure_endpoint=creds.get("azure_endpoint", ""),
            api_version=creds.get("api_version", "2025-03-01-preview"),
        )
    else:
        client = openai.AsyncOpenAI(api_key=creds.get("api_key", ""))

    # Wrap flat tool defs into OpenAI format if needed
    openai_tools = []
    for tool in tools:
        if "type" in tool and "function" in tool:
            openai_tools.append(tool)
        else:
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("parameters", {}),
                },
            })

    resp = await client.chat.completions.create(
        model=model,
        messages=messages,
        tools=openai_tools,
        temperature=temperature,
    )

    choice = resp.choices[0]
    if choice.message.tool_calls:
        tool_calls = [
            {
                "id": tc.id,
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                },
            }
            for tc in choice.message.tool_calls
        ]
        return ChatResponse(tool_calls=tool_calls)

    return ChatResponse(content=choice.message.content or "")


# ── Anthropic adapter ─────────────────────────────────────────────

async def chat_anthropic(
    *,
    model: str,
    system_instruction: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    temperature: float,
    tenant_id: str,
    user_id: str,
) -> ChatResponse:
    """Multi-turn chat with function calling via anthropic SDK."""
    import anthropic

    creds = await _resolve_credentials("anthropic", tenant_id, user_id)
    client = anthropic.AsyncAnthropic(api_key=creds.get("api_key", ""))

    # Filter out system messages (Anthropic uses separate system param)
    filtered = [m for m in messages if m.get("role") != "system"]

    # Convert tool defs to Anthropic format
    anthropic_tools = [
        {
            "name": (t.get("function", t))["name"],
            "description": (t.get("function", t)).get("description", ""),
            "input_schema": (t.get("function", t)).get("parameters", {}),
        }
        for t in tools
    ]

    resp = await client.messages.create(
        model=model,
        system=system_instruction,
        messages=filtered,
        tools=anthropic_tools,
        temperature=temperature,
        max_tokens=4096,
    )

    tool_calls = []
    text_parts = []
    for block in resp.content:
        if block.type == "text":
            text_parts.append(block.text)
        elif block.type == "tool_use":
            tool_calls.append({
                "id": block.id,
                "function": {
                    "name": block.name,
                    "arguments": json.dumps(block.input),
                },
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
    *,
    provider: str,
    model: str,
    system_instruction: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    temperature: float = 0.3,
    tenant_id: str,
    user_id: str,
) -> ChatResponse:
    adapter = ADAPTERS.get(provider)
    if not adapter:
        raise ValueError(f"Unsupported provider: {provider}")
    return await adapter(
        model=model,
        system_instruction=system_instruction,
        messages=messages,
        tools=tools,
        temperature=temperature,
        tenant_id=tenant_id,
        user_id=user_id,
    )
