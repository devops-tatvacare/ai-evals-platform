# Roadmap 01 — Foundation: two-schema Postgres, naming, durable inside-sales history

**Status:** binding plan. Self-contained. Rebased on the current Alembic head (`0004_drop_inside_sales_cols`). Folds and supersedes:
- `phase-02-oltp-olap-schema-split.md`
- `phase-02.5-table-renames-semantic-clarity.md`
- `phase-03-inside-sales-lead-history-data-mode.md`

**Roadmap follow-on:** Roadmap 02 (vectors + graph) — depends on this roadmap completing in full. Then Roadmap 03 (FHIR / `clinical` schema) — depends on Roadmap 02.

**Implementation status (2026-04-28):**

| Step | State |
|---|---|
| §0 hard gate (revisions `0001`–`0004`, `startup_schema.py` removed, single Alembic head) | ✅ Met at HEAD |
| Phase 1 groundwork — schema-aware helpers, no table moves (this PR, branch `feat/postgres-two-schemas`) | ✅ Shipped |
| └ `alembic/env.py` — `include_schemas=True`, `version_table_schema='public'`, schema-tolerant index filter | ✅ |
| └ `manifest.CatalogTable.pg_schema` (default `None` → `public`) + `effective_schema` + `qualified_table_name` | ✅ |
| └ `manifest.lookup_column` accepts `schema.table.column` | ✅ |
| └ `manifest_validator` queries `information_schema` per-table schema; warns on unqualified | ✅ |
| └ `comment_emitter` emits `COMMENT ON COLUMN <schema>.<table>.<column>` | ✅ |
| └ `catalog_tools` `information_schema`/`pg_catalog`/`pg_indexes` queries route via manifest's declared schema | ✅ |
| └ `sql_agent.validate_sql_columns_against_manifest` recognizes every `known_schemas()` prefix | ✅ |
| └ `vocabulary.ColumnTarget` carries `schema` (default `"public"`); `resolve_column` accepts `schema.table.column` | ✅ |
| Phase 1 entrypoint policy — `RUN_MIGRATIONS=true` default unchanged; flip deferred to revision `0006` PR | ✅ |
| Revision `0005` (create `platform` schema) | ✅ Shipped |
| Revision `0006` (move 43 OLTP tables to `platform`) | ✅ Shipped |
| Revision `0007` (create `analytics` schema + `analytics_reader` role + grants + transitional `search_path`) | ✅ Shipped |
| Revision `0008` (move 16 analytics-adjacent tables to `analytics`) | ✅ Shipped |
| Revision `0009` (rename 15 analytics tables to role-prefixed names) | ✅ Shipped |
| Revision `0010` (drop legacy `evaluation_analytics` cache table) | ✅ Shipped |
| Revision `0011` (Sherlock platform-table rename within `platform`) | ✅ Shipped |
| Revision `0012` (Evaluation platform-table rename within `platform`) | ✅ Shipped |
| Revision `0013` (Reports + history platform-table rename within `platform`) | ✅ Shipped |
| Revision `0014` (Library + datasets + uploads + tags rename within `platform`) | ✅ Shipped |
| Revision `0015` (Application registry rename within `platform`) | ✅ Shipped |
| Revision `0016` (Tenants + audit + jobs rename within `platform`) | ✅ Shipped |
| Revision `0017` (IAM rename within `platform`) | ✅ Shipped |
| Revision `0018` (Inside-sales analytics fact tables created in `analytics` + populator + sync side-effects) | ✅ Shipped |

---

## 0. Hard gate — Alembic is the only DDL surface

**This gate is non-negotiable. Nothing in this roadmap, Roadmap 02, or Roadmap 03 ships unless every condition below is true.**

### 0.1 Phase 01 Alembic adoption is complete

| Check | Required state |
|---|---|
| Baseline revision applied to prod | `0001_baseline_prod` |
| Catch-up revision applied to prod | `0002_catchup_indexes_defaults` |
| FK/lsq cleanup revision applied to prod | `0003_drop_redundant_fks_and_lsq` |
| Inside-sales normalized-column cleanup applied to prod | `0004_drop_inside_sales_cols` |
| `alembic current` (in prod) | `0004_drop_inside_sales_cols (head)` |
| `startup_schema.py` and `backend/migrations/` | **removed from the repo and from prod boot** |
| Alembic single-head | `alembic heads` returns exactly one revision |

### 0.2 Hard rules that follow from the gate

1. **All schema changes ship as numbered Alembic revisions.** No exceptions. Revisions after the current head (`0004_drop_inside_sales_cols`) are the only path to prod schema mutation.
2. **No boot-time ad-hoc DDL.** No `startup_schema.py`, no `CREATE TABLE IF NOT EXISTS` in application startup, no shadow schema mutators. For this rename chain, migrations run from a single release step before app/worker traffic resumes; they do **not** run opportunistically from multiple rolling containers.
3. **No stop-gap migration directories.** `backend/migrations/` does not exist; nobody re-creates it. `pg_dump`-based hand-rolled DDL files are not migrations.
4. **Single Alembic head throughout the entire chain** (starting at the next revision after the current head, planned here as `0005`–`0018`, then Roadmap 02 revisions, then Roadmap 03 revisions). If another revision lands before this chain starts, increment the IDs but preserve the order and scope. If two heads ever exist, the chain stops until merged.
5. **Reversibility per revision.** Every revision in this chain has a working `downgrade()`. Rollback path verified on a prod clone before each merge.
6. **Manifest validator must pass at boot** against the live catalog after every revision applies. CI runs the validator.

### 0.3 What proceeds only after this gate

| Work | Gated by |
|---|---|
| Revision `0006` (move app tables `public` → `platform`, leaving `public.alembic_version` in place permanently) | §0.1 + §0.2 + §9.6 schema-aware refactor merged + §9.1 release choreography in place |
| Revisions `0007`–`0018` (analytics split, renames, inside-sales facts) | Revision `0006` applied; ORM models updated |
| **Roadmap 02** (pgvector retrieval substrate) | This roadmap (§17) accepted as done |
| **Roadmap 03** (FHIR / `clinical` schema) | Roadmap 02 accepted as done |

If any check in §0.1 is false, **stop**. Do not write revision `0005` or later. Do not draft Roadmap 02 work items. Re-enter Phase 01 until §0.1 is green.

---

## 1. End state when this roadmap is done

Single Postgres database. Two application schemas (`platform`, `analytics`). Clean role-prefixed names. Inside-sales analytics history populating durably. `public` remains only as a bookkeeping schema and holds no application-domain tables.

| Schema | Count | Purpose |
|---|---|---|
| `platform` | 43 tables | OLTP / app state. User-owned, transactional, FK-dense. |
| `analytics` | 19 tables | OLAP. Facts, aggregates, dimensions, references, snapshots, logs, caches. Populated by jobs (occasionally by triggers; never by request handlers writing to facts). |
| `public` | 1 bookkeeping table | Permanent bookkeeping only. Holds `alembic_version`; no application-domain tables remain here after revision `0006`. |

- Sherlock SQL agent reads schema-qualified, role-prefixed identifiers.
- Database default `search_path = platform, public, analytics` while any non-bookkeeping tables still remain in `public`; once the analytics/public stragglers move in later revisions, the search path may tighten to `platform, analytics`. Application code schema-qualifies everywhere, and Alembic/app diagnostics address `public.alembic_version` explicitly.
- `evaluation_analytics` table is dropped (legacy zero-row cache, fully shadowed by analytics layer).
- 4 inside-sales tables (`dim_lead`, `fact_lead_stage_transition`, `fact_lead_activity`, `fact_lead_signal`) populating from sync side-effects + `populate-analytics`.

