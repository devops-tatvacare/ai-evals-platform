"""Section 3 — create_draft_version validates drafts.

These cases mock the AsyncSession so the validation path can run without
a live Postgres. The DB-integration suite covers the persistence side via
test_orchestration_routes_unittest (port 5432 required).
"""
from __future__ import annotations

import asyncio
import uuid
import unittest
from unittest.mock import AsyncMock, MagicMock

import app.services.orchestration.nodes  # noqa: F401  (register handlers)
from app.services.orchestration.api.versions import (
    DraftValidationError,
    create_draft_version,
)


def _make_db(workflow_type: str = "crm", existing_max_version: int = 0) -> MagicMock:
    """Mock AsyncSession that returns one Workflow then one version-count row."""
    db = MagicMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    workflow = MagicMock()
    workflow.workflow_type = workflow_type
    workflow.app_id = "inside-sales"

    wf_scalar = MagicMock()
    wf_scalar.scalar_one_or_none = MagicMock(return_value=workflow)

    ver_scalar = MagicMock()
    ver_scalar.scalar_one = MagicMock(return_value=existing_max_version)

    db.execute = AsyncMock(side_effect=[wf_scalar, ver_scalar])
    return db


class CreateDraftVersionValidationTests(unittest.TestCase):
    def test_partial_draft_with_empty_configs_is_stored(self) -> None:
        async def run() -> None:
            db = _make_db()
            definition = {
                "nodes": [
                    {"id": "src", "type": "source.event_trigger", "config": {}},
                ],
                "edges": [],
            }
            row = await create_draft_version(
                db, tenant_id=uuid.uuid4(), workflow_id=uuid.uuid4(),
                definition=definition,
            )
            self.assertIsNotNone(row)
            db.add.assert_called_once()
            db.commit.assert_awaited_once()

        asyncio.run(run())

    def test_fabricated_key_rejects_with_structured_errors(self) -> None:
        async def run() -> None:
            db = _make_db()
            bad = {
                "nodes": [{
                    "id": "src",
                    "type": "source.event_trigger",
                    "config": {"fabricated_key": 1},
                }],
                "edges": [],
            }
            with self.assertRaises(DraftValidationError) as cm:
                await create_draft_version(
                    db, tenant_id=uuid.uuid4(), workflow_id=uuid.uuid4(),
                    definition=bad,
                )
            self.assertTrue(cm.exception.errors)
            self.assertEqual(cm.exception.errors[0]["node_id"], "src")
            self.assertEqual(cm.exception.errors[0]["field"], "config")
            db.add.assert_not_called()
            db.commit.assert_not_awaited()

        asyncio.run(run())

    def test_unknown_node_type_rejects(self) -> None:
        async def run() -> None:
            db = _make_db()
            bad = {
                "nodes": [{"id": "n", "type": "made.up.type", "config": {}}],
                "edges": [],
            }
            with self.assertRaises(DraftValidationError):
                await create_draft_version(
                    db, tenant_id=uuid.uuid4(), workflow_id=uuid.uuid4(),
                    definition=bad,
                )

        asyncio.run(run())

    def test_missing_workflow_returns_none(self) -> None:
        async def run() -> None:
            db = MagicMock()
            db.add = MagicMock()
            db.commit = AsyncMock()
            wf_scalar = MagicMock()
            wf_scalar.scalar_one_or_none = MagicMock(return_value=None)
            db.execute = AsyncMock(side_effect=[wf_scalar])
            row = await create_draft_version(
                db, tenant_id=uuid.uuid4(), workflow_id=uuid.uuid4(),
                definition={"nodes": [], "edges": []},
            )
            self.assertIsNone(row)

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
