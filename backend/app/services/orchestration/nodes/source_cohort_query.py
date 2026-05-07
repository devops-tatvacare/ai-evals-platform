"""source.cohort_query — entry node. Materializes the entry cohort via one CTE.

Phase 11 contract:
  - User config selects a cohort source via ``source_ref`` (or legacy
    ``source_table`` + ``id_column``) plus filters / payload fields /
    optional lookback / optional consent gate.
  - The successor node is **never** part of node config. The executor
    reads the outgoing ``default`` edge target via
    ``ctx.resolve_default_target()`` and passes that to the SQL compiler.
"""
from __future__ import annotations

from sqlalchemy import text, update

from app.models.orchestration import WorkflowRun
from app.services.orchestration.node_protocol import NodeResult
from app.services.orchestration.node_registry import register_node
from app.services.orchestration.nodes._cohort_query_compiler import (
    CohortQueryConfig,
    compile_cohort_query,
)
from app.services.orchestration.source_catalog import (
    ResolvedSource,
    resolve_source,
)


# ``_Config`` is an alias for ``CohortQueryConfig`` — back-compat for tests
# and any caller that imports the canonical handler config under the
# convention every other node uses.
_Config = CohortQueryConfig


def _next_target(ctx, config: CohortQueryConfig) -> str:
    """Phase 11: prefer the graph-derived ``default`` target. Fall back to a
    legacy ``next_node_id`` if the executor did not populate
    ``outgoing_targets`` (test mode or pre-Phase-11 saved definition that
    bypassed normalization)."""
    if ctx.outgoing_targets:
        targets = ctx.outgoing_targets.get("default") or []
        if targets:
            return targets[0]
    if config.next_node_id:
        return config.next_node_id
    return ctx.resolve_default_target()  # raises with a structured message


@register_node(workflow_type="*", node_type="source.cohort_query")
class _Handler:
    node_type = "source.cohort_query"
    config_schema = CohortQueryConfig
    output_edges = ["default"]
    category = "source"

    async def execute(self, input_cohort, config: CohortQueryConfig, ctx) -> NodeResult:
        next_node_id = _next_target(ctx, config)

        # Phase 12: route through the async resolver so dataset sources
        # (``source_ref='dataset.<uuid>'``) hit ``orchestration.cohort_dataset_rows``
        # while the static catalog entries continue to hit their backing
        # ``schema.table``. The legacy ``source_table``/``id_column`` config
        # path bypasses ``resolved_source`` and lets the compiler fall back
        # to ``cfg.resolve_table_and_id()`` — preserves pre-Phase-12 saved
        # definitions that never got re-normalized.
        resolved: ResolvedSource | None = None
        if config.source_ref is not None:
            resolved = await resolve_source(
                config.source_ref,
                db=ctx.db,
                tenant_id=ctx.tenant_id,
            )

        sql, params = compile_cohort_query(
            config,
            run_id=ctx.run_id,
            workflow_id=ctx.workflow_id,
            workflow_version_id=ctx.workflow_version_id,
            tenant_id=ctx.tenant_id,
            app_id=ctx.app_id,
            next_node_id=next_node_id,
            resolved_source=resolved,
        )
        result = await ctx.db.execute(text(sql), params)
        rows = result.all()
        cohort_size = len(rows)
        await ctx.db.execute(
            update(WorkflowRun)
            .where(WorkflowRun.id == ctx.run_id)
            .values(cohort_size_at_entry=cohort_size)
        )
        await ctx.db.flush()
        return NodeResult(summary={"cohort_size": cohort_size})
