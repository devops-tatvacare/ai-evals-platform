# Sherlock v3 — Manifest v2 + DB Hardening Spec

**Date:** 2026-04-26 (refreshed 2026-05-09)
**Status:** Draft, pre-implementation — refreshed against current schema substrate
**Companion doc:** `2026-04-26-sherlock-v3-architecture.md`
**Scope:** schema migrations to harden cross-table joins (M2–M6, M8 — **M1 dropped**) + manifest YAML v2 schema + Phase-1 content for inside-sales pack.

> **2026-05-09 refresh notes.** The roadmap-01 schema reorg landed on 2026-04-27, one day after the original draft, and changed almost every table name this spec referenced. Refreshed:
>
> - `analytics_eval_facts` → `analytics.fact_evaluation`
> - `analytics_criterion_facts` → `analytics.fact_evaluation_criterion`
> - `analytics_run_facts` → `analytics.agg_evaluation_run`
> - `eval_runs` → `platform.evaluation_runs`
> - `evaluators` → `platform.evaluators`
> - `source_call_records` → `analytics.crm_call_record`
> - `source_lead_records` → `analytics.crm_lead_record`
> - `llm_usage` → `analytics.fact_llm_generation` (already polymorphic via `owner_type` / `owner_id`)
> - **`external_agents` does not exist.** M2 reframed: build a new `analytics.dim_agent` table as the canonical agent dimension.
> - **M1 (legacy PK rename) dropped** — already done by roadmap-01 (`uq_crm_call_record_tenant_app_activity`, etc., are the live names).
> - All raw SQL is schema-qualified per the CLAUDE.md invariant. Migrations are Alembic revisions (the original draft was already correct on this; the architecture spec was the one assuming `startup_schema.py`).
>
> Manifest YAML schema (§4), validator rules (§4.1), Phase-1 content targets, and the consumer-side contract (§9) are otherwise unchanged.

---

## 1. Why this exists

The current manifest (`backend/app/services/chat_engine/manifests/<app-id>.yaml`) is rich on column-level metadata (3-axis taxonomy: `role` / `data_type` / `semantic_type`) but missing five top-level constructs that production text-to-SQL systems use: relationships, named filters, derived metrics, verified-query exemplars, and value groups.

Worse, the data model itself has joins that cannot be declared as FKs because the underlying columns are inconsistent or missing. Profiling revealed:

- **Agent identity is structurally broken.** `analytics.fact_evaluation.agent` ("Amisha Rana", Title Case) and `analytics.crm_call_record.agent_name` (mixed case) **never match cleanly**. There is **no canonical agent dimension table** — `external_agents` does not exist; the closest neighbor (`platform.application_external_agent_connectors`) is connector config, not an agent dim. M2 (below) introduces `analytics.dim_agent`.
- **`evaluator_id` on `analytics.fact_evaluation` exists as a column but has no FK constraint** to `platform.evaluators(id)`.
- **Lead linkage lives in JSONB** on the eval side: `analytics.fact_evaluation.context.prospect_id`. Call linkage is split — `analytics.crm_call_record.activity_id` and `prospect_id` are first-class columns (good — partial M4 done by roadmap-01), but `platform.evaluation_runs.config.activity_id` is still JSONB-buried.
- **Legacy index/PK names from the inside-sales rename were already cleaned up by roadmap-01** — `uq_crm_call_record_tenant_app_activity` and `uq_crm_lead_record_tenant_app_prospect` are the live names. **M1 dropped.**
- **Duplicate writes** — verify which keys still get duplicated in `analytics.fact_evaluation.context` post-roadmap-01 before authoring M6.

Soft-joining around all this in the manifest is a workaround. Instead: **harden the DB, then the manifest declares only real FKs.**

## 2. Two parallel deliverables

| Track | What | When |
|---|---|---|
| **DB Hardening** | Migrations M2–M6, M8 (M1 dropped, M7 deferred) | Phase 0 — must land before manifest content |
| **Manifest v2** | New YAML schema + Phase 1-3 content per pack | Phase 1+ — depends on hardened FKs |

---

## 3. DB Hardening Migrations

Each migration is one Alembic revision under `backend/alembic/versions/`. SQL shown is illustrative; the actual revision uses Alembic ops. Every migration includes a verification query and a rollback note. **All raw SQL is schema-qualified per CLAUDE.md.** **M1 dropped** (already done by roadmap-01). **M7 (slug → UUID for `app_id`) is deferred — out of scope for v3.**

### M2 — Build `analytics.dim_agent` as canonical agent dimension

**Goal:** every "agent" column points to one canonical row in `analytics.dim_agent`. There is no pre-existing `external_agents` table — this migration creates the dim from scratch and backfills it from `analytics.crm_call_record`, then links `analytics.fact_evaluation`, `analytics.crm_call_record`, and `analytics.crm_lead_record` to it.