Total domain tables: 62.

## 2. Why this is the right shape

1. **Two schemas is the standard Postgres pattern** for OLTP/OLAP separation in one database. Five sub-schemas was overengineered and is rejected.
2. **Application tables are banished from `public`.** That removes accidental defaults from runtime SQL while avoiding the Alembic self-hosting hazard of moving `alembic_version` mid-chain.
3. **Role-prefixed names** in `analytics` (`fact_`, `agg_`, `dim_`, `ref_`, `snapshot_`, `log_`, `cache_`, `crm_`) make each table's purpose obvious to humans and to Sherlock's SQL agent.
4. **Renaming is highest-leverage** for chat-to-SQL accuracy. Sherlock currently trips on collisions (`jobs` / `analytics_jobs` / `scheduled_jobs`) and opaque names (`history`, `settings`, `tags`).
5. **Inside-sales facts answer two product questions** that the rolling 7-day source layer cannot: agent follow-up adherence, and time-to-first-contact.
6. **No JSONB flattening refactor in this roadmap.** The four new tables already use typed columns where the contract is stable. Shape-evolution governance is deferred.

## 3. Schema assignment — final names

### 3.1 `platform` schema (43 tables — moved from `public`)

```
tenants, tenant_configurations, users, identity_refresh_tokens, identity_invite_links,
applications, access_roles, access_role_application_grants, access_role_permissions,
audit_event_logs, evaluation_datasets, application_uploaded_files,
library_prompt_definitions, library_output_schema_definitions, evaluators,
chat_sessions, chat_messages, application_event_history, application_settings,
library_adversarial_test_cases, application_tags, background_jobs,
evaluation_runs, evaluation_run_thread_results, evaluation_run_adversarial_results,
evaluation_run_api_call_logs, evaluation_reviews, evaluation_review_items,
report_configurations, report_generation_runs, report_generated_artifacts,
application_external_agent_connectors, evaluation_templates,
analytics_saved_charts, analytics_saved_dashboards,
sherlock_agent_sessions, sherlock_conversation_turns, sherlock_turn_events,
sherlock_ontology_classes, sherlock_ontology_entity_types, sherlock_entity_resolvers,
scheduled_job_definitions, scheduler_worker_heartbeats
```

Bookkeeping stays in `public.alembic_version`. This roadmap does not move it, and no later phase in this roadmap or the follow-on roadmaps depends on moving it.

### 3.2 `analytics` schema (19 tables, role-prefixed)

| Table | Role | Populated by |
|---|---|---|
| `analytics.fact_evaluation` | Fact at evaluation grain (run × thread × evaluator) | `populate-analytics` job |
| `analytics.fact_evaluation_criterion` | Fact at criterion grain (rule check) | `populate-analytics` job |
| `analytics.agg_evaluation_run` | Aggregate per eval run (rolled-up counts, rates) | `populate-analytics` job |
| `analytics.fact_lead_stage_transition` | Fact per lead stage change | sync side-effect (leads path) |
| `analytics.fact_lead_activity` | Fact per lead activity (call / email / web / etc.) | sync side-effect (calls + activities paths) |
| `analytics.fact_lead_signal` | Fact per LLM-extracted signal | `populate-analytics` (SignalExtractor) |
| `analytics.dim_lead` | Dimension — one row per lead, mutable `latest_stage` pointer | sync side-effect (leads path) |
| `analytics.fact_llm_generation` | Fact per LLM generation call | `LoggingLLMWrapper` (live, request-path writes) |
| `analytics.agg_llm_usage_daily` | Aggregate — daily rollup from `fact_llm_generation` | `populate-cost-rollup` job |
| `analytics.ref_llm_model_pricing` | Reference — effective-dated billing rates | manual + bootstrap seed |
| `analytics.ref_llm_model_alias` | Reference — observed → canonical model-name mapping | manual |
| `analytics.ref_llm_models_catalog` | Reference — models.dev metadata catalog | `models_dev_refresh` job |
| `analytics.snapshot_llm_models_catalog` | Snapshot — per-refresh capture of catalog state | `models_dev_refresh` job |
| `analytics.crm_lead_record` | Source mirror — rolling 7d copy of CRM leads | sync job (Layer 1 write) |
| `analytics.crm_call_record` | Source mirror — rolling 7d copy of CRM calls | sync job (Layer 1 write) |
| `analytics.log_crm_source_sync` | Log — per-sync-run audit | sync job self-writes |
| `analytics.log_fact_population_run` | Log — `populate-analytics` self-trace | populator self-writes |
| `analytics.log_sherlock_tool_call` | Log — Sherlock tool-call trace | mid-turn agent |
| `analytics.cache_sql_query` | Cache — Sherlock SQL agent query results, TTL-bound | Sherlock on cache miss |

### 3.3 Drop (1 table)

`evaluation_analytics` — legacy zero-row cache, fully shadowed by `analytics.fact_evaluation` / `analytics.fact_evaluation_criterion` / `analytics.agg_evaluation_run`. Only readers are `routes/reports.py` and `services/reports/base_report_service.py` (legacy report paths replaced by `report_builder_v2`).

### 3.4 Judgement calls captured

- `fact_llm_generation` is in `analytics`, written live on every LLM call. Cross-schema cost: zero (same DB / same transaction). Conceptual cleanliness gained.
- `log_sherlock_tool_call` is fact-shaped but emitted mid-turn from request path. Treated as a log because it's observability data. If request-path coupling becomes an issue, revisit.
- `sherlock_agent_sessions` / `_conversation_turns` / `_turn_events` (renamed from `sherlock_runtime_*`) stay in `platform`. Session/trace data, not facts.
- `sherlock_ontology_*` / `sherlock_entity_resolvers` stay in `platform`. Seeded application config.
- `analytics_saved_charts` / `_saved_dashboards` (renamed from `analytics_charts` / `_dashboards`) stay in `platform`. User-owned chart configuration despite the name.
- `scheduler_worker_heartbeats` stays in `platform`. Per-worker liveness, transactional.
- Inside-sales `dim_lead` is roster-shaped (one row per lead, mutable pointer fields) — classic SCD-1 dimension. Stage history is in `fact_lead_stage_transition`.

## 4. Naming principles (applied throughout)

1. **Schema name is not repeated in the table name.** No `analytics.analytics_*` stutter. No `platform.platform_*`.
2. **Role-prefix announces the table's function** in the analytics schema: `fact_` / `agg_` / `dim_` / `ref_` / `snapshot_` / `log_` / `cache_` / `crm_` (source mirror).
3. **Intent visible from the name itself** — a reader (human or LLM) infers the table's purpose from the name alone.
4. **Singular nouns in `analytics` and `clinical` schemas** (Kimball convention). `platform` keeps Postgres plural style for existing OLTP tables.
5. **Spell things out** — 3–4 underscore-joined words are fine. Never abbreviate when intent suffers.
6. **No implementation words** in public names (`runtime`, `tmp`, `v2`, `legacy`).
7. **Make the grain visible** — `evaluation_run_thread_results`, not `thread_evaluations`.

Namespace prefixes for `platform.*`: `tenant_`, `identity_`, `access_`, `application_`, `evaluation_`, `library_`, `chat_`, `sherlock_`, `report_`, `analytics_saved_` (for charts/dashboards config), `scheduled_job_`, `scheduler_worker_`, `audit_event_`.

## 4.5 Tall-fact discipline (load-bearing design principle)

Every `fact_*` table across `analytics` and `clinical` is **tall** — new measures or new categories add **rows**, not columns. A discriminator column identifies the kind of measurement; a small set of typed value columns carries the data.

