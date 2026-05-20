"""Strict-config audit for orchestration workflows.

Scans every `workflow_versions.definition` against the strict Pydantic
schemas (`extra='forbid'` is unconditional via `_config_strictness`) and
emits one CSV row per offending node.

Use this when you suspect a stored workflow carries fabricated fields
that the publish path will now reject. Output columns:
`workflow_id, version_id, version_status, app_id, workflow_type, node_id,
node_type, issue`.

Usage::

    PYTHONPATH=backend python -m \\
        app.services.orchestration.contract_audit \\
        --output /tmp/audit.csv

When `--output` is omitted the report is written to stdout. Database URL
comes from the standard `DATABASE_URL` / `ANALYTICS_DATABASE_URL` env
vars — no credentials hard-coded here.

The script is read-only. It does not normalise or write back. The
publish path keeps applying `definition_normalizer.normalize_definition`
before strict validation, but the audit operates on the canonical row as
stored — that's what the publish path will see when re-publishing.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import os
import sys
from dataclasses import dataclass
from typing import Any, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.orchestration import Workflow, WorkflowVersion  # noqa: E402
from app.services.orchestration.definition_normalizer import (  # noqa: E402
    normalize_definition,
)
from app.services.orchestration.node_registry import (  # noqa: E402
    NodeRegistryError,
    resolve_handler,
)

# Eager-import every node module so ``register_node`` decorators run and
# the registry is populated. The lifespan does this through
# ``import app.services.job_worker`` — the audit runs outside that path,
# so we do it explicitly here.
from app.services.orchestration.nodes import (  # noqa: E402, F401
    core_webhook_out,
    filter_consent_gate,
    filter_eligibility,
    logic_conditional,
    logic_merge,
    logic_split,
    logic_wait,
    sink_complete,
    source_dataset,
    source_event_trigger,
    source_saved_cohort,
)


@dataclass(frozen=True)
class AuditFinding:
    workflow_id: str
    version_id: str
    version_status: str
    app_id: str
    workflow_type: str
    node_id: str
    node_type: str
    issue: str


def _audit_node(
    *,
    workflow_type: str,
    node: dict[str, Any],
) -> Iterable[str]:
    """Run strict ``_Config`` validation on one node. Yields one issue
    string per offending field; empty if the node validates clean."""
    node_type = node.get("type") or ""
    config = node.get("config") or {}
    try:
        handler = resolve_handler(workflow_type=workflow_type, node_type=node_type)
    except NodeRegistryError as exc:
        yield f"unknown node type {node_type!r}: {exc}"
        return
    schema = getattr(handler, "config_schema", None)
    if schema is None:
        return
    try:
        schema(**config)
    except Exception as exc:  # noqa: BLE001 — surface verbatim
        yield str(exc)


def audit_definition(
    *,
    workflow_id: str,
    version_id: str,
    version_status: str,
    app_id: str,
    workflow_type: str,
    definition: dict[str, Any],
) -> list[AuditFinding]:
    """Audit one workflow version. Normalises first (so the audit reflects
    what the publish path would see), then runs strict validation."""
    canonical = normalize_definition(definition)
    findings: list[AuditFinding] = []
    for node in canonical.get("nodes") or []:
        node_id = str(node.get("id") or "<unknown>")
        node_type = str(node.get("type") or "<unknown>")
        for issue in _audit_node(workflow_type=workflow_type, node=node):
            findings.append(
                AuditFinding(
                    workflow_id=workflow_id,
                    version_id=version_id,
                    version_status=version_status,
                    app_id=app_id,
                    workflow_type=workflow_type,
                    node_id=node_id,
                    node_type=node_type,
                    issue=issue,
                )
            )
    return findings


async def _scan(
    db: AsyncSession,
    *,
    only_published: bool,
) -> list[AuditFinding]:
    findings: list[AuditFinding] = []
    rows = (
        await db.execute(
            select(
                WorkflowVersion.id,
                WorkflowVersion.workflow_id,
                WorkflowVersion.version,
                WorkflowVersion.status,
                WorkflowVersion.definition,
                WorkflowVersion.app_id,
                Workflow.workflow_type,
            ).join(Workflow, Workflow.id == WorkflowVersion.workflow_id),
        )
    ).all()
    for row in rows:
        if only_published and row.status != "published":
            continue
        findings.extend(
            audit_definition(
                workflow_id=str(row.workflow_id),
                version_id=str(row.id),
                version_status=str(row.status),
                app_id=str(row.app_id or ""),
                workflow_type=str(row.workflow_type or ""),
                definition=row.definition or {},
            )
        )
    return findings


def write_csv(findings: list[AuditFinding], stream) -> None:
    writer = csv.writer(stream)
    writer.writerow([
        "workflow_id",
        "version_id",
        "version_status",
        "app_id",
        "workflow_type",
        "node_id",
        "node_type",
        "issue",
    ])
    for f in findings:
        writer.writerow([
            f.workflow_id,
            f.version_id,
            f.version_status,
            f.app_id,
            f.workflow_type,
            f.node_id,
            f.node_type,
            f.issue,
        ])


async def _amain(args: argparse.Namespace) -> int:
    database_url = (
        os.environ.get("DATABASE_URL")
        or os.environ.get("ANALYTICS_DATABASE_URL")
        or args.database_url
    )
    if not database_url:
        print(
            "ERROR: DATABASE_URL not set and --database-url not provided",
            file=sys.stderr,
        )
        return 2
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace(
            "postgresql://", "postgresql+asyncpg://", 1,
        )
    engine = create_async_engine(database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as db:
        findings = await _scan(db, only_published=args.only_published)
    await engine.dispose()

    if args.output:
        with open(args.output, "w", newline="") as fh:
            write_csv(findings, fh)
        print(
            f"audit: {len(findings)} finding(s) written to {args.output}",
            file=sys.stderr,
        )
    else:
        write_csv(findings, sys.stdout)
        print(f"audit: {len(findings)} finding(s)", file=sys.stderr)
    # Exit code 1 when offending workflows exist so CI / one-off runs can
    # gate the env-flag flip on a clean audit.
    return 0 if not findings else 1


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Audit orchestration workflow versions against the strict "
            "Phase 14 / Phase D Pydantic contract."
        ),
    )
    parser.add_argument("--output", help="Write CSV to this file. Default: stdout.")
    parser.add_argument(
        "--database-url",
        help=(
            "Override DATABASE_URL for the audit run. Useful when scanning "
            "a snapshot from outside the application's normal env."
        ),
    )
    parser.add_argument(
        "--only-published",
        action="store_true",
        default=False,
        help=(
            "Restrict the audit to workflow_versions with status='published'. "
            "Default scans drafts too so authors get an early warning."
        ),
    )
    args = parser.parse_args(argv)
    return asyncio.run(_amain(args))


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
