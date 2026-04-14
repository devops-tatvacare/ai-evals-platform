# Sherlock v2 — Implementation Plan

> 4 phases. Each phase ships a working increment. Each phase branch merges to `main` before the next starts.

**Spec:** `docs/specs/2026-04-14-sherlock-v2-design.md`
**Mocks:** `docs/investigations/sherlock-v2-chat-ui-mock.html`, `docs/investigations/sherlock-v2-integrations-mock.html`

---

## Phase 1: Foundation — Catalog Tools, Column Comments, Entity Recognition

**Branch:** `feat/phase-1-sherlock-v2-foundation`
**Goal:** Build the schema discovery layer and entity recognition pre-step. After this phase, the agent can explore the DB catalog, resolve entities, and the pipeline gates non-platform questions. Existing Sherlock continues to work — new tools are additive.

### 1.1 Column Comments Migration

Add PostgreSQL comments to all queryable columns in the analytics fact tables and related tables.

**Files:**
- Create `backend/alembic/versions/xxxx_add_column_comments.py` (or manual migration script if no Alembic)
- Cover all columns on: `analytics_run_facts`, `analytics_eval_facts`, `analytics_criterion_facts`, `eval_runs`
- Each comment follows the convention: `"Description. Role: dimension|measure|temporal. Values: ... Synonyms: ... Unit: ... Granularities: ..."`
- Cover app-specific JSONB context keys (voice-rx: segment_id, speaker; kaira-bot: intent, route; inside-sales: agent, direction)
- Include `Pre-aggregated` flag on columns like `pass_rate`, `avg_intent_accuracy`, `adversarial_block_rate`

**Acceptance:** `SELECT col_description(...)` returns structured comment for every column the agent queries. A helper function `parse_column_comment(comment_text)` extracts role, values, synonyms, unit, granularities into a dict.

### 1.2 Catalog Tools — Backend

Implement four new tool handlers following `{namespace}_{action}` naming.

**`catalog_inspect`:**
- Query `information_schema.columns` + `pg_catalog.pg_description` for the specified table
- Parse column comments into structured metadata (role, values, synonyms, etc.)
- Return column names, types, nullable, comments (parsed), primary key info
- Access control: only expose tables in a configured allowlist (expandable per app)
- File: `backend/app/services/chat_engine/catalog_tools.py`

**`catalog_relations`:**
- Query `information_schema.key_column_usage` + `information_schema.table_constraints` + `information_schema.referential_constraints`
- Return FK relationships with source table, target table, columns, cardinality direction
- Cardinality derived from: if FK is on "many" side, relation is many:1 toward the referenced table
- File: same `catalog_tools.py`

**`catalog_values`:**
- `SELECT DISTINCT {column}, COUNT(*) FROM {table} WHERE tenant_id = :tid AND app_id = :aid [AND column ILIKE :search] GROUP BY 1 ORDER BY 2 DESC LIMIT :limit`
- Parameterized — no SQL injection risk
- Support JSONB expressions: `context->>'agent'`
- File: same `catalog_tools.py`

**`catalog_sample`:**
- For regular columns: `SELECT * FROM {table} WHERE ... LIMIT :limit`
- For JSONB columns: fetch N rows, extract union of all keys at each nesting level, detect types from values, return structure + sample values
- File: same `catalog_tools.py`

**Tool registration:**
- Add to `tool_definitions.py` under a new `CATALOG_TOOLS` list
- Add `"catalog"` to `CAPABILITY_TOOLS` registry
- Register handlers in `TOOL_HANDLER_MAP` in `tool_handlers.py`
- Add `"catalog"` to `COMMON_SHERLOCK_CAPABILITIES` in `seed_defaults.py`

**Tests:**
- Unit tests for each tool with mock DB responses
- Test comment parsing with various formats (missing fields, extra fields)
- Test JSONB structure detection with nested objects and arrays
- Test access control (tenant/app filtering)

### 1.3 Entity Type Registry

Build the per-app entity type registry that scopes entity recognition.

