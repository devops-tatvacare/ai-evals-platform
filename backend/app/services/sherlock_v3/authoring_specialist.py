"""Sherlock v3 authoring_specialist — orchestration-builder sub-agent.

Mirrors `data_specialist.py` in shape: a single-purpose Agent that the
supervisor invokes via `as_tool(...)` only when the route handler has
attached a `BuilderSnapshot` AND the caller holds `orchestration:manage`.

One source of truth: this module imports `tool_specs()` and
`tool_handlers()` from `orchestration_authoring_pack` to construct its
`FunctionTool(strict_json_schema=True)` list. The pack owns the contract;
the specialist owns the SDK wiring. When the v3 harness eventually
auto-wires packs (per `docs/plans/sherlock-future-plan.md`), this
specialist's manual import becomes a one-line refactor.

Per [[Decisions/2026-05-10-agents-sdk-conformance-review|conformance review]]:
- §A: `as_tool()` takes no parameters JSON Schema; the supervisor sends
  free-text briefs and structured validation lives on this sub-agent's
  tools.
- §C: `apply_patch` config travels as JSON-encoded strings to satisfy
  strict_json_schema.
- §E: Canvas snapshot is baked into the system prompt at agent build
  time; no `describe_workflow` tool.
- §F: `extract_authoring_specialist_output` matches strictly on
  `apply_patch` — no "if only one tool, assume it" fallback because this
  specialist has multiple tools (apply_patch + 5 lookups).
- §I: ModelSettings(parallel_tool_calls=False, reasoning=effort='medium').
"""
from __future__ import annotations

import json
import logging
from typing import Any

import openai
from agents import Agent, FunctionTool
from agents.model_settings import ModelSettings
from agents.models.openai_responses import OpenAIResponsesModel
from openai.types.shared import Reasoning

from app.auth.context import AuthContext
from app.services.orchestration_authoring.builder_snapshot import BuilderSnapshot
from app.services.orchestration_authoring.orchestration_authoring_pack import (
    OrchestrationAuthoringPack,
    node_type_enum,
)
from app.services.sherlock_v3.azure_client import specialist_model

logger = logging.getLogger(__name__)


_AUTHORING_TOOL_TERMINAL = 'apply_patch'


def _build_system_prompt(
    *,
    app_id: str,
    builder_context: BuilderSnapshot,
) -> str:
    """Render the per-turn system prompt with the canvas snapshot baked in.

    The frontend keeps `definition.canvas` (cosmetics) and other heavy
    fields out of the prompt by passing only the persistence-shaped
    definition; we still strip `canvas` here as defense in depth.
    """
    definition = dict(builder_context.definition or {})
    definition.pop('canvas', None)
    snapshot = json.dumps({
        'workflow_id': str(builder_context.workflow_id),
        'workflow_type': builder_context.workflow_type,
        'app_id': builder_context.app_id,
        'view_mode': builder_context.view_mode,
        'selected_node_id': builder_context.selected_node_id,
        'data_hash': builder_context.data_hash,
        'definition': definition,
    }, default=str, indent=2)
    enum_list = ', '.join(node_type_enum())

    return f"""\
Role: Sherlock — orchestration authoring specialist.

# Goal
Translate the user's authoring intent into a single CanvasPatch that the
frontend applier will animate onto the live canvas. You read the canvas
state below; you propose edits via `apply_patch`. The user reviews and
saves manually.

# App
{app_id}

# Canvas snapshot (this turn — frozen)
{snapshot}

# Available node types (from NODE_REGISTRY at boot)
{enum_list}

# Tools
- `list_node_types(category?)`           — palette enumeration
- `list_provider_connections(provider)`  — tenant + app scoped
- `list_action_templates(channel)`       — tenant + app scoped
- `list_wati_templates(connection_id)`   — per-connection re-checked
- `list_cohort_datasets()`               — tenant + app scoped
- `apply_patch(ops_json, rationale)`     — TERMINAL — emit one CanvasPatch

# Operating rules
1. Lookups first, patch last. UUIDs you reference in `apply_patch`
   (connection_id / dataset_version_id / action_template_id) MUST come
   from a `list_*` call you made THIS TURN. Inventing UUIDs will be
   rejected with reason_code=UUID_NOT_AUTHORIZED.
2. `ops_json` is a JSON-encoded array of ops. Each op is
   `{{op, node_id, payload}}`:
   - `add_node`: payload is `{{node_type, position?, config}}`. `config` is
     a JSON OBJECT (not a nested string).
   - `update_node_config`: payload is `{{config_patch}}` — a shallow merge.
   - `connect`: payload is `{{source_node_id, output_id, target_node_id, edge_id}}`.
   - `remove_node`: payload `{{}}` (cascades edges).
3. Do NOT claim work is "saved", "live", or "published". You only
   propose patches; the user clicks Save / Publish.
4. If the user asks for live execution, refuse politely in one line.
5. `view_mode='view'` in the snapshot above means the canvas is
   read-only. The supervisor only constructs you with `'edit'`; if you
   somehow see 'view' anyway, ask the user to switch to edit.

# Stop rules
Stop after one successful `apply_patch`. On `status=error`, regenerate
once and try again. After two failures, surface the error to the user.
"""


