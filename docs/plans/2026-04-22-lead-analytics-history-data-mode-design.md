# Lead Analytics History — Data Mode Design

**Date:** 2026-04-22
**Owner:** Platform
**Status:** Spec — awaiting implementation plan
**Reading time:** ~15 min

---

## 0. Why this spec exists

Inside Sales evaluation today extracts per-call scores against a rubric and stores them in `ThreadEvaluation`. It does **not** extract lead-nurture-closure signals (follow-up commitments, objections, intent, outcome), and there is no surface on which Sherlock can answer questions like:

1. *"Did the human agents follow up on calls they were supposed to?"* — requires cross-referencing LLM-extracted commitments with actual subsequent call activity.
2. *"New leads come in on a given day — how many are contacted same-day, +1 day, +2 days?"* — requires a durable lead roster plus an activity timeline that extends beyond the rolling 7-day CRM source window.

The locked architecture in `docs/plans/2026-04-21-inside-sales-mirror-scheduler.md` (hereafter the "sync plan") treats `source_call_records` and `source_lead_records` as a **rolling 7-day view**, pruned on every scheduled tick. That view is right for listings and eval selection, but it cannot carry history: the working copy of day 2 is gone by day 10.

This spec adds a **durable analytics history layer** alongside the rolling source layer. The sync job becomes a two-sided writer: it maintains the 7-day working copy as it does today, and as a side-effect, it accumulates observations into an append-only fact family that Sherlock queries for time-series analytics. A new `populate-analytics` extractor normalizes LLM-extracted signals from eval output into the same fact family.

No app name appears in any new table, column, or code path. Every new table is `tenant_id` + `app_id` partitioned per sync-plan §1.1.7 so future CRM-backed apps can reuse the same data mode.

### 0.1 Alignment with the generic pgvector capability plan

This spec now reads alongside:

- `docs/plans/sherlock-future-plan.md`
- `docs/plans/generic-transcript-retrieval-plan.md`
- `docs/plans/2026-04-23-pgvector-capability-pack-implementation-plan.md`

The alignment is:

1. **This spec owns the authoritative durable facts.** The `analytics_lead_*_facts` family remains the source of truth for lead roster, stage history, activities, and LLM-extracted signals.
2. **The vector layer does not replace these facts.** A later pgvector substrate may project some of these rows into derived retrieval documents, but those documents are secondary read models with provenance back to the fact rows defined here.
3. **Inside-sales v1 uses both SQL and retrieval.** Exact counts, rates, and grouped history should still resolve through analytics/SQL. Semantic retrieval is complementary and may use transcript chunks plus derived business-evidence documents built from these facts when Sherlock needs evidence-oriented or fuzzy retrieval, or when the SQL path is not the right fit.
4. **No raw fact-row embedding rule.** If these facts feed pgvector, they do so through declared data contracts that render retrieval-ready evidence documents. The facts tables themselves stay normalized and queryable.
5. **Population rules in this document still hold.** The sync side-effects and `populate-analytics` extractor defined here are still required even if a vector projection is later added.

---

## 1. Decisions locked in (do not renegotiate)

1. **Two storage layers, clear ownership.**
   - **Layer 1 (rolling CRM source):** `source_call_records`, `source_lead_records`. 7d window, pruned on scheduled runs per sync-plan §1.1.1. Read surface for listings, eval selection, refresh UX. **No new `source_*` table is added in this work.**
   - **Layer 2 (durable analytics history):** four new `analytics_lead_*_facts` tables, append-only (with one delete-then-insert exception for the eval-derived table). Read surface for Sherlock analytics and historical narratives.