**Files:**
- Add `entity_types` field to `AppChatConfig` schema in `backend/app/schemas/app_config.py`
- Seed entity types per app in `seed_defaults.py`:
  - Common types: `eval_type`, `run_reference`, `evaluator`, `rule`, `time_range`, `metric`, `status`
  - voice-rx additions: `segment`, `speaker`
  - kaira-bot additions: `intent`, `route`
  - inside-sales additions: `agent`, `thread`, `direction`
- Auto-derive additional types from semantic model dimensions at session start (merge with seeded types)
- File: `backend/app/services/chat_engine/entity_registry.py`

**Acceptance:** `load_entity_registry(app_id, app_config, semantic_model)` returns a list of `{name, description, examples}` dicts covering all entity types for the app.

### 1.4 Entity Recognition Pre-Step

Implement the structured output LLM call that classifies questions before the agent loop.

**Files:**
- `backend/app/services/chat_engine/entity_recognition.py`
- Function: `async def recognize_entities(question, scratchpad, entity_registry, provider, model) -> EntityRecognitionResult`
- Uses structured output (`response_format: json_schema` for OpenAI, equivalent for Gemini)
- Returns: `{entities: [{text, type, confidence}], is_platform_query: bool, needs_resolution: bool, out_of_scope_reason: str|None}`
- Prompt: minimal — entity type registry + question + "Extract entities of these types. If the question is not about data analytics, set is_platform_query to false."
- Fast model: same as SQL generation (Flash Lite / GPT-nano)

**Integration with chat handler:**
- In `chat_handler.py:_execute_chat_turn()`, call `recognize_entities()` BEFORE the agent loop
- If `is_platform_query: false` → return graceful rejection message, skip agent loop entirely
- If `needs_resolution: true` → set `tool_choice="any"` for round 1 of agent loop
- Emit `entity_recognition` SSE event with results

**Tests:**
- Test with platform questions: "What's the pass rate?" → entities detected, is_platform_query=true
- Test with off-topic: "Who is the PM of India?" → is_platform_query=false
- Test with vague: "Show me trends" → is_platform_query=true, low confidence, needs_resolution=true
- Test with entities: "adversarial runs last week" → eval_type + time_range extracted
- Test with follow-up context: scratchpad has prior entities → detected as carryover

### 1.5 Tool Choice Gating in Runner

Modify `run_tool_loop()` to support `tool_choice` parameter per round.

**Files:**
- `backend/app/services/chat_engine/runner.py`
- Add `first_round_tool_choice` parameter (default `"auto"`)
- Round 1: pass `tool_choice=first_round_tool_choice` to adapter
- Round 2+: pass `tool_choice="auto"`
- Both adapters (`GeminiAdapter`, `OpenAIAdapter`) must support `tool_choice` parameter in `send()` and `send_stream()`

**Gemini adapter:**
- `tool_choice="any"` maps to `tool_config={"function_calling_config": {"mode": "ANY"}}`
- `tool_choice="auto"` maps to `tool_config={"function_calling_config": {"mode": "AUTO"}}`

**OpenAI adapter:**
- `tool_choice="any"` maps to `tool_choice="required"`
- `tool_choice="auto"` maps to `tool_choice="auto"`

