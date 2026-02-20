"""Adversarial config API routes.

Typed endpoints for managing adversarial evaluation config, with validation.
Preferred over raw settings writes so the FE gets validation errors early.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app.services.evaluators.adversarial_config import (
    AdversarialConfig, get_default_config,
    load_config_from_db, save_config_to_db,
)

router = APIRouter(prefix="/api/adversarial-config", tags=["adversarial-config"])


@router.get("")
async def get_config():
    """Return current adversarial config (from DB or built-in default)."""
    config = await load_config_from_db()
    return config.model_dump()


@router.put("")
async def update_config(body: dict):
    """Validate and save adversarial config. Returns validated config or 422."""
    try:
        config = AdversarialConfig.model_validate(body)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    await save_config_to_db(config)
    return config.model_dump()


@router.post("/reset")
async def reset_config():
    """Restore built-in default config."""
    config = get_default_config()
    await save_config_to_db(config)
    return config.model_dump()


@router.get("/export")
async def export_config():
    """Export current config as downloadable JSON."""
    config = await load_config_from_db()
    return JSONResponse(
        content=config.model_dump(),
        headers={"Content-Disposition": "attachment; filename=adversarial-config.json"},
    )


@router.post("/import")
async def import_config(body: dict):
    """Validate and replace config from imported JSON."""
    try:
        config = AdversarialConfig.model_validate(body)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    await save_config_to_db(config)
    return config.model_dump()