2. **The sync job is the observation point.** Every `sync-external-source` execution writes Layer 1 as it does today and, as a transaction-scoped side-effect, writes Layer 2. The 7-day prune removes Layer 1 rows only; Layer 2 persists.
3. **Stage-change history is built by snapshot-observation, not LSQ read API.** LSQ exposes no read endpoint for stage-change history (confirmed from LSQ API docs — `DeleteStageChangeHistory` exists but no `Get…History` counterpart; `StageChange` is a `LeadManagement.svc` audit activity, not a `ProspectActivity` event code). The only path is diff-on-observe. `analytics_lead_stage_facts.detected_at` reflects observation time, not the true transition time. Granularity is the scheduler cadence (6h today).
4. **Signals are LLM-extracted into `ThreadEvaluation.result` JSONB (write-once), then normalized into `analytics_lead_signal_facts` by `populate-analytics`.** Two-stage pipeline matching the existing `analytics_*_facts` pattern (see `backend/app/services/job_worker.py:1135–1148` and the `FactPopulator` dispatch). No new job type.
5. **Scheduler workload registration stays single-entry.** One workload `(app_id='inside-sales', job_type='sync-external-source')` gains a new allowed `source_family` value: `'activities'`, alongside existing `'calls'` and `'leads'`. The activities sync writes only to Layer 2 (no working copy). Per-app registration is additive; the scheduler engine remains app-agnostic.
6. **Signal extraction is app-generic.** The populator's `SignalExtractor` reads `ThreadEvaluation.result.signals` regardless of eval type. Any evaluator that emits that shape contributes to the same fact table. Inside-sales is the v1 producer; kaira-bot or future apps plug in without schema change.
7. **Retention is deferred to v2.** Append-only in v1; retention policy (per-tenant, per-fact-table) becomes a future scheduled prune. Not a blocker for this work.
8. **Vector projection is downstream-only.** If retrieval documents are derived from these facts, that happens after or alongside fact population; it does not change the authoritative write model defined here.
9. **SQL remains the exact-answer path.** Sherlock should use these facts through analytics/SQL for strict metrics and deterministic grouped questions; vector retrieval is an additional evidence path, not a substitute for the fact family.

### Explicitly rejected designs (do not build)

- Reading LSQ stage-change history via an HTTP call — no such read API exists.
- Building a "lead actions" table outside the `analytics_*_facts` family. History is analytics; it belongs in that family.
- A second `source_activity_records` rolling table. Activities are durable-only; nothing queries them in a 7d shape.
- Widening `source_call_records` to include non-call activities. `source_call_records` is the eval-selection shape and stays narrow.
- App-specific fact table names (`inside_sales_*`, `kaira_*`). Every table name is domain-generic and tenant/app-partitioned.
- EAV-in-a-single-jsonb-blob for signals. One row per signal per call, typed `signal_type`, per brainstorm decision.
- Hard-coupling signal extraction to the inside-sales runner. The populator reads `result.signals`; any runner can emit it.
- A new job type. The existing `populate-analytics` is extended with a new extractor.
- Webhook-driven stage-change ingestion in v1. The schema anticipates a future `transition_at` column but does not implement it.

---

## 2. Target architecture

```
                     LSQ (source of truth, external)
                                │
                       fetch_* (GET/POST reads)
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
   sync-external-source   sync-external-source   sync-external-source
      (calls)                (leads)               (activities) [NEW]
              │                 │                          │
              │ upsert          │ upsert                   │ (no Layer 1 write)
              ▼                 ▼                          │
     source_call_records   source_lead_records             │
       [ rolling 7d ]        [ rolling 7d ]                │
              │                 │                          │
              │ side-effect     │ side-effect              │
              ▼                 ▼                          ▼
    ┌─────────────────────────────────────────────────────────────┐
    │  LAYER 2 — durable analytics history  (append-only)        │
    │                                                             │
    │  analytics_lead_roster_facts    ← leads sync                │
    │  analytics_lead_stage_facts     ← leads sync (diff)         │
    │  analytics_lead_activity_facts  ← calls + activities syncs  │
    │  analytics_lead_signal_facts    ← populate-analytics        │
    └─────────────────────────────────────────────────────────────┘
                   │                                  │
                   │ exact analytics / SQL            │ derived retrieval projection
                   ▼                                  ▼
          Sherlock analytics pack             generic pgvector substrate
          (strict metrics/history)            (transcript + business-evidence docs)
                                                      │
                                                      ▼
                                          Sherlock vector_retrieval pack
```

Layer 1 is entirely within the sync plan's scope and unchanged in shape. Layer 2 is the authoritative durable history layer. Any later vector retrieval projection is downstream and derived; it does not replace Layer 2.

---

## 3. Data model

### 3.1 `analytics_lead_roster_facts`

Durable roster of every lead ever observed. One row per lead per tenant/app.