```sql
-- 0. Create the dim
CREATE TABLE analytics.dim_agent (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  app_id        text NOT NULL,
  source_system text NOT NULL,        -- 'lsq' | 'bolna' | etc., mirrors crm_call_record.source_system
  external_id   text,                 -- crm_call_record.agent_id when present
  name          text NOT NULL,
  email         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_dim_agent_tenant_app_source_extid
  ON analytics.dim_agent(tenant_id, app_id, source_system, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX uq_dim_agent_tenant_app_name_lower
  ON analytics.dim_agent(tenant_id, app_id, lower(name));

-- 1. Add agent_uuid columns on the three target tables
ALTER TABLE analytics.crm_call_record  ADD COLUMN agent_uuid uuid;
ALTER TABLE analytics.crm_lead_record  ADD COLUMN agent_uuid uuid;
ALTER TABLE analytics.fact_evaluation  ADD COLUMN agent_uuid uuid;

-- 2. Backfill dim_agent from crm_call_record (cleanest source of agent identity — has agent_id + agent_name)
INSERT INTO analytics.dim_agent (id, tenant_id, app_id, source_system, external_id, name, email, created_at, updated_at)
SELECT gen_random_uuid(), tenant_id, app_id, source_system, agent_id,
       MAX(agent_name)  AS name,
       MAX(agent_email) AS email,
       now(), now()
  FROM analytics.crm_call_record
 WHERE agent_id IS NOT NULL AND agent_name IS NOT NULL
 GROUP BY tenant_id, app_id, source_system, agent_id
ON CONFLICT (tenant_id, app_id, source_system, external_id)
  WHERE external_id IS NOT NULL DO NOTHING;

-- 3. Backfill any name-only agents (no external_id) from crm_lead_record + fact_evaluation
INSERT INTO analytics.dim_agent (id, tenant_id, app_id, source_system, external_id, name, created_at, updated_at)
SELECT gen_random_uuid(), tenant_id, app_id, 'unknown', NULL, agent_name, now(), now()
  FROM analytics.crm_lead_record
 WHERE agent_name IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM analytics.dim_agent a
      WHERE a.tenant_id = analytics.crm_lead_record.tenant_id
        AND a.app_id    = analytics.crm_lead_record.app_id
        AND lower(a.name) = lower(analytics.crm_lead_record.agent_name)
   )
 GROUP BY tenant_id, app_id, agent_name
ON CONFLICT DO NOTHING;

-- 4. Link crm_call_record.agent_uuid via (tenant_id, app_id, source_system, agent_id)
UPDATE analytics.crm_call_record sc
   SET agent_uuid = a.id
  FROM analytics.dim_agent a
 WHERE a.tenant_id     = sc.tenant_id
   AND a.app_id        = sc.app_id
   AND a.source_system = sc.source_system
   AND a.external_id   = sc.agent_id;

-- 5. Link crm_lead_record.agent_uuid via case-insensitive name match within tenant+app
UPDATE analytics.crm_lead_record sl
   SET agent_uuid = a.id
  FROM analytics.dim_agent a
 WHERE a.tenant_id = sl.tenant_id
   AND a.app_id    = sl.app_id
   AND lower(a.name) = lower(sl.agent_name);

-- 6. Link fact_evaluation.agent_uuid via case-insensitive name match within tenant+app
UPDATE analytics.fact_evaluation ef
   SET agent_uuid = a.id
  FROM analytics.dim_agent a
 WHERE a.tenant_id = ef.tenant_id
   AND a.app_id    = ef.app_id
   AND lower(a.name) = lower(ef.agent);

-- 7. Add FKs (after backfill verification)
ALTER TABLE analytics.crm_call_record
  ADD CONSTRAINT fk_crm_call_record_agent
  FOREIGN KEY (agent_uuid) REFERENCES analytics.dim_agent(id) ON DELETE SET NULL;
ALTER TABLE analytics.crm_lead_record
  ADD CONSTRAINT fk_crm_lead_record_agent
  FOREIGN KEY (agent_uuid) REFERENCES analytics.dim_agent(id) ON DELETE SET NULL;
ALTER TABLE analytics.fact_evaluation
  ADD CONSTRAINT fk_fact_evaluation_agent
  FOREIGN KEY (agent_uuid) REFERENCES analytics.dim_agent(id) ON DELETE SET NULL;

-- 8. Indexes for the canonical join
CREATE INDEX idx_crm_call_record_agent_uuid ON analytics.crm_call_record(agent_uuid)
  WHERE agent_uuid IS NOT NULL;
CREATE INDEX idx_crm_lead_record_agent_uuid ON analytics.crm_lead_record(agent_uuid)
  WHERE agent_uuid IS NOT NULL;
CREATE INDEX idx_fact_evaluation_agent_uuid ON analytics.fact_evaluation(agent_uuid)
  WHERE agent_uuid IS NOT NULL;
```

**Verify:**
```sql
-- Backfill rate by table — target ≥ 95% on populated rows
SELECT 'crm_call_record' AS tbl,
       count(*) FILTER (WHERE agent_uuid IS NULL  AND agent_id IS NOT NULL) AS unmatched,
       count(*) FILTER (WHERE agent_uuid IS NOT NULL)                       AS matched
  FROM analytics.crm_call_record
UNION ALL
SELECT 'fact_evaluation',
       count(*) FILTER (WHERE agent_uuid IS NULL  AND agent IS NOT NULL),
       count(*) FILTER (WHERE agent_uuid IS NOT NULL)
  FROM analytics.fact_evaluation;

-- Quarantine list — agents that failed to match (for ops triage)
SELECT DISTINCT ef.tenant_id, ef.app_id, ef.agent
  FROM analytics.fact_evaluation ef
 WHERE ef.agent IS NOT NULL AND ef.agent_uuid IS NULL;
```

**Producer code change required** — going forward, the analytics-job runner that writes `analytics.fact_evaluation` and the CRM sync that writes `analytics.crm_*` rows must populate `agent_uuid` at insert time. Same PR as the migration.

