"""source.dataset — entry node bound to a specific cohort_dataset_versions row.

Snapshot semantics (D2/D8): the dataset version pins the recipient set, so
re-running the same workflow against the same dataset version produces an
identical recipient list. Delegates to the shared ``_cohort_query_compiler``
dataset branch.
"""
from __future__ import annotations

import uuid

from pydantic import BaseModel
from sqlalchemy import text

from app.services.orchestration._config_strictness import strict_node_config_dict
from app.services.orchestration.node_protocol import NodeResult
from app.services.orchestration.node_registry import register_node
from app.services.orchestration.nodes._cohort_query_compiler import (
    CohortQueryConfig,
    compile_cohort_query,
)
from app.services.orchestration.source_catalog import (
    DatasetSource,
    SourceCatalogError,
    _DATASET_PREFIX,
    resolve_source,
)


class SourceDatasetConfig(BaseModel):
    model_config = strict_node_config_dict()
    dataset_version_id: uuid.UUID


_Config = SourceDatasetConfig


class DatasetVersionNotFound(Exception):
    """Raised when the pinned dataset_version_id is missing or not owned
    by the running tenant."""


@register_node(workflow_type="*", node_type="source.dataset")
class _Handler:
    node_type = "source.dataset"
    config_schema = SourceDatasetConfig
    output_edges = ["default"]
    category = "source"

    async def execute(
        self,
        input_cohort,
        config: SourceDatasetConfig,
        ctx,
    ) -> NodeResult:
        next_node_id = ctx.resolve_default_target()

        source_ref = f"{_DATASET_PREFIX}{config.dataset_version_id}"
        try:
            resolved = await resolve_source(
                source_ref, db=ctx.db, tenant_id=ctx.tenant_id,
            )
        except SourceCatalogError as exc:
            raise DatasetVersionNotFound(str(exc)) from exc
        if not isinstance(resolved, DatasetSource):
            raise DatasetVersionNotFound(
                f"dataset_version_id {config.dataset_version_id} did not resolve "
                f"to a dataset source"
            )

        query_config = CohortQueryConfig(source_ref=source_ref)

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

        await ctx.db.execute(
            text(
                "UPDATE orchestration.workflow_runs "
                "SET params = COALESCE(params, '{}'::jsonb) || "
                "    jsonb_build_object('enrolled_dataset_version_id', :vid), "
                "    cohort_size_at_entry = :size "
                "WHERE id = :run_id"
            ),
            {
                "vid": str(config.dataset_version_id),
                "size": cohort_size,
                "run_id": ctx.run_id,
            },
        )
        await ctx.db.flush()
        return NodeResult(summary={"cohort_size": cohort_size})
