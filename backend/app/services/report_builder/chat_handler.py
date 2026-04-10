"""
Report builder chat surface.
Wires report-specific tools and system prompt into the shared chat engine.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.chat_engine import create_adapter, run_tool_loop
from app.services.report_builder.tool_definitions import resolve_tools
from app.services.report_builder.tool_handlers import dispatch_tool_call

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are an AI assistant for an evaluation analytics platform called Sherlock. \
You answer questions about evaluation data and help build custom reports.

CRITICAL ROUTING — read the user's intent carefully:
- Questions about DATA (scores, pass rates, trends, failures, comparisons, "show me", \
"what happened", "which", "how many") → use DATA EXPLORER tools. Query the database FIRST.
- Requests to BUILD or COMPOSE a report layout → use REPORT BUILDER tools.
- If unsure → default to DATA EXPLORER. Users usually want answers, not report configs.

DATA EXPLORER TOOLS (use these to answer questions):
- query_eval_runs: List recent runs with stats. START HERE for most data questions.
- get_run_summary: Deep dive into one run's results.
- compare_runs: Diff two runs — what improved, what regressed.
- query_threads: List individual thread results. Filter by verdict to find failures.
- get_app_stats: Aggregate stats across all runs (totals, distributions, averages).
- get_report_section: Pull a specific pre-computed section (compliance_table, friction_analysis, exemplars, etc.). Most detailed tool for analytical questions.
- get_thread_detail: Rule outcomes, transcript excerpt, and friction turns for one thread.
- get_rule_compliance: Per-rule pass/fail breakdown and co-failure patterns for a run.
- query_adversarial: Adversarial test results — goal achievement, difficulty, traits.

REPORT BUILDER TOOLS (use these only when user explicitly wants a report layout):
- list_section_types: Available report section types.
- get_section_detail: Details on one section type.
- list_app_sections: What sections the app supports.
- compose_report: Build a report config for preview.
- save_template: Persist a report config. Only when user says "save".

RESPONSE FORMAT:
- Be concise. Lead with the answer, not the methodology.
- Format data as markdown tables when showing lists of runs or threads.
- Use bold for key numbers: **78% pass rate**, **12 failures**.
- When comparing, use ▲/▼ arrows: **▲ +5% pass rate**, **▼ -3 threads passing**.
- Short IDs only (first 8 chars of UUIDs).
- Never dump raw JSON. Summarize and format for humans.
- Never explain what tools you're calling or why. Just call them and present results.
"""

MAX_TOOL_ROUNDS = 5


def _summarize_tool_result(name: str, result_str: str) -> str:
    """Extract a short label from a tool result for the UI badge."""
    try:
        data = json.loads(result_str)
    except (json.JSONDecodeError, TypeError):
        return "done"

    if name == "list_section_types":
        sections = data.get("sections", [])
        return f"{len(sections)} types"
    if name == "list_app_sections":
        app_id = data.get("app_id", "")
        sections = data.get("sections", [])
        return f"{app_id} · {len(sections)} sections" if app_id else f"{len(sections)} sections"
    if name == "get_section_detail":
        return data.get("key", data.get("label", "done"))
    if name == "compose_report":
        sections = data.get("sections", [])
        return f"{len(sections)} sections"
    if name == "save_template":
        return data.get("report_name", "saved")
    if name == "query_eval_runs":
        count = data.get("count", 0)
        return f"{count} runs"
    if name == "get_run_summary":
        return data.get("name", "") or str(data.get("id", ""))[:8]
    if name == "compare_runs":
        ra = data.get("run_a", {}).get("id", "?")
        rb = data.get("run_b", {}).get("id", "?")
        return f"{ra} vs {rb}"
    if name == "query_threads":
        count = data.get("count", 0)
        return f"{count} threads"
    if name == "get_app_stats":
        return f"{data.get('total_runs', 0)} runs"
    if name == "get_report_section":
        return data.get("section_type", data.get("title", "done"))
    if name == "get_thread_detail":
        return data.get("thread_id", "done")
    if name == "get_rule_compliance":
        rules = data.get("rules", [])
        return f"{len(rules)} rules"
    if name == "query_adversarial":
        return f"{data.get('total', 0)} cases"
    return "done"