def build_authoring_specialist(
    client: openai.AsyncAzureOpenAI,
    app_id: str,
    *,
    builder_context: BuilderSnapshot,
    auth: AuthContext,
) -> Agent:
    """Construct the authoring_specialist Agent for one turn.

    `builder_context` and `auth` are required — the supervisor never
    builds this agent without them. They're not used directly here
    (handlers read them off `ctx.context`), but threading them through
    documents the binding and lets the system prompt close over the
    snapshot.
    """
    del auth  # consumed by the per-tool re-checks via ctx.context.auth

    pack = OrchestrationAuthoringPack()
    handlers = pack.tool_handlers()

    # Typed as `list[Any]` because `Agent(tools=...)` annotates the
    # parameter as `list[Tool]` (invariant) — `FunctionTool` is one of
    # several concrete `Tool` types and a plain `list[FunctionTool]`
    # is not assignable.
    function_tools: list[Any] = []
    for spec in pack.tool_specs():
        name = spec['name']
        description = pack.describe_tools(app_id).get(
            name, spec.get('description', '')
        )
        function_tools.append(
            FunctionTool(
                name=name,
                description=description,
                params_json_schema=spec['params_json_schema'],
                on_invoke_tool=handlers[name],
                strict_json_schema=True,
            )
        )

    system_prompt = _build_system_prompt(
        app_id=app_id, builder_context=builder_context,
    )

    return Agent(
        name='sherlock-authoring-specialist',
        instructions=system_prompt,
        model=OpenAIResponsesModel(specialist_model(), client),
        model_settings=ModelSettings(
            parallel_tool_calls=False,
            reasoning=Reasoning(effort='medium'),
        ),
        tools=function_tools,
    )


# ─────────────────────── as_tool output extractor ───────────────────────


async def extract_authoring_specialist_output(run_result: Any) -> str:
    """Strict match on `apply_patch` — no defaulting to "the only tool".

    Walk `new_items` in reverse, take the most recent
    `tool_call_output_item` whose tool name is `apply_patch`, return its
    JSON output. Fall back to `final_output` text only when no tool was
    called (clarifying-question turns).
    """
    new_items = list(getattr(run_result, 'new_items', []) or [])
    for item in reversed(new_items):
        if not _is_tool_output_for(item, _AUTHORING_TOOL_TERMINAL):
            continue
        output = getattr(item, 'output', None)
        if isinstance(output, str) and output.strip():
            return output
        if isinstance(output, dict):
            return json.dumps(output, default=str)
    final_output = getattr(run_result, 'final_output', None)
    return final_output if isinstance(final_output, str) else ''


def _is_tool_output_for(item: Any, tool_name: str) -> bool:
    """Strict tool-name match (no fallback) — see Decision §F."""
    item_type = getattr(item, 'type', None)
    if item_type != 'tool_call_output_item':
        return False
    raw = getattr(item, 'raw_item', None)
    if isinstance(raw, dict):
        return raw.get('name') == tool_name
    name_attr = getattr(raw, 'name', None)
    return isinstance(name_attr, str) and name_attr == tool_name


__all__ = [
    'build_authoring_specialist',
    'extract_authoring_specialist_output',
]
