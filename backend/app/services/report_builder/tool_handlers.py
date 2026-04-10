"""
Executes tool calls from the LLM during report builder chat.
Each handler takes parsed arguments and returns a JSON-serializable result.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.report_builder.section_catalog import (
    get_section_detail,
    list_section_types,
)


async def handle_list_section_types(**_kwargs: Any) -> dict:
    return {"sections": list_section_types()}


async def handle_get_section_detail(*, section_type: str, **_kwargs: Any) -> dict:
    detail = get_section_detail(section_type)
    if not detail:
        return {"error": f"Unknown section type: {section_type}"}
    return detail


async def handle_list_app_sections(
    *,
    app_id: str,
    db: AsyncSession,
    tenant_id: str,
    **_kwargs: Any,
) -> dict:
    """Look up analytics config for the app and return its declared sections."""
    from sqlalchemy import select
    from app.models.app import App

    result = await db.execute(
        select(App).where(App.slug == app_id, App.is_active.is_(True))
    )
    config = result.scalar_one_or_none()
    if not config:
        return {"error": f"No app config found for {app_id}"}

    analytics = (config.config or {}).get("analytics", {})
    single_run = analytics.get("singleRun", {})
    sections = single_run.get("sections", [])

    return {
        "app_id": app_id,
        "sections": [
            {
                "id": s.get("id"),
                "type": s.get("type"),
                "title": s.get("title", ""),
                "variant": s.get("variant", ""),
            }
            for s in sections
        ],
    }


async def handle_compose_report(
    *,
    report_name: str,
    sections: list[dict],
    **_kwargs: Any,
) -> dict:
    """Validate and return a preview-ready report config."""
    from app.services.report_builder.section_catalog import get_section_type

    errors: list[str] = []
    validated: list[dict] = []

    for section in sections:
        section_type = section.get("type", "")
        if not get_section_type(section_type):
            errors.append(f"Unknown section type: {section_type}")
            continue

        validated.append({
            "id": section.get("id", f"custom-{section_type}-{uuid.uuid4().hex[:6]}"),
            "type": section_type,
            "title": section.get("title", section_type.replace("_", " ").title()),
            "variant": section.get("variant", ""),
        })

    if errors:
        return {"status": "error", "errors": errors, "validated_sections": validated}

    return {
        "status": "ok",
        "report_name": report_name,
        "sections": validated,
        "preview_ready": True,
    }


async def handle_save_template(
    *,
    report_name: str,
    sections: list[dict],
    db: AsyncSession,
    tenant_id: str,
    user_id: str,
    app_id: str,
    **_kwargs: Any,
) -> dict:
    """Persist as a new ReportConfig row."""
    from app.models.report_config import ReportConfig

    report_id = f"custom-{uuid.uuid4().hex[:8]}"
    presentation_config = {
        "rendererId": "platform-default",
        "layoutGroups": [],
        "density": "default",
        "designTokens": {},
        "themeTokens": {},
        "sections": [
            {
                "sectionId": s["id"],
                "componentId": s["type"],
                "title": s.get("title", ""),
                "description": None,
                "variant": s.get("variant", ""),
                "printable": True,
            }
            for s in sections
        ],
    }
    export_config = {
        "enabled": True,
        "format": "pdf",
        "documentVariant": "platform-default",
        "sectionIds": [s["id"] for s in sections],
    }

    config = ReportConfig(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        report_id=report_id,
        scope="single_run",
        name=report_name,
        description=f"Custom report created via report builder",
        presentation_config=presentation_config,
        narrative_config={"enabled": False},
        export_config=export_config,
    )
    db.add(config)
    await db.flush()

    return {
        "status": "saved",
        "report_id": report_id,
        "report_name": report_name,
        "section_count": len(sections),
    }


TOOL_HANDLER_MAP = {
    "list_section_types": handle_list_section_types,
    "get_section_detail": handle_get_section_detail,
    "list_app_sections": handle_list_app_sections,
    "compose_report": handle_compose_report,
    "save_template": handle_save_template,
}


async def dispatch_tool_call(
    tool_name: str,
    arguments: dict[str, Any],
    *,
    db: AsyncSession,
    tenant_id: str,
    user_id: str,
    app_id: str,
) -> str:
    """Route a tool call to its handler and return JSON string result."""
    handler = TOOL_HANDLER_MAP.get(tool_name)
    if not handler:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})

    # Context kwargs (db, tenant_id, etc.) take precedence over LLM-supplied args
    context = dict(db=db, tenant_id=tenant_id, user_id=user_id, app_id=app_id)
    safe_args = {k: v for k, v in arguments.items() if k not in context}
    result = await handler(**safe_args, **context)
    return json.dumps(result, default=str)