async def _resolve_tools_for_app(app_id: str, db: AsyncSession) -> list[dict[str, Any]]:
    """Resolve tools from App.config.chat.capabilities. Falls back to all tools."""
    from sqlalchemy import select
    from app.models.app import App

    result = await db.execute(
        select(App.config).where(App.slug == app_id, App.is_active.is_(True))
    )
    config = result.scalar_one_or_none()
    capabilities = None
    if config:
        chat_config = (config or {}).get("chat", {})
        capabilities = chat_config.get("capabilities")
    return resolve_tools(capabilities)


async def run_chat_turn(
    session: dict[str, Any],
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
    tools = await _resolve_tools_for_app(session["app_id"], db)

    adapter = await create_adapter(
        provider=provider,
        model=model,
        tenant_id=session["tenant_id"],
        user_id=session["user_id"],
    )

    session["messages"].append(adapter.build_user_message(user_message))

    composed_report: dict | None = None
    tool_call_log: list[dict[str, str]] = []

    async def dispatch(name: str, arguments: dict) -> str:
        nonlocal composed_report

        result_str = await dispatch_tool_call(
            name, arguments,
            db=db,
            tenant_id=session["tenant_id"],
            user_id=session["user_id"],
            app_id=session["app_id"],
        )

        if name == "compose_report":
            parsed = json.loads(result_str)
            if parsed.get("status") == "ok":
                composed_report = parsed

        if name == "save_template":
            await db.commit()

        summary = _summarize_tool_result(name, result_str)
        tool_call_log.append({"name": name, "summary": summary})

        return result_str

    text, session["messages"] = await run_tool_loop(
        adapter=adapter,
        messages=session["messages"],
        tools=tools,
        system=SYSTEM_PROMPT,
        temperature=0.3,
        dispatch_fn=dispatch,
        max_rounds=MAX_TOOL_ROUNDS,
    )

    if text is None:
        text = "I've reached the maximum number of tool calls for this turn. Please try a simpler request."

    return {
        "role": "assistant",
        "content": text,
        "tool_calls": tool_call_log,
        "composed_report": composed_report,
    }


async def run_chat_turn_streaming(
    session: dict[str, Any],
    user_message: str,
    *,
    provider: str,
    model: str,
    db: AsyncSession,
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Generator version of run_chat_turn that yields SSE-style event dicts.
    Each yielded dict has {"event": str, "data": dict}.
    """
    tools = await _resolve_tools_for_app(session["app_id"], db)

    adapter = await create_adapter(
        provider=provider,
        model=model,
        tenant_id=session["tenant_id"],
        user_id=session["user_id"],
    )

    session["messages"].append(adapter.build_user_message(user_message))

    composed_report: dict | None = None
    tool_call_log: list[dict[str, str]] = []
    event_queue: list[dict[str, Any]] = []

    async def dispatch(name: str, arguments: dict) -> str:
        nonlocal composed_report

        event_queue.append({"event": "tool_call_start", "data": {"name": name}})

        result_str = await dispatch_tool_call(
            name, arguments,
            db=db,
            tenant_id=session["tenant_id"],
            user_id=session["user_id"],
            app_id=session["app_id"],
        )

        summary = _summarize_tool_result(name, result_str)
        tool_call_log.append({"name": name, "summary": summary})
        event_queue.append({"event": "tool_call_end", "data": {"name": name, "summary": summary}})

        if name == "compose_report":
            parsed = json.loads(result_str)
            if parsed.get("status") == "ok":
                composed_report = parsed

        if name == "save_template":
            await db.commit()

        return result_str

    text, session["messages"] = await run_tool_loop(
        adapter=adapter,
        messages=session["messages"],
        tools=tools,
        system=SYSTEM_PROMPT,
        temperature=0.3,
        dispatch_fn=dispatch,
        max_rounds=MAX_TOOL_ROUNDS,
    )

    if text is None:
        text = "I've reached the maximum number of tool calls for this turn. Please try a simpler request."

    # Yield all queued tool call events
    for event in event_queue:
        yield event

    # Yield content
    yield {"event": "content_delta", "data": {"delta": text}}

    # Yield done
    composed_out = None
    if composed_report:
        composed_out = {
            "reportName": composed_report.get("report_name"),
            "sections": composed_report.get("sections", []),
        }

    yield {
        "event": "done",
        "data": {
            "toolCalls": tool_call_log,
            "composedReport": composed_out,
        },
    }
