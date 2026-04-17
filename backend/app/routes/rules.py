"""Rules catalog API — read/write the published rule catalog for an app."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.auth.permissions import require_permission
from app.database import get_db
from app.schemas.rule_catalog import RuleCatalogResponse
from app.services.evaluators.rules_service import DEFAULT_RULES_KEY, load_rules, save_rules

router = APIRouter(prefix="/api/rules", tags=["rules"])


@router.get("", response_model=RuleCatalogResponse)
async def get_rules(
    app_id: str = Query(...),
    catalog_key: str = Query(DEFAULT_RULES_KEY),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Return the published rule catalog for an app. Any user with app access can read."""
    return RuleCatalogResponse(
        rules=await load_rules(
            db,
            app_id=app_id,
            tenant_id=auth.tenant_id,
            catalog_key=catalog_key,
        )
    )


@router.put("", response_model=RuleCatalogResponse)
async def update_rules(
    body: RuleCatalogResponse,
    app_id: str = Query(...),
    catalog_key: str = Query(DEFAULT_RULES_KEY),
    auth: AuthContext = require_permission('configuration:edit'),
    db: AsyncSession = Depends(get_db),
):
    """Replace the published rule catalog for an app. Requires configuration:edit."""
    if catalog_key != DEFAULT_RULES_KEY:
        raise HTTPException(status_code=400, detail="Unsupported catalog_key for update")
    await save_rules(
        db,
        app_id=app_id,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        rules=[rule.model_dump(by_alias=True) for rule in body.rules],
    )
    return RuleCatalogResponse(rules=await load_rules(db, app_id=app_id, tenant_id=auth.tenant_id))