**Tests:**
- Test that round 1 with `tool_choice="any"` forces a tool call (model can't emit text only)
- Test that round 2+ allows text-only responses

### Phase 1 Verification

- All 4 catalog tools work against real DB with column comments
- Entity recognition correctly classifies platform vs off-topic questions
- Agent loop round 1 forced tool call works with both providers
- Existing Sherlock functionality unbroken (new tools are additive)
- All new tests pass

---

## Phase 2: SQL Pipeline — data_query, Result Verification, Chart Binding

**Branch:** `feat/phase-2-sherlock-v2-sql-pipeline`
**Goal:** Replace the current `analyze` + `render_chart` flow with `data_check` + `data_query` that includes result verification, column metadata, and deterministic chart suggestions. After this phase, the core analytics query path is v2.

### 2.1 `data_check` Tool

Pre-flight data availability check.

**Files:**
- Add handler in `catalog_tools.py` (or new `data_tools.py`)
- SQL: `SELECT COUNT(*), MIN(created_at), MAX(created_at) FROM {table} WHERE tenant_id = :tid AND app_id = :aid [AND filter_conditions]`
- Parameterized filter conditions from `filters` dict
- Register in tool definitions under `DATA_TOOLS`

**Acceptance:** Agent calls `data_check("analytics_run_facts", {eval_type: "batch_adversarial"})` and gets `{row_count: 6, min_date: "2026-04-08", max_date: "2026-04-14"}`.

### 2.2 Rework `data_query` (Replace `analyze`)

Rebuild the SQL generation + execution tool with column metadata and chart suggestions.

**Files:**
- `backend/app/services/chat_engine/sql_agent.py` — major rework of `analyze()` and `generate_sql()`
- `backend/app/services/chat_engine/result_verifier.py` — new file for result verification

**SQL Generation Changes:**
- Prompt receives schema subset (from agent's prior catalog discoveries in context), not full semantic model
- Include column role hints from parsed catalog comments: "pass_rate is pre-aggregated per run — do not SUM it"
- Include join cardinality hints from catalog_relations: "analytics_eval_facts.run_id → eval_runs.id is many:1 — GROUP BY needed when joining"
- Prompt does NOT anchor to any SQL technique — just "full PostgreSQL available"
- Temperature 0, same fast models

**Retry Strategy (3 attempts):**
- Attempt 1: send error message + failing SQL → ask LLM to fix
- Attempt 2: send original question + full error history → ask for simpler approach from scratch
- Attempt 3: return structured error with what was tried, suggest user rephrase

**Result Verification (new `result_verifier.py`):**
- Check empty results: `row_count == 0` → warning
- Check all-NULL columns → warning
- Check single-row for distribution questions → warning
- Check excessive rows (>100) → warning
- Check double-aggregation: if a `pre_aggregated` column appears in SUM/AVG → warning
- Warnings returned in response, agent sees them

**Column Metadata in Response:**
- Parse column comments for each result column using the catalog comment parser from Phase 1
- Return `columns: [{name, role, type, unit?, ordering?}]`
- If column not in catalog (computed expression), infer role from type (numeric→measure, text→dimension, timestamptz→temporal)

**Chart Options in Response:**
- Use existing `chart_classifier.py` logic but now informed by column roles from metadata
- Deterministic axis assignment: temporal→X, dimension→X (if no temporal) or series, measure→Y
- Return `chart_options: {eligible_types, suggested: {type, x, y, series, x_label, y_label}}`

**Register as `data_query`:**
- New tool definition replacing `analyze`
- Keep `analyze` as deprecated alias during migration (logs warning)
- Update `TOOL_HANDLER_MAP`

### 2.3 Remove `render_chart` Tool

Chart config now comes from `data_query` response. The agent includes chart spec in its natural language response. Frontend renders from the `chart` SSE event.

**Files:**
- Remove `render_chart` from `tool_definitions.py`
- Remove `handle_render_chart` from `tool_handlers.py`
- Update base prompt: remove render_chart tool description, add guidance that charts are auto-suggested by data_query

**Chart emission in chat handler:**
- After `data_query` returns with chart_options, automatically emit `chart` SSE event
- Agent's text response can reference the chart ("As shown in the chart above...")
- No separate tool call needed

### 2.4 Scratchpad V2

Rework scratchpad to support new fields.

**Files:**
- `backend/app/services/report_builder/scratchpad_state.py`

**New fields:**
- `resolved_entities`: dict of entity_type → canonical value (carry forward across turns)
- `active_filters`: dict of column → value that should be inherited by follow-up queries
- `discovered_schema`: dict of tables_inspected, relations_found, json_structures

**Context carryover logic:**
- When user asks a follow-up ("now show that by evaluator"), carry forward `resolved_entities` and `active_filters`
- Only clear when user explicitly changes topic or starts new conversation
- `data_query` context parameter auto-populated from scratchpad active_filters + resolved_entities

### 2.5 Update System Prompt

Rewrite base prompt with Sherlock v2 persona and tool descriptions.

**Files:**
- `backend/app/services/chat_engine/prompts/base.py`

**Content:**
- Sherlock — A Data Detective persona
- All v2 tool descriptions with parameter schemas
- Orchestration guidance (discover before query, verify results, check data availability)
- SQL freedom statement (full PostgreSQL, no technique anchoring)
- Response format rules (bold numbers, markdown tables, arrows for trends)
- Remove old tool references (discover, lookup, resolve_entity, analyze, render_chart)

### 2.6 Update Scratchpad Prompt Layer

**Files:**
- `backend/app/services/chat_engine/prompts/scratchpad.py`

**Changes:**
- Render resolved_entities as "Known entities: eval_type=batch_adversarial, time_range=Apr 8–14"
- Render active_filters as "Active filters: app=voice-rx, eval_type=batch_adversarial, time=last 7 days"
- Render discovered_schema as "Explored: analytics_run_facts (columns, relations), analytics_eval_facts"
- Keep existing: findings, errors, analysis snapshots

### Phase 2 Verification

- `data_check` correctly reports row counts and date ranges
- `data_query` generates correct SQL with proper GROUP BY when joining tables
- `data_query` handles time series with DATE_TRUNC and correct temporal column detection
- Result verification catches empty results and warns agent
- Chart options correctly assign temporal→X, measure→Y
- Pre-aggregated columns not double-aggregated (warning emitted)
- `render_chart` removed, charts auto-emitted from data_query
- Scratchpad carries forward entities and filters across turns
- System prompt updated with v2 persona and tools
- Old `analyze` tool still works (deprecated alias) during migration
- All tests pass, including new SQL generation tests with various query patterns

---

## Phase 3: Frontend Rewrite — Parts Model, Tool Stack, Chart Cards

**Branch:** `feat/phase-3-sherlock-v2-frontend`
**Goal:** Rewrite the chat widget with parts-based message model, tool stack with collapse/expand, approved chart card design, and integration save flows. After this phase, the full v2 UX is live.

### 3.1 Message Model & Store Rewrite

Replace flat message model with parts-based model.

**Files:**
- `src/features/chat-widget/types.ts` — new `MessagePart` union type, updated `WidgetMessage`
- `src/features/chat-widget/useChatWidget.ts` — rewrite store

**Store changes:**
- Messages use `parts: MessagePart[]` instead of `{content, toolCalls[]}`
- Streaming state: `streamingParts: MessagePart[]` (accumulated during stream, flushed on done)
- Tool calls keyed by `toolCallId` (from SSE events), not name
- Add 50ms throttle on streaming state updates
- Add 60s send timeout: if no `done`/`error` within timeout, resolve with error
- Fix: `status` never permanently stuck in `'sending'`

### 3.2 SSE Parser Update

Update stream parser for v2 event types.

**Files:**
- `src/features/chat-widget/api.ts`

**Changes:**
- Handle new events: `entity_recognition`, `save_result`, `blueprint`
- Use `toolCallId` from `tool_call_start`/`tool_call_end` events
- EOF handling: detect `reader.read()` done without `done` event → emit synthetic error
- Malformed JSON: log + count, surface error if >3 malformed events
- Parse non-OK response body for error detail (not just "API error N")

### 3.3 Message Rendering — Parts-Based

Rewrite message rendering to iterate over parts array.

**Files:**
- `src/features/chat-widget/ChatMessages.tsx` — major rewrite

**User messages:** Right-aligned bubbles (unchanged from mock).

**Assistant messages:** No bubble. Avatar row + parts rendered sequentially:
- `text` parts → markdown rendering (react-markdown or evaluate streamdown)
- `tool-call` parts → tool item components
- `chart` parts → ChartCard component
- `blueprint` parts → BlueprintCard component
- `save-toast` parts → SaveToast component
- `dashboard-bar` parts → DashboardBar component

**Streaming text:** Blinking cursor after last text part during `status: 'streaming'`.

**Memoization:** Custom `React.memo` comparator — skip re-render unless streaming the last message (from Jan's pattern).

### 3.4 Tool Stack & Collapse Components

Build the tool execution stack and post-completion collapse.

**Files:**
- `src/features/chat-widget/components/ToolStack.tsx` — vertical stack during execution
- `src/features/chat-widget/components/ToolGroup.tsx` — collapsed dropdown post-completion
- `src/features/chat-widget/components/ToolItem.tsx` — individual tool item (spinner/check/error)

**ToolItem states:**
- `executing`: spinner + monospace name + shimmer status text
- `completed`: green checkmark + name + summary + duration
- `error`: red X + name + error message + duration

**ToolStack:** Renders during streaming when tool-call parts are being added. Vertical list of ToolItems.

**ToolGroup:** Auto-collapses when all tool-call parts are `completed` and a `text` part follows. Shows "⚙ Used N tools ▾" trigger. Click to expand/see individual tools. Use Radix Collapsible (already in project deps) or a simple disclosure component.

**Auto-collapse logic (from Jan's ChainOfThought pattern):**
- Group consecutive tool-call parts
- When a text part follows the group and all tools are completed → set collapsed
- `useEffect` triggers collapse, not render-time side effect

### 3.5 Chart Card Component

Build the chart card matching the approved mock design exactly.

**Files:**
- `src/features/chat-widget/components/ChatChartCard.tsx` — replaces current `ChatChart.tsx`

**Design (from mock):**
- Card with border + border-radius, dark surface background
- Header: title (bold) + subtitle (muted) left, action buttons right
- Actions: Copy button, Save to library button
- Chart body: clean spacing, proper height calculation per chart type
- Footer: alternative type pills, active one highlighted with accent
- Uses `ChartRenderer` from `src/features/analytics/components/ChartRenderer.tsx` for actual rendering
- Chart colors via `resolveColor()` from `statusColors.ts`

**Save flow:**
- "Save to library" → `analyticsLibraryApi.saveChart({title, sql_query, chart_config, source_question, source_session_id})`
- Button transforms to "✓ Saved" (green)
- SaveToast part appended to message: green card with "View →" link
- Link: `routes.analyticsChartForApp(appId, chartId)`

**Data consolidation:** Keep existing logic for max slices (pie: 8, radar: 10, treemap: 20).

### 3.6 Dashboard Creation Bar

Rebuild MergeChartBar as DashboardBar — fix render-time side effects.

**Files:**
- `src/features/chat-widget/components/DashboardBar.tsx` — replaces `MergeChartBar.tsx`
- Delete `MergeChartBar.tsx`

**Design (from mock):**
- Card with chart thumbnail previews (mini chart representations)
- Name input + "Create" button
- Appears when message list has ≥2 chart parts

**Fixes:**
- No `useNavigate()` at module level — use callback ref or lazy import
- No state updates during render — all in `useEffect`
- Navigation after save via callback, not direct render-time call

**Save flow:**
- Save each unsaved chart → collect chart IDs
- `analyticsLibraryApi.saveDashboard({name, chart_entries, source_session_id})`
- SaveToast: green card with "Open →" link
- Link: `routes.analyticsDashboardForApp(appId, dashboardId)`

### 3.7 Blueprint Card Component

New component for blueprint display in chat.

**Files:**
- `src/features/chat-widget/components/BlueprintCard.tsx`

**Design (from mock):**
- Purple-themed card with subtle purple border and background
- Header: 📐 icon + blueprint name + section count
- Body: numbered section list with block type labels in monospace
- Actions: "Edit sections" button, "Save blueprint" button (primary, solid purple)

**Save flow:**
- "Save blueprint" triggers `blueprint_save` tool call (backend returns `blueprint_id` directly)
- SaveToast: purple card with "Use in wizard →" link
- Link: `routes.reportWizardForApp(appId, blueprintId)`

### 3.8 Save Toast Component

Reusable inline confirmation component.

**Files:**
- `src/features/chat-widget/components/SaveToast.tsx`

**Props:** `variant: 'chart' | 'dashboard' | 'blueprint'`, `title`, `subtitle`, `linkText`, `linkHref`

**Variants:**
- `chart`: green theme, checkmark icon
- `dashboard`: green theme, checkmark icon
- `blueprint`: purple theme, 📐 icon

**Animation:** Fade + slide-in on mount (from mock).

### 3.9 Auto-Scroll

Replace manual scroll tracking with `use-stick-to-bottom` library (from Jan's pattern).

**Files:**
- `npm install use-stick-to-bottom`
- Update `ChatMessages.tsx` to use `StickToBottom` wrapper

### 3.10 Shimmer Component

Build shimmer text animation for tool executing state.

**Files:**
- `src/features/chat-widget/components/Shimmer.tsx`

**Implementation:** CSS gradient animation on text (from mock's `shimmer-text` class). Can also use framer-motion if already in deps (from Jan's pattern).

### Phase 3 Verification

- Open chat widget, send a query → tools execute with spinner stack → collapse into dropdown on completion
- Chart renders in card with correct design language (match mock exactly)
- "Save to library" → green toast with "View →" → navigates to analytics chart page
- Send 2+ queries with charts → dashboard bar appears → create dashboard → green toast with "Open →" → navigates to analytics dashboard page
- Ask for a report template → blueprint card renders → "Save" → purple toast with "Use in wizard →"
- Resize widget → all content flows correctly with width
- Stream interruption → error state shown, retry button works
- Tool calls keyed by toolCallId — repeated tool names render as separate items
- Browser refresh → session restores, messages reload
- Dark mode only (matching mock theme) with CSS variables from globals.css
- Run existing frontend tests (fix any broken by refactor)
- Visual comparison against mock HTML files for pixel-level accuracy

---

## Phase 4: Transport Fixes, Session Reliability, Cleanup

**Branch:** `feat/phase-4-sherlock-v2-reliability`
**Goal:** Fix all transport/state reliability bugs identified in the investigation. Remove deprecated code paths. After this phase, Sherlock v2 is production-ready.

### 4.1 Session Resolution Fix

**Files:**
- `backend/app/services/report_builder/runtime_store.py`

**Change:** When `session_id` is provided but doesn't match a valid session for this tenant/user/app → return structured error, not silently create new session.

```python
if session_id and not existing_session:
    raise HTTPException(status_code=404, detail="session_not_found")
```

New session creation only when `session_id` is omitted.

### 4.2 Session Updated_at Fix

**Files:**
- `backend/app/services/report_builder/runtime_store.py`

**Change:** After each turn, update parent `chat_sessions.updated_at`:

```python
await db.execute(
    update(ChatSession)
    .where(ChatSession.id == session.chat_session_id)
    .values(updated_at=func.now())
)
```

History now sorts correctly by recency.

### 4.3 Persistence Atomicity

**Files:**
- `backend/app/services/report_builder/runtime_store.py`
- `backend/app/services/report_builder/chat_handler.py`

**Change:** Consolidate per-turn DB operations into a single transaction:
- User message creation, assistant message creation, runtime state save, event append, assistant finalization — all within one `async_session()` context
- Single commit at end
- Rollback on any failure

### 4.4 CancelledError Handling

**Files:**
- `backend/app/services/report_builder/chat_handler.py`

**Change:** Catch `asyncio.CancelledError` alongside `Exception` in `_execute_chat_turn()`:

```python
except (Exception, asyncio.CancelledError) as exc:
    await save_runtime_state(session, status='error')
    await finalize_assistant_message(msg_id, status='error')
```

### 4.5 Lineage Tracking Migration

Add `source_session_id` column to charts, dashboards, and report configs.

**Files:**
- Migration script: add nullable FK column to `analytics_charts`, `analytics_dashboards`, `report_configs`
- Update `analyticsLibraryApi` save methods to pass `source_session_id`
- Update backend chart/dashboard/report-config create endpoints to accept and store `source_session_id`

### 4.6 Remove Deprecated Code

- Remove old `discover`, `lookup`, `resolve_entity`, `analyze`, `render_chart` tool definitions
- Remove old handlers from `tool_handlers.py`
- Remove old `MergeChartBar.tsx` (replaced by `DashboardBar.tsx` in Phase 3)
- Remove old `ChatChart.tsx` (replaced by `ChatChartCard.tsx` in Phase 3)
- Remove old `ComposedReportCard.tsx` (replaced by `BlueprintCard.tsx` in Phase 3)
- Remove old `chatWidgetHelpers.ts` tool-name-based identity logic
- Clean up any remaining references to old tool names in prompts, tests, seed data

### 4.7 Route Helper for Blueprint → Wizard

**Files:**
- `src/config/routes.ts`

**Add:** `reportWizardForApp(appId, blueprintId)` helper that resolves to the report generation wizard with template pre-selected. Verify the wizard's template selection UI actually fetches and displays custom blueprints from `GET /api/report-configs`.

### 4.8 End-to-End Tests

**Backend:**
- Full turn test: user question → entity recognition → agent loop → data_query → chart options → response
- Multi-turn test: first question sets entities → follow-up carries them forward
- Error recovery test: bad SQL → retry → success
- Off-topic rejection test: non-platform question → graceful message
- Blueprint save test: compose → save → list → verify in report configs
- Session tests: invalid session_id → 404, missing session_id → new session

**Frontend:**
- Component tests for: ToolItem, ToolStack, ToolGroup, ChatChartCard, BlueprintCard, SaveToast, DashboardBar
- Integration test: render full message with all part types
- Streaming test: mock SSE events → verify correct parts accumulation
- Save flow test: chart save → toast appears → link correct
- Router context test: DashboardBar doesn't break outside router (the bug that already broke tests)

### Phase 4 Verification

- Invalid session ID returns 404, not silent new session
- Chat history sorts by actual last-message time
- Stream disconnect doesn't leave orphaned DB state
- Task cancellation properly finalizes messages
- Charts/dashboards/blueprints have `source_session_id` populated
- All deprecated tools removed, no references remain
- Blueprint appears in report wizard template selection
- All backend tests pass (aim: 100+ Sherlock-specific tests)
- All frontend tests pass (aim: 30+ chat widget tests)
- Manual walkthrough of all flows matches mock designs

---

## Phase Summary

| Phase | Focus | Key Deliverables | Estimated Complexity |
|-------|-------|-----------------|---------------------|
| **1** | Foundation | Column comments, 4 catalog tools, entity recognition, tool_choice gating | Medium — new tools, no breaking changes |
| **2** | SQL Pipeline | data_check, data_query with verification + chart binding, scratchpad v2, new prompt | High — core analytics path rewrite |
| **3** | Frontend | Parts model, tool stack/collapse, chart cards, blueprint cards, save flows, dashboard bar | High — full widget rewrite |
| **4** | Reliability | Transport fixes, session fixes, persistence atomicity, lineage, cleanup, e2e tests | Medium — targeted fixes + testing |

### Dependencies

```
Phase 1 ──→ Phase 2 ──→ Phase 3
                    └──→ Phase 4
```

Phase 3 and 4 can overlap — frontend rewrite (Phase 3) can start as soon as Phase 2's SSE event contract is stable. Phase 4 transport fixes can land in parallel with Phase 3 component work.

### Risk Mitigation

- **Phase 1 is additive** — new tools don't break existing Sherlock. Safe to merge to main.
- **Phase 2 keeps `analyze` as deprecated alias** — old frontend continues working until Phase 3 ships.
- **Phase 3 is a full widget rewrite** — test against mock HTML files for visual correctness.
- **Phase 4 is all fixes** — each fix is independently testable and mergeable.
