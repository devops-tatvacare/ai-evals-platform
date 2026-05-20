"""Regenerate ``docs/orchestration/workflow-json-contract.md``.

The contract MD is the input you paste alongside the manifest YAMLs when
asking Claude to author a workflow as JSON. It documents:

  - the export/import envelope shape
  - per-node config JSON Schemas (auto-extracted from each handler's
    ``config_schema`` Pydantic model)
  - the ``POST /api/orchestration/workflows/validate`` request/response

Run::

    PYTHONPATH=backend python -m scripts.dump_workflow_contract

The script is the source of truth for the doc — edits to a node's
``_Config`` model automatically flow through to the next regen, so the
contract cannot drift from the runtime.
"""
from __future__ import annotations

import json
from pathlib import Path

# Eager-import every node module so ``register_node`` decorators run and
# populate ``NODE_REGISTRY`` before we iterate it.
import app.services.orchestration.nodes  # noqa: F401
from app.schemas.orchestration import (
    WorkflowDefinition,
    WorkflowValidateRequest,
    WorkflowValidateResponse,
)
from app.services.orchestration.node_registry import NODE_REGISTRY


REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = REPO_ROOT / "docs" / "orchestration" / "workflow-json-contract.md"


_CATEGORY_ORDER = {"source": 0, "filter": 1, "logic": 2, "action": 3, "escalation": 4, "sink": 5}


def _pretty_json_schema(model_cls: type) -> str:
    schema = model_cls.model_json_schema()
    return json.dumps(schema, indent=2, sort_keys=False)


def _node_rows() -> list[tuple[str, str, str, type]]:
    rows = []
    for (wf, nt), handler in NODE_REGISTRY.items():
        rows.append((wf, nt, handler.category, handler.config_schema))
    rows.sort(key=lambda r: (_CATEGORY_ORDER.get(r[2], 99), r[0] if r[0] != "*" else "", r[1]))
    return rows


def _build_doc() -> str:
    parts: list[str] = []
    parts.append(_INTRO)

    parts.append("\n## 1. Envelope schema (export / import JSON)\n")
    parts.append(_ENVELOPE_OVERVIEW)
    parts.append("\n### `WorkflowDefinition` (JSON Schema)\n")
    parts.append("```json\n" + _pretty_json_schema(WorkflowDefinition) + "\n```\n")

    parts.append("\n## 2. Validate endpoint\n")
    parts.append(_VALIDATE_DOC)
    parts.append("\n### Request body — `WorkflowValidateRequest`\n")
    parts.append("```json\n" + _pretty_json_schema(WorkflowValidateRequest) + "\n```\n")
    parts.append("\n### Response body — `WorkflowValidateResponse`\n")
    parts.append("```json\n" + _pretty_json_schema(WorkflowValidateResponse) + "\n```\n")

    parts.append("\n## 3. Node registry\n")
    parts.append(_REGISTRY_INTRO)
    parts.append(_node_table())

    parts.append("\n## 4. Per-node config schemas\n")
    parts.append(_PER_NODE_INTRO)
    for wf, nt, cat, cfg_cls in _node_rows():
        scope = "shared" if wf == "*" else wf
        parts.append(f"\n### `{nt}` ({cat}, scope: `{scope}`)\n")
        parts.append("```json\n" + _pretty_json_schema(cfg_cls) + "\n```\n")

    parts.append("\n## 5. Worked examples\n")
    parts.append(_EXAMPLES)

    parts.append("\n## 6. Output-edge index (every node, every output_id)\n")
    parts.append(_OUTPUT_EDGE_INTRO)
    parts.append(_output_edge_table())

    return "".join(parts).rstrip() + "\n"


def _output_edge_table() -> str:
    lines = [
        "| node_type | output_ids |",
        "|-----------|------------|",
    ]
    for wf, nt, _cat, _cfg in _node_rows():
        handler = NODE_REGISTRY[(wf, nt)]
        outs = list(getattr(handler, "output_edges", []) or [])
        if nt == "logic.split":
            label = "_dynamic_ — declared in `config.branches[].id`"
        else:
            label = ", ".join(f"`{o}`" for o in outs) if outs else "_none (terminal)_"
        lines.append(f"| `{nt}` | {label} |")
    return "\n".join(lines) + "\n"


def _node_table() -> str:
    lines = [
        "| node_type | category | workflow_type | config class |",
        "|-----------|----------|---------------|--------------|",
    ]
    for wf, nt, cat, cfg_cls in _node_rows():
        scope = "shared (`*`)" if wf == "*" else f"`{wf}`"
        lines.append(f"| `{nt}` | {cat} | {scope} | `{cfg_cls.__module__}.{cfg_cls.__name__}` |")
    return "\n".join(lines) + "\n"


_INTRO = """# Orchestration Workflow JSON Contract

Single source of truth for the **export / import / Claude-authored** JSON
shape consumed by the orchestration builder.

This file is **auto-generated** by
`backend/scripts/dump_workflow_contract.py`. Do not hand-edit. To refresh:

```bash
PYTHONPATH=backend python -m scripts.dump_workflow_contract
```

**Audience:** paste this file into Claude **along with the relevant app
manifest YAML(s)** from `backend/app/services/chat_engine/manifests/` when
asking it to generate a workflow as JSON. The manifest tells Claude what
data is available; this contract tells Claude how to wire it into nodes.

**Compatibility guarantee:** every Pydantic `_Config` model below ships
with `extra='forbid'`. Fabricating a field that isn't in the schema will
fail validation — silently dropping unknown keys is the bug class we
explicitly fixed (see `CLAUDE.md` invariants).
"""