**Rollback:** drop the 3 FKs, drop the 3 indexes, drop the 3 columns, drop `analytics.dim_agent`. Source data untouched.
**Risk:** medium. Backfill quality depends on name-match. Names that fail to match stay NULL — no silent corruption. Quarantine list goes to ops.

---

### M3 — Make `analytics.fact_evaluation.evaluator_id` a real FK

**Goal:** lift the existing soft pointer to a real cross-schema FK; backfill what we can.

```sql
-- Backfill from platform.evaluation_runs.evaluator_id (which IS a real FK)
UPDATE analytics.fact_evaluation ef
   SET evaluator_id = er.evaluator_id
  FROM platform.evaluation_runs er
 WHERE ef.run_id = er.id
   AND ef.evaluator_id IS NULL
   AND er.evaluator_id IS NOT NULL;

-- Backfill from evaluator_name when an evaluator with that name exists for the tenant+app
UPDATE analytics.fact_evaluation ef
   SET evaluator_id = e.id
  FROM platform.evaluators e
 WHERE ef.evaluator_id IS NULL
   AND e.tenant_id = ef.tenant_id
   AND e.app_id    = ef.app_id
   AND e.name      = ef.evaluator_name;

-- Add real FK (nullable; system evaluators legitimately have no row in platform.evaluators)
ALTER TABLE analytics.fact_evaluation
  ADD CONSTRAINT fk_fact_evaluation_evaluator
  FOREIGN KEY (evaluator_id) REFERENCES platform.evaluators(id) ON DELETE SET NULL;

CREATE INDEX idx_fact_evaluation_evaluator_id
  ON analytics.fact_evaluation(evaluator_id) WHERE evaluator_id IS NOT NULL;
```

**Verify:**
```sql
-- Fill rate by app
SELECT app_id,
       count(*) FILTER (WHERE evaluator_id IS NOT NULL) AS with_id,
       count(*)                                          AS total
  FROM analytics.fact_evaluation
 GROUP BY app_id;

-- Orphan check — no evaluator_id should point to a missing row
SELECT count(*)
  FROM analytics.fact_evaluation ef
  LEFT JOIN platform.evaluators e ON e.id = ef.evaluator_id
 WHERE ef.evaluator_id IS NOT NULL AND e.id IS NULL;   -- expect 0
```

**Rollback:** drop the FK and index. `evaluator_id` stays as a soft pointer.
**Risk:** low. NULL is a legitimate value (system evaluators).

---

### M4 — Promote remaining JSONB-buried join keys to first-class columns

**Goal:** stop joining via JSONB extraction. **Partial work already done by roadmap-01:** `analytics.crm_call_record` already exposes `prospect_id` + `activity_id` as first-class columns with indexes (`idx_crm_call_record_tenant_app_prospect`, `uq_crm_call_record_tenant_app_activity`). M4 covers what's left:

```sql
-- 1. prospect_id lives in analytics.fact_evaluation.context — promote
ALTER TABLE analytics.fact_evaluation ADD COLUMN prospect_id varchar(100);
UPDATE analytics.fact_evaluation
   SET prospect_id = context->>'prospect_id'
 WHERE context ? 'prospect_id';
CREATE INDEX idx_fact_evaluation_prospect_id
  ON analytics.fact_evaluation(tenant_id, app_id, prospect_id)
  WHERE prospect_id IS NOT NULL;

-- 2. activity_id lives in platform.evaluation_runs.config — promote
ALTER TABLE platform.evaluation_runs ADD COLUMN activity_id varchar(100);
UPDATE platform.evaluation_runs
   SET activity_id = config->>'activity_id'
 WHERE config IS NOT NULL AND (config::jsonb) ? 'activity_id';
CREATE INDEX idx_evaluation_runs_activity_id
  ON platform.evaluation_runs(tenant_id, app_id, activity_id)
  WHERE activity_id IS NOT NULL;

-- 3. Composite UNIQUE on crm_lead_record (already exists as uq_crm_lead_record_tenant_app_prospect — verify before re-adding).
--    crm_call_record composite UNIQUE on (tenant_id, app_id, activity_id) also exists.

-- 4. Composite cross-schema FKs
ALTER TABLE analytics.fact_evaluation
  ADD CONSTRAINT fk_fact_evaluation_prospect
  FOREIGN KEY (tenant_id, app_id, prospect_id)
  REFERENCES analytics.crm_lead_record(tenant_id, app_id, prospect_id)
  ON DELETE SET NULL;

ALTER TABLE platform.evaluation_runs
  ADD CONSTRAINT fk_evaluation_runs_activity
  FOREIGN KEY (tenant_id, app_id, activity_id)
  REFERENCES analytics.crm_call_record(tenant_id, app_id, activity_id)
  ON DELETE SET NULL;
```

**Verify:**
```sql
-- Prospect linkage rate
SELECT count(*) FILTER (WHERE prospect_id IS NOT NULL) AS with_prospect,
       count(*)                                         AS total
  FROM analytics.fact_evaluation
 WHERE app_id = 'inside-sales';

-- Orphan checks
SELECT count(*) FROM analytics.fact_evaluation ef
  LEFT JOIN analytics.crm_lead_record sl
    ON (sl.tenant_id, sl.app_id, sl.prospect_id) = (ef.tenant_id, ef.app_id, ef.prospect_id)
 WHERE ef.prospect_id IS NOT NULL AND sl.prospect_id IS NULL;   -- expect 0
```

