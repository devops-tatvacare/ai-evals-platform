"""Resolve report-side assets from analytics config keys and settings rows."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.mixins.shareable import Visibility
from app.models.application_setting import ApplicationSetting
from app.schemas.app_analytics_config import AnalyticsAssetKeys
from app.services.access_control import shared_visibility_clause
from app.services.reports.config_models import NarrativeAssetKeys
from app.services.reports.prompts.inside_sales_narrative_prompt import (
    INSIDE_SALES_NARRATIVE_SYSTEM_PROMPT,
)
from app.services.reports.prompts.narrative_prompt import (
    ADVERSARIAL_NARRATIVE_SYSTEM_PROMPT,
    NARRATIVE_SYSTEM_PROMPT,
)


@dataclass
class ResolvedReportAssets:
    prompt_references: dict[str, str | None] = field(default_factory=dict)
    narrative_template: str | None = None
    glossary: str | None = None
    adversarial_narrative_template: str | None = None


@dataclass
class ResolvedNarrativeAssets:
    prompt_references: dict[str, str | None] = field(default_factory=dict)
    system_prompt: str | None = None
    glossary: str | None = None


def _narrative_defaults_for_app(app_id: str) -> str | None:
    return {
        'kaira-bot': NARRATIVE_SYSTEM_PROMPT,
        'inside-sales': INSIDE_SALES_NARRATIVE_SYSTEM_PROMPT,
        'voice-rx': (
            'You are a clinical transcription QA analyst. Summarize the evaluation accurately, '
            'using only the evidence and counts provided in the analytics payload.'
        ),
    }.get(app_id)


async def _resolve_setting_value(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    key: str | None,
) -> dict[str, Any] | None:
    if not key:
        return None

    private_row = await db.scalar(
        select(ApplicationSetting).where(
            ApplicationSetting.tenant_id == tenant_id,
            ApplicationSetting.user_id == user_id,
            ApplicationSetting.app_id == app_id,
            ApplicationSetting.key == key,
            ApplicationSetting.visibility == Visibility.PRIVATE,
        )
    )
    if private_row:
        return private_row.value or {}

    tenant_shared = await db.scalar(
        select(ApplicationSetting).where(
            ApplicationSetting.tenant_id == tenant_id,
            ApplicationSetting.app_id == app_id,
            ApplicationSetting.key == key,
            shared_visibility_clause(ApplicationSetting.visibility),
        )
    )
    if tenant_shared:
        return tenant_shared.value or {}

    system_shared = await db.scalar(
        select(ApplicationSetting).where(
            ApplicationSetting.tenant_id == SYSTEM_TENANT_ID,
            ApplicationSetting.user_id == SYSTEM_USER_ID,
            ApplicationSetting.app_id == app_id,
            ApplicationSetting.key == key,
            shared_visibility_clause(ApplicationSetting.visibility),
        )
    )
    if system_shared:
        return system_shared.value or {}

    return None


def _extract_content(value: dict[str, Any] | None) -> str | None:
    if not value:
        return None
    raw = value.get('content')
    if isinstance(raw, str):
        return raw
    template = value.get('template')
    if isinstance(template, str):
        return template
    system_prompt = value.get('systemPrompt') or value.get('system_prompt')
    if isinstance(system_prompt, str):
        return system_prompt
    return None


def _extract_prompt_references(value: dict[str, Any] | None) -> dict[str, str | None]:
    if not value:
        return {}
    prompt_refs = value.get('promptReferences') or value.get('prompt_references')
    if isinstance(prompt_refs, dict):
        return {
            str(key): item if isinstance(item, str) or item is None else str(item)
            for key, item in prompt_refs.items()
        }
    return {
        str(key): item if isinstance(item, str) or item is None else str(item)
        for key, item in value.items()
    }


async def resolve_report_assets(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    asset_keys: AnalyticsAssetKeys,
) -> ResolvedReportAssets:
    prompt_value = await _resolve_setting_value(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        key=asset_keys.prompt_references_key,
    )
    narrative_value = await _resolve_setting_value(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        key=asset_keys.narrative_template_key,
    )
    glossary_value = await _resolve_setting_value(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        key=asset_keys.glossary_key,
    )

    prompt_references = _extract_prompt_references(prompt_value)

    narrative_template = _extract_content(narrative_value) or _narrative_defaults_for_app(app_id)
    glossary = _extract_content(glossary_value)

    return ResolvedReportAssets(
        prompt_references=prompt_references,
        narrative_template=narrative_template,
        glossary=glossary,
        adversarial_narrative_template=ADVERSARIAL_NARRATIVE_SYSTEM_PROMPT,
    )


async def resolve_report_config_assets(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    asset_keys: NarrativeAssetKeys,
) -> ResolvedNarrativeAssets:
    prompt_value = await _resolve_setting_value(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        key=asset_keys.prompt_references_key,
    )
    system_prompt_value = await _resolve_setting_value(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        key=asset_keys.system_prompt_key,
    )
    glossary_value = await _resolve_setting_value(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        key=asset_keys.glossary_key,
    )

    return ResolvedNarrativeAssets(
        prompt_references=_extract_prompt_references(prompt_value),
        system_prompt=_extract_content(system_prompt_value) or _narrative_defaults_for_app(app_id),
        glossary=_extract_content(glossary_value),
    )