| Column                    | Type          | Notes |
|---------------------------|---------------|-------|
| `id`                      | UUID PK       | |
| `tenant_id`               | UUID, FK → tenants | NOT NULL |
| `app_id`                  | VARCHAR(64)   | NOT NULL |
| `lead_id`                 | VARCHAR(128)  | NOT NULL; LSQ prospect_id (or equivalent external id) |
| `source`                  | VARCHAR(64)   | NOT NULL; e.g. `'leadsquared'` |
| `source_ref`              | VARCHAR(128)  | NULLABLE; original source id if different from `lead_id` |
| `lsq_created_on`          | TIMESTAMPTZ   | NULLABLE; authoritative lead-creation time from source |
| `first_seen_at`           | TIMESTAMPTZ   | NOT NULL; when this platform first observed the lead |
| `latest_stage_observed`   | VARCHAR(128)  | NULLABLE; denormalized pointer updated by leads sync |
| `latest_stage_observed_at`| TIMESTAMPTZ   | NULLABLE |
| `attributes_at_first_seen`| JSONB         | NOT NULL DEFAULT `'{}'`; snapshot of lead attrs at first observation |
| `created_at`, `updated_at`| TIMESTAMPTZ   | |

- **Uniqueness:** `UNIQUE (tenant_id, app_id, lead_id)`.
- **Indexes:** `(tenant_id, app_id, lsq_created_on DESC)`, `(tenant_id, app_id, first_seen_at DESC)`.
- **Write mode:** Upsert ON CONFLICT (tenant_id, app_id, lead_id) DO UPDATE SET latest_stage_observed = EXCLUDED.latest_stage_observed, latest_stage_observed_at = EXCLUDED.latest_stage_observed_at, updated_at = now(). `first_seen_at` and `attributes_at_first_seen` never change after insert.

### 3.2 `analytics_lead_stage_facts`

One row per detected stage transition. Append-only.

| Column             | Type          | Notes |
|--------------------|---------------|-------|
| `id`               | UUID PK       | |
| `tenant_id`        | UUID          | NOT NULL |
| `app_id`           | VARCHAR(64)   | NOT NULL |
| `lead_id`          | VARCHAR(128)  | NOT NULL |
| `from_stage`       | VARCHAR(128)  | NULLABLE; NULL on first-observation row |
| `to_stage`         | VARCHAR(128)  | NOT NULL |
| `detected_at`      | TIMESTAMPTZ   | NOT NULL; the sync-cycle start timestamp that detected the change |
| `transition_at`    | TIMESTAMPTZ   | NULLABLE; reserved for future webhook-derived rows where the true transition time is known. Always NULL in v1. |
| `sync_run_id`      | UUID, FK → source_sync_runs | NULLABLE; which observation cycle wrote this row |
| `attributes`       | JSONB         | NOT NULL DEFAULT `'{}'`; e.g. `{"prior_observed_at": "..."}` for auditing |
| `created_at`       | TIMESTAMPTZ   | |

- **Indexes:** `(tenant_id, app_id, lead_id, detected_at DESC)`, `(tenant_id, app_id, detected_at DESC)`, `(tenant_id, app_id, to_stage, detected_at)`.
- **No unique constraint on value.** Idempotency is guarded by the stage-detector's "new stage != latest known stage" read before write (§4.2).
- **Column comment on `detected_at`:** observation time; real transition happened at or before this timestamp, bounded by the prior detection.

### 3.3 `analytics_lead_activity_facts`

One row per observed lead activity. Includes call activities (duplicating the rows in `source_call_records` at a different grain) plus all other LSQ ProspectActivity types. Append-only.

| Column                | Type          | Notes |
|-----------------------|---------------|-------|
| `id`                  | UUID PK       | |
| `tenant_id`           | UUID          | NOT NULL |
| `app_id`              | VARCHAR(64)   | NOT NULL |
| `lead_id`             | VARCHAR(128)  | NOT NULL |
| `source_activity_id`  | VARCHAR(128)  | NOT NULL; LSQ ProspectActivityId |
| `activity_type`       | VARCHAR(64)   | NOT NULL; normalized: `call` / `email` / `web` / `sms` / `form_submit` / `custom` / `revenue` |
| `activity_subtype`    | VARCHAR(128)  | NULLABLE; e.g. `'inbound_call'`, `'outbound_call'`, source-specific event name |
| `source_event_code`   | INTEGER       | NULLABLE; LSQ `ActivityEvent` numeric code (e.g. 21, 22) |
| `occurred_at`         | TIMESTAMPTZ   | NOT NULL; LSQ `ActivityDateTime` |
| `actor_type`          | VARCHAR(32)   | NULLABLE; `agent` / `lead` / `system` |
| `actor_id`            | VARCHAR(128)  | NULLABLE; agent id where applicable |
| `attributes`          | JSONB         | NOT NULL DEFAULT `'{}'`; full normalized activity payload |
| `sync_run_id`         | UUID, FK → source_sync_runs | NULLABLE |
| `created_at`          | TIMESTAMPTZ   | |

