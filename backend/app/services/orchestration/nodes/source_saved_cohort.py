"""source.saved_cohort — entry node bound to a saved CohortDefinitionVersion.

Loads the pinned ``cohort_definition_version_id`` row, builds a transient
``CohortQueryConfig`` from its (source_ref, filters, payload_fields,
lookback_*, consent_gate_channel), and delegates to the shared
``_cohort_query_compiler``. D2: re-execution is dynamic — each workflow run
picks up the current state of the source table.
"""
from __future__ import annotations

import uuid

from pydantic import BaseModel
from sqlalchemy import select, text

from app.models.orchestration import CohortDefinitionVersion
from app.services.orchestration._config_strictness import strict_node_config_dict
from app.services.orchestration.node_protocol import NodeResult
from app.services.orchestration.node_registry import register_node
from app.services.orchestration.nodes._cohort_query_compiler import (
    CohortQueryConfig,
    compile_cohort_query,
)
from app.services.orchestration.source_catalog import (
    ResolvedSource,
    SourceCatalogError,
    resolve_source,
)


class SourceSavedCohortConfig(BaseModel):
    model_config = strict_node_config_dict()
    cohort_definition_version_id: uuid.UUID


_Config = SourceSavedCohortConfig


class SavedCohortNotFound(Exception):
    """Raised when the pinned cohort_definition_version_id is missing or
    not owned by the running tenant. Bubbles up as a structured run failure."""


async def _load_version(
    ctx, version_id: uuid.UUID
) -> CohortDefinitionVersion:
    stmt = select(CohortDefinitionVersion).where(
        CohortDefinitionVersion.id == version_id,
        CohortDefinitionVersion.tenant_id == ctx.tenant_id,
    )
    result = await ctx.db.execute(stmt)
    version = result.scalar_one_or_none()
    if version is None:
        raise SavedCohortNotFound(
            f"cohort_definition_version not found or not owned by tenant: {version_id}"
        )
    return version


@register_node(workflow_type="*", node_type="source.saved_cohort")
class _Handler:
    node_type = "source.saved_cohort"
    config_schema = SourceSavedCohortConfig
    output_edges = ["default"]
    category = "source"

    async def execute(
        self,
        input_cohort,
        config: SourceSavedCohortConfig,
        ctx,
    ) -> NodeResult:
        next_node_id = ctx.resolve_default_target()

        version = await _load_version(ctx, config.cohort_definition_version_id)

        # The saved version row is the canonical source of truth for the
        # predicate; rebuild the transient CohortQueryConfig from it instead
        # of trusting any cached copy on the node.
        query_config = CohortQueryConfig(
            source_ref=version.source_ref,
            payload_fields=list(version.payload_fields or []),
            filters=list(version.filters or []),
            lookback_hours=version.lookback_hours,
            lookback_column=version.lookback_column,
            consent_gate_channel=version.consent_gate_channel,
        )

        try:
            resolved: ResolvedSource = await resolve_source(
                version.source_ref,
                db=ctx.db,
                tenant_id=ctx.tenant_id,
            )
        except SourceCatalogError as exc:
            raise SavedCohortNotFound(str(exc)) from exc

        sql, params = compile_cohort_query(
            query_config,
            run_id=ctx.run_id,
            workflow_id=ctx.workflow_id,
            workflow_version_id=ctx.workflow_version_id,
            tenant_id=ctx.tenant_id,
            app_id=ctx.app_id,
            next_node_id=next_node_id,
            resolved_source=resolved,
        )
        result = await ctx.db.execute(text(sql), params)
        cohort_size = len(result.all())

        # Provenance: stamp the pinned version into workflow_runs.params so
        # logs and reporting can join back to the cohort that produced this
        # recipient set.
        await ctx.db.execute(
            text(
                "UPDATE orchestration.workflow_runs "
                "SET params = COALESCE(params, '{}'::jsonb) || "
                "    jsonb_build_object('enrolled_cohort_definition_version_id', :vid), "
                "    cohort_size_at_entry = :size "
                "WHERE id = :run_id"
            ),
            {
                "vid": str(version.id),
                "size": cohort_size,
                "run_id": ctx.run_id,
            },
        )
        await ctx.db.flush()
        return NodeResult(summary={"cohort_size": cohort_size})
