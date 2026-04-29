"""Apps route — list registered applications."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import get_auth_context, AuthContext
from app.database import get_db
from app.models.application import Application
from app.schemas.app_config import AppConfig

router = APIRouter(prefix="/api/apps", tags=["apps"])


@router.get("")
async def list_apps(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """List all registered apps."""
    result = await db.execute(select(Application).where(Application.is_active == True).order_by(Application.slug))
    apps = result.scalars().all()
    return [
        {
            "id": str(a.id),
            "slug": a.slug,
            "displayName": a.display_name,
            "description": a.description,
            "iconUrl": a.icon_url,
            "isActive": a.is_active,
        }
        for a in apps
    ]


@router.get("/{slug}/config")
async def get_app_config(
    slug: str,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Return the config payload for one app by slug."""
    result = await db.execute(
        select(Application).where(Application.slug == slug, Application.is_active == True)
    )
    app = result.scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")
    return AppConfig.model_validate(app.config or {}).model_dump(by_alias=True)