| Fact table | Discriminator | New X = new rows |
|---|---|---|
| `analytics.fact_evaluation` | `evaluator_type` + `evaluator_id` + `evaluator_name` | New evaluator |
| `analytics.fact_evaluation_criterion` | `criterion_id` (evaluator-defined) | New rule / criterion |
| `analytics.fact_lead_signal` | `signal_type` | New signal type (after vocabulary update §7) |
| `analytics.fact_lead_activity` | `activity_type` + `activity_subtype` + `source_event_code` | New LSQ activity event code |
| `analytics.fact_lead_stage_transition` | `to_stage` (free string from CRM) | New CRM stage |
| `analytics.fact_llm_generation` | `provider` + `model` + `call_purpose` | New LLM provider/model/call site |
| `clinical.fact_patient_observation` (Roadmap 03) | `concept_id` (FK to terminology) | New clinical concept |
| `clinical.fact_patient_condition`, `_medication`, etc. | `concept_id` | New clinical concept |

### Why this matters

1. **JSONB shape evolution stays a TXN concern.** When source JSONB shape changes (new evaluator output, new FHIR profile, new CRM event), the change lands as a new value of the discriminator column — never a new column on the fact. The fact's column set is stable across years.
2. **Sherlock semantic-model stability.** The agent's manifest references columns that don't change. New domain values arrive as rows the agent can filter on with `WHERE discriminator = 'X'`. No manifest churn per evaluator / concept.
3. **No schema explosion.** A wide fact with one column per evaluator (or per signal type, or per FHIR profile) would be unmanageable as the platform onboards new apps and tenants. Tall facts cap column count regardless of cardinality.
4. **Typed values where it matters.** Each fact carries a small fixed set of typed value columns (e.g. `value_numeric`, `value_text`, `value_bool` on observation-style facts; `signal_value` / `signal_value_numeric` on signal facts). Only the appropriate column is populated per row.
5. **Deferred JSONB-flattening work has a known target shape.** When a future measure must become first-class queryable (e.g. a new evaluator output field that dashboards depend on), the path is: extend the discriminator vocabulary → emit new rows from the populator → done. No DDL, no manifest edit beyond synonyms.

### What this does NOT mean

- **Not all `analytics.*` tables are tall.** Aggregates (`agg_*`), dimensions (`dim_*`), references (`ref_*`), snapshots, logs, and caches are wide where wide is appropriate. The tall-fact discipline applies only to `fact_*` tables.
- **Not a general `fact_metric_event` mega-table.** Each fact is bounded to a domain (lead signals, patient observations, evaluation results). Cross-domain rollups are aggregates (`agg_*`), not a single mega-fact.
- **Not an excuse to over-narrow.** If a stable, conformed dimension exists for the row (e.g. `tenant_id`, `app_id`, `lead_id`, `evaluator_id`), it stays a typed column. Tall applies to the *measure axis*, not to the dimensions.

This discipline is the platform's answer to "how do we handle JSONB shape evolution as new evaluators / new apps / new FHIR profiles land" without reintroducing schema-migration churn or wide-table explosion. Roadmap 03's clinical marts (`fact_patient_observation` etc.) follow this discipline natively because OMOP CDM is itself a tall-fact design.

## 5. Full rename mapping

### 5.1 Tenant plane (in `platform`)
| Current | Final |
|---|---|
| `public.tenants` | `platform.tenants` |
| `public.tenant_configs` | `platform.tenant_configurations` |

### 5.2 Identity & access (in `platform`)
| Current | Final |
|---|---|
| `public.users` | `platform.users` |
| `public.refresh_tokens` | `platform.identity_refresh_tokens` |
| `public.invite_links` | `platform.identity_invite_links` |
| `public.roles` | `platform.access_roles` |
| `public.role_app_access` | `platform.access_role_application_grants` |
| `public.role_permissions` | `platform.access_role_permissions` |

### 5.3 Application registry (in `platform`)
| Current | Final |
|---|---|
| `public.apps` | `platform.applications` |
| `public.external_agents` | `platform.application_external_agent_connectors` |
| `public.settings` | `platform.application_settings` |

### 5.4 Evaluation domain (in `platform`)
| Current | Final |
|---|---|
| `public.eval_runs` | `platform.evaluation_runs` |
| `public.thread_evaluations` | `platform.evaluation_run_thread_results` |
| `public.adversarial_evaluations` | `platform.evaluation_run_adversarial_results` |
| `public.api_logs` | `platform.evaluation_run_api_call_logs` |
| `public.eval_templates` | `platform.evaluation_templates` |
| `public.eval_reviews` | `platform.evaluation_reviews` |
| `public.eval_review_items` | `platform.evaluation_review_items` |
| `public.evaluators` | `platform.evaluators` |

### 5.5 Datasets & files (in `platform`)
| Current | Final |
|---|---|
| `public.listings` | `platform.evaluation_datasets` |
| `public.files` | `platform.application_uploaded_files` |

### 5.6 Library (in `platform`)
| Current | Final |
|---|---|
| `public.prompts` | `platform.library_prompt_definitions` |
| `public.schemas` | `platform.library_output_schema_definitions` |
| `public.adversarial_test_cases` | `platform.library_adversarial_test_cases` |
| `public.tags` | `platform.application_tags` |

### 5.7 Background jobs (in `platform`)
| Current | Final |
|---|---|
| `public.jobs` | `platform.background_jobs` |
| `public.scheduled_jobs` | `platform.scheduled_job_definitions` |
| `public.scheduler_heartbeats` | `platform.scheduler_worker_heartbeats` |

### 5.8 Chat engine (in `platform`)
| Current | Final |
|---|---|
| `public.chat_sessions` | `platform.chat_sessions` |
| `public.chat_messages` | `platform.chat_messages` |

### 5.9 Sherlock agent (in `platform`)
| Current | Final |
|---|---|
| `public.sherlock_runtime_sessions` | `platform.sherlock_agent_sessions` |
| `public.sherlock_runtime_turns` | `platform.sherlock_conversation_turns` |
| `public.sherlock_runtime_events` | `platform.sherlock_turn_events` |
| `public.sherlock_ontology_classes` | `platform.sherlock_ontology_classes` |
| `public.sherlock_entity_types` | `platform.sherlock_ontology_entity_types` |
| `public.sherlock_resolvers` | `platform.sherlock_entity_resolvers` |
| `public.agent_tool_logs` | `analytics.log_sherlock_tool_call` (also moves schema) |

### 5.10 Analytics — moved AND renamed (role-prefixed)
| Current | Final |
|---|---|
| `public.analytics_run_facts` | `analytics.agg_evaluation_run` |
| `public.analytics_eval_facts` | `analytics.fact_evaluation` |
| `public.analytics_criterion_facts` | `analytics.fact_evaluation_criterion` |
| `public.analytics_jobs` | `analytics.log_fact_population_run` |
| `public.analytics_query_cache` | `analytics.cache_sql_query` |
| `public.evaluation_analytics` | **dropped** |
| `public.analytics_charts` | `platform.analytics_saved_charts` (stays in OLTP — user-owned config) |
| `public.analytics_dashboards` | `platform.analytics_saved_dashboards` (stays in OLTP — user-owned config) |

### 5.11 Reports & history (in `platform`)
| Current | Final |
|---|---|
| `public.report_configs` | `platform.report_configurations` |
| `public.report_runs` | `platform.report_generation_runs` |
| `public.report_artifacts` | `platform.report_generated_artifacts` |
| `public.history` | `platform.application_event_history` |

### 5.12 CRM source mirror (moved to `analytics`)
| Current | Final |
|---|---|
| `public.source_call_records` | `analytics.crm_call_record` |
| `public.source_lead_records` | `analytics.crm_lead_record` |
| `public.source_sync_runs` | `analytics.log_crm_source_sync` |