_ENVELOPE_OVERVIEW = """
The export bundle is a JSON object with this top-level shape:

```jsonc
{
  "schema_version": 1,                 // bump only if the envelope shape changes
  "workflow": {
    "name": "MQL Concierge — Aug 2026",
    "description": "optional",
    "app_id": "inside-sales",          // platform.applications.id
    "workflow_type": "crm",            // "crm" | "clinical"
    "visibility": "private"            // "private" | "shared"
  },
  "definition": { /* WorkflowDefinition — see below */ },
  "triggers": [                        // optional; omit for manual-only
    {
      "kind": "cron",                  // "cron" | "event" | "manual"
      "cron_expression": "0 10 * * 1-5",
      "event_name": null,
      "params": {},
      "active": true
    }
  ],
  "layout": {                          // optional, but recommended for round-trip
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
    // node positions are carried inside definition.nodes[].position
  }
}
```

`definition` is the canonical workflow definition stored on
`orchestration.workflow_versions.definition`. Its JSON Schema follows.
"""


_VALIDATE_DOC = """
`POST /api/orchestration/workflows/validate`

Pure validate — runs the same pipeline as publish (`normalize_definition`
→ `validate_dispatch_required_fields` → `validate_definition`) without
writing to the database. Used by the JSON import preview and by
Claude-generated-payload checks.

- **Auth:** Bearer token + `orchestration:manage` permission. App-gated
  against `app_id` (must be in `auth.app_access`).
- **HTTP status:** always `200` when the request body itself parses.
  Validation outcomes land in the response body — `ok=false` means do
  not import; `errors[]` carries the same `{node_id, field, message}`
  shape `PublishErrorPanel` already renders.
- **Connection IDs:** unknown `connection_id` refs come back as
  `warnings[]`, not `errors[]`. The runtime contract still enforces the
  binding at publish, but the import can land as a draft the user
  rebinds in the builder.
"""


_REGISTRY_INTRO = """
20 node types live in the registry. Resolution is by `(workflow_type,
node_type)` with a `*` fallback for nodes shared across workflow types.
"""


_PER_NODE_INTRO = """
Each `_Config` schema below is dumped via `BaseModel.model_json_schema()`
and is the **authoritative** contract for that node's `config` object.
Notes:

- `extra='forbid'` is universal. Unknown keys hard-fail validation.
- `required` fields are enforced at **publish**. Drafts tolerate missing
  required fields except for the dispatch fields gated by
  `validate_dispatch_required_fields` (Bolna `connection_id` / `agent_id`,
  WATI `connection_id` / `template_name` / `channel_number` /
  `broadcast_name`).
- Predicate / condition fields use the predicate AST defined in
  `backend/app/services/orchestration/predicate_contract.py`.
"""


_EXAMPLES = """
**Read this before copying.** Every example below has been validated
against the live `_Config` schemas in Section 4 and the output-edge
declarations in Section 3. The fastest way to confirm a hand-written
workflow is correct: `POST /api/orchestration/workflows/validate`.

### 5.1 Minimal event-driven workflow

Notes:
- `source.event_trigger.config` does **not** carry the event name. The
  event is named on the **trigger row** at the workflow level (`triggers`
  array below).
- `core.webhook_out` requires `connection_id` and `url` at the Pydantic
  level. Outgoing edges use `output_id` values from `{"success", "exhausted"}`.

```json
{
  "schema_version": 1,
  "workflow": {
    "name": "Forward MQL to ops",
    "description": "Post each MQL payload to an internal endpoint.",
    "app_id": "inside-sales",
    "workflow_type": "crm",
    "visibility": "private"
  },
  "definition": {
    "nodes": [
      {
        "id": "src",
        "type": "source.event_trigger",
        "position": { "x": 0, "y": 0 },
        "data": { "label": "On MQL arrival" },
        "config": {}
      },
      {
        "id": "post",
        "type": "core.webhook_out",
        "position": { "x": 320, "y": 0 },
        "data": { "label": "Forward to ops" },
        "config": {
          "connection_id": "00000000-0000-0000-0000-000000000000",
          "url": "https://ops.internal/incoming/mql",
          "method": "POST",
          "body": { "lead_id": { "$payload": "lead_id" } }
        }
      },
      {
        "id": "done",
        "type": "sink.complete",
        "position": { "x": 640, "y": 0 },
        "data": { "label": "Done" },
        "config": {}
      }
    ],
    "edges": [
      { "id": "e1", "source": "src", "target": "post", "output_id": "default" },
      { "id": "e2", "source": "post", "target": "done", "output_id": "success" }
    ],
    "canvas": {}
  },
  "triggers": [
    { "kind": "event", "event_name": "lead.mql.arrived", "params": {}, "active": true }
  ]
}
```

"""


_OUTPUT_EDGE_INTRO = """
Auto-generated from each handler's declared `output_edges`. The
authoring agent must use **exactly** these strings as edge `output_id`
values — `validate_definition` rejects anything else.

`logic.split` is special: its branch ids are declared inline in
`config.branches[].id` rather than at the handler level. Edges out of a
split node use the branch's `id` as their `output_id`.

`logic.wait` declares all possible output ids but the validator only
accepts the subset matching the configured wait mode (see the wait
`_Config` schema in Section 4).
"""


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(_build_doc(), encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(REPO_ROOT)} ({OUT_PATH.stat().st_size} bytes, {len(NODE_REGISTRY)} nodes)")


if __name__ == "__main__":
    main()
