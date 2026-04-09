"""
Multi-turn chat orchestrator for the report builder.
Manages conversation state, LLM calls with tools, and tool dispatch.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.report_builder.llm_adapters import chat_completion
from app.services.report_builder.tool_definitions import TOOLS
from app.services.report_builder.tool_handlers import dispatch_tool_call

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are a report builder assistant. Users describe what they want to see in an \
evaluation report using natural language. Your job is to translate their intent \
into a structured report configuration by selecting and arranging the right \
section types.

WORKFLOW:
1. When the user describes what they want, call list_section_types to see available \
   building blocks.
2. Match the user's intent to section types based on descriptions and use_when hints.
3. If you need more detail about a section type, call get_section_detail.
4. Call list_app_sections to see what the user's app already supports.
5. Use compose_report to propose a configuration. The frontend will show a live preview.
6. Iterate with the user — add, remove, reorder sections based on their feedback.
7. Only call save_template when the user explicitly says to save.

RULES:
- Never ask the user to name section types. Map their natural language to types yourself.
- Be concise. Show what you're building, don't explain the system.
- When proposing sections, briefly explain WHY each maps to their request.
- If the user's request doesn't map to any section type, say so honestly.
"""

MAX_TOOL_ROUNDS = 5


class ChatSession:
    """In-memory conversation state for one builder session."""

    def __init__(self, app_id: str, tenant_id: str, user_id: str):
        self.app_id = app_id
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
        ]

    def add_user_message(self, content: str) -> None:
        self.messages.append({"role": "user", "content": content})

    def add_assistant_message(self, content: str) -> None:
        self.messages.append({"role": "assistant", "content": content})

    def add_tool_call(self, tool_call_id: str, name: str, arguments: str) -> None:
        self.messages.append({
            "role": "assistant",
            "tool_calls": [{
                "id": tool_call_id,
                "type": "function",
                "function": {"name": name, "arguments": arguments},
            }],
        })

    def add_tool_result(self, tool_call_id: str, content: str) -> None:
        self.messages.append({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": content,
        })


async def run_chat_turn(
    session: ChatSession,
    user_message: str,
    *,
    provider: str,
    model: str,
    db: AsyncSession,
) -> dict[str, Any]:
    """
    Process one user message through the LLM with tool calling.
    Returns the final assistant response + any composed report config.
    """
    session.add_user_message(user_message)

    composed_report: dict | None = None

    for _round in range(MAX_TOOL_ROUNDS):
        response = await chat_completion(
            provider=provider,
            model=model,
            system_instruction=SYSTEM_PROMPT,
            messages=session.messages,
            tools=TOOLS,
            temperature=0.3,
            tenant_id=session.tenant_id,
            user_id=session.user_id,
        )

        if not response.tool_calls:
            session.add_assistant_message(response.content)
            return {
                "role": "assistant",
                "content": response.content,
                "composed_report": composed_report,
            }

        for tc in response.tool_calls:
            func = tc.get("function", {})
            tool_name = func.get("name", "")
            raw_args = func.get("arguments", "{}")
            tool_call_id = tc.get("id", f"tc_{_round}")

            try:
                arguments = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except json.JSONDecodeError:
                arguments = {}

            logger.info("Report builder tool call: %s(%s)", tool_name, list(arguments.keys()))

            result_str = await dispatch_tool_call(
                tool_name,
                arguments,
                db=db,
                tenant_id=session.tenant_id,
                user_id=session.user_id,
                app_id=session.app_id,
            )

            if tool_name == "compose_report":
                parsed = json.loads(result_str)
                if parsed.get("status") == "ok":
                    composed_report = parsed

            if tool_name == "save_template":
                await db.commit()

            session.add_tool_call(tool_call_id, tool_name, raw_args)
            session.add_tool_result(tool_call_id, result_str)

    content = "I've reached the maximum number of tool calls for this turn. Please try a simpler request."
    session.add_assistant_message(content)
    return {
        "role": "assistant",
        "content": content,
        "composed_report": composed_report,
    }
