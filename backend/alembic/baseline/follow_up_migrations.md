# Follow-up Migrations — 2026-04-27

Post-baseline migrations needed to bring prod to parity with the (corrected) models. These ship in Phase 3 (`feat/alembic-phase-3-catchup-migrations`), each as its own revision file under `backend/alembic/versions/`.

Order matters. Ship 0002 first, then 0003.

## `0002_catchup_indexes_and_defaults.py`

Bucket B items. All metadata-only, zero-downtime safe.

```python
def upgrade():
    # B1: missing btree index on report_configs.source_session_id
    op.create_index(
        "ix_report_configs_source_session_id",
        "report_configs",
        ["source_session_id"],
    )

    # B2: align prod scratchpad default with the deliberate model shape.
    # composed_report was intentionally removed (see comment on the model
    # at backend/app/models/sherlock_runtime.py:24-27 — Sherlock Core no
    # longer stores report-builder-specific state). Existing rows are
    # untouched; new inserts use the new default. Application code on
    # load tolerates rows that still carry composed_report.
    op.execute("""
        ALTER TABLE sherlock_runtime_sessions
        ALTER COLUMN scratchpad SET DEFAULT
        '{"errors": [], "lookups": {}, "findings": [], "discovery": null,
          "last_analysis": null, "last_evidence": null, "active_filters": {},
          "last_data_check": null, "analysis_history": [],
          "discovered_schema": {"json_structures": {}, "relations_found": [],
                                "columns_by_table": {}, "tables_inspected": []},
          "resolved_entities": {}}'::jsonb
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sherlock_runtime_sessions
        ALTER COLUMN scratchpad SET DEFAULT
        '{"errors": [], "lookups": {}, "findings": [], "discovery": null,
          "last_analysis": null, "last_evidence": null, "active_filters": {},
          "composed_report": null, "last_data_check": null,
          "analysis_history": [],
          "discovered_schema": {"json_structures": {}, "relations_found": [],
                                "columns_by_table": {}, "tables_inspected": []},
          "resolved_entities": {}}'::jsonb
    """)
    op.drop_index("ix_report_configs_source_session_id", table_name="report_configs")
```

## `0003_drop_redundant_constraints_and_lsq.py`

Bucket D — cleanup.

**Pre-flight for D1 (drop `lsq_lead_cache`):**
```
grep -rn "lsq_lead_cache\|LsqLeadCache" backend/ src/
```
Must return zero matches. Code references were removed in commit `50baf9f`; this is just a defensive check.

```python
def upgrade():
    # D2 + D3: drop redundant duplicate FKs on analytics_charts and
    # analytics_dashboards. Both tables already have the SQLAlchemy-default
    # `*_source_session_id_fkey` constraint; the `fk_*` variant was added
    # by an old startup_schema ALTER TABLE ADD CONSTRAINT IF NOT EXISTS,
    # producing a duplicate. Same column, same target, same delete behaviour.
    op.drop_constraint(
        "fk_analytics_charts_source_session_id",
        "analytics_charts",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_analytics_dashboards_source_session_id",
        "analytics_dashboards",
        type_="foreignkey",
    )

    # D1: drop dead lsq_lead_cache table. Cascades drop its FKs, indexes, PK.
    op.drop_table("lsq_lead_cache")


def downgrade():
    # Recreate empty lsq_lead_cache for rollback safety. Data unrecoverable.
    op.execute("""
        CREATE TABLE lsq_lead_cache (
            id uuid NOT NULL,
            prospect_id varchar(100) NOT NULL,
            first_name varchar(255),
            last_name varchar(255),
            phone varchar(50),
            email varchar(255),
            fetched_at timestamptz NOT NULL DEFAULT now(),
            tenant_id uuid NOT NULL,
            user_id uuid NOT NULL,
            CONSTRAINT lsq_lead_cache_pkey PRIMARY KEY (id),
            CONSTRAINT uq_lsq_lead_cache_tenant_prospect UNIQUE (tenant_id, prospect_id),
            CONSTRAINT lsq_lead_cache_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
            CONSTRAINT lsq_lead_cache_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_lsq_lead_cache_tenant ON lsq_lead_cache (tenant_id);
    """)
    # Recreate the redundant FKs (rollback parity, even though they're useless).
    op.create_foreign_key(
        "fk_analytics_dashboards_source_session_id",
        "analytics_dashboards", "chat_sessions",
        ["source_session_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_analytics_charts_source_session_id",
        "analytics_charts", "chat_sessions",
        ["source_session_id"], ["id"], ondelete="SET NULL",
    )
```

D2 and D3 are pure dedupe — the SQLAlchemy-default-named FKs (`analytics_charts_source_session_id_fkey`, `analytics_dashboards_source_session_id_fkey`) remain in place and continue to enforce referential integrity. Verify before/after with `\d analytics_charts` and `\d analytics_dashboards`.

D1 is destructive but safe: the live code must already not reference the table. Code references were removed in commit `50baf9f`.

## Bucket A — closed

No outstanding model edits. All Bucket A items reconciled in `feat/alembic-phase-0-drift-audit`:

| # | Model file | Change |
|---|---|---|
| A1 | `backend/app/models/evaluator.py` | Replaced `idx_evaluators_seed_scope` with partial unique `uq_evaluators_seed_scope` (`COALESCE(seed_variant, '')`, with WHERE clause). |
| A2 | `backend/app/models/job.py` | Added partial unique `uq_jobs_user_idempotency_key`. |
| A3 | `backend/app/models/cost.py` | Added partial unique `uq_llm_usage_idempotency_key`. |
| A4 | `backend/app/models/sherlock_runtime.py` | Added `postgresql_where=text('correlation_id IS NOT NULL')` to existing index. |
| A7 | `backend/app/models/source_records.py` | Changed 11 columns from `String(...)` to `Text` to match prod (`first_name`, `last_name`, `phone`, `email`, `plan_name`, `condition`, `condition_normalized`, `intent_to_pay`, `agent_name`, `agent_name_normalized`, `source_campaign`). |
