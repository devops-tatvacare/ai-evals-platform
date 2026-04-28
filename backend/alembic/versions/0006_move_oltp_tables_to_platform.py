"""move 43 OLTP/application tables from public to platform

Roadmap 01 §9.3 + §9.4 revision 0006: the breaking move. Every
application/OLTP table currently in ``public`` migrates to the
``platform`` schema in a single transactional revision. ``ALTER TABLE
... SET SCHEMA`` is metadata-only (sub-second per table; FK constraints
preserved across the move per Postgres docs).

Tables NOT moved here (16):
  - 6 analytics-adjacent tables (analytics_run_facts, analytics_eval_facts,
    analytics_criterion_facts, analytics_jobs, agent_tool_logs,
    analytics_query_cache) — move to ``analytics`` in revision 0008
  - 1 legacy zero-row cache (evaluation_analytics) — dropped in 0010
  - 3 source-mirror tables (source_call_records, source_lead_records,
    source_sync_runs) — move to ``analytics`` in revision 0008
  - 6 cost/observability tables (llm_usage, llm_usage_daily_rollup,
    model_pricing, model_aliases, models_dev_catalog, models_dev_snapshots)
    — move to ``analytics`` in revision 0008

After this revision applies, ``public`` holds only those 16 transitional
tables plus ``alembic_version``. They move out in 0008+; ``public`` then
holds only ``alembic_version`` for the duration of Roadmap 01 (§17).

Reversibility: downgrade reverses every move (``ALTER TABLE platform.X
SET SCHEMA public``). Symmetric, transactional.

Dependencies: §0.1 hard gate met; revision 0005 applied (``platform``
schema exists); Phase 1 schema-aware refactor merged. Companion ORM
update in this same commit adds ``__table_args__ = {"schema":
"platform"}`` to every model whose table is moved here, plus
schema-qualifies the cross-schema FKs in the 16 staying-in-public
tables (FKs preserved by Postgres but the SQLAlchemy model strings
must match for autogenerate to stay clean and for fresh
``Base.metadata.create_all`` paths in tests to work).

Revision ID: 0006_move_oltp_tables_to_platform
Revises: 0005_create_platform_schema
Create Date: 2026-04-28
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0006_move_oltp_tables_to_platform"
down_revision: Union[str, None] = "0005_create_platform_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 43 OLTP/application tables. Order doesn't matter — ``SET SCHEMA``
# preserves FK constraints; the transactional wrapping makes the whole
# move atomic. Listed grouped by domain (per plan §3.1 / §5) for
# readability.
_TABLES_TO_MOVE: tuple[str, ...] = (
    # Tenant plane
    "tenants",
    "tenant_configs",
    # Identity & access
    "users",
    "refresh_tokens",
    "invite_links",
    "roles",
    "role_app_access",
    "role_permissions",
    # Application registry
    "apps",
    "external_agents",
    "settings",
    # Evaluation domain
    "eval_runs",
    "thread_evaluations",
    "adversarial_evaluations",
    "api_logs",
    "eval_templates",
    "eval_reviews",
    "eval_review_items",
    "evaluators",
    # Datasets & files
    "listings",
    "files",
    # Library
    "prompts",
    "schemas",
    "adversarial_test_cases",
    "tags",
    # Background jobs
    "jobs",
    "scheduled_jobs",
    "scheduler_heartbeats",
    # Chat engine
    "chat_sessions",
    "chat_messages",
    # Sherlock agent (runtime + ontology)
    "sherlock_runtime_sessions",
    "sherlock_runtime_turns",
    "sherlock_runtime_events",
    "sherlock_ontology_classes",
    "sherlock_entity_types",
    "sherlock_resolvers",
    # Analytics user-owned config (stays OLTP per §3.4 judgement call)
    "analytics_charts",
    "analytics_dashboards",
    # Reports & history
    "report_configs",
    "report_runs",
    "report_artifacts",
    "history",
    # Audit
    "audit_log",
)


def upgrade() -> None:
    assert len(_TABLES_TO_MOVE) == 43, (
        f"expected 43 tables to move per plan §3.1, got {len(_TABLES_TO_MOVE)}"
    )
    for table in _TABLES_TO_MOVE:
        op.execute(f"ALTER TABLE public.{table} SET SCHEMA platform")


def downgrade() -> None:
    for table in _TABLES_TO_MOVE:
        op.execute(f"ALTER TABLE platform.{table} SET SCHEMA public")