**Rollback:** drop FKs, drop indexes, drop columns. The original JSONB is untouched.
**Risk:** medium. Inserts into `platform.evaluation_runs` and `analytics.fact_evaluation` need to write the new columns going forward — code change required at the producer (analytics-job runner + evaluation_runs creation paths).

---

### M5 — Lead ↔ Calls hard FK

**Goal:** every call points to a real lead row.

```sql
ALTER TABLE analytics.crm_call_record
  ADD CONSTRAINT fk_crm_call_record_lead
  FOREIGN KEY (tenant_id, app_id, prospect_id)
  REFERENCES analytics.crm_lead_record(tenant_id, app_id, prospect_id)
  ON DELETE SET NULL;
```

**Verify:**
```sql
-- Calls without a matching lead — these should be cleaned up first or the FK will fail
SELECT count(*)
  FROM analytics.crm_call_record sc
  LEFT JOIN analytics.crm_lead_record sl
    ON (sl.tenant_id, sl.app_id, sl.prospect_id) = (sc.tenant_id, sc.app_id, sc.prospect_id)
 WHERE sl.prospect_id IS NULL;
```

If verify count > 0, **fix sync ordering** (leads ingest first) before applying the FK.

**Rollback:** drop the FK.
**Risk:** medium. Depends on sync hygiene. If calls are ingested before leads, the FK will fail.

---

### M6 — Drop duplicate JSONB writes from `analytics.fact_evaluation.context`

**Goal:** any column that already exists as a first-class column on `analytics.fact_evaluation` should not also live in `context` JSONB.

**Step 0 — verify what's actually duplicated.** Before authoring the cleanup query, run:

```sql
SELECT jsonb_object_keys(context) AS k, count(*)
  FROM analytics.fact_evaluation
 WHERE context IS NOT NULL
 GROUP BY k
 ORDER BY count(*) DESC LIMIT 30;
```

Cross-reference with `\d analytics.fact_evaluation` to find keys that shadow columns. Original spec named `agent`, `direction`, `difficulty`, `total_turns`, `duration` — re-confirm against current schema before shipping.

**Two parts:**

**6a. Code change** — fix the analytics-job producer that writes `context`. Stop including these keys; they belong in their own columns.
**6b. One-time cleanup** (template — replace `<keys>` with the verified list):
```sql
UPDATE analytics.fact_evaluation
   SET context = context - <keys>
 WHERE context ?| ARRAY[<keys>];
```

**Verify:**
```sql
SELECT count(*) FROM analytics.fact_evaluation
 WHERE context ?| ARRAY[<keys>];
-- expect 0
```

**Rollback:** none required — these are duplicates; the column copy is canonical.
**Risk:** low, but the **code change must land first** or the next analytics-job run repopulates the duplicates.

---

### M8 — `analytics.fact_llm_generation` polymorphism — partial indexes per `owner_type`

**Goal:** the table is already polymorphic (`owner_type` + `owner_id` + composite `idx_fact_llm_generation_owner` exist post-roadmap-01). M8 adds per-owner-type partial indexes so the manifest can declare each polymorphic relationship as a clean discriminated join.

```sql
CREATE INDEX idx_fact_llm_generation_eval_run
  ON analytics.fact_llm_generation(owner_id) WHERE owner_type = 'eval_run';
CREATE INDEX idx_fact_llm_generation_sherlock_turn
  ON analytics.fact_llm_generation(owner_id) WHERE owner_type = 'sherlock_turn';
CREATE INDEX idx_fact_llm_generation_chat_session
  ON analytics.fact_llm_generation(owner_id) WHERE owner_type = 'chat_session';
```

The manifest declares per-owner-type joins as separate `relationships:` entries with a discriminator predicate.

**Verify:**
```sql
SELECT indexname FROM pg_indexes
 WHERE schemaname = 'analytics' AND indexname LIKE 'idx_fact_llm_generation_%';
```

**Rollback:** drop indexes. Pure performance hint.
**Risk:** zero.

---

### Migration order & rollout

```
M3 (evaluator FK)   — backfill + cross-schema FK
M2 (dim_agent)      — heavy backfill, quarantine list, producer code change
M4 (JSONB → cols)   — producer code change first; mostly done by roadmap-01
M5 (lead↔calls FK)  — sync hygiene check
M6 (drop dup JSON)  — re-verify duplicate keys against current schema first
M8 (partial idx)    — instant, no downtime
```

(M1 dropped — already done by roadmap-01.)

Each migration is its own Alembic revision. Verification reports go to `docs/migrations/2026-05-XX-sherlock-v3-hardening/<MN>-verify.md` (date the directory by start of work, not the original 2026-04-26).

---

## 4. Manifest v2 — YAML schema

