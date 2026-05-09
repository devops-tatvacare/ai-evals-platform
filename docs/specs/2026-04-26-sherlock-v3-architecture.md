# Sherlock v3 — Agent-to-Agent Architecture Spec

**Date:** 2026-04-26 (refreshed 2026-05-09)
**Status:** Implementation-ready (post-review v3 — refreshed against current schema substrate)
**Companion doc:** `2026-04-26-sherlock-v3-manifest.md` (manifest rewrite, scope-limited)
**Out of scope (separate tracks):** DB hardening migrations (M2–M6, M8); manifest content authoring (verified queries, value groups).

> **2026-05-09 refresh notes.** This spec was originally authored one day before the roadmap-01 schema reorg landed (`0001_baseline_prod`, 2026-04-27). Refreshed to reflect current reality: (1) schema substrate is `platform.*` / `analytics.*` / `orchestration.*`, not bare names; (2) all migrations land via Alembic — `startup_schema.py` no longer exists; (3) Sherlock runtime table names (`platform.sherlock_conversation_turns`, `platform.sherlock_turn_events`, `platform.sherlock_agent_sessions`) replace the speculative `sherlock_runtime_*` names used in the original draft; (4) all raw SQL is schema-qualified per the CLAUDE.md invariant. M1 (legacy PK rename) is dropped — already done by roadmap-01. The architectural decisions (D1–D9, D11) and the agent-to-agent design are unchanged. D4 spike has a new target date.

---

## 1. Why this exists

Today Sherlock runs as a single flat agent with 15 tools, ~16 KLOC of orchestration glue, a 17-key scratchpad, and a parallel SQL-generation orchestrator (`sql_agent.py`) the SDK never sees. Cost per turn is **$0.19 / 208 K tokens** with **0%** prompt-cache hit on SQL generation. ~70% of recent sessions ended `degraded`. The system is over-engineered, expensive, and unreliable.

The fix is structural: **let the OpenAI Agents SDK orchestrate. We feed it.**

