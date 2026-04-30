"""Seed fixtures for the orchestration engine.

JSON files under ``action_templates/`` are loaded as system-default
WorkflowActionTemplate rows (tenant_id IS NULL, app_id IS NULL).
JSON files under ``workflows/`` are loaded as system-owned Workflow + v1
WorkflowVersion rows (tenant_id = SYSTEM_TENANT_ID).

The loader lives in ``app.services.orchestration_seed`` and runs at app
boot; tenants opt in by cloning the system workflow via
``POST /api/orchestration/workflows/clone``.
"""