### 5.13 LLM cost / observability (moved to `analytics`, role-prefixed)
| Current | Final |
|---|---|
| `public.llm_usage` | `analytics.fact_llm_generation` |
| `public.llm_usage_daily_rollup` | `analytics.agg_llm_usage_daily` |
| `public.model_pricing` | `analytics.ref_llm_model_pricing` |
| `public.model_aliases` | `analytics.ref_llm_model_alias` |
| `public.models_dev_catalog` | `analytics.ref_llm_models_catalog` |
| `public.models_dev_snapshots` | `analytics.snapshot_llm_models_catalog` |

### 5.14 Audit (in `platform`)
| Current | Final |
|---|---|
| `public.audit_log` | `platform.audit_event_logs` |

## 6. Inside-sales durable history — 4 new tables

Lives in `analytics`. Tenant + app partitioned. App-generic — name carries `lead_*`, not `inside_sales_*`. Future CRM-backed apps reuse the same data mode.

### 6.1 `analytics.dim_lead` (was `analytics_lead_roster_facts`)

Dimension — one row per lead per tenant/app. Mutable `latest_stage` pointer.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID, FK → `platform.tenants` | NOT NULL |
| `app_id` | VARCHAR(64) | NOT NULL |
| `lead_id` | VARCHAR(128) | NOT NULL — LSQ prospect_id (or equivalent external id) |
| `source` | VARCHAR(64) | NOT NULL — e.g. `'leadsquared'` |
| `source_ref` | VARCHAR(128) | NULLABLE — original source id if different |
| `lsq_created_on` | TIMESTAMPTZ | NULLABLE — authoritative lead-creation time from source |
| `first_seen_at` | TIMESTAMPTZ | NOT NULL — when this platform first observed the lead |
| `latest_stage_observed` | VARCHAR(128) | NULLABLE — denormalized pointer updated by leads sync |
| `latest_stage_observed_at` | TIMESTAMPTZ | NULLABLE |
| `attributes_at_first_seen` | JSONB | NOT NULL DEFAULT `'{}'` |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

- **Uniqueness:** `UNIQUE (tenant_id, app_id, lead_id)`.
- **Indexes:** `(tenant_id, app_id, lsq_created_on DESC)`, `(tenant_id, app_id, first_seen_at DESC)`.
- **Write mode:** Upsert ON CONFLICT (tenant_id, app_id, lead_id) DO UPDATE SET latest_stage_observed = EXCLUDED.latest_stage_observed, latest_stage_observed_at = EXCLUDED.latest_stage_observed_at, updated_at = now(). `first_seen_at` and `attributes_at_first_seen` never change after insert.

### 6.2 `analytics.fact_lead_stage_transition` (was `analytics_lead_stage_facts`)

Fact at stage-transition grain. Append-only.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID | NOT NULL |
| `app_id` | VARCHAR(64) | NOT NULL |
| `lead_id` | VARCHAR(128) | NOT NULL |
| `from_stage` | VARCHAR(128) | NULLABLE — NULL on first-observation row |
| `to_stage` | VARCHAR(128) | NOT NULL |
| `detected_at` | TIMESTAMPTZ | NOT NULL — sync-cycle start timestamp that detected the change |
| `transition_at` | TIMESTAMPTZ | NULLABLE — reserved for future webhook-derived rows. Always NULL in v1. |
| `sync_run_id` | UUID, FK → `analytics.log_crm_source_sync` | NULLABLE |
| `attributes` | JSONB | NOT NULL DEFAULT `'{}'` |
| `created_at` | TIMESTAMPTZ | |

- **Indexes:** `(tenant_id, app_id, lead_id, detected_at DESC)`, `(tenant_id, app_id, detected_at DESC)`, `(tenant_id, app_id, to_stage, detected_at)`.
- **No unique constraint on value.** Idempotency guarded by stage-detector's "new stage != latest known stage" read before write.
- **Column comment on `detected_at`:** "observation time; real transition happened at or before this timestamp, bounded by the prior detection."

### 6.3 `analytics.fact_lead_activity` (was `analytics_lead_activity_facts`)

Fact at activity grain. Includes call activities (duplicating rows in `analytics.crm_call_record` at a different grain) plus all other LSQ ProspectActivity types. Append-only.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID | NOT NULL |
| `app_id` | VARCHAR(64) | NOT NULL |
| `lead_id` | VARCHAR(128) | NOT NULL |
| `source_activity_id` | VARCHAR(128) | NOT NULL — LSQ ProspectActivityId |
| `activity_type` | VARCHAR(64) | NOT NULL — normalized: `call` / `email` / `web` / `sms` / `form_submit` / `custom` / `revenue` |
| `activity_subtype` | VARCHAR(128) | NULLABLE — e.g. `'inbound_call'`, `'outbound_call'` |
| `source_event_code` | INTEGER | NULLABLE — LSQ `ActivityEvent` numeric code |
| `occurred_at` | TIMESTAMPTZ | NOT NULL — LSQ `ActivityDateTime` |
| `actor_type` | VARCHAR(32) | NULLABLE — `agent` / `lead` / `system` |
| `actor_id` | VARCHAR(128) | NULLABLE |
| `attributes` | JSONB | NOT NULL DEFAULT `'{}'` |
| `sync_run_id` | UUID, FK → `analytics.log_crm_source_sync` | NULLABLE |
| `created_at` | TIMESTAMPTZ | |

- **Uniqueness:** `UNIQUE (tenant_id, app_id, source_activity_id)`.
- **Indexes:** `(tenant_id, app_id, lead_id, occurred_at DESC)`, `(tenant_id, app_id, activity_type, occurred_at DESC)`, `(tenant_id, app_id, occurred_at DESC)`.
- **Write mode:** Upsert ON CONFLICT (tenant_id, app_id, source_activity_id) DO NOTHING.

### 6.4 `analytics.fact_lead_signal` (was `analytics_lead_signal_facts`)

Fact at signal grain. One row per LLM-extracted signal from an evaluated call. Delete-then-insert per `eval_run_id`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID | NOT NULL |
| `app_id` | VARCHAR(64) | NOT NULL |
| `eval_run_id` | UUID, FK → `platform.evaluation_runs` | NOT NULL |
| `thread_evaluation_id` | UUID, FK → `platform.evaluation_run_thread_results` | NOT NULL |
| `lead_id` | VARCHAR(128) | NULLABLE |
| `source_activity_id` | VARCHAR(128) | NULLABLE |
| `signal_type` | VARCHAR(64) | NOT NULL — controlled vocabulary (§7) |
| `signal_value` | VARCHAR(128) | NULLABLE — canonical short value |
| `signal_value_numeric` | NUMERIC | NULLABLE |
| `signal_at` | TIMESTAMPTZ | NULLABLE — e.g. committed-followup datetime |
| `confidence` | NUMERIC | NULLABLE — 0..1 |
| `supporting_quote` | TEXT | NULLABLE |
| `ordinal` | INTEGER | NOT NULL DEFAULT 0 |
| `attributes` | JSONB | NOT NULL DEFAULT `'{}'` |
| `created_at` | TIMESTAMPTZ | |

- **Uniqueness:** `UNIQUE (tenant_id, app_id, eval_run_id, thread_evaluation_id, signal_type, ordinal)`.
- **Indexes:** `(tenant_id, app_id, eval_run_id)`, `(tenant_id, app_id, lead_id, signal_type, signal_at)`, `(tenant_id, app_id, signal_type, created_at DESC)`.
- **Write mode:** Delete existing rows for `eval_run_id`, then bulk-insert.

## 7. Signal taxonomy (controlled vocabulary, v1)