## 2. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Supervisor + specialists, composed via `agent.as_tool(...)`. **No handoffs.** | Manager synthesizes the final answer; specialists do bounded tasks. SDK docs prescribe this when the manager retains ownership. |
| D2 | Specialists run with clean task briefs. **No inherited message history.** | Context isolation; per Anthropic multi-agent pattern. Cheaper, more focused. |
| D3 | **Provider lock: OpenAI only.** Model id pinned via `SHERLOCK_SUPERVISOR_MODEL` / `SHERLOCK_SPECIALIST_MODEL` env vars (today's default: the same OpenAI flagship `sql_agent.py` uses — see `os.getenv('SQL_AGENT_MODEL')`). Sherlock supervisor + specialists do not run on Azure OpenAI in v3. Other subsystems (evaluators) keep their multi-provider story. | `OpenAIConversationsSession` is OpenAI-direct; using it commits us. v4 may introduce a `SQLAlchemySession` fallback if multi-provider Sherlock is needed. |
| D4 | Conversation continuation via **`OpenAIConversationsSession`** (server-managed). **Subject to a Phase-0 proof spike** (§7); `previous_response_id` (current adapter pattern in `openai_agents_adapter.py:560` and `report_builder/chat_handler.py:1430`) is the documented fallback if the spike fails. | No 30-day TTL on Conversations objects (vs `previous_response_id` chains which expire). Multi-worker safe. Resumable approvals + automatic compaction free. |
| D5 | App-owned persistence is `platform.chat_messages` (durable user-visible message log) + `platform.sherlock_state` (small structured cross-turn state) + `platform.sherlock_evidence` (cross-specialist evidence). `RunContextWrapper.context` is a per-request handle bag, not a store. | `chat_messages` stays as today; new state and evidence tables added. |
| D6 | Generic envelopes — one shape across all specialist families (data, retrieval, kg, action). | Capability-pack extensibility. No per-pack contract layers. |
| D7 | No taxonomy of question types. Supervisor decides per-turn what to spawn (sequential or parallel). | Agent drives behavior. |
| D8 | Streaming UX uses `phase: commentary` + `phase: final_answer`. | Per OpenAI prompt-guidance docs; prevents preambles being mis-classified as final answers. |
| D9 | Supervisor prompt follows GPT-5.5 template. Role → Personality → Goal → Success → Constraints → Output → Stop, with named blocks (`<instruction_priority>`, `<tool_persistence_rules>`, `<output_contract>`). | Per OpenAI prompt-guidance. |
| D10 | Schema migrations land as **Alembic revisions** under `backend/alembic/versions/`. Each revision file is committed with the matching ORM model edit. Container boot runs `alembic upgrade head` via `backend/entrypoint.sh`. | CLAUDE.md invariant: "Schema lives in Alembic, not in `startup_schema.py`. That file no longer exists." |
| D11 | Pre-cutover conversations become **read-only** post-cutover. No dual-protocol stream renderer. | Cleanest break. History viewable; continuation requires a new chat. |

## 3. Component map

```
                  ┌─────────────────────────────────────────────┐
                  │  Supervisor Agent (gpt-5.4, reasoning=med)  │
                  │  • Tools = [data_specialist.as_tool(),      │
                  │             retrieval_specialist.as_tool(), │
                  │             action_specialist.as_tool()]    │
                  │  • Reads conversation via SDK Session       │
                  │  • Reads sherlock_state row                 │
                  │  • Synthesizes; streams commentary + final  │
                  └────────────────────┬────────────────────────┘
                                       │  as_tool (parallel-capable)
            ┌──────────────────────────┼──────────────────────────┐
            │                          │                          │
   ┌────────▼─────────┐      ┌─────────▼──────────┐    ┌──────────▼───────┐
   │ data_specialist  │      │ retrieval_spec     │    │ action_spec      │
   │ tools:           │      │ tools:             │    │ tools:           │
   │  generate_sql    │      │  surface_search    │    │  run_evaluation  │
   │  execute_sql     │      │  vector_search     │    │  trigger_report  │
   │  data_check      │      │  get_evidence      │    │  approve_*       │
   └──────────────────┘      └────────────────────┘    └──────────────────┘
            │                          │                          │
            └──────────┬───────────────┴──────────────────────────┘
                       ▼
              ┌────────────────────┐
              │  sherlock_evidence │  one row per piece of evidence;
              │  (composite-scoped │  refs returned in SpecialistResult.evidence;
              │   per-tenant/user/ │  briefs pass refs, not payloads
              │   app/chat_session)│
              └────────────────────┘
```

## 4. Identity & storage model

This section is the explicit mapping between our internal identifiers and OpenAI's. **Read this before anything else; it's where v1 → v3 confusion would otherwise creep in.**

### 4.1 Internal IDs (unchanged)

| ID | Type | Role |
|---|---|---|
| `platform.chat_sessions.id` | uuid | Internal PK. Immutable. The join key for **everything** Sherlock-side: `sherlock_state.chat_session_id`, `sherlock_evidence.chat_session_id`, `platform.sherlock_conversation_turns.chat_session_id`, `platform.sherlock_turn_events.chat_session_id`, `platform.chat_messages.session_id`. |
| `platform.chat_messages.id` | uuid | Per-message PK for the user-visible message log. Survives v3 unchanged. Frontend renders chat history from this table on page load. The FK column is `session_id` (not `chat_session_id`). |
| `platform.sherlock_conversation_turns.id` | uuid | Per-turn PK. One row per user turn. Drives the SSE stream URL. (This is the existing runtime table — see `backend/app/models/sherlock_runtime.py`. The 2026-04-26 draft used the speculative name `sherlock_runtime_turns`; refreshed.) |
| `platform.sherlock_turn_events.id` | uuid | Per-event PK. One row per emitted SSE event. (The 2026-04-26 draft used the speculative name `sherlock_runtime_events`; refreshed.) |

### 4.2 New ID: `openai_conversation_id`

Added as a column on `platform.chat_sessions` via Alembic revision (see §6):

```sql
ALTER TABLE platform.chat_sessions ADD COLUMN openai_conversation_id TEXT;
CREATE UNIQUE INDEX uq_chat_sessions_openai_convo
  ON platform.chat_sessions(openai_conversation_id) WHERE openai_conversation_id IS NOT NULL;
```

Lifecycle:
1. First Sherlock turn for a `chat_session`: backend calls OpenAI to create a Conversation, stores the returned ID in `platform.chat_sessions.openai_conversation_id`.
2. Every subsequent turn: backend reads the column, instantiates `OpenAIConversationsSession(conversation_id=...)`, passes to `Runner.run_streamed`.
3. `chat_session_id` is the canonical key for our DB; `openai_conversation_id` is a satellite reference used only for SDK Session wiring. We never join on it.

### 4.3 Two purposes, two stores — no overlap

| Surface | Holds | Read by | Authoritative for |
|---|---|---|---|
| `platform.chat_messages` (existing) | User and assistant message bodies as the user sees them | Frontend on page load; chat history view; export | The **rendered conversation**. |
| OpenAI Conversations API (via `openai_conversation_id`) | LLM-shaped Responses input items (assistant messages, tool calls, tool outputs, reasoning items) | OpenAI servers, on every `Runner.run_streamed` call | The **LLM's transcript view** for compaction, continuation, prompt-cache prefix. |

**The two are not synced; they serve different purposes.** Frontend never reads from OpenAI Conversations API. Backend never reads from `chat_messages` to feed the LLM. The Sherlock-side persistence path:

```
turn arrives → write user row to platform.chat_messages
            → run supervisor with OpenAIConversationsSession
            → write assistant row to platform.chat_messages with synthesized final_answer
            → SDK persists raw LLM items at OpenAI automatically
```

If a user opens a conversation a week later, the page-load query is `SELECT * FROM platform.chat_messages WHERE session_id = ?`. To **continue** that conversation, the backend re-uses the stored `openai_conversation_id`; OpenAI restores the LLM's view from server-side state. No transcript replay code on our side.

### 4.4 sherlock_state — small structured row, one per chat

ORM model lives at `backend/app/models/sherlock_runtime.py` alongside the existing runtime tables. Schema is `platform`.

```sql
CREATE TABLE platform.sherlock_state (
  chat_session_id          UUID PRIMARY KEY REFERENCES platform.chat_sessions(id) ON DELETE CASCADE,
  tenant_id                UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  app_id                   TEXT NOT NULL,
  resolved_entities        JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_filters           JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_artifact_id         UUID,
  last_specialist_call_at  TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sherlock_state_tenant_user_app
  ON platform.sherlock_state(tenant_id, user_id, app_id);
```

Four content fields. Compare to today's 17-key scratchpad averaging 21 KB.

### 4.5 sherlock_evidence — full composite scoping

```sql
CREATE TABLE platform.sherlock_evidence (
  ref_id           UUID PRIMARY KEY,
  chat_session_id  UUID NOT NULL REFERENCES platform.chat_sessions(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  app_id           TEXT NOT NULL,
  source           TEXT NOT NULL,            -- sql_row | vector_chunk | kg_triple | action_receipt | doc_excerpt
  locator          JSONB NOT NULL,
  snippet          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sherlock_evidence_session
  ON platform.sherlock_evidence(chat_session_id, created_at);
CREATE INDEX idx_sherlock_evidence_tenant_user_app
  ON platform.sherlock_evidence(tenant_id, user_id, app_id, created_at);
```

Cleanup is automatic via `ON DELETE CASCADE` from `platform.chat_sessions`. Same composite scope (`tenant_id, user_id, app_id, chat_session_id`) the rest of Sherlock uses.

## 5. Data contracts

### 5.1 TaskBrief (supervisor → specialist)

```json
{
  "task":          "natural-language goal",
  "scope":         { "app_id": "string", "tenant_id": "uuid",
                     "user_id": "uuid", "chat_session_id": "uuid",
                     "time_window": { "since": "iso", "until": "iso" } },
  "intent_hint":   "measure | dimension | record_lookup | grounding | action | mixed",
  "evidence_refs": ["ref_id", ...],
  "expected_kind": "data | retrieval | kg | action",
  "budget":        { "max_tool_calls": 6, "deadline_ms": 20000 }
}
```

### 5.2 SpecialistResult (specialist → supervisor)

```json
{
  "kind":         "data | retrieval | kg | action | error",
  "status":       "ok | partial | empty | needs_clarification | error",
  "summary":      "string for supervisor synthesis",
  "evidence":     [EvidenceRef, ...],
  "artifacts":    [Artifact, ...],
  "state_delta":  { "resolved_entities?": {...}, "active_filters?": {...} },
  "meta":         { "confidence": 0.0..1.0, "latency_ms": int, "source_pack_id": "string" }
}
```

### 5.3 EvidenceRef (capability-agnostic)

```json
{
  "ref_id":   "uuid",
  "source":   "sql_row | vector_chunk | kg_triple | action_receipt | doc_excerpt",
  "locator":  { "table": "...", "pk": "..." }
              | { "vector_id": "...", "doc_id": "..." }
              | { "subject": "...", "predicate": "...", "object": "..." }
              | { "action_id": "..." },
  "snippet":  "short text/json blob"
}
```

### 5.4 Artifact (UI-bound, discriminated)

```json
{ "kind": "chart", "payload": {
    "kind": "chart",
    "spec": { "...": "Vega-Lite v5 spec" },
    "data": [ { "...": "row" } ],
    "title?": "optional",
    "sql_query?": "optional",
    "source_question?": "optional",
    "reason_code?": "CG_*",
    "warning?": "optional"
} }

{ "kind": "table", "payload": {
    "kind": "table",
    "columns": [ { "key": "metric", "label": "Metric" } ],
    "data": [ { "metric": "Pass rate", "value": 0.62 } ],
    "title?": "optional",
    "reason_code?": "CG_*",
    "warning?": "optional"
} }

{ "kind": "kpi", "payload": {
    "kind": "kpi",
    "kpi": { "label": "Pass rate", "value": 0.62, "format": "percent" },
    "title?": "optional"
} }

{ "kind": "summary", "payload": {
    "kind": "summary",
    "summary": {
      "fields": [ { "label": "Top criterion", "value": "Hallucinated medication" } ]
    },
    "title?": "optional"
} }

{ "kind": "citation_set", "payload": {
    "kind": "citation_set",
    "citations": [ { "label": "Run 9f2a1c7b", "ref_id": "uuid", "snippet?": "optional" } ],
    "title?": "optional"
} }

{ "kind": "empty", "payload": {
    "kind": "empty",
    "title?": "optional",
    "message?": "No data for this question."
} }
```

`payload` is the exact UI-facing discriminated union. The duplication (`Artifact.kind === Artifact.payload.kind`) is intentional: SSE handlers can branch on the top-level `kind`, while the frontend can pass `payload` directly into the existing chart/table/KPI render path and validators. Charts continue to follow the **`analytics.chart.v1` contract (Vega-Lite v5 + data rows)** — see §16.

## 6. Schema bootstrap — Alembic revision

All v3 schema changes ship as a single Alembic revision under `backend/alembic/versions/`. The revision file is committed in the same PR as the matching ORM model edits (`backend/app/models/sherlock_runtime.py` for the new tables, `backend/app/models/chat.py` for the `openai_conversation_id` column). Boot runs `alembic upgrade head` via `backend/entrypoint.sh` on every container start.

Concrete revision (illustrative — actual file uses `op.create_table`, `op.add_column`, etc.):

```python
"""sherlock v3 — openai conversation id, sherlock_state, sherlock_evidence

Revision ID: 00XX_sherlock_v3_state_evidence
Revises: <prior head>
Create Date: 2026-05-XX
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


def upgrade() -> None:
    # 1. openai_conversation_id satellite on platform.chat_sessions
    op.add_column(
        'chat_sessions',
        sa.Column('openai_conversation_id', sa.Text(), nullable=True),
        schema='platform',
    )
    op.create_index(
        'uq_chat_sessions_openai_convo',
        'chat_sessions',
        ['openai_conversation_id'],
        unique=True,
        postgresql_where=sa.text('openai_conversation_id IS NOT NULL'),
        schema='platform',
    )

    # 2. platform.sherlock_state
    op.create_table(
        'sherlock_state',
        sa.Column('chat_session_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('app_id', sa.Text(), nullable=False),
        sa.Column('resolved_entities', postgresql.JSONB(),
                  nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('active_filters', postgresql.JSONB(),
                  nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('last_artifact_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('last_specialist_call_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True),
                  nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('chat_session_id'),
        sa.ForeignKeyConstraint(['chat_session_id'], ['platform.chat_sessions.id'],
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['platform.tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['platform.users.id'], ondelete='CASCADE'),
        schema='platform',
    )
    op.create_index(
        'idx_sherlock_state_tenant_user_app', 'sherlock_state',
        ['tenant_id', 'user_id', 'app_id'], schema='platform',
    )

    # 3. platform.sherlock_evidence
    op.create_table(
        'sherlock_evidence',
        sa.Column('ref_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('chat_session_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('app_id', sa.Text(), nullable=False),
        sa.Column('source', sa.Text(), nullable=False),
        sa.Column('locator', postgresql.JSONB(), nullable=False),
        sa.Column('snippet', sa.Text(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True),
                  nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('ref_id'),
        sa.ForeignKeyConstraint(['chat_session_id'], ['platform.chat_sessions.id'],
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['platform.tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['platform.users.id'], ondelete='CASCADE'),
        schema='platform',
    )
    op.create_index(
        'idx_sherlock_evidence_session', 'sherlock_evidence',
        ['chat_session_id', 'created_at'], schema='platform',
    )
    op.create_index(
        'idx_sherlock_evidence_tenant_user_app', 'sherlock_evidence',
        ['tenant_id', 'user_id', 'app_id', 'created_at'], schema='platform',
    )


def downgrade() -> None:
    op.drop_index('idx_sherlock_evidence_tenant_user_app',
                  table_name='sherlock_evidence', schema='platform')
    op.drop_index('idx_sherlock_evidence_session',
                  table_name='sherlock_evidence', schema='platform')
    op.drop_table('sherlock_evidence', schema='platform')

    op.drop_index('idx_sherlock_state_tenant_user_app',
                  table_name='sherlock_state', schema='platform')
    op.drop_table('sherlock_state', schema='platform')

    op.drop_index('uq_chat_sessions_openai_convo',
                  table_name='chat_sessions', schema='platform')
    op.drop_column('chat_sessions', 'openai_conversation_id', schema='platform')
```

Boot order (unchanged from CLAUDE.md lifespan): `alembic upgrade head` runs first (entrypoint script), then `Base.metadata` is consistent with the live schema, then the FastAPI lifespan executes (`sync_column_comments`, `seed_all_defaults`, etc.).

**Schema-qualify every raw SQL line** inside `op.execute(...)` — bare names will resolve against `public` and crash boot per the CLAUDE.md invariant. ORM operations are safe because `__table_args__ = {"schema": "platform"}` propagates.

Rollback: `alembic downgrade -1` reverts the revision. Tables are dropped; the `chat_sessions.openai_conversation_id` column is dropped along with it. Existing `chat_messages` data is untouched.

## 7. Conversation continuation — Phase-0 proof spike

D4 commits to `OpenAIConversationsSession`, but with a hard prerequisite: **a 1-day spike validates this works for our deployment before Phase 1 starts.**

Spike acceptance criteria:

1. `OpenAIConversationsSession` instantiates against the configured Sherlock model (`SHERLOCK_SUPERVISOR_MODEL` env, today's default = the OpenAI flagship the codebase uses elsewhere — see `sql_agent.py:1790`) using our existing API key + endpoint.
2. Multi-turn: 5 sequential `Runner.run` calls share state through the same `conversation_id`, the LLM remembers turn 1 in turn 5.
3. Token billing: input-token counts on turn N include cached-prefix discounts (verified via `usage` field).
4. Conversation object survives 24 h with no items written to it (no TTL).
5. Items persisted across worker process restarts (multi-worker safety check).

Fallback: if the spike fails any of these, fall back to **`previous_response_id`** strategy (today's pattern), accepting the 30-day TTL and writing a refresh-on-expiry helper. This is the path `openai_agents_adapter.py:560-570` and `report_builder/chat_handler.py:1430-1525` already implement; we keep it.

Spike output: a `docs/spikes/<DATE>-openai-conversations-session.md` go/no-go report. Go/No-go decision is made before Phase 1 PR opens. (The original 2026-04-29 target slipped during the roadmap-01 reorg; reschedule fresh against the start-of-implementation date.)

## 8. Provider lock

**Sherlock supervisor + every Sherlock specialist runs on OpenAI direct.** Azure OpenAI is not supported as a Sherlock backend in v3.

- The SDK wiring (§11) reads `OpenAIResponsesModel(os.getenv('SHERLOCK_SUPERVISOR_MODEL'))` and `os.getenv('SHERLOCK_SPECIALIST_MODEL')` (default: same flagship `sql_agent.py` already uses via `SQL_AGENT_MODEL`). Pinning the version string in env keeps deploys controllable; bumping a model is a config change, not a code change.
- Phase 5 deletion includes the Azure code paths in today's `openai_agents_adapter.py` **only for the Sherlock chat surface**. Azure paths used by other subsystems (evaluators, transcription) are untouched.
- Cost telemetry references OpenAI rates; pricing rows for Azure-equivalents stay in `analytics.ref_llm_model_pricing` for non-Sherlock callers.
- v4 may revisit if a Sherlock-on-Azure use case appears; the path is `OpenAIConversationsSession` → `SQLAlchemySession` swap + provider abstraction in supervisor build.

This decision is final for v3.

## 9. Supervisor prompt skeleton

```
Role: Sherlock — analyst-by-prompt for evaluation data.

# Personality
Sharp, observant, lightly witty. Confident and warm.

# Goal
Answer the user's data question correctly using the specialist tools available
in this app's capability pack. Never invent data. Cite evidence.

# Success criteria
- A direct answer to the user's question, in 1-3 sentences plus optional table/chart.
- All numbers cite SpecialistResult evidence refs.
- Compound questions get all needed specialists fired (parallel when independent).

# Constraints
- Only call specialist tools. Do not generate SQL, embeddings, or actions yourself.
- Stay in scope of this app. Out-of-scope topics → brief refusal in character.

# Output
- Markdown. Tables for tabular data. Bold key numbers.
- Use phase: "commentary" for status updates.
- Use phase: "final_answer" only when synthesizing the answer.

# Stop rules
- Stop when (a) a real result lands, (b) a single clarifying question is needed,
  or (c) the capability truly cannot satisfy the ask.

<instruction_priority>
1. Tool persistence rules
2. Output contract
3. Safety / scope
4. Personality
</instruction_priority>

<tool_persistence_rules>
- If a specialist returns status=empty or status=partial, retry once with a
  broadened brief before answering.
- If a specialist returns status=needs_clarification, ask the user exactly one
  crisp clarifying question.
- For compound questions, fire independent specialists in parallel in the same
  turn. Sequence only when brief B references A's evidence.
</tool_persistence_rules>

<output_contract>
- Lead with the answer. No preamble.
- Bold key numbers and use arrows for comparisons (+5%, -12 calls).
- Abbreviate UUIDs to first 8 chars in prose.
</output_contract>
```

## 10. Specialist contract

Every specialist is an `Agent` whose `instructions` follow the GPT-5.5 template. Each specialist:

- Takes a `TaskBrief` (passed via `as_tool` parameters; validated by Pydantic).
- Owns its own bounded tool set (no specialist calls another specialist).
- Returns a `SpecialistResult` validated against the JSON schema.
- Writes evidence rows to `sherlock_evidence`; returns refs in the result.
- Reads the manifest slice for its scope; never sees the full manifest.

### 10.1 data_specialist
- Tools: `generate_sql`, `execute_sql`, `data_check`. Catalog tools (`catalog_inspect/relations/sample/values`) deleted.
- Prompt input: TaskBrief + projected manifest slice (3–5 tables) + retrieved verified-query exemplars (top 2–3).
- Output: rows ⇒ `EvidenceRef[]` of `source: sql_row`; chart spec ⇒ `Artifact` of `kind: chart`.

### 10.2 retrieval_specialist
- Tools: `surface_search` (over `platform.evaluation_run_thread_results`, `platform.chat_messages`, `platform.evaluation_run_api_call_logs`), `vector_search` (when a vector index exists), `get_record`.
- Prompt input: TaskBrief + relevant data-surface descriptors.
- Output: chunks ⇒ `EvidenceRef[]` of `source: vector_chunk` or `doc_excerpt`.

### 10.3 action_specialist (Phase 5)
- Tools: `run_evaluation`, `trigger_report`, `approve_review`, etc.
- Approval gate: every tool call requires explicit `interruption` per OpenAI Agents SDK. Resume from `state` after user confirms.
- Output: action_receipt ⇒ `EvidenceRef[]` of `source: action_receipt`. No data modification without an explicit approval round-trip.

### 10.4 kg_specialist
Out of v3 scope. KG infrastructure not in place yet.

## 11. SDK wiring

```python
from agents import Agent, Runner
from agents.memory import OpenAIConversationsSession
from agents.models.openai_responses import OpenAIResponsesModel
from agents.model_settings import ModelSettings

SHERLOCK_SUPERVISOR_MODEL = os.getenv(
    'SHERLOCK_SUPERVISOR_MODEL',
    os.getenv('SQL_AGENT_MODEL', 'gpt-5.4-mini'),
)

def build_supervisor(app_id: str, pack: CapabilityPack) -> Agent[SherlockContext]:
    data_spec      = build_data_specialist(app_id, pack)
    retrieval_spec = build_retrieval_specialist(app_id, pack)

    return Agent[SherlockContext](
        name=f"sherlock-supervisor-{app_id}",
        instructions=SUPERVISOR_PROMPT.format(app_id=app_id),
        model=OpenAIResponsesModel(SHERLOCK_SUPERVISOR_MODEL),
        model_settings=ModelSettings(reasoning_effort="medium", temperature=0.3),
        tools=[
            data_spec.as_tool(
                tool_name="data_specialist",
                tool_description="Answers analytics questions over evaluation facts.",
                parameters=TaskBriefSchema,
                custom_output_extractor=specialist_result_extractor,
            ),
            retrieval_spec.as_tool(
                tool_name="retrieval_specialist",
                tool_description="Pulls raw evidence from threads, transcripts, and logs.",
                parameters=TaskBriefSchema,
                custom_output_extractor=specialist_result_extractor,
            ),
        ],
    )

async def run_turn(chat_session_id: str, user_message: str, ctx: SherlockContext):
    convo_id = await ensure_openai_conversation(chat_session_id, ctx)  # creates if NULL
    session = OpenAIConversationsSession(conversation_id=convo_id)
    supervisor = build_supervisor(ctx.app_id, load_pack(ctx.app_id))
    async for event in Runner.run_streamed(
        supervisor, user_message, context=ctx, session=session, max_turns=10
    ).stream_events():
        yield normalize_to_v3_event(event)   # see §14
```

Total wiring code: < 200 LOC. Replaces 656 LOC of `openai_agents_adapter.py` + 1764 LOC of `chat_handler.py`.

## 12. Failure recovery — single source of truth

Recovery lives in the supervisor's `<tool_persistence_rules>`:

| Specialist returns | Supervisor action |
|---|---|
| `status: ok` | Synthesize. |
| `status: partial` | Synthesize what landed, note caveat. |
| `status: empty` | Re-brief same specialist with broader scope (drop one filter, expand window). One retry only. |
| `status: needs_clarification` | Ask user exactly one crisp clarifying question. |
| `status: error` | Try another specialist if applicable, or surface a clean failure message. No silent fallbacks. |

No code-level retry orchestration. The LLM is the orchestrator; the prompt is the policy.

## 13. Streaming UX — the user-facing trace

```
[user]    Provide eval runs failure summary for the last 4 runs

[stream]  phase: commentary  → "Pulling the recent run grid…"
[tool]    data_specialist (in flight, ~6s)
[stream]  phase: commentary  → "Cross-checking criterion violations…"
[stream]  phase: final_answer →
          "Last 4 runs averaged a **62% pass rate**, down 5%…"
[artifact] kind=table
[artifact] kind=chart
[stream]  turn_finished, status=done
```

UI sees a single ordered SSE event stream. Commentary renders to the status strip; final_answer renders to the message body; artifacts attach as message-scoped components.

## 14. Stream-stitch — backend events ↔ chat widget

Defines the contract the chat widget binds to. Rationale: today's 10+ event types collapse to a smaller, semantic set aligned with the supervisor + specialists model.

### 14.1 End-to-end turn lifecycle

```
1. User submits a message in the chat widget.
2. Frontend POSTs /api/chat/turn { chat_session_id, user_message }.
3. Backend creates platform.sherlock_conversation_turns row (status='queued'),
   writes user row to platform.chat_messages, returns { turn_id, stream_url },
   opens SSE.
4. Backend ensures openai_conversation_id exists for the chat_session
   (creates one on first turn). Spawns Runner.run_streamed with
   OpenAIConversationsSession + supervisor.
5. Frontend opens EventSource(stream_url), shows assistant bubble in
   "thinking" state with empty status strip above it.
6. Supervisor's first model call returns. First emitted output is a
   phase=commentary content_delta. Frontend renders to status strip.
7. Supervisor activates a specialist via as_tool. SDK emits agent_updated +
   the specialist's run begins. Backend emits specialist_started event.
   Frontend status strip: "● data_specialist · <brief_summary>"
8. Specialist runs its inner loop (NOT streamed to UI). Writes evidence
   rows to platform.sherlock_evidence. Returns SpecialistResult.
9. Backend emits specialist_finished with 1-line summary + evidence/artifact
   refs. Frontend status strip updates: "✓ data_specialist · 4 rows"
10. (Optional) supervisor fires more specialists; steps 7-9 repeat.
11. Supervisor begins synthesis with phase=final_answer content_deltas.
    Frontend swaps status strip into message body, starts typewriter.
12. Artifacts emit as artifact_emitted events; frontend renders inline.
13. Run completes. Backend writes assistant row to platform.chat_messages
    with the full synthesized text. Emits turn_finished { status,
    final_message_id, usage }. Closes SSE.
14. Frontend marks message complete, exposes actions.
15. SDK has persisted LLM items at OpenAI automatically. Our
    platform.sherlock_state row gets state_delta merged.
    platform.sherlock_evidence rows persist.
```

### 14.2 Event surface — old → new

| Today | v3 | Disposition |
|---|---|---|
| `user_message_added` | `turn_started` | Renamed |
| `scope.resolved` | — | Deleted |
| `bundle.assembled` | — | Deleted |
| `entity_recognition` | — | Deleted (entity grounding is internal to specialists) |
| `system_prompt` | — | Internal only; persisted to `platform.sherlock_turn_events` for audit, not streamed |
| `tool_call_start` / `tool_call_end` | `specialist_started` / `specialist_finished` | UI sees specialists, not inner tools |
| (none) | `agent_updated` | New; native SDK event when supervisor activates a specialist |
| `content_delta` (untagged) | `content_delta` (carries `phase`) | Same name, new field |
| `chart` | `artifact_emitted` (carries `kind`) | Generalized envelope |
| `done` | `turn_finished` (carries `status`) | Renamed |
| (none) | `error_emitted` | New; specialist or supervisor errors with `recoverable: bool` |

### 14.3 Turn status enum

| Today | v3 | Meaning |
|---|---|---|
| `queued` | `queued` | Same |
| `active` | `running` | In-flight turn; non-terminal |
| `done` | `done` | Synthesized cleanly |
| `degraded` | `partial` | Renamed; specialist returned `empty`/`partial`, supervisor synthesized with caveats |
| `error` | `failed` | Unhandled error, max_turns, or deadline |
| `interrupted` | `interrupted` | User/operator cancel or SDK interruption before synthesis completes |
| (none) | `clarifying` | New; supervisor asked the user a question |

#### 14.3.1 Migration / cutover mapping

This rename is not just documentation; it is a lockstep contract migration across backend rows, SSE, and frontend types.

**Persisted turn enum (`platform.sherlock_conversation_turns.status`) after cutover**

```text
queued | running | done | partial | failed | interrupted | clarifying
```

Rules:

1. `running` is persisted on the turn row and returned by session snapshot APIs, but never emitted by `turn_finished`.
2. `turn_finished.status` is terminal-only:

```text
done | partial | failed | interrupted | clarifying
```

3. Frontend `TurnLifecycleStatus` mirrors the persisted enum exactly.
4. Frontend `TerminalStatus` becomes the terminal subset:

```text
done | partial | failed | interrupted
```

5. `clarifying` is terminal for **this turn** but non-terminal for the conversation: the assistant asked one question and awaits the next user turn.

**Implementation cutover**

P1 changes these surfaces in one PR:

1. Backend status writers/readers (`mark_turn_active`, terminal mappers, `_is_terminal_turn_status`, snapshot serializers).
2. SSE `turn_finished.status` payloads and reconnect logic.
3. Frontend chat-widget status types, badges, and terminal-state handling.

**Old-row handling**

Pre-cutover rows are **not** rewritten in place. They remain queryable for audit, but because pre-cutover conversations are read-only (§15), the v3 frontend never needs to interpret old runtime row statuses during live replay. The only preserved user-facing history surface is `chat_messages`.

### 14.4 SSE wire format

```
event: <event_type>
id:    <seq>          ← per-turn integer, monotonic
data:  <JSON payload>
```

Every event is persisted to `platform.sherlock_turn_events` **before** flushing to the stream. DB is at-or-ahead of the wire. Reconnect deterministic.

### 14.5 Per-event payload schemas

```typescript
// All payloads are JSON; turn_id and conversation_id implicit in the stream URL.

interface TurnStarted {
  type: 'turn_started';
  turn_id: string;
  chat_session_id: string;
  user_message: string;
  app_id: string;
}

interface AgentUpdated {
  type: 'agent_updated';
  from_agent: string;       // 'supervisor' | 'data_specialist' | ...
  to_agent: string;
}

interface SpecialistStarted {
  type: 'specialist_started';
  specialist: string;       // 'data_specialist' | 'retrieval_specialist' | 'action_specialist'
  call_id: string;          // SDK tool_call_id
  brief_summary: string;    // 1-line, supervisor-supplied
}

interface SpecialistFinished {
  type: 'specialist_finished';
  specialist: string;
  call_id: string;
  status: 'ok' | 'partial' | 'empty' | 'needs_clarification' | 'error';
  result_summary: string;   // 1-line, from SpecialistResult.summary
  evidence_refs: string[];  // ref_ids written to sherlock_evidence
  artifact_refs: string[];  // ids of artifacts attached to this message
  duration_ms: number;
}

interface ContentDelta {
  type: 'content_delta';
  phase: 'commentary' | 'final_answer';
  text: string;             // delta chunk; concatenate in order
}

interface ArtifactEmitted {
  type: 'artifact_emitted';
  artifact_id: string;
  kind: 'chart' | 'kpi' | 'summary' | 'table' | 'citation_set' | 'empty';
  payload:
    | { kind: 'chart'; spec: object; data: Array<Record<string, unknown>>; title?: string;
        sql_query?: string; source_question?: string; reason_code?: string; warning?: string | null }
    | { kind: 'table'; columns: Array<{ key: string; label: string }>;
        data: Array<Record<string, unknown>>; title?: string; reason_code?: string; warning?: string | null }
    | { kind: 'kpi'; kpi: { label: string; value: unknown; format?: string }; title?: string }
    | { kind: 'summary'; summary: { fields: Array<{ label: string; value: unknown }> }; title?: string }
    | { kind: 'citation_set'; citations: Array<{ label: string; ref_id: string; snippet?: string }>; title?: string }
    | { kind: 'empty'; title?: string; message?: string };
  position: number;         // ordering within the message body
}

interface ErrorEmitted {
  type: 'error_emitted';
  source: 'supervisor' | 'specialist';
  specialist?: string;
  message: string;
  recoverable: boolean;
}

interface TurnFinished {
  type: 'turn_finished';
  turn_id: string;
  status: 'done' | 'partial' | 'failed' | 'interrupted' | 'clarifying';
  final_message_id: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cached_read_tokens: number;
    cost_usd: number;
    call_count: number;
  };
}
```

### 14.6 Frontend event handler — switch (concrete)

```
turn_started        → mark turn live, show empty status strip
agent_updated       → status strip: "supervisor → <to_agent>"
specialist_started  → status strip: "● <specialist> · <brief_summary>"
specialist_finished → status strip: "✓ <specialist> · <result_summary>"
content_delta:
  phase=commentary  → append to status strip (transient lane)
  phase=final_answer→ append to message body (durable lane, typewriter)
artifact_emitted    → render inline at `position` in message body
error_emitted       → banner; recoverable? show retry. fatal? show error
turn_finished       → close stream, finalize message, show actions
```

### 14.7 Two render lanes — the key UX rule

| Lane | Source | Persistence | Visual |
|---|---|---|---|
| Status strip | `commentary` deltas + `agent_updated` + `specialist_*` | Transient on screen; persisted in `platform.sherlock_turn_events` for audit only | Slim line above the assistant bubble; wiped when final answer starts |
| Message body | `final_answer` deltas + `artifact_emitted` | Durable; this is the assistant message stored in `platform.chat_messages` | Assistant bubble itself with typewriter + inline artifacts (`artifact.payload` reuses the existing UI contract) |

The model's `phase` tag is the discriminator. UI does not infer.

### 14.8 Reconnect / replay

```
Frontend tracks last_seq across the live stream.
On disconnect:
  reopen with /api/chat/turn/<turn_id>/stream?resume_from=<last_seq>
Backend behavior:
  if turn is still live → replay events with seq > last_seq from
    platform.sherlock_turn_events, then continue with live events
  if turn is finished   → replay all events with seq > last_seq, then close
On client unmount mid-turn:
  backend keeps writing events; on return, the conversation pane fetches
  the full event log from seq=0 and reconstructs the message progressively
  (or jumps to final state if turn_finished is present).
```

Events are always persisted before streaming; the DB is the source of truth.

### 14.9 Specialist activity is scoped, not nested

v3 deliberately does not stream nested tool calls (the data_specialist's internal `generate_sql` / `execute_sql` / `data_check`). The widget shows: supervisor → 1-3 specialist tags → final answer.

- Matches the user's mental model — "what's the agent doing right now."
- Eliminates the catalog-tool-explosion the today's tree shows.
- Power-user audit panel is sourced from a separate fetch (`GET /api/chat/turn/<id>/events?include=tool_internal`), not from the live stream.

## 15. Pre-cutover conversation handling

**Decision (D11):** pre-cutover conversations are **read-only** post-cutover. Continuation requires a new chat.

Rendering rules:

1. Page-load query for any conversation reads `platform.chat_messages` only. This works for all conversations, pre- and post-cutover, because `chat_messages` is preserved across the migration.
2. Pre-cutover conversations have `platform.chat_sessions.openai_conversation_id IS NULL`. The frontend detects this and:
   - Shows the conversation in read-only mode.
   - Disables the input box.
   - Shows a banner: "This conversation predates the new Sherlock. Start a new chat to continue with the same context."
3. Post-cutover conversations have `openai_conversation_id` populated and behave normally.
4. `platform.sherlock_turn_events` rows from before cutover remain queryable for ops/audit. The v3 frontend never replays them as a live event stream.

No dual-protocol stream renderer. No event-shape conversion layer. Cleanest break.

## 16. Vega-Lite contract — preserved verbatim

The `analytics.chart.v1` contract (Vega-Lite v5) is preserved in v3. Specifically:

| Component | Status |
|---|---|
| `result_set_typer.py`, `chartability_gate.py`, `chart_type_picker.py`, `vega_lite_emitter.py` | **Kept intact.** Pure functions; pipeline runs end-to-end in the data_specialist's `execute_sql` step. |
| 7 Vega-Lite marks (`bar`/`grouped_bar`/`stacked_bar`/`line`/`multi_line`/`area`/`pie`) | Unchanged. |
| Reason codes (`CG_EMPTY` / `CG_FIELD_CARD` / `CG_NO_MEASURE` / `CG_DEGENERATE_MEASURE` / `CG_ALL_IDS` / `CG_HIGH_CARD` / `CG_SINGLE_VALUE`) | Unchanged. |
| Schema validation against `vega-lite-schema-v5.json` | Unchanged. |
| Discriminated payload union (`kind: chart \| kpi \| summary \| table \| empty`) | Preserved inside `Artifact.payload` for analytics outputs; top-level `Artifact.kind` mirrors it on the wire (§5.4, §14.5). `citation_set` is an additive non-chart artifact, not part of `analytics.chart.v1`. |
| Chart spec payload (Vega-Lite v5 JSON) | Bytewise identical. |
| Frontend translator `src/features/analytics/vegaLiteToRecharts.ts` | Untouched. |

Only changes:
- Caller — was `data_query` tool handler in `tool_handlers.py`; now data_specialist's `execute_sql` step.
- Wire event name — `chart` → `artifact_emitted` (§14.2). The chart payload survives as `{ kind: 'chart', spec, data, ... }`; non-chart artifacts use their own payload variants.

## 17. What gets deleted from current code

| File / module | LOC | Fate |
|---|---:|---|
| `chat_engine/sql_agent.py` (orchestration parts) | ~1,200 of 2,385 | Delete. Pure execution helpers stay (~600 LOC). |
| `chat_engine/openai_agents_adapter.py` (`_StreamPacer`, custom turn wrapper, Azure paths) | ~500 of 656 | Delete. Replace with thin SDK wiring (§11). |
| `chat_engine/catalog_tools.py` | 830 | Delete entirely. Catalog tools not LLM-facing in v3. |
| `report_builder/scratchpad_state.py` | 1,255 | Delete. Replaced by `sherlock_state` row. |
| `report_builder/chat_handler.py` | 1,764 | Delete. Logic moves to specialists. |
| `report_builder/tool_handlers.py` | 1,806 | Reduce to ≤ 400 LOC of specialist tool implementations. |
| **Total deletion target** | **~7,000 LOC** | Net code reduction ≥ 40 % of chat_engine + report_builder. |

What's kept:
- `chat_engine/manifest.py`, `manifest_validator.py`, `comment_emitter.py`, `prompt_generator.py`, `tool_description_generator.py` — manifest infrastructure.
- `chat_engine/chartability_gate.py`, `chart_type_picker.py`, `vega_lite_emitter.py`, `result_set_typer.py` — Vega-Lite chart pipeline (§16).
- `chat_engine/data_surfaces.py` — surface registry.
- `platform.chat_messages` table, the chat history routes, and the existing chat-widget message-log render path.
- The existing `platform.sherlock_agent_sessions` / `platform.sherlock_conversation_turns` / `platform.sherlock_turn_events` runtime tables (`backend/app/models/sherlock_runtime.py`). v3 reuses them directly; only the persisted enum values for `sherlock_conversation_turns.status` change (see §14.3.1).
- All ORM, all evaluators, all routes outside `/api/chat`.

## 18. Phased rollout

Long-lived integration branch `feat/sherlock-v3` off `main`. One PR per phase into the integration branch; final cutover PR `feat/sherlock-v3 → main`.

| Phase | Scope | Acceptance |
|---|---|---|
| **P0** | (a) Eval harness for the 8 war-game questions; (b) **Conversations API spike** (§7) with go/no-go report; (c) Branch + CI setup | Spike report committed; harness runs against a stub specialist |
| **P1** | Alembic revision (§6) + supervisor + data_specialist + `OpenAIConversationsSession` wiring + replace `/api/chat/turn` + stream-stitch normalizer + turn-status enum migration (§14.3.1) | Q1, Q2, Q3, Q6, Q8 pass; cost ≤ $0.04/turn for single-specialist Qs |
| **P2** | retrieval_specialist + parallel `as_tool` + sequential `prior_evidence_refs` chaining | Q5, Q7 pass; compound-question cost ≤ $0.06/turn |
| **P3** | Frontend stream-stitch — status strip, event-parser swap, tool-call panel deletion, status badges, reconnect verified, power-user audit panel | Live stream renders cleanly; one full conversation walked end-to-end |
| **P4** | action_specialist + approval/interrupt flow + first two action tools | "Trigger evaluation" demo with approval gate |
| **P5** | Code deletion (~7 KLOC), Azure-path removal, internal dogfood, telemetry confirms targets, integration PR, deploy | All targets met in 24 h smoke window |

Each phase ends with three checks, all passing before next phase starts:
1. Schema/migrations — Alembic revision applies and downgrades cleanly on a dev DB; `alembic upgrade head` runs end-to-end on `docker compose up --build`.
2. War-game harness — questions tagged for this phase pass with assertions.
3. Cost telemetry — per-turn token + dollar usage at or below phase target.

## 19. War-game checkpoint

The 8 questions (Q1–Q8) walked through this architecture in the conversation that produced this spec. Re-walked against the post-hardening manifest in the manifest spec. Q4 / Q5 / Q7 unblock cleanly only after the DB hardening track (M2–M6, M8 — M1 already done by roadmap-01) lands and adds canonical agent-dim joins. v3 ships either way; without hardening the soft-join workarounds remain in the manifest's `verified_queries`.

## 20. Open items deferred

- Cross-turn evidence reuse / vector search over `sherlock_evidence` snippets — P5+ (add embedding column).
- Capability pack contract — formal Python plug-in registry — v4.
- KG specialist — out of v3 scope.
- Multi-pack questions ("compare voice-rx and inside-sales") — v4.
- Provider abstraction (Sherlock on Azure / Anthropic) — v4 if the use case appears.

## 21. Telemetry / cost discipline

Per-turn target post-P2: **≤ 4 LLM calls, ≤ 30 K input tokens, ≤ $0.04 cost.**

Measured via:
- `analytics.fact_llm_generation` rows aggregated by `owner_type='sherlock_turn'` + `owner_id` (per supervisor turn). Pricing resolution goes through `pricing_cache` per the CLAUDE.md cost invariant; do not hand-roll model normalization.
- `platform.sherlock_turn_events` retained for tool-call audit.
- Cache-hit rate: target ≥ 70 % on supervisor follow-ups, ≥ 50 % on data_specialist follow-ups.
- `degraded`/`partial` rate: target < 10 % of turns (vs ~70 % today).

Tracked in the existing `/api/cost` views; no new infra.

---

## Decision log — what changed from the v1 draft

| Gap raised | Resolution | Where |
|---|---|---|
| Storage model inconsistency (`chat_session_id` vs `conversation_id`) | Explicit identity & storage model with two-stores-no-overlap rule | §4 |
| `sherlock_evidence` under-scoped | Full composite scope with FK CASCADE | §4.5, §6 |
| `OpenAIConversationsSession` not proven; conflicts with current `previous_response_id` adapter | Hard prerequisite spike in P0 with documented fallback path | §2 D4, §7 |
| Migration mechanism (`startup_schema.py`) | **2026-05-09 refresh:** rewritten to Alembic — `startup_schema.py` no longer exists per CLAUDE.md invariant | §2 D10, §6 |
| Schema-qualified table names | **2026-05-09 refresh:** all SQL is `platform.*` / `analytics.*` qualified per CLAUDE.md invariant; bare names previously crashed prod boot | §4, §6, §11, §14, §21 |
| Runtime table names — speculative `sherlock_runtime_*` vs actual | **2026-05-09 refresh:** rewritten to use the existing `platform.sherlock_conversation_turns` / `platform.sherlock_turn_events` / `platform.sherlock_agent_sessions` tables in `backend/app/models/sherlock_runtime.py` | §4.1, §14 |
| SSE protocol contract incomplete | Per-event TypeScript schemas added; pre-cutover read-only rule committed | §14.5, §15 |
| Artifact payload too vague (`spec` could be misread as chart-only) | Rewritten as a precise discriminated union with chart `data` and per-kind payloads | §5.4, §14.5, §16 |
| Turn-status rename not reconciled with current `active/degraded/error/interrupted` runtime | Explicit lockstep migration for DB rows, SSE payloads, frontend types, and old-row handling | §14.3, §14.3.1, §15 |
| Provider support ambiguous; model id pin (`gpt-5.4-2026-03-05`) likely to drift | **2026-05-09 refresh:** hard lock to OpenAI direct; model id read from `SHERLOCK_SUPERVISOR_MODEL` / `SHERLOCK_SPECIALIST_MODEL` env, default = whatever `SQL_AGENT_MODEL` resolves to today; Azure paths deleted in P5 | §2 D3, §8, §11 |
| Approval/resume not deeply specified | Acknowledged Phase 5 territory; sub-spec to follow before P4 starts | §10.3 |
