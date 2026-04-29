# Sherlock 101

The single reference for *how Sherlock is wired together and how to add things to it*. If you find yourself explaining Sherlock architecture in a chat more than once, update this file instead.

File paths are clickable; use them as the jump points.

---

## 1. What Sherlock is

A **constrained analytics agent** scoped to one app at a time (`kaira-bot`, `voice-rx`, `inside-sales`).

- Users ask natural-language questions about their data.
- Sherlock orchestrates a fixed set of tools to discover schema, resolve entities, and run SQL.
- SQL results flow through a **deterministic Python pipeline** that decides chart-vs-table, picks a chart type, and emits a validated Vega-Lite v5 spec.
- The frontend renders the returned payload. It never infers chart type; the backend owns that decision.

The agent is an LLM. The pipeline is code. The boundary between them is strict.

---

## 2. End-to-end request flow

```
user message
   │
   ▼
Scope classifier ──────────── [entity_recognition.py]
   │   (is this about this app's data? any entities to resolve?)
   ▼
Outer Sherlock LLM ────────── [prompts/base.py + prompt_generator + app_context + user_context + scratchpad]
   │   (chooses tools, composes questions)
   ▼
Tool dispatch ─────────────── [report_builder/tool_handlers.py]
   │
   ├─ catalog_* / discover / lookup / resolve_entity / data_check / get_surface_records
   │
   └─ data_query(question) ─── [sql_agent.py]
          │   Inner SQL LLM → {sql, chart_title, output_columns}
          ▼
      Execute SQL
          │
          ▼
      result_set_typer ────── [result_set_typer.py]        (manifest-tagged TypedResultSet)
          │
          ▼
      chartability_gate ───── [chartability_gate.py]       (chart / kpi / summary / table / empty + reason_code)
          │
          ▼
      chart_type_picker ───── [chart_type_picker.py]       (bar|grouped_bar|stacked_bar|line|multi_line|area|pie)
          │
          ▼
      vega_lite_emitter ───── [vega_lite_emitter.py]       (Vega-Lite v5 spec, validated)
          │
          ▼
      ChartPayload (discriminated union) → frontend
```

Everything after `data_query` runs deterministically in Python. The picker and emitter **do not call an LLM**.

---

## 3. Single sources of truth

Know these six files. Everything else is derived.

| Source | What it owns |
|---|---|
| [`backend/app/services/chat_engine/manifests/<app-id>.yaml`](backend/app/services/chat_engine/manifests/) | Catalog tables, data surfaces, column roles/types, synonyms, allowed values, per-app vocabulary |
| [`backend/app/services/chat_engine/manifests/_schema.yaml`](backend/app/services/chat_engine/manifests/_schema.yaml) | JSONSchema for manifest validation |
| [`backend/app/services/chat_engine/chart_type_picker.py`](backend/app/services/chat_engine/chart_type_picker.py) | Which chart mark to pick, given a TypedResultSet |
| [`backend/app/services/chat_engine/vega_lite_emitter.py`](backend/app/services/chat_engine/vega_lite_emitter.py) | How each mark becomes a Vega-Lite v5 spec |
| [`backend/app/services/chat_engine/prompts/base.py`](backend/app/services/chat_engine/prompts/base.py) | Sherlock persona + orchestration + chart-type request rules |
| [`backend/app/services/report_builder/tool_definitions.py`](backend/app/services/report_builder/tool_definitions.py) | Tool specs the agent sees (names, descriptions, schemas) |