Lives as a Python constant set in `backend/app/services/analytics/signal_taxonomy.py`. Populator validates `signal_type` against it; unknown values are coerced to `other_notable_signal` with the raw label preserved in `attributes.signal_type_raw`.

**Commitments & next steps**
- `followup_call_commitment`, `info_send_commitment`, `payment_link_commitment`, `onboarding_link_commitment`, `home_visit_commitment`, `video_consult_commitment`, `callback_request`

**Intent & stage progression**
- `purchase_intent` (values: `hot` / `warm` / `cold`)
- `enrollment_intent`
- `decision_maker_status` (values: `self` / `needs_spouse` / `needs_family` / `needs_doctor`)
- `decision_timeline` (values: `immediate` / `this_week` / `this_month` / `unclear` / `never`)
- `budget_signal` (values: `can_afford` / `needs_emi` / `too_expensive` / `not_discussed`)

**Objections**
- `objection` with `signal_value` ∈ `{price, spouse_consent, doctor_trust, medication_skepticism, already_tried, already_enrolled_elsewhere, time, clinical_doubt, privacy, language_barrier}`

**Qualification & correction**
- `condition_confirmed`, `condition_denied`, `current_treatment_status`, `preferred_language`, `preferred_contact_window`, `alternate_contact`, `wrong_number`, `do_not_call_request`

**Outcome & relationship**
- `outcome` (values: `interested` / `not_interested` / `needs_time` / `already_enrolled` / `wrong_number` / `rnr` / `dnc`)
- `sentiment` (`signal_value_numeric`: signed score −1..1)
- `rapport_level` (values: `high` / `medium` / `low`)
- `escalation_needed`

**Freeform capture**
- `other_notable_signal` with `attributes.signal_type_raw`

## 8. Population rules

### 8.1 Leads sync side-effect (roster + stage diff)

In `backend/app/services/inside_sales_sync.py`, in the leads sync path, after the existing upsert into `analytics.crm_lead_record` and **within the same transaction**:

1. Upsert `analytics.dim_lead` for each lead row just written. `ON CONFLICT (tenant_id, app_id, lead_id) DO UPDATE` refreshes `latest_stage_observed` / `latest_stage_observed_at` / `updated_at` only.
2. For each lead row, read the latest row in `analytics.fact_lead_stage_transition` for `(tenant, app, lead_id)`. If no row exists, insert `(from_stage=NULL, to_stage=<current>, detected_at=cycle_start)` when current stage is non-null. If a row exists and its `to_stage` differs from current, insert `(from_stage=<prior to_stage>, to_stage=<current>, detected_at=cycle_start)`. If equal, no-op.
3. All writes share one transaction. Partial failure rolls back the cycle.

### 8.2 Calls sync side-effect (activity capture)

In the calls sync path, after the existing upsert into `analytics.crm_call_record`, within the same transaction:

1. For each call activity, upsert `analytics.fact_lead_activity` with `activity_type='call'`, `activity_subtype` derived from LSQ event code (`'inbound_call'` for 21, `'outbound_call'` for 22), and the full normalized LSQ payload in `attributes`. `ON CONFLICT (tenant_id, app_id, source_activity_id) DO NOTHING`.

### 8.3 Activities sync (new `source_family='activities'`)

New path in `inside_sales_sync.py`. Runs only when `job.params.source_family == 'activities'`.

1. Pull LSQ ProspectActivities via existing `fetch_*` helpers. Event codes: every code present in tenant's `ActivityTypes.Get` response except call codes 21 and 22 (already captured by calls sync). Allowlist configurable via scheduler workload `params`.
2. For each pulled activity, upsert `analytics.fact_lead_activity`. No Layer 1 write.
3. Same 7d window semantics as other families. Prune does not apply to facts.

### 8.4 `populate-analytics` signal extractor

In `backend/app/services/analytics/fact_populator.py`:

1. Add a new `SignalExtractor` class sibling to existing run/eval/criterion extractors.
2. For each `evaluation_run_thread_results` child of the eval run, read `result.signals` (a JSONB array; absent or empty → skip).
3. For each signal entry, emit one `analytics.fact_lead_signal` row. `lead_id` and `source_activity_id` resolved from the thread evaluation's underlying call. `ordinal` is array index.
4. Delete-then-insert per `eval_run_id`.
5. Runs inside the existing `populate-analytics` job; no new job type.

### 8.5 LLM extraction schema extension

In `backend/app/services/evaluators/inside_sales_runner.py`, extend the **runtime structured-output schema** with a `signals` array:

1. **Do not rely on manually editing persisted evaluator records.** The runner currently builds JSON Schema from each evaluator's stored `output_schema` via `generate_json_schema(output_schema)`. For Phase `0018`, build a runtime-only augmented schema copy and append a required top-level `signals` field **before** calling `generate_json_schema()`.
2. **Do not mutate the original stored `output_schema` used for scoring / visible breakdown.** `primary_score()` and summary helpers continue to use the evaluator's original rubric fields only.
3. Each evaluator response therefore returns its normal rubric output **plus** a top-level `signals` array. Missing / null values are normalized to `[]`.
4. Because one call may run through multiple evaluators, the runner must merge + de-duplicate all per-evaluator `signals` arrays into one canonical `platform.evaluation_run_thread_results.result.signals` array at the persisted thread-result top level.
5. `result.signals` is the **authoritative analytics contract** consumed by `populate-analytics`. Nested per-evaluator copies may remain in `result.evaluations[*].output.signals`, but downstream extractors do not read them.

The augmented `signals` array shape is:

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

Every entry conforms 1:1 to `analytics.fact_lead_signal` row shape. Unknown-unknowns use `signal_type='other_notable_signal'` with freeform `attributes.signal_type_raw`. Additive to the existing result contract — no existing rubric field is renamed or dropped. The persisted thread-result shape after this phase is therefore:

```json
{
  "evaluations": [
    {
      "evaluator_id": "...",
      "evaluator_name": "...",
      "output": {
        "...existing rubric fields...": "...",
        "signals": [ "...per-evaluator extraction..." ]
      }
    }
  ],
  "signals": [ "...canonical merged/deduped thread-level signals..." ],
  "transcript": "...",
  "call_metadata": { "...": "..." },
  "source_snapshot": { "...": "..." }
}
```

## 9. Migration plan

### 9.1 Release choreography (mandatory for the rename chain)

This roadmap assumes a **maintenance-window / traffic-drained cutover** for every breaking schema or table rename revision. Mixed old/new application versions are not supported during this chain.

**Current prod deploy shape (verified against `.github/workflows/`):** one Azure Container App `ai-evals-be-prod` (`backend/`) and one Azure Container App `ai-evals-fe-prod` (frontend), deployed by their respective `*AutoDeployTrigger*.yml` workflows. There is **no separate prod worker deploy pipeline**. Combined with the `JOB_RUN_EMBEDDED_WORKER=True` default in `backend/app/config.py`, prod today runs an embedded worker inside the backend container unless overridden by environment variable. Any rename-chain choreography that names a "worker container" must be read as "the backend container's embedded worker" until a dedicated worker deploy is added.

Cutover steps for each breaking revision:

1. Drain backend traffic on `ai-evals-be-prod` (scale to zero or move behind a maintenance gate). The embedded worker stops with it.
2. Run Alembic exactly once from a release job / one-off task (e.g., a manual `az containerapp job` execution against the prod DB, or a temporary `RUN_MIGRATIONS=true` startup of a single ephemeral revision with traffic disabled).
3. Run post-migration smoke checks before serving traffic.
4. Roll forward the new backend image only after the migration succeeds.