- **Uniqueness:** `UNIQUE (tenant_id, app_id, source_activity_id)`.
- **Indexes:** `(tenant_id, app_id, lead_id, occurred_at DESC)`, `(tenant_id, app_id, activity_type, occurred_at DESC)`, `(tenant_id, app_id, occurred_at DESC)`.
- **Write mode:** Upsert ON CONFLICT (tenant_id, app_id, source_activity_id) DO NOTHING. A re-sync of the same activity is a no-op.

### 3.4 `analytics_lead_signal_facts`

One row per LLM-extracted signal from an evaluated call. Delete-then-insert per `eval_run_id` (matches existing `populate-analytics` idempotency).

| Column                   | Type          | Notes |
|--------------------------|---------------|-------|
| `id`                     | UUID PK       | |
| `tenant_id`              | UUID          | NOT NULL |
| `app_id`                 | VARCHAR(64)   | NOT NULL |
| `eval_run_id`            | UUID, FK → eval_runs | NOT NULL |
| `thread_evaluation_id`   | UUID, FK → thread_evaluations | NOT NULL |
| `lead_id`                | VARCHAR(128)  | NULLABLE; resolved from thread_evaluation's item (call row) |
| `source_activity_id`     | VARCHAR(128)  | NULLABLE; the underlying call activity id |
| `signal_type`            | VARCHAR(64)   | NOT NULL; controlled vocabulary (§5) |
| `signal_value`           | VARCHAR(128)  | NULLABLE; canonical short value (e.g. `'hot'`, `'committed'`, `'price'`) |
| `signal_value_numeric`   | NUMERIC       | NULLABLE; for sentiment/confidence style signals |
| `signal_at`              | TIMESTAMPTZ   | NULLABLE; e.g. the committed-followup datetime |
| `confidence`             | NUMERIC       | NULLABLE; 0..1 |
| `supporting_quote`       | TEXT          | NULLABLE |
| `ordinal`                | INTEGER       | NOT NULL DEFAULT 0; position within a call's signals for stable delete-then-insert replay |
| `attributes`             | JSONB         | NOT NULL DEFAULT `'{}'` |
| `created_at`             | TIMESTAMPTZ   | |

- **Uniqueness:** `UNIQUE (tenant_id, app_id, eval_run_id, thread_evaluation_id, signal_type, ordinal)`.
- **Indexes:** `(tenant_id, app_id, eval_run_id)`, `(tenant_id, app_id, lead_id, signal_type, signal_at)`, `(tenant_id, app_id, signal_type, created_at DESC)`.
- **Write mode:** Delete existing rows for `eval_run_id`, then bulk-insert. Same as `analytics_*_facts` populator pattern.

---

## 4. Populators

### 4.1 Leads sync side-effect (roster + stage diff)

At `backend/app/services/inside_sales_sync.py`, in the leads sync path, after the existing upsert into `source_lead_records` and within the **same transaction**:

1. Upsert `analytics_lead_roster_facts` for each lead row just written. `ON CONFLICT (tenant_id, app_id, lead_id) DO UPDATE` refreshes the `latest_stage_observed` pointer and `updated_at` only; `first_seen_at` and `attributes_at_first_seen` never change after insert.
2. For each lead row, read the **latest** row in `analytics_lead_stage_facts` for `(tenant, app, lead_id)`. If no row exists, insert `(from_stage=NULL, to_stage=<current stage>, detected_at=cycle_start)` when the current stage is non-null. If a row exists and its `to_stage` differs from the current stage, insert `(from_stage=<prior to_stage>, to_stage=<current stage>, detected_at=cycle_start)`. If equal, no-op.
3. All three writes (source upsert, roster upsert, stage insert) live in one transaction. If any fails, the whole cycle rolls back.

Transaction-boundary rationale: the sync runner already wraps Layer 1 writes in a single transaction (per sync-plan §PR 4, which extends the runner with prune inside that transaction). The side-effect writes reuse that transaction. A partial write would split Layer 1 and Layer 2 state, which is worse than a retryable failure.

### 4.2 Calls sync side-effect (activity capture)

At `backend/app/services/inside_sales_sync.py`, in the calls sync path, after the existing upsert into `source_call_records`:

1. For each call activity just upserted, upsert `analytics_lead_activity_facts` with `activity_type='call'`, `activity_subtype` derived from the LSQ event code (`'inbound_call'` for 21, `'outbound_call'` for 22), and the full normalized LSQ payload in `attributes`. `ON CONFLICT (tenant_id, app_id, source_activity_id) DO NOTHING`.
2. Within the same transaction as the source upsert.