Everything downstream (column comments in Postgres, TOOLS section of the prompt, SQL agent's column-role hints, frontend translator) is **generated** from these. Do not hand-edit generated artifacts.

---

## 4. Catalog tables vs data surfaces

Both are declared in the per-app manifest. They serve different purposes and are invoked via different tools.

| | Catalog table | Data surface |
|---|---|---|
| **Purpose** | Structured analytics — counts, aggregates, trends, charts | Raw evidence — individual records, nested JSONB, transcripts |
| **Declared under** | `catalog_tables:` | `data_surfaces:` |
| **Agent tool** | `data_query(question)` | `get_surface_records(surface_key, ...)` |
| **Backs** | A real Postgres table; columns typed with role/data_type/semantic_type | A logical record view; `backed_by:` points to a catalog table OR an external ORM source |
| **Typical shape** | `analytics_run_facts`, `analytics_eval_facts`, `analytics_criterion_facts` | `thread_records`, `recording_records`, `adversarial_case_records` |
| **Produces charts?** | Yes | No — raw rows only |

Rule of thumb (already baked into [base.py](backend/app/services/chat_engine/prompts/base.py)):
- *"show counts / trends / breakdown"* → catalog table.
- *"show me thread / transcript / the actual payload"* → data surface.

---

## 5. Playbooks — how to add things

Follow these exactly. Each playbook lists the *only* files you should touch. If you find yourself editing something outside the list, stop and read this doc again.

### 5.1 Add a column to an existing catalog table

1. Add the column in your ORM model if it's a new physical column. Run the Alembic migration.
2. Edit the manifest:
   ```yaml
   catalog_tables:
     analytics_run_facts:
       columns:
         your_new_column:
           role: dimension | measure | temporal | ordered_categorical | key | identifier
           type: text | int | float | timestamptz | ...
           data_type: nominal | quantitative | temporal | ordinal | boolean
           semantic_type: category | count | percent | ratio | score | duration | id_hash | pk | fk | currency | none
           # Optional:
           allowed_values: ["A", "B"]
           synonyms: ["business name", "alias"]
           ordering: ["EASY", "MEDIUM", "HARD"]
           unit: percent
           measure_kind: count | percent | duration_ms | ...
           description: "Short, user-facing."
   ```
3. **Nothing else.** Boot the app. The manifest validator ([manifest_validator.py](backend/app/services/chat_engine/manifest_validator.py)) confirms the column exists in Postgres and matches the taxonomy. The comment emitter ([comment_emitter.py](backend/app/services/chat_engine/comment_emitter.py)) writes `COMMENT ON COLUMN` so the SQL agent sees the role/type/synonyms. The SQL agent's column-role hints ([sql_agent.py](backend/app/services/chat_engine/sql_agent.py)) pick it up from the manifest.

**What NOT to do:** do not edit `COMMENT ON COLUMN` SQL by hand, do not touch the TOOLS block in `prompts/base.py`, do not add hand-written rules to the SQL agent prompt for this column.

### 5.2 Add a new catalog table

1. Add the ORM model under `backend/app/models/`. Migrate.
2. Edit the manifest:
   ```yaml
   catalog_tables:
     your_new_table:
       orm: YourOrmClassName
       alias: optional_sql_alias
       columns:
         id: { role: identifier, data_type: nominal, semantic_type: pk }
         tenant_id: { role: identifier, data_type: nominal, semantic_type: id_hash }
         app_id: { role: dimension, data_type: nominal, semantic_type: category }
         # ...other columns
   ```
3. Ensure every tenant-scoped query path is satisfied: tables must have `tenant_id` and (usually) `app_id` columns; the SQL agent always filters on `:tenant_id` and `:app_id`.
4. Boot. Manifest validator checks physical drift. Generators handle everything else.

**Gotchas:**
- `measure` role requires `data_type: quantitative` (validator error otherwise).
- `temporal` role requires `data_type: temporal`.
- `measure` without `semantic_type` logs a warning but is allowed.

### 5.3 Add a data surface

Used when you want the agent to fetch *raw records* by entity (thread id, run id, etc.).

1. Confirm the backing source exists — either a declared catalog table in this manifest, or one of the known external sources ([manifest.py](backend/app/services/chat_engine/manifest.py) → `EXTERNAL_SURFACE_SOURCES` = `eval_runs`, `api_logs`, `thread_evaluations`, `adversarial_evaluations`).
2. Edit the manifest:
   ```yaml
   data_surfaces:
     - key: your_surface_key              # lowercase_snake
       label: "Human-readable label"
       description: "What this surface returns"
       backed_by: thread_evaluations      # catalog table name OR external source
       entity_types: [thread_id, run_id]  # entities the agent can filter by
       entity_field_map:
         thread_id: item_id               # map entity_type → column name
       fields: [item_id, result_status, result_detail]  # default projection
       default_limit: 10
   ```
3. If `backed_by` isn't already known — i.e., not in `EXTERNAL_SURFACE_SOURCES` and not a declared catalog table — either add it to `catalog_tables` or extend `EXTERNAL_SURFACE_SOURCES` (rare).
4. Boot. `get_surface_records` resolution logic in [data_surfaces.py](backend/app/services/chat_engine/data_surfaces.py) picks up the new key automatically. The TOOLS block in the agent prompt lists surface keys dynamically via [prompt_generator.py](backend/app/services/chat_engine/prompt_generator.py).

### 5.4 Add a new tool

Tools are agent-callable functions. Adding one = spec + handler + registration.

1. **Define the spec** in [tool_definitions.py](backend/app/services/report_builder/tool_definitions.py): name, description, JSONSchema for args. You can use `{{catalog_tables}}` and `{{surface_keys}}` tokens in the description — [tool_description_generator.py](backend/app/services/chat_engine/tool_description_generator.py) substitutes them per app.
2. **Write the handler** in [tool_handlers.py](backend/app/services/report_builder/tool_handlers.py) as `async def handle_your_tool(...)`.
3. **Register** in the `TOOL_HANDLERS` dict at the bottom of the same file.
4. **Add a summarizer line** in `_summarize_tool_result` in [chat_handler.py](backend/app/services/report_builder/chat_handler.py) so the UI shows a meaningful badge.
5. **Add a one-line rule** to `ORCHESTRATION` in [prompts/base.py](backend/app/services/chat_engine/prompts/base.py) telling the agent *when* to call this tool. Add an entry to the numbered list in [prompt_generator.py](backend/app/services/chat_engine/prompt_generator.py) so it appears in the TOOLS block.

**Gotcha:** tool names are global. Adding a tool with the same name as an existing one silently shadows it. Check `TOOL_HANDLERS` first.

### 5.5 Add a new chart type

Only do this when an actual user question cannot be answered by any of the 7 existing marks: `bar | grouped_bar | stacked_bar | line | multi_line | area | pie`. In practice, almost never.

If you must:

1. **Add a branch to the picker** in [chart_type_picker.py](backend/app/services/chat_engine/chart_type_picker.py) with the precondition (what column roles/types/rows produce this mark).
2. **Add an emitter case** in [vega_lite_emitter.py](backend/app/services/chat_engine/vega_lite_emitter.py) producing a Vega-Lite v5 spec that passes schema validation.
3. **Extend the translator** at [`src/features/analytics/vegaLiteToRecharts.ts`](src/features/analytics/vegaLiteToRecharts.ts) and the `RechartsChartType` type.
4. **Add a renderer branch** in [`src/features/analytics/components/ChartRenderer.tsx`](src/features/analytics/components/ChartRenderer.tsx) and update `CHART_MAP`.
5. **Update chart-type hints** in [`prompts/base.py`](backend/app/services/chat_engine/prompts/base.py) → `CHART TYPE REQUESTS` so the agent knows how to ask `data_query` for this shape.
6. **Tests**: extend `chartLayout.test.ts`, `chartReplay.test.ts`, and picker/emitter Python tests.

---

## 6. The prompt stack

Sherlock's system prompt is assembled per turn in [`chat_handler.py:assemble_context`](backend/app/services/report_builder/chat_handler.py):

```
base.render()                       # Persona + orchestration + chart-type rules.     STATIC per app.
render_tools_section(app_id)        # TOOLS block with catalog tables + surface keys. GENERATED from manifest.
app_context.render(session, db)     # App name, description, domain context.           DB-backed.
user_context.render(session, db)    # Saved report templates, recent tool usage.       DB-backed.
scratchpad.render(session)          # SESSION STATE: findings, discovery cache, etc.   PER-TURN.
```

Plus a pre-turn classifier ([entity_recognition.py](backend/app/services/chat_engine/entity_recognition.py)) that decides if the question is in-scope and flags entity references.

Plus a separate inner SQL agent ([sql_agent.py](backend/app/services/chat_engine/sql_agent.py)) invoked by `data_query`. It sees its own prompt (`SQL_AGENT_PROMPT`) with schema, column role hints, and strict output shape. **The outer agent never sees SQL.**

### When to edit which prompt

| Goal | Edit |
|---|---|
| Teach Sherlock new orchestration rules (when to call which tool, how to phrase a chart request) | `prompts/base.py` |
| Add/rename a tool in the numbered list | `prompt_generator.py` |
| Change SQL generation behavior (new aggregate hint, new formatting rule) | `sql_agent.py` → `SQL_AGENT_PROMPT` |
| Add a domain hint specific to one app (e.g., kaira-bot's adversarial concepts) | `apps.config.chat.context` in the database — surfaces via `app_context.render` |
| Teach the agent about a new chart type's required data shape | `prompts/base.py` → `CHART TYPE REQUESTS` section |

**Never** edit `prompts/base.py`'s TOOLS block by hand — it's injected by the generator. **Never** hand-type `COMMENT ON COLUMN` — it's emitted by [comment_emitter.py](backend/app/services/chat_engine/comment_emitter.py) from the manifest.

---

## 7. Runtime telemetry

Every Sherlock turn creates rows in three tables (invariant, do not sidestep):

| Table | Content |
|---|---|
| `sherlock_agent_sessions` | One row per chat session, per (tenant, user, app) |
| `sherlock_conversation_turns` | One row per user message → agent reply cycle |
| `sherlock_turn_events` | Tool calls, LLM generations, final response — full trace |

Plus:
- `llm_usage` rows for every LLM call (outer agent, inner SQL agent, entity recognizer) — owner_type=`sherlock_turn`.
- `analytics_charts` for saved charts; `analytics_dashboards` for user-curated dashboards.

Read these to debug agent behavior. Do not write to them from request handlers.

---

## 8. Common failure modes

### Agent answered in prose instead of rendering a chart
The picker couldn't produce the requested chart type because the data didn't have the right shape. Most commonly: user asked for *pie* but the SQL returned counts, not percentages. The agent computed percentages in its head and narrated them.

Fix: teach the agent how to ask `data_query` for the required shape — already in [`prompts/base.py`](backend/app/services/chat_engine/prompts/base.py) under `CHART TYPE REQUESTS`. If a new chart type keeps failing, extend that block.

### Chart picked wasn't what you expected
Check the scratchpad on the next turn — it tells you `Last result rendered as a {mark} chart. (reason: {code})`. Trace back:
1. What semantic_types did `output_columns` declare? (SQL agent prompt behavior)
2. Were column roles correct? (manifest vs manifest_validator output at boot)
3. Did the gate degrade? (look at `reason_code`)

### Agent tried to read a table not in the manifest
Manifest validator would have logged drift at boot. Also: `catalog_inspect`/`data_query` reject unknown tables. Add the table to the manifest, don't loosen the guard.

### Manifest drift error on boot
[manifest_validator.py](backend/app/services/chat_engine/manifest_validator.py) refuses startup when a declared table/column doesn't exist in Postgres, or when role/data_type taxonomy contradicts itself (e.g., `role: measure` + `data_type: nominal`). Fix the manifest or the migration; don't silence the validator.

---

## 9. What NOT to do

- **Do not** edit `COMMENT ON COLUMN` SQL by hand — regenerated from manifest.
- **Do not** hand-write per-table rules in the SQL agent prompt — they go in the manifest as column metadata.
- **Do not** edit the TOOLS numbered list in `prompts/base.py` — it's in `prompt_generator.py`.
- **Do not** add chart-type inference logic to the frontend — backend owns chart type.
- **Do not** introduce new agent-side state between the outer agent and the inner SQL agent. They communicate via `data_query`'s `question` string + its typed result. Nothing else.
- **Do not** reintroduce the retired `kaira-evals` app id anywhere.
- **Do not** create subdirectory agent rule files (`agents/`, `.cursor/`). `CLAUDE.md` is the source.

---

## 10. Test entry points

If you change any of the above, these should pass:

```bash
# Python
PYTHONPATH=backend pytest backend/tests/test_chart_type_picker.py
PYTHONPATH=backend pytest backend/tests/test_vega_lite_emitter.py
PYTHONPATH=backend pytest backend/tests/test_chartability_gate.py
PYTHONPATH=backend pytest backend/tests/test_manifest_validator.py

# Frontend
npm run test -- src/features/analytics/chartLayout.test.ts
npm run test -- src/features/analytics/chartReplay.test.ts
npm run test -- src/features/analytics/vegaLiteToRecharts.test.ts
npm run test -- src/features/analytics/components/ChartRenderer.test.tsx
```

Boot the backend — manifest validator runs automatically. If you see `ManifestDriftError`, stop and fix the manifest or the migration before doing anything else.

---

## 11. Where to go next

| Question | File |
|---|---|
| "What apps exist and what tables does each use?" | [manifests/](backend/app/services/chat_engine/manifests/) |
| "How is a chart type decided?" | [chart_type_picker.py](backend/app/services/chat_engine/chart_type_picker.py) |
| "How is a result typed?" | [result_set_typer.py](backend/app/services/chat_engine/result_set_typer.py) |
| "When does the system degrade to table/KPI/summary?" | [chartability_gate.py](backend/app/services/chat_engine/chartability_gate.py) |
| "What does the agent see on a given turn?" | Scratchpad rows + [`assemble_context`](backend/app/services/report_builder/chat_handler.py) |
| "How do tool results flow back to the agent?" | [`openai_agents_adapter.py`](backend/app/services/chat_engine/openai_agents_adapter.py) + [`_summarize_tool_result`](backend/app/services/report_builder/chat_handler.py) |

That's the whole system. If a problem doesn't map to one of the playbooks above, it's probably not a Sherlock problem — look at the data, the LLM settings, or the frontend.