Practical implication for `RUN_MIGRATIONS`: for breaking revisions, set `RUN_MIGRATIONS=false` on the steady-state Container App and execute Alembic from the release step. **Phase 1 (this groundwork PR) does not flip the default** — the entrypoint default stays at `RUN_MIGRATIONS=true` because Phase 1 ships no breaking revisions. The flip happens in the PR that introduces revision `0006`.

After the rename chain is complete, the team can decide whether to restore boot-time `alembic upgrade head` for non-breaking revisions, or to keep the release-step path as the canonical migration mechanism.

### 9.2 Roles and grants

```sql
CREATE ROLE analytics_reader NOLOGIN;

GRANT USAGE ON SCHEMA analytics TO analytics_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO analytics_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  GRANT SELECT ON TABLES TO analytics_reader;

ALTER ROLE analytics_reader SET statement_timeout = '30s';
ALTER ROLE analytics_reader SET work_mem = '256MB';
ALTER ROLE analytics_reader SET idle_in_transaction_session_timeout = '60s';
```

The existing app role retains full access to both `platform` and `analytics` schemas.

Database default `search_path` during the transition:

```sql
ALTER DATABASE <db_name> SET search_path = platform, public, analytics;
```

`public` stays in the path until revisions `0008+` move the remaining transitional tables out of `public`. This is for interactive `psql` / GUI use only. **Application code schema-qualifies every reference per §9.6 — no code path may rely on `search_path`.**

### 9.3 Alembic revision sequence

Assumption: the current head remains `0004_drop_inside_sales_cols`. If another revision lands first, increment the IDs below but preserve the order and scope.

| Revision | Scope | Risk |
|---|---|---|
| `0005` | Create `platform` schema. No table moves yet. | Low |
| `0006` | Move all 43 application/OLTP tables from `public` to `platform`. **Leave `public.alembic_version` in place.** Update database default `search_path`. | Medium — universal schema move, but no Alembic version-table relocation |
| `0007` | Create `analytics` schema + `analytics_reader` role + grants. | Low |
| `0008` | Move analytics-adjacent tables to `analytics` **without renaming them yet** (`analytics_*`, `source_*`, `llm_*`, `model_*`, `agent_tool_logs`). | Medium — wide blast radius, schema move only |
| `0009` | Rename moved analytics tables to their final role-prefixed names from §5.10–§5.13. Keep `evaluation_analytics` alive for now. | Medium |
| `0010` | Remove final readers of `evaluation_analytics`, then drop `evaluation_analytics`. | Low |
| `0011` | Sherlock domain rename within `platform` (`sherlock_runtime_*` → `sherlock_agent_*`, etc.) | Low |
| `0012` | Evaluation domain rename within `platform` (`eval_runs`, `thread_evaluations`, `adversarial_evaluations`, `api_logs`, `eval_templates`, `eval_reviews`, `eval_review_items`) | High — core entity, wide backend reach |
| `0013` | Reports + history rename (`report_*`, `history`) | Medium |
| `0014` | Library + datasets + uploads + tags rename (`prompts`, `schemas`, `adversarial_test_cases`, `listings`, `files`, `tags`) | Medium |
| `0015` | Application registry rename (`apps`, `external_agents`, `settings`) | Medium |
| `0016` | Tenants + audit + jobs rename (`tenant_configs`, `audit_log`, `jobs`, `scheduled_jobs`, `scheduler_heartbeats`) | Medium — worker-sensitive |
| `0017` | IAM rename (`refresh_tokens`, `invite_links`, `roles`, `role_*`) | High — auth-path |
| `0018` | Inside-sales tables (`dim_lead`, `fact_lead_stage_transition`, `fact_lead_activity`, `fact_lead_signal`) created with final names directly in `analytics` | Low |

Each revision stays narrow: one schema move or one domain rename group. `SET SCHEMA` and `RENAME` operations are still metadata-only, but the chain avoids bundling multiple blast-radius changes into one release. Reversible per revision.

### 9.4 Revision 0006 SQL sketch (move app tables to `platform`, keep Alembic in `public`)

```sql
-- 0005 already created the schema.

-- Move all 43 OLTP/application tables (one ALTER each)
ALTER TABLE public.tenants SET SCHEMA platform;
ALTER TABLE public.tenant_configs SET SCHEMA platform;
ALTER TABLE public.users SET SCHEMA platform;
-- ... (40 more — every application table currently in public)

-- Leave public.alembic_version untouched.

-- Set the database default search_path for interactive use
ALTER DATABASE :db_name SET search_path = platform, public, analytics;
```

Locking: each `ALTER TABLE ... SET SCHEMA` takes a brief `ACCESS EXCLUSIVE` lock. Sub-second per table; bundle the migration in a worker-quiet maintenance window. Whole revision under one transaction.

Downgrade: symmetric — move the application tables back to `public`. `public.alembic_version` never moved, so there is no version-table cutover risk in either direction.

### 9.5 SQLAlchemy model setup

After revision `0006` lands, every OLTP/application ORM model gets `__table_args__ = {"schema": "platform"}`. After revisions `0008` + `0009`, the moved analytics models get `{"schema": "analytics"}` and their final `__tablename__` values.

**Schema-qualified FKs.** Cross-schema FKs (analytics-schema models pointing at `platform.tenants`, `platform.evaluation_runs`, etc.) require schema-qualified string ForeignKeys: `ForeignKey("platform.tenants.id")`. Postgres preserves FK definitions across `SET SCHEMA` — no FK rewrites in the migration body.

Enable schema-aware autogenerate in `alembic/env.py`:

```python
context.configure(
    connection=connection,
    target_metadata=target_metadata,
    include_schemas=True,
    version_table_schema='public',
    include_object=_skip_system_objects,
)
```

`public.alembic_version` remains the Alembic bookkeeping location. This plan does **not** schedule a later phase to move it into `platform`, and no later roadmap assumes such a move. Treat `public` as the permanent home of Alembic bookkeeping unless a separate future admin-only decision explicitly changes that.

Single Alembic head. No fork.

### 9.6 Schema-aware refactor (must precede revision `0006`)

Before revision `0006` runs in prod, the manifest stack and helpers must accept arbitrary schema names. Files to update:

- `backend/app/services/chat_engine/manifest.py`
- `backend/app/services/chat_engine/manifest_validator.py`
- `backend/app/services/chat_engine/comment_emitter.py`
- `backend/app/services/chat_engine/catalog_tools.py`
- `backend/app/services/chat_engine/result_set_typer.py`
- `backend/app/services/chat_engine/sql_agent.py`
- `backend/app/services/report_builder/analytics/vocabulary.py`

These currently assume `public` or a simple `table.column` shape. Teach them to accept `schema.table.column` and to treat `platform` and `analytics` as legitimate sources during the chain. During the transition, `public` remains valid only for Alembic bookkeeping and any still-unmoved tables.

**Do not rely on `search_path`. Schema-qualify everywhere** in application code, raw SQL, and manifests. The database default `search_path` exists only for interactive `psql` use.

The `manifest_validator` is extended to:
1. Reject any unqualified table name in a manifest.
2. Warn if a manifest references a table whose actual live-catalog schema does not match the declaration.

### 9.7 Sherlock SQL-agent manifests

After revision `0009` ships and onward, schema-qualify physical tables in `backend/app/services/chat_engine/manifests/<app-id>.yaml`. Cross-schema joins (e.g. `analytics.fact_evaluation` joins `platform.evaluation_runs`) are native SQL — no special handling once identifier plumbing is fixed.

Per CLAUDE.md invariants:
- Edit YAML manifests; let `tool_description_generator`, `prompt_generator`, `comment_emitter` propagate.
- The `TOOLS` block in `prompts/base.py` and `apps.config.chat.dataSurfaces` are not hand-edited.

