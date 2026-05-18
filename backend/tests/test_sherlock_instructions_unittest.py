"""Phase 3 — instruction loader + prompt rendering.

Asserts:
  * App-default markdown is loaded by app_id.
  * Tenant override is concatenated AFTER the app default (later
    instruction wins on contradiction).
  * Empty result (missing file + null override) renders no INSTRUCTIONS
    heading at all (no stub noise).
  * The rendered prompt contains the sentinel app rule.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select, update

from app.constants import SYSTEM_TENANT_ID
from app.models.tenant_config import TenantConfiguration
from app.services.sherlock_v3.data_specialist_prompt import (
    build_data_specialist_prompt,
)
from app.services.sherlock_v3.instructions import load_instructions


@pytest_asyncio.fixture
async def reset_tenant_override(db_session):
    """Ensure SYSTEM_TENANT_ID has a tenant_configurations row with NULL
    sherlock_instructions before/after. The outer fixture's transaction
    rolls back, so test data does not leak."""
    existing = (await db_session.execute(
        select(TenantConfiguration.id).where(
            TenantConfiguration.tenant_id == SYSTEM_TENANT_ID,
        )
    )).scalar_one_or_none()
    if existing is None:
        db_session.add(TenantConfiguration(
            tenant_id=SYSTEM_TENANT_ID, allowed_domains=[],
        ))
        await db_session.commit()
    else:
        await db_session.execute(
            update(TenantConfiguration)
            .where(TenantConfiguration.tenant_id == SYSTEM_TENANT_ID)
            .values(sherlock_instructions=None)
        )
        await db_session.commit()
    yield


@pytest.mark.asyncio
async def test_app_default_loaded_for_known_app(
    db_session, reset_tenant_override,
) -> None:
    block = await load_instructions(
        'voice-rx', tenant_id=SYSTEM_TENANT_ID, db=db_session,
    )
    assert 'one decimal place' in block.lower()
    assert 'iso weeks' in block.lower()


@pytest.mark.asyncio
async def test_unknown_app_returns_empty(
    db_session, reset_tenant_override,
) -> None:
    block = await load_instructions(
        'this-app-has-no-md-file',
        tenant_id=SYSTEM_TENANT_ID,
        db=db_session,
    )
    assert block == ''


@pytest.mark.asyncio
async def test_tenant_override_appended_after_app_default(
    db_session, reset_tenant_override,
) -> None:
    sentinel = 'TENANT-OVERRIDE-SENTINEL-XYZ-' + uuid.uuid4().hex[:8]
    await db_session.execute(
        update(TenantConfiguration)
        .where(TenantConfiguration.tenant_id == SYSTEM_TENANT_ID)
        .values(sherlock_instructions=sentinel)
    )
    await db_session.commit()

    block = await load_instructions(
        'voice-rx', tenant_id=SYSTEM_TENANT_ID, db=db_session,
    )

    # Both present.
    assert 'one decimal place' in block.lower()
    assert sentinel in block
    # Order: app default first, tenant override later.
    assert block.index('one decimal place') < block.index(sentinel)
    # Tenant override carries its visible heading.
    assert '## Tenant overrides' in block


@pytest.mark.asyncio
async def test_prompt_skips_heading_when_block_is_empty(
    db_session, reset_tenant_override,
) -> None:
    prompt = build_data_specialist_prompt(
        app_id='voice-rx',
        schema_context={'agg_evaluation_run': {}},
        allowed_tables=['agg_evaluation_run'],
        column_role_hints=['agg_evaluation_run.status is dimension'],
        exemplars=[],
        max_rows=200,
        grounding_header=None,
        instructions_block='',
    )
    assert 'INSTRUCTIONS (residual rules' not in prompt


@pytest.mark.asyncio
async def test_prompt_renders_instructions_block(
    db_session, reset_tenant_override,
) -> None:
    block = await load_instructions(
        'voice-rx', tenant_id=SYSTEM_TENANT_ID, db=db_session,
    )
    prompt = build_data_specialist_prompt(
        app_id='voice-rx',
        schema_context={'agg_evaluation_run': {}},
        allowed_tables=['agg_evaluation_run'],
        column_role_hints=['agg_evaluation_run.status is dimension'],
        exemplars=[],
        max_rows=200,
        grounding_header=None,
        instructions_block=block,
    )
    assert 'BUSINESS SEMANTICS' in prompt
    assert 'one decimal place' in prompt.lower()