### 4.3 Activities sync (new `source_family='activities'`)

New path in `backend/app/services/inside_sales_sync.py` (or a refactored-generic module if the plan's PR 0 restructured it). Runs only when `job.params.source_family == 'activities'`.

1. Pull LSQ ProspectActivities via the existing `fetch_*` helpers in `lsq_client.py`. Event codes to pull: v1 baseline is every event code present in the tenant's `ActivityTypes.Get` response **except** call codes 21 and 22 (which the calls sync already captures). Configuration surface for the event-code allowlist lives in the scheduler workload entry's `params` so operators can scope without a code change.
2. For each pulled activity, upsert `analytics_lead_activity_facts`. No Layer 1 write — activities have no rolling working copy.
3. Honor the same 7d window semantics as the other families (the LSQ pull is bounded by the scheduler's window params). Prune does not apply to Layer 2.

Re-runs are safe: the unique key `(tenant_id, app_id, source_activity_id)` collapses duplicates.

### 4.4 `populate-analytics` signal extractor

At `backend/app/services/analytics/fact_populator.py` (or the current module housing `FactPopulator`):

1. Add a new `SignalExtractor` class sibling to the existing run/eval/criterion extractors.
2. For each `ThreadEvaluation` child of the eval run, read `result.signals` (a JSONB array; absent or empty → skip).
3. For each signal entry, emit one `analytics_lead_signal_facts` row. `lead_id` and `source_activity_id` are resolved from the `ThreadEvaluation`'s underlying call (the existing inside-sales runner already stores the `activity_id` / `prospect_id` in thread evaluation context; read from there). `ordinal` is the array index.
4. Delete-then-insert per `eval_run_id`, matching the existing `_delete_existing()` pattern at `job_worker.py:160–169`.
5. Runs inside the existing `populate-analytics` job; no new job type.

Re-normalization is free: re-running `populate-analytics` on the same eval run rebuilds signals from the immutable `result.signals` without re-invoking the LLM.

### 4.5 LLM extraction schema extension

At `backend/app/services/evaluators/inside_sales_runner.py`, extend the evaluator's output schema (the JSON schema passed into `generate_json`) with a `signals` array at the top level of the per-call result. The array shape:

```json
{
  "signals": [
    {
      "signal_type": "followup_call_commitment",
      "signal_value": "committed",
      "signal_at": "2026-04-24T16:00:00+05:30",
      "confidence": 0.92,
      "supporting_quote": "I'll call you Friday at 4pm.",
      "attributes": { "committed_by": "agent" }
    }
  ]
}
```

Every entry must conform 1:1 to the `analytics_lead_signal_facts` row shape — no reshaping at normalization time. Unknown-unknowns use `signal_type='other_notable_signal'` with a freeform `attributes.signal_type_raw`.

This is additive to the existing `result` payload. No existing column is renamed or dropped. Scoring logic is untouched.

---

## 5. Signal taxonomy (controlled vocabulary)

`signal_type` is an enum-like controlled string. V1 values:

**Commitments & next steps**
- `followup_call_commitment`
- `info_send_commitment`
- `payment_link_commitment`
- `onboarding_link_commitment`
- `home_visit_commitment`
- `video_consult_commitment`
- `callback_request`

**Intent & stage progression**
- `purchase_intent` (values: `hot` / `warm` / `cold`)
- `enrollment_intent`
- `decision_maker_status` (values: `self` / `needs_spouse` / `needs_family` / `needs_doctor`)
- `decision_timeline` (values: `immediate` / `this_week` / `this_month` / `unclear` / `never`)
- `budget_signal` (values: `can_afford` / `needs_emi` / `too_expensive` / `not_discussed`)

**Objections**
- `objection` with `signal_value` ∈ `{price, spouse_consent, doctor_trust, medication_skepticism, already_tried, already_enrolled_elsewhere, time, clinical_doubt, privacy, language_barrier}`

**Qualification & correction**
- `condition_confirmed` / `condition_denied`
- `current_treatment_status`
- `preferred_language`
- `preferred_contact_window`
- `alternate_contact`
- `wrong_number`
- `do_not_call_request`

**Outcome & relationship**
- `outcome` (values: `interested` / `not_interested` / `needs_time` / `already_enrolled` / `wrong_number` / `rnr` / `dnc`)
- `sentiment` (value: enum; `signal_value_numeric`: signed score −1..1)
- `rapport_level` (values: `high` / `medium` / `low`)
- `escalation_needed`

**Freeform capture**
- `other_notable_signal` with `attributes.signal_type_raw` carrying the LLM's raw label. Mined later for new typed signals.

The vocabulary lives as a Python constant set in a new `backend/app/services/analytics/signal_taxonomy.py`. The populator validates `signal_type` against it; unknown values are coerced to `other_notable_signal` with the raw label preserved in `attributes`.

---

## 6. Sherlock manifest updates

At `backend/app/services/chat_engine/manifests/inside-sales.yaml`:

1. Add four new table definitions: `analytics_lead_roster_facts`, `analytics_lead_stage_facts`, `analytics_lead_activity_facts`, `analytics_lead_signal_facts`.
2. Each column carries the 3-axis taxonomy required by the manifest validator (per CLAUDE.md invariant on taxonomy): `role` (dimension / measure / temporal / key / identifier), `data_type` (Vega-Lite), `semantic_type` (Metabase-style).
3. Per-app vocabulary labels ("Follow-up commitment", "Stage transition", "Lead first seen", etc.) live in the manifest's vocabulary layer so the physical table names stay generic while Sherlock's explanations use domain language.
4. Join hints declared between `analytics_lead_signal_facts.lead_id → analytics_lead_activity_facts.lead_id`, `analytics_lead_activity_facts.lead_id → analytics_lead_roster_facts.lead_id`, `analytics_lead_stage_facts.lead_id → analytics_lead_roster_facts.lead_id`. No physical FKs across lead_id (it is a source-string id, not a UUID on `leads`) — the manifest carries the join semantics.

The `TOOLS` block in `prompts/base.py` and `apps.config.chat.dataSurfaces` are **not** hand-edited (per CLAUDE.md invariant); generators propagate changes from the manifest.

---

## 7. Scheduler workload registration

At `backend/app/services/scheduler/workloads.py` (created by sync-plan PR 2):

1. The single `(app_id='inside-sales', job_type='sync-external-source')` workload entry remains.
2. Extend the entry's `source_family` enum to include `'activities'`.
3. Add a workload-level note that `source_family='activities'` writes to Layer 2 only and does not participate in Layer 1 prune semantics. The sync runner checks `source_family` and branches write paths accordingly; the scheduler engine is unchanged.
4. The admin "Source config / run setup" picker in sync-plan PR 3's overlay gains `activities` alongside `calls` and `leads`.

No second workload entry. No scheduler coupling to inside-sales.

---

## 8. Query patterns Sherlock must answer

### 8.1 "Did agents follow up on calls they were supposed to?"

```sql
WITH expected AS (
  SELECT s.lead_id, s.signal_at AS expected_at, s.supporting_quote
  FROM analytics_lead_signal_facts s
  WHERE s.tenant_id = :t AND s.app_id = :a
    AND s.signal_type = 'followup_call_commitment'
    AND s.signal_at IS NOT NULL
    AND s.signal_at <= now()
),
actual AS (
  SELECT a.lead_id, a.occurred_at
  FROM analytics_lead_activity_facts a
  WHERE a.tenant_id = :t AND a.app_id = :a
    AND a.activity_type = 'call' AND a.actor_type = 'agent'
)
SELECT
  e.lead_id,
  e.expected_at,
  MIN(a.occurred_at) AS actual_at,
  CASE WHEN MIN(a.occurred_at) IS NULL THEN 'missed'
       WHEN MIN(a.occurred_at) BETWEEN e.expected_at AND e.expected_at + INTERVAL '1 day'
         THEN 'kept'
       ELSE 'late'
  END AS status
FROM expected e
LEFT JOIN actual a
  ON a.lead_id = e.lead_id AND a.occurred_at >= e.expected_at
GROUP BY e.lead_id, e.expected_at, e.supporting_quote;
```

### 8.2 "New leads by day — contacted same-day / +1 / +2"

```sql
WITH new_leads AS (
  SELECT lead_id, lsq_created_on::date AS created_day
  FROM analytics_lead_roster_facts
  WHERE tenant_id = :t AND app_id = :a
    AND lsq_created_on >= :from_date
),
first_contact AS (
  SELECT DISTINCT ON (lead_id) lead_id, occurred_at::date AS contacted_day
  FROM analytics_lead_activity_facts
  WHERE tenant_id = :t AND app_id = :a
    AND activity_type = 'call' AND actor_type = 'agent'
  ORDER BY lead_id, occurred_at ASC
)
SELECT
  n.created_day,
  COUNT(*)                                                                      AS new_leads,
  COUNT(f.lead_id) FILTER (WHERE f.contacted_day = n.created_day)                AS same_day,
  COUNT(f.lead_id) FILTER (WHERE f.contacted_day = n.created_day + 1)            AS plus_1,
  COUNT(f.lead_id) FILTER (WHERE f.contacted_day = n.created_day + 2)            AS plus_2,
  COUNT(*) - COUNT(f.lead_id)                                                    AS never_contacted
FROM new_leads n
LEFT JOIN first_contact f USING (lead_id)
GROUP BY n.created_day
ORDER BY n.created_day DESC;
```

### 8.3 "How long do leads sit in each stage?"

```sql
SELECT
  lead_id,
  to_stage,
  detected_at AS entered_at,
  LEAD(detected_at) OVER (PARTITION BY tenant_id, app_id, lead_id ORDER BY detected_at) AS exited_at
FROM analytics_lead_stage_facts
WHERE tenant_id = :t AND app_id = :a;
```

---

## 9. Files touched

### Backend — new

- `backend/app/models/analytics_lead_facts.py` — four ORM models.
- `backend/app/services/analytics/signal_taxonomy.py` — controlled vocabulary + validator.
- `backend/app/services/analytics/signal_extractor.py` — the new populator extractor.
- `backend/migrations/versions/2026_04_22_add_analytics_lead_facts.py` — create four tables, indexes, unique constraints.
- `backend/tests/test_analytics_lead_roster_sync_unittest.py`
- `backend/tests/test_analytics_lead_stage_detector_unittest.py`
- `backend/tests/test_analytics_lead_activity_sync_unittest.py`
- `backend/tests/test_analytics_signal_extractor_unittest.py`
- `backend/tests/test_inside_sales_signals_output_unittest.py`

### Backend — changed

- `backend/app/models/__init__.py` — export the new models.
- `backend/app/services/inside_sales_sync.py` — transactional side-effects for leads, calls, and the new activities path.
- `backend/app/services/evaluators/inside_sales_runner.py` — extend the output JSON schema with `signals`.
- `backend/app/services/analytics/fact_populator.py` — register `SignalExtractor` in the dispatch map.
- `backend/app/services/chat_engine/manifests/inside-sales.yaml` — four new table blocks + vocabulary labels.
- `backend/app/services/scheduler/workloads.py` (created in sync-plan PR 2) — add `'activities'` to the inside-sales workload's allowed `source_family` values.

### Frontend — changed

- None directly required. Sherlock renders via its existing chart-payload contract. Any eval-detail UI surface that wants to display extracted signals can read them from `ThreadEvaluation.result.signals` in a follow-up; not in v1 scope.

---

## 10. Invariants

- Every SELECT/UPDATE/DELETE on the four new tables scopes on `(tenant_id, app_id)`. Tests must assert this.
- Layer 1 prune (sync-plan PR 4) MUST NOT touch any Layer 2 table. Prune scope stays `source_*` only.
- `analytics_lead_stage_facts.detected_at` is observation time, not transition time. Column comment is load-bearing; do not remove.
- `analytics_lead_signal_facts` is the only Layer 2 table using delete-then-insert. The other three are append-only and rely on upsert-do-nothing semantics for re-run safety.
- Signal extraction never triggers an LLM call at populator time. Re-running `populate-analytics` reads only from `ThreadEvaluation.result.signals`.
- Sync-side side-effects share the sync transaction. No separate transaction commits.
- No app name (`inside-sales`, `kaira-bot`) appears in any new table, column, index, or service module except the scheduler workload registry (which is designed to hold per-app config per sync-plan §PR 2).

---

## 11. Risks and follow-ups

- **Stage granularity is 6h.** Fast multi-step transitions collapse into one fact row. Mitigation is a future webhook path that sets `transition_at` precisely; schema already supports it. Product acceptance needed.
- **Roster coverage is leading-edge only.** Leads created before the first successful sync are invisible until a boundary-crossing on-demand sync (sync-plan PR 5) pulls their window. Operators should be told this the first time they ask a historical question that looks short; a "coverage from" badge on the analytics surface is a reasonable follow-up.
- **Retention unbounded in v1.** Append-only tables will grow monotonically. Estimate: ~O(N_leads × activities_per_lead) rows per tenant per month. Document a retention prune as a v2 scheduled workload.
- **Signal taxonomy drift.** The LLM may emit `signal_type` values outside the controlled vocabulary. The populator coerces them to `other_notable_signal`; a follow-up review of `signal_type_raw` frequencies should drive vocabulary expansion.
- **Activity event-code allowlist per tenant.** LSQ tenants may have hundreds of ProspectActivity types configured. The operator scheduling the `activities` sync should pick the allowlist consciously (via the workload's `params`); pulling everything by default risks surprise volume. Default list for inside-sales to be nailed down in the implementation plan.

---

## 12. Alignment with the Sherlock rewrite (`docs/plans/sherlock-future-plan.md`)

This spec is **analytics-pack-local** under the rewrite's two-layer model (§4.1–4.2, §6.4). It adds tables, a manifest block, and a signal extractor; it touches no harness-core file. That makes most of it parallelizable with the rewrite's phases. There is one gated piece.

### 12.1 Component-by-component dependency

| Component (this spec) | Rewrite dependency | When to land |
|---|---|---|
| §3 — four new `analytics_lead_*_facts` tables + migration | None (pack-local schema) | Parallel with any rewrite phase |
| §4.1, §4.2, §4.3 — `inside_sales_sync.py` Layer 2 side-effects and new `activities` source_family | None (not Sherlock code; lives in the sync service) | Parallel; blocked only by sync-plan PRs 0/2/4/5, not by the rewrite |
| §4.4 — `SignalExtractor` in `fact_populator.py`, registered in the `populate-analytics` job | None (the populate-analytics job is not Sherlock runtime) | Parallel |
| §4.5 — `inside_sales_runner.py` output-schema extension with `result.signals` | None | Parallel |
| §5 — `signal_taxonomy.py` controlled vocabulary | None | Parallel |
| §6 — `inside-sales.yaml` manifest block for the four new tables | **Rewrite Phase 4** (manifest → `comment_emitter` → SQL agent collapse) | After Phase 4 |
| §7 — scheduler workload `source_family` extension | None | Parallel |

### 12.2 Why the manifest block is gated on rewrite Phase 4

Rewrite Phase 4 extends `comment_emitter` to serialize additional manifest fields (`synonyms`, `allowed_values`, `ordering`, `measure_kind`, `chartable`, `unit`) and deletes the parallel `manifest.lookup_column()` path from `sql_agent._column_role_hints`. Four new manifest table blocks added **before** Phase 4 will be authored against today's taxonomy surface and will need to be revised as soon as Phase 4 expands the serialized field set. Waiting costs nothing: the Layer 2 tables accumulate history from the moment §3/§4 ship, and Sherlock simply cannot answer questions against the new tables until §6 lands.

### 12.3 No rework required for the rewrite envelope

This spec produces nothing that travels through the §6.2 tool-result envelope directly — it populates tables that the existing analytics pack's `data_query` already queries via SQL. Once the manifest block is in, rewrite Phase 2's `outcome` / `reason_code` / `artifact` shape flows through unchanged. No new reason codes are introduced here.

### 12.4 Harness invariants this spec respects

- No app name (`inside-sales`, `kaira-bot`) is introduced into harness-core files (§10 of this spec; rewrite Rule 3).
- The manifest YAML is the authoring surface; the `TOOLS` block in `prompts/base.py` and `apps.config.chat.dataSurfaces` are not hand-edited (rewrite §6.4; CLAUDE.md invariant).
- No new tool is added to Sherlock; the new data is reached via the existing `data_query` + manifest-driven SQL generator.

### 12.5 Build order with the rewrite in flight

1. In parallel with rewrite Phases 1–3: ship everything in §3, §4.1–4.5, §5, §7. Layer 2 begins accumulating immediately.
2. Wait for rewrite Phase 4 to land. Then ship §6 (manifest block). At that point Sherlock can answer the queries in §8 end-to-end.

---

## 13. Out of scope for this spec

- Retention policy and scheduled prune for Layer 2 tables.
- Webhook-driven stage ingestion (schema-ready, not built).
- Signal extraction for non-inside-sales evaluators (populator is generic; other runners emit `result.signals` when ready).
- UI surfaces for browsing signals on an eval-detail page.
- Any change to `EvalRun` polymorphism, `ThreadEvaluation` scoring columns, or the inside-sales runner's scoring logic.
- Cross-tenant analytics (explicitly rejected; tenant scoping is absolute).
- Backfill of history from historical LSQ windows beyond the 30-day boundary-crossing cap in sync-plan §1.1.3.

---

**End of spec.**