### 9.8 Optional `analytics_engine` (deferred to a follow-up PR)

For extra safety on the Sherlock execution path, add a second SQLAlchemy engine using the `analytics_reader` role. Used only by the existing `analytics_session` / SQL-agent execution path. Optional; not load-bearing for correctness.

### 9.9 Dependencies between this roadmap and follow-on roadmaps

Explicit dependency callouts so the chain is unambiguous:

| Item | Depends on |
|---|---|
| Revision `0006` (move app tables `public` → `platform`) | §9.6 schema-aware refactor merged first. §9.1 release choreography in place. |
| Revision `0008` (move analytics-adjacent tables into `analytics`) | Revision `0006` applied. ORM models updated to `__table_args__ = {"schema": "platform"}`. |
| Revision `0009` (rename moved analytics tables) | Revision `0008` applied. All direct readers/writers inventory complete. |
| Revisions `0011`–`0017` (per-domain renames within `platform`) | Revision `0009` applied. Each is independently shippable after `0009`. |
| Revision `0018` (inside-sales fact tables) | All renames (`0011`–`0017`) applied — guarantees fact tables are born under final FK targets. |
| **Roadmap 02** (pgvector + retrieval substrate) | Revision `0018` applied. `analytics` schema is the install target for the `pgvector` extension (`CREATE EXTENSION pgvector SCHEMA analytics`). |
| **Roadmap 03** (`clinical` schema for FHIR) | Roadmap 02 fully shipped. |

## 10. Decisions locked before execution

1. **Rename decisions are now locked based on current code usage:**
   - `history` → `application_event_history`
   - `settings` → `application_settings`
   - `files` → `application_uploaded_files`
   - `tags` → `application_tags`
2. **`fact_llm_generation` placement.** `analytics`. Locked.
3. **`log_sherlock_tool_call` placement.** `analytics`. Locked.
4. **Optional `analytics_engine`.** Deferred to a follow-up PR.
5. **Frontend coordination:** API payloads carrying table names (analytics chart specs, manifests over the wire). Audit `src/services/api/*.ts` and `src/features/analytics/` per revision.
6. **Activity event-code allowlist** for inside-sales activities sync — operator picks consciously via workload `params`.
7. **Extension installation target** (forward-looking for Roadmap 02). Install `pgvector` in `analytics`. No `extensions` schema. Locked.
8. **Database default `search_path`.** `platform, public, analytics` during the transition; tighten only when the remaining non-bookkeeping public tables are gone. Locked.
9. **`public` handling.** Keep `public.alembic_version`; do not attempt to move it or drop `public` as part of this chain. No later phase in Roadmap 01, Roadmap 02, or Roadmap 03 assumes `alembic_version` moves to `platform`.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `ALTER TABLE ... SET SCHEMA` locks a hot table | Pause worker during migration window; sub-second lock per ALTER. |
| Mixed-version backend/worker deploys hit renamed tables mid-rollout | Use the mandatory release choreography in §9.1. Old and new builds do not overlap during breaking revisions. |
| Raw-SQL strings reference bare table names and break post-move | Grep + manifest validator assertion + CI grep test. |
| `public` referenced by an extension or third-party tool | Pre-revision-0006 audit: list extensions (`SELECT * FROM pg_extension`) and dependent tools; confirm none depend on application tables living in `public`. None expected today since pgvector / AGE are not yet installed. |
| Someone tries to move `alembic_version` or drop `public` mid-chain | Explicitly out of scope for Roadmap 01 and not required by later roadmaps. Keep `public.alembic_version` fixed unless a separate future admin-only decision changes that. |
| Search-path drift silently re-routes queries | Schema-qualify everywhere in code. Database default `search_path` is for interactive use only. Documented in CLAUDE.md addendum. |
| Alembic autogen churn after enabling `include_schemas` | First revision scripts schema moves explicitly; future autogens stable once baseline set. |
| Sherlock manifest drift after rename/move | `manifest_validator` cross-checks live catalog at boot. |
| Frontend hard-codes table names | Audit per revision; rename atomically with backend. |
| Constraint and index names embed old table name | Renaming an index/constraint is metadata-only; included in each revision. |
| Stage granularity is 6h (sync cadence) | `transition_at` column reserved for future webhook path. |
| Roster coverage is leading-edge only | Operators told first time they ask a historical question. "Coverage from" badge as follow-up. |
| Retention unbounded in v1 | Append-only growth. Document retention prune as v2 scheduled workload. |
| Signal taxonomy drift (LLM emits values outside vocabulary) | Coerce to `other_notable_signal`; review `signal_type_raw` frequencies to drive vocabulary expansion. |

## 12. Files touched

### Backend — new
- `backend/alembic/versions/0005_*.py` through `0018_*.py`
- `backend/app/models/analytics_lead_facts.py` — four ORM models (`DimLead`, `FactLeadStageTransition`, `FactLeadActivity`, `FactLeadSignal`)
- `backend/app/services/analytics/signal_taxonomy.py`
- `backend/app/services/analytics/signal_extractor.py`
- Tests: `test_analytics_dim_lead_sync_unittest.py`, `test_analytics_fact_lead_stage_detector_unittest.py`, `test_analytics_fact_lead_activity_sync_unittest.py`, `test_analytics_fact_lead_signal_extractor_unittest.py`, `test_inside_sales_signals_output_unittest.py`

### Backend — changed
- `backend/app/models/__init__.py` — export new models, update `__tablename__` per rename revision, add `__table_args__ = {"schema": "platform" | "analytics"}`.
- `backend/app/services/inside_sales_sync.py` — transactional side-effects for leads, calls, new activities path; reference final table names.
- `backend/app/services/evaluators/inside_sales_runner.py` — append a runtime-only required `signals` field before `generate_json_schema()`, then persist canonical top-level `result.signals`.
- `backend/app/services/analytics/fact_populator.py` — register `SignalExtractor`; reference final table names.
- `backend/app/services/chat_engine/manifests/inside-sales.yaml` — add four new table blocks + vocabulary labels. Schema-qualify all references.
- `backend/app/services/chat_engine/manifests/<other-app>.yaml` — schema-qualify renamed tables.
- `backend/app/services/chat_engine/manifest.py`, `manifest_validator.py`, `comment_emitter.py`, `catalog_tools.py`, `result_set_typer.py`, `sql_agent.py`, `report_builder/analytics/vocabulary.py` — schema-aware refactor.
- `backend/app/services/scheduler/workloads.py` — add `'activities'` to inside-sales workload's allowed `source_family` values.
- `alembic/env.py` — `include_schemas=True`, `version_table_schema='public'` (✅ shipped in Phase 1).
- `backend/entrypoint.sh` and/or deploy release automation — disable steady-state auto-migration during the rename chain; run Alembic from the release step. Note: prod has no dedicated worker container today; the backend Container App runs the embedded worker (see §9.1). When the rename chain ships, set `RUN_MIGRATIONS=false` on `ai-evals-be-prod` and run Alembic from a one-off release task.
- `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` — registry update with final names.

### Frontend
- Audit `src/services/api/*.ts` and `src/features/analytics/` per revision for hard-coded table names.

## 13. Invariants

