# Sherlock v2 — Design Specification

> **Sherlock — A Data Detective**
>
> Rewrite of the Sherlock chat-to-analytics agent. Replaces the current LLM-orchestrated tool loop with a constrained agent architecture that delivers predictable SQL generation, faithful chart rendering, and clean integration with the analytics library, dashboards, and report blueprints.

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Architecture Overview](#2-architecture-overview)
3. [Entity Recognition (Forced Pre-Step)](#3-entity-recognition)
4. [Tool Inventory](#4-tool-inventory)
5. [Semantic Model & DB Catalog](#5-semantic-model--db-catalog)
6. [Agent Loop & Orchestration](#6-agent-loop--orchestration)
7. [SQL Generation & Validation](#7-sql-generation--validation)
8. [Result Verification](#8-result-verification)
9. [Chart Binding](#9-chart-binding)
10. [Blueprint System](#10-blueprint-system)
11. [Integration Flows](#11-integration-flows)
12. [Frontend Chat Widget](#12-frontend-chat-widget)
13. [Streaming Protocol](#13-streaming-protocol)
14. [Session & State Management](#14-session--state-management)
15. [Transport Reliability Fixes](#15-transport-reliability-fixes)
16. [Persona & System Prompt](#16-persona--system-prompt)
17. [Visual References](#17-visual-references)
18. [What Stays vs. What Changes](#18-what-stays-vs-what-changes)

---

## 1. Problem Statement

### Current Failures

| Symptom | Root Cause |
|---------|-----------|
| Missing GROUP BY | LLM can't distinguish pre-aggregated columns from raw columns; no join cardinality info |
| Bad time series | No `time_dimensions` concept; temporal detection relies on column name regex |
| Blank charts | No result verification; 0-row results rendered as empty charts |
| Swapped axes | LLM picks x/y arbitrarily; no column role metadata (dimension vs measure) |
| Random orchestration | LLM controls tool order; skips entity resolution ~30% of the time |
| Stuck UI | Stream EOF has no fallback; `send()` promise hangs forever if `done` event never fires |
| Context loss | Invalid session ID silently creates new conversation |
| Tool call collision | Frontend keys tool badges by name, not call ID; repeated tools misrepresented |
| Stale history order | Sherlock turns don't update parent `chat_sessions.updated_at` |

### Design Goals

1. **Predictable SQL**: Correct GROUP BY, proper time series handling, no hallucinated columns
2. **No blank charts**: Every chart backed by verified non-empty data
3. **Correct axes**: Deterministic axis binding from column metadata, not LLM guessing
4. **Structured orchestration**: Forced context loading, agent freedom within guardrails
5. **Reliable transport**: No hung streams, no silent session resets, clean error states
6. **Clean integrations**: Charts → library, dashboards → analytics page, blueprints → report wizard — all ID-based, config-driven

---

## 2. Architecture Overview

```
User Question
      │
      ▼
┌─────────────────────────────────────────────────────┐
│ FORCED: Entity Recognition (structured output call)  │
│  Input:  question + scratchpad + entity type registry│
│  Output: {entities[], is_platform_query, needs_resolution}│
│  Gate:   is_platform_query=false → graceful reject   │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ FORCED: Context Assembly                             │
│  - Load app-specific entity type registry            │
│  - Load scratchpad (prior entities, active filters)  │
│  - Inject into agent system prompt:                  │
│    recognized entities, session state, persona       │
│  - Set tool_choice="any" for round 1 if             │
│    needs_resolution=true                             │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ AGENT LOOP (ReAct, max 8 rounds)                     │
│                                                       │
│  Round 1: tool_choice="any" (forced tool call)       │
│  Round 2+: tool_choice="auto" (agent decides)        │
│                                                       │
│  Tools: catalog_inspect, catalog_relations,           │
│         catalog_values, catalog_sample,               │
│         data_check, data_query, data_records,         │
│         blueprint_blocks, blueprint_compose,          │
│         blueprint_save, blueprint_list                │
│                                                       │
│  Agent SEES query results and reasons about them.    │
│  Agent uses any SQL technique the question demands.  │
│  Agent self-corrects on empty/wrong results.         │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ FORCED: Chart Binding (deterministic)                │
│  - Column roles from DB catalog metadata             │
│  - Auto-assign axes: temporal→X, measure→Y           │
│  - Pick best chart type from data shape              │
│  - Agent can override type / provide title           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ FORCED: Response Assembly                            │
│  - Inline save toasts for charts/dashboards/         │
│    blueprints with navigation links                  │
│  - Update scratchpad with resolved entities,         │
│    active filters, analysis snapshots                │
│  - Finalize assistant message + persist state        │
└─────────────────────────────────────────────────────┘
```

### Core Principle

> The LLM does three things: (1) understand the question, (2) call tools to explore schema and data, (3) generate SQL. Everything else — entity scoping, axis binding, chart selection, result verification, access control — is deterministic code.

---

## 3. Entity Recognition

### Purpose

Classify the user's question before the agent loop starts. Determine if it's a platform analytics question, extract typed entity references, and gate the pipeline.

### Implementation

A **separate, fast LLM call** with structured output (`response_format: json_schema`). Not a tool — code that runs before the agent loop.

**Input:**
- User question
- Scratchpad context (prior resolved entities, active filters)
- Entity type registry for the current app

**Entity Type Registry** (derived from semantic model dimensions + app config, ~10–15 types per app):

```json
{
  "entity_types": [
    {"name": "eval_type", "description": "Type of evaluation run", "examples": ["adversarial", "batch", "call quality"]},
    {"name": "run_reference", "description": "Reference to a run by name, ID, or recency", "examples": ["last run", "nightly batch", "abc123"]},
    {"name": "evaluator", "description": "Evaluator/checker name", "examples": ["correctness", "safety"]},
    {"name": "rule", "description": "Rule or criterion name", "examples": ["greeting rule", "medication check"]},
    {"name": "time_range", "description": "Time period", "examples": ["last week", "past month", "March"]},
    {"name": "metric", "description": "Measurable quantity", "examples": ["pass rate", "block rate", "accuracy"]},
    {"name": "status", "description": "Result or run status", "examples": ["failed", "passing", "critical"]},
    {"name": "agent", "description": "Sales/support agent name (inside-sales)", "examples": ["Mr. Khan", "Priya"]},
    {"name": "thread", "description": "Thread or conversation reference", "examples": ["thread xyz", "the failing thread"]}
  ]
}
```

**Output Schema:**

```json
{
  "entities": [
    {"text": "adversarial", "type": "eval_type", "confidence": 0.9},
    {"text": "last week", "type": "time_range", "confidence": 0.95}
  ],
  "is_platform_query": true,
  "needs_resolution": true,
  "out_of_scope_reason": null
}
```

**Gating Logic:**
- `is_platform_query: false` → return graceful message: "I'm Sherlock, a data detective for [app]. I can help with evaluation analytics, rule compliance, trends, and more."
- `is_platform_query: true, needs_resolution: false` → agent loop starts with `tool_choice="auto"` (no forced tool call)
- `is_platform_query: true, needs_resolution: true` → agent loop starts with `tool_choice="any"` on round 1

**Entity Type Registry Source:** Built at session start from `App.config.chat.entityTypes` (seeded per app) merged with dimension names from the semantic model. Cached per session.

---

## 4. Tool Inventory

### Naming Convention

Pattern: `{namespace}_{action}` — predictable, derivable, scales to new namespaces.

### Catalog Tools (Schema Discovery)

#### `catalog_inspect`

Query `information_schema` + `pg_catalog` for table/column metadata.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `table` | string | yes | Table name |
| `column` | string | no | Specific column (returns all if omitted) |

**Returns:** Column names, types, nullable, defaults, **column comments** (from `pg_description`), primary key, indexes. For JSONB columns, indicates "use `catalog_sample` to inspect structure."

**Column comments serve as the semantic layer.** Comments should include: description, sample values, synonyms, role tag (`dimension` / `measure` / `temporal`). Example comment: `"Type of evaluation. Role: dimension. Values: batch_thread, call_quality, batch_adversarial, custom, inside_sales. Synonyms: evaluation type, run type, test type"`

#### `catalog_relations`

Query `information_schema.key_column_usage` + `information_schema.table_constraints` for FK/PK relationships.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `table` | string | yes | Table name |

**Returns:** All FK relationships (incoming and outgoing), join paths, **cardinality direction** (one-to-many, many-to-one). Example: `analytics_eval_facts.run_id → eval_runs.id (many:1)`.

The agent uses this to know when GROUP BY is needed (joining across a one-to-many boundary).

#### `catalog_values`

Query distinct values for a specific column with counts.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `table` | string | yes | Table name |
| `column` | string | yes | Column name or JSONB expression |
| `search` | string | no | Filter (ILIKE '%search%') |
| `limit` | int | no | Max values (default 20) |

**Returns:** `[{value, count}]` ordered by count descending. Access-controlled: always filtered by tenant_id + app_id.

This is the primary entity resolution tool. Agent calls it to resolve "adversarial" → exact `eval_type` value.

#### `catalog_sample`

Get sample rows, with special handling for JSONB columns.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `table` | string | yes | Table name |
| `column` | string | no | Specific column (for JSONB introspection) |
| `limit` | int | no | Max rows (default 5) |

**Returns:** For regular columns: sample rows. For JSONB columns: detected key structure with nesting, types, and 3 sample values per leaf key. Example:

```json
{
  "json_structure": {
    "entities": {
      "leads": [{"name": "text", "phone": "text", "follow_up_date": "date"}],
      "medications": [{"name": "text", "dosage": "text"}]
    },
    "summary": "text"
  },
  "sample_values": {
    "entities.leads[0].name": ["Rajesh Kumar", "Priya Shah", "Amit Patel"]
  }
}
```

### Data Tools (Query & Fetch)

#### `data_check`

Pre-flight check: does data exist for the intended query?

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `table` | string | yes | Table name |
| `filters` | object | no | Column→value filter conditions |

**Returns:** `{row_count, min_created_at, max_created_at}`. Access-controlled.

Prevents blank charts. Agent calls this before `data_query` to verify data exists for the intended filters.

#### `data_query`

The core SQL tool. Generates SQL from question + context, validates, executes, returns results with column metadata and chart suggestions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | yes | Natural language question or follow-up |
| `context` | object | no | Resolved entities, discovered schema, prior analysis |

**Internal Pipeline:**
1. Load relevant schema context from catalog (already in agent's context from prior tool calls)
2. Generate SQL via LLM (Gemini Flash or GPT-nano, temperature 0)
3. Validate: SELECT-only, table allowlist, no dangerous patterns
4. Inject access control (tenant_id, app_id) as bind parameters
5. Cost estimation via EXPLAIN
6. Execute with 10s timeout, max 200 rows
7. **Result verification** (see section 8)
8. Classify columns using DB catalog metadata
9. Compute chart suggestions
10. On failure: retry up to 3 times with varied strategies

**Returns:**

```json
{
  "status": "ok",
  "row_count": 6,
  "data": [...],
  "columns": [
    {"name": "created_at", "role": "temporal", "type": "timestamptz"},
    {"name": "pass_rate", "role": "measure", "type": "float", "unit": "percent"}
  ],
  "chart_options": {
    "eligible_types": ["line", "area", "bar"],
    "suggested": {"type": "line", "x": "created_at", "y": ["pass_rate"]}
  },
  "sql_used": "SELECT ...",
  "cache_hit": false,
  "warnings": []
}
```

The agent sees the full result including data rows, column metadata, and chart suggestions. It can reason about whether the results make sense.

#### `data_records`

Fetch raw evidence records from configured data surfaces.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `surface` | string | yes | Surface key (e.g., "runs", "logs", "threads") |
| `entity_type` | string | no | Filter by entity type |
| `entity_value` | string | no | Filter value |
| `run_id` | string | no | Filter by run |
| `limit` | int | no | Max records (default 10, max 25) |

**Returns:** Raw records from the configured surface with field selection and serialization. Unchanged from current `get_surface_records` behavior.

### Blueprint Tools (Report Templates)

#### `blueprint_blocks`

List available section blocks for composing blueprints. Consolidates three current tools (`list_section_types`, `get_section_detail`, `list_app_sections`) into one.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app_id` | string | no | Scope to app's supported blocks |
| `block_type` | string | no | Get detail for a specific block type |

**Returns:** Array of blocks with `{type, label, description, use_when}`. When `block_type` specified, includes `data_shape` and `known_variants`.

#### `blueprint_compose`

Validate a blueprint configuration. No persistence.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Blueprint name |
| `sections` | array | yes | Ordered section objects: `{id?, type, title, variant?}` |

**Returns:** `{status, sections (validated with generated IDs), preview_ready}` or `{status: "error", errors[]}`.

#### `blueprint_save`

Persist a validated blueprint as a reusable template.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Blueprint name |
| `sections` | array | yes | Same schema as compose |

**Returns:** `{status: "saved", blueprint_id, name, block_count}`. The `blueprint_id` is returned directly — no LLM round-trip needed. Frontend shows inline save toast with navigation link.

**DB Storage:** Creates `ReportConfig` row with `scope="single_run"`, `presentation_config`, `export_config`. Adds `source_session_id` column for Sherlock lineage tracking.

#### `blueprint_list`

Browse saved blueprints for the current app.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app_id` | string | no | Filter by app |

**Returns:** `{blueprints: [{id, name, block_count, created_at}]}`.

---

## 5. Semantic Model & DB Catalog

### Strategy: DB Catalog as Source of Truth

The semantic model YAML still exists for **app-specific configuration** (entity type registry, data surfaces, entity resolvers, capabilities). But the **schema knowledge** that feeds SQL generation comes from the DB catalog via `catalog_*` tools.

### Column Comments Convention

Every column the agent can query should have a PostgreSQL comment following this format:

```sql
COMMENT ON COLUMN analytics_run_facts.eval_type IS
  'Type of evaluation. Role: dimension. Values: batch_thread, call_quality, batch_adversarial, custom, inside_sales. Synonyms: evaluation type, run type.';

COMMENT ON COLUMN analytics_run_facts.pass_rate IS
  'Percentage of threads passing (0-100). Role: measure. Unit: percent. Pre-aggregated per run.';

COMMENT ON COLUMN analytics_run_facts.created_at IS
  'When the run was created. Role: temporal. Granularities: day, week, month, quarter.';

COMMENT ON COLUMN analytics_eval_facts.result_status IS
  'Evaluation result status. Role: dimension. Values: PASS, SOFT FAIL, HARD FAIL, CRITICAL, ERROR. Ordering: PASS, SOFT FAIL, HARD FAIL, CRITICAL, ERROR.';

COMMENT ON COLUMN analytics_criterion_facts.criterion_label IS
  'Human-readable rule name. Role: dimension. Synonyms: rule, rule name, criterion.';
```

**Comment fields parsed by `catalog_inspect`:**
- `Role:` → dimension | measure | temporal (drives chart axis binding)
- `Values:` → sample values (drives entity resolution)
- `Synonyms:` → alternative names users might use
- `Unit:` → percent, ms, count (drives chart formatting)
- `Granularities:` → for temporal columns (drives DATE_TRUNC)
- `Ordering:` → for ordered categoricals (drives chart sort order)
- `Pre-aggregated` → flag: this column is already an aggregate, don't re-aggregate

### Selective Retrieval vs. Prompt Dumping

**Current (wrong):** Entire semantic model YAML dumped into SQL generation prompt every time. ~3000 tokens of schema context regardless of question complexity.

**V2 (correct):** Agent calls `catalog_inspect`, `catalog_relations`, `catalog_sample` for the specific tables/columns it needs. SQL generation prompt contains only the discovered schema subset. A question about pass rate trend doesn't need criterion_facts schema.

### What Stays in YAML

Per-app config that can't live in DB catalog:
- Entity type registry (what entity types exist for this app)
- Data surface configuration (what raw evidence surfaces exist)
- Entity resolver configuration
- Capability list (which tool namespaces are enabled)
- Prompt templates (quick-start suggestions in chat widget)

---

## 6. Agent Loop & Orchestration

### Loop Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `max_rounds` | 8 | Complex multi-table queries need more exploration |
| `round_1_tool_choice` | `"any"` if `needs_resolution` else `"auto"` | Forces at least one tool call when entities detected |
| `round_2+_tool_choice` | `"auto"` | Agent decides freely |
| `streaming` | yes | Text deltas + tool events streamed to frontend |
| `provider` | Configurable (Gemini, OpenAI) | Per session, locked after first turn |

### System Prompt Structure

Four layers, same as current but with richer content:

1. **Base Persona** — Sherlock identity, tool descriptions with parameter schemas, orchestration guidance (discover before generating, check data availability, verify results), response format rules
2. **App Context** — App name, description, available report sections (cached per session)
3. **User Context** — Saved blueprints, recent tool usage (cached per session)
4. **Session Scratchpad** — Resolved entities, active filters, analysis snapshots, recent errors (refreshed per turn)

### Scratchpad Structure (V2)

```python
{
    'resolved_entities': {           # Carry forward across turns
        'eval_type': 'batch_adversarial',
        'time_range': {'start': '2026-04-08', 'end': '2026-04-14'},
        'run_id': 'a1b2c3d4-...'
    },
    'active_filters': {              # NEW: inherited by follow-up queries
        'app_id': 'voice-rx',
        'eval_type': 'batch_adversarial',
        'time_range': {'start': '2026-04-08', 'end': '2026-04-14'}
    },
    'discovered_schema': {           # NEW: what the agent has explored
        'tables_inspected': ['analytics_run_facts'],
        'relations_found': [...],
        'json_structures': {...}
    },
    'analysis_snapshots': [...],     # Last 5 analyses with columns, preview, chart options
    'findings': [...],               # Short text summaries
    'errors': [],                    # Last 5 errors
    'composed_blueprint': None,      # Current blueprint being built
    'last_evidence': None            # Latest surface fetch
}
```

### Orchestration Guidance (in System Prompt)

The prompt does NOT prescribe SQL techniques or force specific tool sequences. It teaches the agent WHEN tools are useful:

> - When you encounter entity references (names, IDs, statuses), use `catalog_values` to resolve to exact DB values before generating SQL.
> - When you need to join tables, use `catalog_relations` to discover FK paths and cardinality.
> - When you encounter JSONB columns, use `catalog_sample` to discover the key structure.
> - Before generating SQL that involves filters, use `data_check` to verify data exists.
> - After generating SQL, inspect the results. If 0 rows returned, consider relaxing filters. If all values in a column are NULL, check your join conditions.
> - You have full PostgreSQL at your disposal — CTEs, window functions, recursive queries, JSON operators, date arithmetic, LATERAL, UNNEST, and any other construct the question demands.
> - For follow-up questions, your scratchpad contains resolved entities and active filters from prior turns. Reuse them; don't re-resolve.

---

## 7. SQL Generation & Validation

### Generation

The SQL generation is a focused LLM call within `data_query`. It receives:

1. **Schema subset** — only the tables/columns/relations the agent discovered via catalog tools (not the full model)
2. **Resolved entities** — exact values with bind parameter names
3. **Column metadata** — roles, types, granularities from catalog comments
4. **The question** — optionally rewritten for follow-ups with context from scratchpad

The SQL generation prompt is minimal:

```
SCHEMA:
{discovered_schema_subset}

TASK: Generate a single PostgreSQL SELECT query to answer:
"{question}"

RULES:
- Allowed tables: {discovered_tables}
- Use :app_id, :tenant_id as bind parameters for access control
- Use :uuid_1, :uuid_2, etc. for entity IDs
- JSONB access: context->>'key' for text, (context->>'key')::int for numeric
- {column_role_hints}  -- e.g., "pass_rate is pre-aggregated per run, do not SUM it"
- LIMIT 200 max
```

### Validation (Unchanged Plus)

Existing validation stays:
- SELECT/WITH only (no DML/DDL)
- Dangerous pattern detection (pg_*, information_schema, comments)
- Table allowlist
- EXPLAIN cost estimation (threshold: 50,000)

New additions:
- **Column existence check**: verify all referenced columns exist in discovered schema
- **Bind parameter completeness**: all `:param` placeholders must be bound

### Retry Strategy (3 Attempts, Varied)

| Attempt | Strategy |
|---------|----------|
| 1 | Fix the error: send error message + failing SQL to LLM, ask to correct |
| 2 | Regenerate from scratch: send original question + error history, ask for simpler approach |
| 3 | Fall back: return structured error with what was attempted, suggest user rephrase |

---

## 8. Result Verification

After SQL executes successfully, deterministic checks before returning to agent:

| Check | Condition | Action |
|-------|-----------|--------|
| Empty results | `row_count == 0` | Add warning: "Query returned no rows. Filters may be too restrictive." |
| All-NULL column | Any column is 100% NULL | Add warning: "Column '{col}' is entirely NULL — possible bad join." |
| Single row for distribution | Question implies distribution but only 1 row | Add warning: "Only 1 row returned — missing GROUP BY?" |
| Excessive rows | `row_count > 100` | Add warning: "Large result set — consider adding filters." |
| Suspicious aggregation | Pre-aggregated column (from catalog metadata) used in SUM/AVG | Add warning: "'{col}' is pre-aggregated — aggregating again may produce wrong results." |

Warnings are returned in the `data_query` response. The agent sees them and can act (regenerate, inform user, or proceed with caveat).

---

## 9. Chart Binding

### Axis Assignment (Deterministic)

`data_query` returns `columns` with `role` tags (from DB catalog comments). Chart binding is automatic:

| Column Role | Chart Position |
|-------------|---------------|
| `temporal` | X axis (always) |
| `dimension` (categorical) | X axis if no temporal, otherwise legend/series grouping |
| `measure` | Y axis |
| `ordered_categorical` | X axis with preserved order |

### Chart Type Selection

Same classifier logic as current `chart_classifier.py` but now informed by column roles:

| Data Shape | Best Chart |
|-----------|-----------|
| 1 temporal + 1 measure | line |
| 1 temporal + N measures | composed (line + bar) |
| 1 categorical + 1 measure (≤12 items) | bar |
| 1 categorical + 1 measure (>12 items) | horizontal_bar |
| 1 categorical + 1 measure (≤8 items) | pie or donut |
| 1 ordered_categorical + 1 measure | funnel |
| N measures only | table (no chart) |
| 2+ measures | scatter (if 2 numeric dimensions) |

### Chart Spec in `data_query` Response

```json
{
  "chart_options": {
    "eligible_types": ["line", "area", "bar", "composed"],
    "suggested": {
      "type": "line",
      "x": "period",
      "y": ["pass_rate"],
      "series": null,
      "x_label": "Week",
      "y_label": "Pass Rate (%)"
    }
  }
}
```

The agent can:
- Accept the suggestion as-is
- Override the chart type (user asked for bar chart)
- Add a title based on question context
- Select specific measures if multiple are available

The agent does NOT pick axes. Axes come from column roles. This eliminates swapped axes.

### `render_chart` Removed

No separate tool call for chart rendering. Chart config is part of the `data_query` response. The agent includes chart spec in its response, and the frontend renders it.

---

## 10. Blueprint System

### Naming

| Concept | Old Name | New Name |
|---------|----------|----------|
| Section type | section_type | block |
| Report template | report / template | blueprint |
| Generated report | report | report |

### Two-Layer Model

```
BLOCKS (13 canonical section types)    → Building materials
BLUEPRINT (saved configuration)         → Architectural plan
REPORT (generated from blueprint+data) → The actual building
```

### Block Catalog

Unchanged from current 13 section types: `summary_cards`, `narrative`, `metric_breakdown`, `distribution_chart`, `compliance_table`, `friction_analysis`, `exemplars`, `prompt_gap_analysis`, `issues_recommendations`, `heatmap`, `entity_slices`, `flags`, `callout`.

### Blueprint Persistence

Stored as `ReportConfig` row with:
- `report_id`: `bp-{uuid_hex[:8]}` (prefix `bp-` instead of `custom-`)
- `scope`: `"single_run"`
- `source_session_id`: Sherlock session ID (lineage tracking — NEW)
- `presentation_config`: section structure
- `export_config`: PDF export settings

### Blueprint → Report Wizard Connection

`GET /api/report-configs?app_id={app}&scope=single_run` returns all blueprints for the app. The report generation wizard shows these as available templates. When user selects one, the wizard populates section configuration from the blueprint's `presentation_config`.

---

## 11. Integration Flows

### Chart → Analytics Library

```
data_query returns chart_options
  → Agent includes chart spec in response
  → Frontend renders ChartCard with "Save to library" button
  → User clicks → POST /api/analytics-library/charts
    body: {title, sql_query, chart_config, source_question, source_session_id}
  → Returns {id: UUID}
  → Inline green toast: "Saved to library" + "View →" link
  → Link: routes.analyticsChartForApp(appId, chartId)
```

### Charts → Dashboard

```
Conversation has ≥2 charts
  → Dashboard creation bar appears (with chart thumbnails)
  → User names dashboard + clicks "Create"
  → Each unsaved chart → POST /api/analytics-library/charts → collect IDs
  → POST /api/analytics-library/dashboards
    body: {name, chart_entries: [{chart_id, width, order}], source_session_id}
  → Returns {id: UUID}
  → Inline green toast: "Dashboard created" + "Open →" link
  → Link: routes.analyticsDashboardForApp(appId, dashboardId)
```

### Blueprint → Report Wizard

```
Agent calls blueprint_save
  → POST creates ReportConfig row → returns blueprint_id
  → Tool result includes blueprint_id directly (no LLM round-trip)
  → Inline purple toast: "Blueprint saved" + "Use in wizard →" link
  → Link: routes.reportWizardForApp(appId, blueprintId)
  → Report wizard: GET /api/report-configs?app_id → shows blueprint in template list
```

### Lineage Tracking

New column on `AnalyticsChart`, `AnalyticsDashboard`, and `ReportConfig`:

```sql
ALTER TABLE analytics_charts ADD COLUMN source_session_id UUID REFERENCES chat_sessions(id);
ALTER TABLE analytics_dashboards ADD COLUMN source_session_id UUID REFERENCES chat_sessions(id);
-- ReportConfig already has app-level scoping; add session reference:
ALTER TABLE report_configs ADD COLUMN source_session_id UUID REFERENCES chat_sessions(id);
```

Enables: "Show me everything Sherlock created this week" queries.

### Navigation Helpers

All cross-page links use `routes.ts` helper functions. No hardcoded paths in components:

```typescript
routes.analyticsChartForApp(appId, chartId)      // → /analytics/charts/:chartId
routes.analyticsDashboardForApp(appId, dashboardId) // → /analytics/dashboards/:dashboardId
routes.reportWizardForApp(appId, blueprintId)      // → /reports/generate?template=:blueprintId
```

---

## 12. Frontend Chat Widget

### Design Language

Reference mocks (committed to repo):
- `docs/investigations/sherlock-v2-chat-ui-mock.html` — message states, tool stack, streaming, charts
- `docs/investigations/sherlock-v2-integrations-mock.html` — save flows, dashboard creation, blueprint cards

### Message Model (Parts-Based)

Replace flat `{content, toolCalls[]}` with a parts array (following Jan/Vercel AI SDK pattern):

```typescript
interface WidgetMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  status: 'pending' | 'streaming' | 'complete' | 'error';
}

type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string;
      state: 'executing' | 'completed' | 'error';
      summary?: string; detail?: ToolCallDetail; durationMs?: number }
  | { type: 'chart'; spec: ChartSpec; data: Record<string, unknown>[];
      sqlQuery: string; sourceQuestion: string; saved?: boolean; chartId?: string }
  | { type: 'blueprint'; name: string; sections: BlueprintSection[];
      saved?: boolean; blueprintId?: string }
  | { type: 'save-toast'; variant: 'chart' | 'dashboard' | 'blueprint';
      title: string; subtitle: string; linkText: string; linkHref: string }
  | { type: 'dashboard-bar'; charts: ChartReference[] };
```

**Key improvement:** Tool calls keyed by `toolCallId` (unique), not `toolName`. Eliminates the identity collision bug.

### Rendering Rules

| Part Type | Visual Treatment |
|-----------|-----------------|
| `text` (user) | Right-aligned bubble, subtle border, max-width 85% |
| `text` (assistant) | Left-aligned, no bubble, indented under avatar row |
| `tool-call` (executing) | Vertical stack item: spinner + monospace name + shimmer status |
| `tool-call` (completed) | Same item: green checkmark + name + summary + time |
| `tool-call` (error) | Red X + name + error message + time |
| `tool-call` group (all done) | Collapse into dropdown: "⚙ Used N tools ▾" — click to expand |
| `chart` | Chart card: header (title + subtitle + actions) / chart body / alt type pills |
| `blueprint` | Purple card: numbered section list + "Save blueprint" button |
| `save-toast` | Inline confirmation: icon + title + subtitle + navigation link |
| `dashboard-bar` | Creation card: chart thumbnails + name input + "Create" button |

### Streaming State Isolation

Keep current pattern: `streamingContent`, `streamingToolCalls`, `streamingChart` separate from committed `messages[]`. Flush via `requestAnimationFrame`. Add 50ms throttle on state updates (from Jan's pattern).

### Tool Group Auto-Collapse

When consecutive tool-call parts are all `completed` and a `text` part follows, the tool group auto-collapses into the dropdown trigger. Agent in Jan calls this the ChainOfThought `shouldCollapse` pattern.

### Implementation Reference

Study Jan's source (cloned at `/tmp/jan-source/`) for component architecture:
- `web-app/src/components/ai-elements/tool.tsx` — Radix Collapsible pattern
- `web-app/src/containers/MessageItem.tsx` — parts-based rendering, CoT grouping
- `web-app/src/components/ai-elements/chain-of-thought.tsx` — auto-collapse
- `web-app/src/components/ai-elements/shimmer.tsx` — shimmer animation
- `web-app/src/hooks/use-chat.ts` — 50ms throttle, AI SDK integration

### Chart Card Design (From Approved Mock)

```
┌─────────────────────────────────────────────┐
│ ┌─title─────────────────┐  ┌─actions──────┐ │
│ │ Weekly Pass Rate Trend │  │ 📋 Copy │ 📌 Save │ │
│ │ 4 weeks · voice-rx     │  └──────────────┘ │
│ └────────────────────────┘                   │
├─────────────────────────────────────────────┤
│                                              │
│              [CHART BODY]                    │
│                                              │
├─────────────────────────────────────────────┤
│ (line) (area) (bar) (composed)   ← alt types │
└─────────────────────────────────────────────┘
```

- Dark surface background with subtle border
- Header: title left (bold) + subtitle (muted), action buttons right
- Chart body: clean, proper spacing, animated bars/lines on mount
- Alt type pills: active one highlighted with accent color, others muted
- Save button → transforms to "✓ Saved" state → green toast appears below

This exact design language MUST carry through to the React implementation. Use CSS variables from `globals.css`, not hardcoded hex.

---

## 13. Streaming Protocol

### SSE Event Types (V2)

```
event: session
data: {"sessionId": "...", "provider": "gemini", "model": "..."}

event: entity_recognition
data: {"entities": [...], "is_platform_query": true}

event: tool_call_start
data: {"toolCallId": "tc_001", "toolName": "catalog_values"}

event: tool_call_end
data: {"toolCallId": "tc_001", "toolName": "catalog_values", "summary": "eval_type · 5 values", "detail": {...}, "durationMs": 120}

event: content_delta
data: {"delta": "Here are the "}

event: chart
data: {"spec": {...}, "data": [...], "sqlQuery": "...", "sourceQuestion": "..."}

event: blueprint
data: {"name": "...", "sections": [...], "blueprintId": null}

event: save_result
data: {"variant": "chart", "id": "...", "title": "...", "linkHref": "..."}

event: done
data: {"content": "full text", "toolCalls": [...], "chart": {...}, "blueprint": {...}}

event: error
data: {"message": "...", "recoverable": false}
```

**Key change:** `tool_call_start` and `tool_call_end` include `toolCallId` (unique per call), not just `toolName`. Frontend uses this for stable identity.

### EOF Handling (Bug Fix)

When the SSE stream ends without a `done` or `error` event:
- Frontend detects EOF via `reader.read()` returning `{done: true}`
- If no `done`/`error` received: emit synthetic error event with accumulated content
- Set message status to `error` with retry option
- Never leave UI in `status: 'sending'` permanently

---

## 14. Session & State Management

### Session Resolution (Fix Silent Creation)

**Current (broken):** Invalid/missing `session_id` silently creates a new conversation.

**V2:** If `session_id` is provided and doesn't match a valid session for this tenant/user/app, return `HTTP 404` with `{"error": "session_not_found"}`. Only create new sessions when `session_id` is omitted.

### Session Updated_at (Fix Stale History)

After each turn, update the parent `chat_sessions.updated_at`:

```python
await db.execute(
    update(ChatSession)
    .where(ChatSession.id == session.chat_session_id)
    .values(updated_at=func.now())
)
```

### Persistence Atomicity

**Current (broken):** 5 separate DB commits per turn. Disconnect can leave orphaned state.

**V2:** Single transaction per turn. User message creation, assistant message creation, runtime state save, event append, and assistant finalization all within one `async_session()` context. Commit once at the end. On failure, rollback everything.

### CancelledError Handling

```python
except (Exception, asyncio.CancelledError) as exc:
    # Clean up on both errors and cancellation
    await save_runtime_state(session, status='error', ...)
    await finalize_assistant_message(msg_id, status='error', ...)
```

---

## 15. Transport Reliability Fixes

| Bug | Fix |
|-----|-----|
| Stream EOF no fallback | Detect EOF in `reader.read()`, emit synthetic error if no `done` received |
| Malformed SSE silently skipped | Log malformed events, increment error counter, surface if >3 |
| `send()` promise hangs forever | Add 60s timeout; if no `done`/`error` within timeout, resolve with error |
| Non-OK response → "API error N" | Parse response body for error detail, surface actual message |
| Session ID invalid → new session | Return 404, don't silently create |
| Tool call identity by name | Use `toolCallId` throughout (SSE events, store, rendering) |
| `updated_at` not advancing | Update parent `chat_sessions` row after each turn |
| MergeChartBar render side effects | Move state updates to `useEffect`, wrap `useNavigate` safely |
| CancelledError bypass | Catch `CancelledError` alongside `Exception` in chat handler |

---

## 16. Persona & System Prompt

### Identity

```
You are Sherlock — A Data Detective.

You investigate evaluation data, uncover patterns, and deliver precise analytics.
You work for {app_display_name}, analyzing {app_description}.

You are methodical: you discover before you query, you verify before you present,
and you never guess when you can look it up.
```

### Tone

- Lead with the answer, not the process
- Bold key numbers
- Use markdown tables for structured data
- Arrow comparisons for trends (↑ 2.1%, ↓ 0.5%)
- No raw JSON in responses
- Abbreviate UUIDs (first 8 chars)

### Tool Guidance

See section 6 (Agent Loop & Orchestration) for the full orchestration guidance included in the system prompt.

---

## 17. Visual References

| Reference | Location | Content |
|-----------|----------|---------|
| Chat UI mock | `docs/investigations/sherlock-v2-chat-ui-mock.html` | Message states, tool stack, streaming, chart card, error recovery |
| Integration mock | `docs/investigations/sherlock-v2-integrations-mock.html` | Chart save, dashboard creation, blueprint card, save toasts, navigation links |
| Jan source | `https://github.com/janhq/jan` | Component architecture reference for parts-based rendering, tool collapse, shimmer, auto-scroll |

---

## 18. What Stays vs. What Changes

### Keep (Existing Foundations)

- `analytics_*_facts` table design and `FactPopulator`
- Provider adapter abstraction (`ChatAdapter` protocol, `GeminiAdapter`, `OpenAIAdapter`)
- Access control injection in `prepare_query()`
- SQL validation (dangerous patterns, table allowlist, cost estimation)
- Query caching (`AnalyticsQueryCache`)
- `AgentToolLog` for tool execution logging
- SSE streaming transport structure (but fix lifecycle)
- Frontend `ChatWidget` shell (but rework internals)
- 13 section block catalog
- `ReportConfig` persistence model

### Rewrite

- **Tool loop** → constrained agent with forced entity recognition + `tool_choice` gating
- **Tool definitions** → `{namespace}_{action}` naming, new tools (`catalog_relations`, `catalog_sample`, `data_check`), consolidated tools (`blueprint_blocks`)
- **Semantic model role** → lighter YAML for app config; DB catalog (column comments) for schema knowledge
- **SQL generation prompt** → schema subset from catalog discovery, not full model dump
- **Chart binding** → deterministic from column roles in `data_query` response; `render_chart` tool removed
- **Message model** → parts-based array instead of flat `{content, toolCalls[]}`
- **Tool call identity** → `toolCallId` throughout, not `toolName`
- **Scratchpad** → add `active_filters`, `discovered_schema`, `resolved_entities` carry-forward
- **System prompt** → Sherlock persona, richer orchestration guidance, no SQL technique anchoring

### Fix (Bugs)

- Stream EOF handling → synthetic error on unexpected close
- Silent session creation → 404 on invalid session
- Tool call collision → unique `toolCallId`
- Session `updated_at` → update parent row after each turn
- CancelledError bypass → catch alongside Exception
- Persistence atomicity → single transaction per turn
- MergeChartBar → move side effects to useEffect

### Add (New)

- Entity recognition pre-step with structured output
- Entity type registry per app
- `catalog_relations` tool (FK/PK/cardinality discovery)
- `catalog_sample` tool (JSONB structure introspection)
- `data_check` tool (pre-flight data availability)
- Result verification layer (empty results, NULL columns, suspicious aggregation)
- Column comments as semantic layer
- `source_session_id` lineage tracking on charts/dashboards/blueprints
- `blueprint_list` tool
- Dashboard creation bar in chat (redesigned from MergeChartBar)
- Inline save toasts with navigation links
- Blueprint card with numbered sections
- 50ms streaming throttle
- 60s send timeout