The manifest is the per-app capability pack. New top-level keys are bolded; existing keys (today's manifest) are preserved.

```yaml
# manifests/<app-id>.yaml
app_id: inside-sales
description: |
  ...

# ─── EXISTING (preserved) ─────────────────────────────────────────────
catalog_tables:        { ... }    # column-level metadata, 3-axis taxonomy
data_surfaces:         [ ... ]
ontology_classes:      [ ... ]
resolver_keys:         [ ... ]
safety_by_entity:      { ... }

# ─── NEW (Snowflake-shaped) ───────────────────────────────────────────
# Table identifiers are schema-qualified throughout. The validator (§4.1) resolves
# them against catalog_tables, where each entry carries an effective schema.
relationships:                    # cross-table joins, FK-backed only
  - name: fact_evaluation_to_evaluation_runs
    left_table: analytics.fact_evaluation
    right_table: platform.evaluation_runs
    relationship_columns:
      - { left_column: run_id, right_column: id }

  - name: fact_evaluation_to_evaluators
    left_table: analytics.fact_evaluation
    right_table: platform.evaluators
    relationship_columns:
      - { left_column: evaluator_id, right_column: id }

  - name: fact_evaluation_to_dim_agent       # post-M2
    left_table: analytics.fact_evaluation
    right_table: analytics.dim_agent
    relationship_columns:
      - { left_column: agent_uuid, right_column: id }

  - name: fact_evaluation_to_lead            # post-M4 (composite)
    left_table: analytics.fact_evaluation
    right_table: analytics.crm_lead_record
    relationship_columns:
      - { left_column: tenant_id,   right_column: tenant_id }
      - { left_column: app_id,      right_column: app_id }
      - { left_column: prospect_id, right_column: prospect_id }

  - name: evaluation_runs_to_call            # post-M4 (composite)
    left_table: platform.evaluation_runs
    right_table: analytics.crm_call_record
    relationship_columns:
      - { left_column: tenant_id,   right_column: tenant_id }
      - { left_column: app_id,      right_column: app_id }
      - { left_column: activity_id, right_column: activity_id }

  - name: call_to_lead                       # post-M5
    left_table: analytics.crm_call_record
    right_table: analytics.crm_lead_record
    relationship_columns:
      - { left_column: tenant_id,   right_column: tenant_id }
      - { left_column: app_id,      right_column: app_id }
      - { left_column: prospect_id, right_column: prospect_id }

  - name: llm_generation_eval_run            # discriminated polymorphic (post-M8)
    left_table: analytics.fact_llm_generation
    right_table: platform.evaluation_runs
    discriminator: { column: owner_type, value: 'eval_run' }
    relationship_columns:
      - { left_column: owner_id, right_column: id }

  - name: llm_generation_sherlock_turn       # discriminated polymorphic (post-M8)
    left_table: analytics.fact_llm_generation
    right_table: platform.sherlock_conversation_turns
    discriminator: { column: owner_type, value: 'sherlock_turn' }
    relationship_columns:
      - { left_column: owner_id, right_column: id }

filters:                          # named, reusable predicates
  - name: compliance_violation
    description: Compliance-category criteria flagged as VIOLATED.
    expr: "criterion_label IN (value_groups.criterion_categories.compliance) AND status = 'VIOLATED'"
    table: analytics.fact_evaluation_criterion

  - name: completed_runs
    expr: "status = 'completed'"
    table: platform.evaluation_runs

facts:                            # row-level numeric attributes (no aggregation)
  - { name: result_score,           table: analytics.fact_evaluation,    expr: result_score,    data_type: float }
  - { name: duration_seconds,       table: analytics.fact_evaluation,    expr: duration_seconds, data_type: float, unit: seconds }
  - { name: call_duration_seconds,  table: analytics.crm_call_record,    expr: duration_seconds, data_type: int,   unit: seconds }

metrics:                          # aggregated; cross-table allowed via using_relationships
  - name: avg_pass_rate
    description: Average pass rate across runs in scope.
    expr: "AVG(pass_rate)"
    table: analytics.agg_evaluation_run

  - name: violations_per_agent
    description: Compliance violations grouped by canonical agent.
    expr: "COUNT(*)"
    using_relationships: [fact_evaluation_to_dim_agent]
    where_filters: [compliance_violation]
    table: analytics.fact_evaluation_criterion

  - name: cost_per_eval_run
    expr: "SUM(cost_usd)"
    using_relationships: [llm_generation_eval_run]
    table: analytics.fact_llm_generation

verified_queries:                 # few-shot exemplars; specialist retrieves top-k by question similarity
  - name: top_agents_by_violation_category
    question: "Which agent has the most {category} issues in {time_window}?"
    sql: |
      SELECT a.name AS agent, COUNT(*) AS violations
        FROM analytics.fact_evaluation_criterion cf
        JOIN analytics.fact_evaluation          ef ON cf.run_id = ef.run_id AND cf.item_id = ef.item_id
        JOIN analytics.dim_agent                a  ON ef.agent_uuid = a.id
       WHERE cf.criterion_label IN :category_labels
         AND cf.status = 'VIOLATED'
         AND cf.tenant_id = :tenant_id AND cf.app_id = :app_id
         AND cf.created_at >= :since
       GROUP BY a.name
       ORDER BY violations DESC
       LIMIT 10
    verified_at: 2026-05-XX
    verified_by: pareekshith.bompally@tatvacare.in

  - name: evaluators_unused_in_window
    question: "Which evaluators have NOT been used in {time_window}?"
    sql: |
      WITH all_evaluators AS (
        SELECT id, name FROM platform.evaluators
         WHERE tenant_id = :tenant_id AND app_id = :app_id
      ),
      used AS (
        SELECT DISTINCT evaluator_id
          FROM analytics.fact_evaluation
         WHERE tenant_id = :tenant_id AND app_id = :app_id
           AND created_at >= :since
      )
      SELECT a.name FROM all_evaluators a
        LEFT JOIN used u ON a.id = u.evaluator_id
       WHERE u.evaluator_id IS NULL
    verified_at: 2026-05-XX

  - name: week_over_week_failure_rate_by_field
    question: "Compare {app} failure rate this week vs last week"
    sql: |
      SELECT
        date_trunc('week', cf.created_at) AS week,
        cf.criterion_label                AS field,
        COUNT(*) FILTER (WHERE cf.status='VIOLATED') AS violations,
        COUNT(*)                                       AS total,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE cf.status='VIOLATED') / NULLIF(COUNT(*),0),
          2
        ) AS violation_rate_pct
      FROM analytics.fact_evaluation_criterion cf
      WHERE cf.tenant_id = :tenant_id AND cf.app_id = :app_id
        AND cf.created_at >= now() - interval '14 days'
      GROUP BY week, cf.criterion_label
      ORDER BY week DESC, violation_rate_pct DESC

# ─── NEW (our extensions; both Snowflake and our v1 lack these) ───────
value_groups:                     # taxonomies over dimension values
  criterion_categories:
    column: analytics.fact_evaluation_criterion.criterion_label
    groups:
      compliance:
        - DISCLOSURE_MISSING
        - CONSENT_NOT_TAKEN
        - REGULATED_CLAIM
      rudeness:
        - HARSH_TONE
        - INTERRUPTION
        - DISMISSIVE
      accuracy:
        - INTENT_MISMATCH
        - FACTUAL_ERROR

time_defaults:
  grains: [run, day, week, month]
  default_window: last_30_days
  relative_aliases:
    "today":          ["date_trunc('day', now())", "now()"]
    "this week":      ["date_trunc('week', now())", "now()"]
    "this month":     ["date_trunc('month', now())", "now()"]
    "last week":      ["date_trunc('week', now()) - interval '7 days'", "date_trunc('week', now())"]
    "last 4 runs":    "ORDER BY created_at DESC LIMIT 4"   # special-case: not a window, but an order+limit
```

### 4.1 Manifest validator

Existing `manifest_validator.py` extends with new checks:

| Check | Rule |
|---|---|
| `relationships[*].relationship_columns` → real FK | The declared join must correspond to a Postgres FK constraint (or for composite/discriminated joins, a UNIQUE + matching column types). Validator queries `pg_constraint` at boot. **No soft joins allowed.** |
| `metrics[*].using_relationships` → must reference declared `relationships[*].name` | Symbol-resolution check. |
| `filters[*].expr` → must reference real columns / `value_groups.*` | No free-text SQL fragments. |
| `value_groups.<name>.column` → must exist in `catalog_tables` | Symbol check. |
| `verified_queries[*].sql` → must compile against the manifest's table set | EXPLAIN dry-run at boot (with placeholder params). |
| `time_defaults.relative_aliases` → values are valid SQL fragments | Lint-only; no execution. |

If any check fails, **boot fails loudly**. No silent degradation.

---

## 5. Phase-1 manifest content target

Per pack, Phase 1 ships:

| Construct | Count target |
|---|---:|
| `relationships` | 8–12 (all FK-backed after M1–M5) |
| `facts` | 4–8 |
| `metrics` | 5–10 |
| `filters` | 3–5 |
| `value_groups` | 1–2 (compliance, rudeness for inside-sales; transcription_error_types for voice-rx) |
| `verified_queries` | **8–12** ← critical content investment |
| `time_defaults` | 1 (shared) |

**Bootstrapping verified queries:** mine the last 90 days of `analytics.fact_llm_generation` rows where `call_purpose = 'sql_generation'` and `status = 'ok'`, manually triage and pick the 8–12 best per pack. One-time effort: ~3-4 hours per pack.

---

## 6. Manifest v1 → v2 migration plan

| Step | Action | Effort |
|---|---|---|
| 1 | Branch `feat/sherlock-v3` off `main` | trivial |
| 2 | Land M3 + M8 as separate Alembic revisions (low-risk first) | 1-2 hours |
| 3 | Re-verify the duplicate-key list on `analytics.fact_evaluation.context` (M6 step 0). Update the producer (analytics-job runner) to stop writing those keys | 1 hour |
| 4 | Land M6 (drop JSONB duplicates) | trivial |
| 5 | Land M2 (`analytics.dim_agent` + backfill + producer code change); review quarantine list with ops | 4-6 hours incl. ops triage |
| 6 | Land M4 (promote remaining `prospect_id` / `activity_id`) — **also requires producer code changes** for new inserts | 2-3 hours |
| 7 | Land M5 (lead↔calls FK) — verify sync ordering first | 1 hour |
| 8 | Update manifest YAMLs to v2 schema for inside-sales (proof of concept) | 2 hours |
| 9 | Bootstrap `verified_queries` for inside-sales (8-12 entries) | 3-4 hours |
| 10 | Update `manifest_validator.py` for the v2 schema checks | 2-3 hours |
| 11 | Repeat steps 8-9 for voice-rx and kaira-bot packs | 3-4 hours per pack |

**Total effort estimate: 25-35 hours, all on the feature branch.**

---

## 7. War-game re-walk against post-P1-P4 manifest

| Q | Status |
|---|---|
| Q1 last 4 runs failure summary | ✅ resolves via `analytics.agg_evaluation_run` + `time_defaults["last 4 runs"]` |
| Q2 most common voice-rx failure type | ✅ resolves via `analytics.fact_evaluation_criterion` + `value_groups` |
| Q3 most stressed API field | ✅ resolves via `metrics.violation_rate_by_field` (defined per pack) + `value_groups` |
| Q4 agent with most compliance issues | ✅ post-M2 — joins `analytics.fact_evaluation.agent_uuid → analytics.dim_agent.id`; `value_groups.compliance` defines what counts |
| Q5 most rude agent | ✅ post-M2 — same join; assumes a `rudeness_score` evaluator exists in pack content |
| Q6 voice-rx week-over-week field comparison | ✅ resolves via `verified_queries.week_over_week_failure_rate_by_field` |
| Q7 snippets for "that agent" | ✅ supervisor reads `platform.sherlock_state.resolved_entities.agent_uuid` from the prior turn; retrieval specialist filters surfaces by agent_uuid |
| Q8 evaluators not used this month | ✅ post-M3 — `verified_queries.evaluators_unused_in_window` uses real `platform.evaluators(id)` FK |

All 8 questions resolved with **zero soft joins** in the manifest.

---

## 8. Risks & open items

| Risk / open item | Mitigation |
|---|---|
| M2 agent-name match rate could be < 90% if normalization conventions diverge further | Quarantine list goes to ops; manual reconciliation. The FK is `ON DELETE SET NULL` so partial-match is safe. |
| Some `analytics.fact_evaluation` rows have no matching evaluator (system / built-in evaluators) | FK is nullable; `evaluator_id IS NULL` is a legitimate value. |
| Producer code changes (M4, M6) could regress if not coordinated | Both producer and migration land in the same PR; integration test verifies no JSONB duplicates after a run. |
| Verified-query bootstrap is content work — not solvable by the agent itself | Allocate 3-4 hours per pack; one-time investment. |
| Multi-pack questions ("compare voice-rx and inside-sales") not addressed | Out of v3 scope. Documented as v4 deferred. |

---

## 9. Consumer side — how the manifest is loaded and rendered

The manifest is content; this section is the contract between content and code. Five concrete responsibilities.

### 9.1 Boot-time loading

At process start, every pack YAML in `backend/app/services/chat_engine/manifests/` is loaded by `manifest.load_pack(app_id)` and validated by `manifest_validator.validate(pack)`:

1. Parse YAML → `Pack` Pydantic model.
2. Validate symbol references — every `metrics[*].using_relationships`, `filters[*].expr` table reference, `value_groups.<n>.column`, `relationships[*].relationship_columns` must resolve to a known table or column in `catalog_tables`.
3. Validate FK-backing — for every entry in `relationships`, query `pg_constraint` to confirm a real FK (or `UNIQUE` + matching column types for composite/discriminated joins) exists. **No soft joins admitted.**
4. EXPLAIN dry-run every `verified_queries[*].sql` against the analytics DB with placeholder bind params. Failures are fatal.
5. Compute embeddings for every `verified_queries[*].question` using `text-embedding-3-small`; cache in-memory keyed by `(app_id, version_hash)`.
6. Cache the validated pack in a process-local registry. Boot fails loudly if any check fails — no degraded-mode startup.

Hot-reload: a SIGHUP-handler re-runs `load_pack` for any changed YAML and atomically swaps the registry entry. Used for ops only; in normal flow the pack is immutable per process.

### 9.2 Projection — manifest slice per task brief

A specialist never sees the full manifest. The data_specialist receives a projection — the minimum slice needed for one TaskBrief.

```
Input:   pack, TaskBrief
Output:  ProjectedManifest = {
           tables:           [<≤ 5 catalog_tables entries>],
           relationships:    [<only those joining the projected tables>],
           facts:            [<only on projected tables>],
           metrics:          [<only resolvable via projected tables>],
           filters:          [<only on projected tables>],
           value_groups:     [<only those whose column is on a projected table>],
           verified_queries: [<top 3 by question similarity to TaskBrief.task>],
           time_defaults:    <unchanged; small, always included>,
         }
```

Projection algorithm:

1. **Seed** — start with tables explicitly named in the brief (rare) or the brief's `intent_hint`-driven defaults (`measure` → fact tables; `record_lookup` → evidence surfaces).
2. **Question-driven retrieval** — embed the brief's `task` text. Compute cosine similarity against:
   - every `catalog_tables[*].description` + columns' `synonyms`
   - every `metrics[*].description`
   - every `verified_queries[*].question`
   Take top-N tables (N=5) and top-K verified queries (K=3).
3. **Relationship closure** — for the seed + retrieved tables, include all `relationships` whose `left_table` and `right_table` are both in the set. Do not pull in tables transitively (no graph walk); the supervisor must brief explicitly for cross-domain joins.
4. **Filter to projected** — drop facts/metrics/filters/value_groups that reference tables outside the projection.
5. **Render** — `prompt_generator.render_projection(projection)` produces a YAML string ≤ 4 K tokens. This is the *only* schema-shaped content in the data_specialist's prompt.

Target projected size: **3-5 tables, 2-3 relationships, 2-3 verified queries, 1-2 value_groups**. Total YAML render ≤ 4 K tokens. Compare to today's full schema dump that grows past 24 K.

### 9.3 Verified-query retrieval — concrete mechanism

Top-3 retrieval over verified queries is the single highest-value lever for SQL accuracy.

```
Storage:  in-memory list per pack, with precomputed question_embedding (1536-dim).
Index:    none — N is small (8-12 per pack), brute-force cosine fits in <1ms.
Query:    embed the TaskBrief.task once, score against all questions in pack,
          take top 3 with score ≥ 0.55 (tunable).
Render:   each match becomes an "Example {question} → SQL: {sql}" block in the
          data_specialist's prompt, ordered by descending score.
```

When the data_specialist's SQL execution succeeds and the user does not reject the answer in the next turn, a **candidate verified-query row** is written to `platform.sherlock_verified_query_candidates` (new table — see below). Ops triages weekly; promoted candidates are appended to the manifest YAML on the next deploy. Ships as its own Alembic revision in P5.

```sql
CREATE TABLE platform.sherlock_verified_query_candidates (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  app_id               text NOT NULL,
  question             text NOT NULL,
  sql                  text NOT NULL,
  output_columns       jsonb,
  ran_at               timestamptz NOT NULL,
  user_accepted        boolean,            -- inferred from "no rejection in next 2 turns"
  promoted_to_manifest boolean DEFAULT false,
  created_at           timestamptz DEFAULT now()
);
```

This is the self-improving loop both Snowflake and Genie cite. It pays off after ~50 successful turns per pack.

### 9.4 Value-group expansion — inline at SQL gen

`value_groups` are resolved by the SQL generator before the LLM sees the prompt — not by SQL templating at runtime. Two reasons: (a) the LLM's filter expression must reference the actual column values to be cache-friendly, (b) Postgres can't see into Python-side group references.

```
Before prompt assembly:
  expand_value_groups(prompt, pack):
    for each occurrence of `value_groups.<group>.<key>`:
      replace with the literal IN-list, formatted as a Postgres array.
```

Result: the data_specialist's prompt contains `criterion_label IN ('DISCLOSURE_MISSING','CONSENT_NOT_TAKEN','REGULATED_CLAIM')` literally — not a symbolic reference. The same expansion runs for `verified_queries[*].sql` at boot time.

### 9.5 Time-default resolution — at brief-build, not in SQL

`time_defaults.relative_aliases` are resolved when the supervisor builds the TaskBrief, not by the SQL generator.

```
TaskBrief.scope.time_window:
  if user message contains a relative alias ("this week", "last 4 runs"):
    resolve via pack.time_defaults.relative_aliases[alias]
    → either a {since, until} ISO range, or a `ORDER BY ... LIMIT N` snippet
  else if user names an absolute window:
    parse to ISO range
  else:
    apply pack.time_defaults.default_window  (e.g. "last_30_days")
```

The resolved window is what flows down to the specialist. Specialists never re-interpret relative time — supervisor owns it. This keeps caching clean (no LLM-emitted `now() - interval '7 days'` strings drifting between calls).

### 9.6 Manifest-to-data_specialist prompt assembly — step by step

```
1. Build TaskBrief             (supervisor)
2. project_manifest(pack, brief)         → ProjectedManifest
3. retrieve_verified_queries(pack, brief) → top-3 exemplars
4. expand_value_groups(projection, pack)  → projection with literal IN-lists
5. render_projection(projection)          → ≤ 4 K-token YAML string
6. Assemble data_specialist prompt:
     [stable prefix — cacheable]
       SYSTEM_INSTRUCTION                  (~600 tokens, constant per pack)
       <output_contract>                   (~200 tokens, constant)
     [volatile suffix — not cached]
       projected manifest YAML             (≤ 4 K tokens)
       verified-query exemplars            (≤ 1.5 K tokens)
       TaskBrief                           (≤ 500 tokens)
       resolved time_window                (≤ 50 tokens)
7. Send to OpenAI Responses API with:
     prompt_cache_key = hash(stable_prefix)
     temperature = 0
     text.format = json_schema (SQL_GENERATION_RESPONSE_SCHEMA)
```

Stable-prefix cache target: **≥ 70% hit rate** on repeated SQL generations within the 5-minute TTL.

### 9.7 Pack registry contract

The pack is exposed to the rest of the codebase via one interface:

```python
# Read-only, post-validation, immutable in normal flow
class CapabilityPack:
    app_id:               str
    version_hash:         str
    catalog_tables:       Mapping[str, TableDef]
    relationships:        Sequence[Relationship]
    facts:                Sequence[FactDef]
    metrics:              Sequence[MetricDef]
    filters:              Sequence[FilterDef]
    verified_queries:     Sequence[VerifiedQuery]   # with embeddings
    value_groups:         Mapping[str, ValueGroup]
    time_defaults:        TimeDefaults
    data_surfaces:        Sequence[DataSurface]
    ontology_classes:     Sequence[OntologyClass]
    resolver_keys:        Sequence[str]
    safety_by_entity:     Mapping[str, SafetyLevel]
```

`load_pack(app_id) -> CapabilityPack` is the only entry point. No code outside `chat_engine/manifest.py` reads YAML directly. This is what makes pack-as-plugin viable in v4.

---

## 10. What this spec does NOT cover

- Architecture (supervisor + specialists, brief/result envelopes, Sessions, evidence store, stream-stitch, event enums) → see `2026-04-26-sherlock-v3-architecture.md`.
- Streaming UX rendering on the frontend (covered in architecture §15).
- Evaluator content / criterion-label registries per pack — owned by the evaluator subsystem, not the manifest. The manifest only references criterion labels via `value_groups`; it does not define them.
- Vector-search infra for cross-turn evidence retrieval — deferred until retrieval_specialist needs it (P5+).
- Multi-pack questions ("compare voice-rx and inside-sales in one answer") — out of v3 scope.