- Every SELECT/UPDATE/DELETE on analytics tables scopes on `(tenant_id, app_id)` where the columns exist. Tests must assert this.
- Layer 1 prune (rolling 7d source records — `analytics.crm_*_record`) MUST NOT touch any fact / aggregate / dim table. Prune scope stays `crm_*_record` only.
- `analytics.fact_lead_stage_transition.detected_at` is observation time, not transition time. Column comment is load-bearing.
- `analytics.fact_lead_signal` is the only inside-sales fact using delete-then-insert. The other three are append-only.
- `platform.evaluation_run_thread_results.result.signals` is the canonical thread-level signal payload consumed by analytics. It is produced by runtime schema augmentation + merge/de-dupe inside `inside_sales_runner.py`, not by manual evaluator-record edits.
- Signal extraction never triggers an LLM call at populator time. Re-running `populate-analytics` reads only from `platform.evaluation_run_thread_results.result.signals`.
- Sync-side side-effects share the sync transaction. No separate transaction commits.
- No app name (`inside-sales`, `kaira-bot`) appears in any new table, column, index, or service module except the scheduler workload registry.
- `public` exists only as the home of `public.alembic_version` once the remaining transitional tables have moved out. Any application-domain table left in `public` after its planned move revision is a bug.
- Application code schema-qualifies every reference; no code path relies on `search_path`.
- Single Alembic head throughout the rename chain.

## 14. Query patterns Sherlock must answer post-roadmap

### 14.1 Did agents follow up on calls they were supposed to?

```sql
WITH expected AS (
  SELECT s.lead_id, s.signal_at AS expected_at, s.supporting_quote
  FROM analytics.fact_lead_signal s
  WHERE s.tenant_id = :t AND s.app_id = :a
    AND s.signal_type = 'followup_call_commitment'
    AND s.signal_at IS NOT NULL
    AND s.signal_at <= now()
),
actual AS (
  SELECT a.lead_id, a.occurred_at
  FROM analytics.fact_lead_activity a
  WHERE a.tenant_id = :t AND a.app_id = :a
    AND a.activity_type = 'call' AND a.actor_type = 'agent'
)
SELECT
  e.lead_id, e.expected_at,
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

### 14.2 New leads by day — contacted same-day / +1 / +2

```sql
WITH new_leads AS (
  SELECT lead_id, lsq_created_on::date AS created_day
  FROM analytics.dim_lead
  WHERE tenant_id = :t AND app_id = :a
    AND lsq_created_on >= :from_date
),
first_contact AS (
  SELECT DISTINCT ON (lead_id) lead_id, occurred_at::date AS contacted_day
  FROM analytics.fact_lead_activity
  WHERE tenant_id = :t AND app_id = :a
    AND activity_type = 'call' AND actor_type = 'agent'
  ORDER BY lead_id, occurred_at ASC
)
SELECT
  n.created_day,
  COUNT(*) AS new_leads,
  COUNT(f.lead_id) FILTER (WHERE f.contacted_day = n.created_day) AS same_day,
  COUNT(f.lead_id) FILTER (WHERE f.contacted_day = n.created_day + 1) AS plus_1,
  COUNT(f.lead_id) FILTER (WHERE f.contacted_day = n.created_day + 2) AS plus_2,
  COUNT(*) - COUNT(f.lead_id) AS never_contacted
FROM new_leads n
LEFT JOIN first_contact f USING (lead_id)
GROUP BY n.created_day
ORDER BY n.created_day DESC;
```

### 14.3 How long do leads sit in each stage?

```sql
SELECT
  lead_id, to_stage, detected_at AS entered_at,
  LEAD(detected_at) OVER (PARTITION BY tenant_id, app_id, lead_id ORDER BY detected_at) AS exited_at
FROM analytics.fact_lead_stage_transition
WHERE tenant_id = :t AND app_id = :a;
```

## 15. Execution appendix — per-revision operating discipline

### 15.1 Preflight checklist

Before each revision in the chain:

1. Confirm the repo still has a single Alembic head and that the planned revision ID sequence still matches the current head.
2. Inventory every direct reader/writer of the tables in scope (ORM, raw SQL, manifests, seeders, admin/report paths, frontend payloads).
3. Run grep assertions for the old physical names and decide which references must disappear in the same release.
4. Confirm release choreography is configured: worker paused, backend traffic drain ready, one-off Alembic runner ready, `RUN_MIGRATIONS=false` on steady-state containers.
5. For schema-move revisions, capture preflight row counts for every moved table.

### 15.2 Cutover sequence

For every breaking revision group:

1. Drain backend traffic and pause workers.
2. Run the Alembic revision once from the release job.
3. Run smoke checks before opening traffic.
4. Start the new backend and worker build.
5. Watch errors, job execution, and query logs before ending the maintenance window.

### 15.3 Postflight checks

- Row counts match for every moved table.
- App boot succeeds and auth, job submission, and report generation still work.
- `manifest_validator` passes against the live catalog.
- Sherlock can execute at least one representative cross-schema query.
- Grep surfaces and manifests no longer reference the retired physical names for that release.

### 15.4 Rollback rule

- If the Alembic revision fails, the transaction rolls back; keep traffic on the old build and fix forward before retrying.
- If the revision succeeds but smoke checks fail due to missed code references, keep traffic drained and either downgrade that revision or ship the smallest forward fix before reopening.
- Never reopen traffic with mixed old/new builds across breaking rename revisions.

## 16. Effort estimate

| Revision | Estimate |
|---|---|
| 0005–0006 (`platform` schema prep + app-table move) | ~1 day |
| 0007–0010 (`analytics` schema, moves, rename, legacy cache drop) | ~1.5 days |
| 0011 Sherlock | ~3 h |
| 0012 Evaluation | ~6 h |
| 0013 Reports + history | ~3 h |
| 0014 Library + datasets + uploads + tags | ~5 h |
| 0015 Application registry | ~4 h |
| 0016 Tenants + audit + jobs | ~4 h |
| 0017 IAM | ~5 h |
| 0018 Inside-sales facts + populator + manifest | ~2 days |

**Total: roughly 8 focused days** spread over multiple PRs/releases. Each revision independently shippable; rollback symmetric.

## 17. Acceptance for Roadmap 01 done

- All planned Alembic revisions (`0005`–`0018`, or the same ordered chain with incremented IDs if another head landed first) applied to prod.
- `public` contains no application-domain tables in prod. `public.alembic_version` remains there as the Alembic bookkeeping table.
- Breaking revisions shipped via the release choreography in §9.1 / §15 rather than mixed-version rolling cutover.
- Database default `search_path` is consistent with the actual schema state (`platform, public, analytics` during the transition; `platform, analytics` only after the remaining non-bookkeeping public tables have moved).
- CLAUDE.md / AGENTS.md / `.github/copilot-instructions.md` registry updated with final schema-qualified names.
- Sherlock manifest validator passes against the live catalog.
- The four inside-sales tables exist in `analytics` under final names (`dim_lead`, `fact_lead_stage_transition`, `fact_lead_activity`, `fact_lead_signal`) and receive sync side-effects.
- Sherlock answers the three query patterns in §14 end-to-end.
- `evaluation_analytics` removed from prod.

When all of those are true, **Roadmap 02 (vectors + graph) starts.**

## 18. What this roadmap does not commit to

- No vector tables. Roadmap 02 territory.
- No FHIR tables. Roadmap 03 territory.
- No new top-level schemas beyond `platform` and `analytics`. Roadmap 03 will add a third (`clinical`) and that is the upper bound.
- No attempt to move `alembic_version` out of `public`. This roadmap treats `public` as the permanent Alembic bookkeeping schema.
- No `extensions` schema. Extensions install into `analytics` when needed (Roadmap 02 installs `pgvector` there).
- No JSONB flattening / registry / semantic-view YAML refactor. Deferred.
- No warehouse migration. Downstream of Roadmap 02 thresholds.
- No retention policy on the four new fact tables (deferred to v2).
- No webhook-driven stage-change ingestion (schema reserves `transition_at` column; not implemented).
- No UI surfaces for browsing signals on eval-detail page (follow-up).
- No cross-tenant analytics. Tenant scoping is absolute.
