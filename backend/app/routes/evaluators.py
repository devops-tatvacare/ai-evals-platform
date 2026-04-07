"""Evaluators API routes."""
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import select, desc, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.auth.permissions import require_permission, require_app_access
from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.database import get_db
from app.models.eval_template import EvalTemplate
from app.models.evaluator import Evaluator
from app.models.mixins.shareable import Visibility
from app.models.listing import Listing
from app.models.user import User
from app.schemas.evaluator import EvaluatorCreate, EvaluatorUpdate, EvaluatorResponse
from app.services.access_control import readable_scope_clause, shared_visibility_clause

router = APIRouter(prefix="/api/evaluators", tags=["evaluators"])


# ── Helpers ──────────────────────────────────────────────────────────


def _extract_paths(data: dict, prefix: str, max_depth: int = 4) -> list[str]:
    """Recursively extract dot-notation paths from a dict."""
    paths: list[str] = []

    def _walk(obj: dict | list | str | int | float | bool | None, path: str, depth: int) -> None:
        if depth > max_depth or not isinstance(obj, dict):
            return
        for k, v in obj.items():
            full = f"{path}.{k}" if path else k
            paths.append(full)
            _walk(v, full, depth + 1)

    _walk(data, prefix, 0)
    return paths


def _owner_name_for_row(evaluator: Evaluator, owner_name: str | None) -> str:
    if evaluator.tenant_id == SYSTEM_TENANT_ID:
        return "System"
    return owner_name or str(evaluator.user_id)


def _annotate_owner_metadata(evaluator: Evaluator, owner_name: str | None) -> Evaluator:
    evaluator.owner_id = evaluator.user_id
    evaluator.owner_name = _owner_name_for_row(evaluator, owner_name)
    evaluator.template_upgrade_available = False  # default, may be overwritten
    return evaluator


async def _annotate_template_upgrades(db: AsyncSession, evaluators: list[Evaluator]) -> None:
    """Batch-check which evaluators have a newer template version available."""
    branch_keys = {
        e.template_branch_key for e in evaluators
        if e.template_id and e.template_branch_key
    }
    if not branch_keys:
        return
    # Get max version per branch
    q = (
        select(EvalTemplate.branch_key, func.max(EvalTemplate.version))
        .where(EvalTemplate.branch_key.in_(branch_keys))
        .group_by(EvalTemplate.branch_key)
    )
    result = await db.execute(q)
    max_versions = dict(result.all())

    # Build pinned version lookup
    pinned_ids = {e.template_id for e in evaluators if e.template_id}
    if not pinned_ids:
        return
    q2 = select(EvalTemplate.id, EvalTemplate.version).where(EvalTemplate.id.in_(pinned_ids))
    result2 = await db.execute(q2)
    pinned_versions = dict(result2.all())

    for e in evaluators:
        if e.template_id and e.template_branch_key:
            pinned_ver = pinned_versions.get(e.template_id, 0)
            max_ver = max_versions.get(e.template_branch_key, 0)
            e.template_upgrade_available = max_ver > pinned_ver


@router.get("", response_model=list[EvaluatorResponse])
async def list_evaluators(
    app_id: str = Query(...),
    listing_id: str = Query(None),
    filter: Literal["all", "private", "shared"] = Query("all"),
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """List evaluators for an app by canonical visibility scope."""
    if filter == "private":
        query = select(Evaluator, User.display_name).outerjoin(
            User,
            and_(User.id == Evaluator.user_id, User.tenant_id == Evaluator.tenant_id),
        ).where(
            Evaluator.tenant_id == auth.tenant_id,
            Evaluator.user_id == auth.user_id,
            Evaluator.app_id == app_id,
        )
    elif filter == "shared":
        query = select(Evaluator, User.display_name).outerjoin(
            User,
                and_(User.id == Evaluator.user_id, User.tenant_id == Evaluator.tenant_id),
        ).where(
            or_(
                and_(Evaluator.tenant_id == auth.tenant_id, shared_visibility_clause(Evaluator.visibility)),
                and_(
                    Evaluator.tenant_id == SYSTEM_TENANT_ID,
                    Evaluator.user_id == SYSTEM_USER_ID,
                    shared_visibility_clause(Evaluator.visibility),
                ),
            ),
            Evaluator.app_id == app_id,
        )
    else:  # "all"
        query = select(Evaluator, User.display_name).outerjoin(
            User,
            and_(User.id == Evaluator.user_id, User.tenant_id == Evaluator.tenant_id),
        ).where(
            readable_scope_clause(Evaluator, auth),
            Evaluator.app_id == app_id,
        )

    if listing_id:
        query = query.where(Evaluator.listing_id == UUID(listing_id))
    query = query.order_by(desc(Evaluator.created_at))

    result = await db.execute(query)
    evaluators = [
        _annotate_owner_metadata(evaluator, owner_name)
        for evaluator, owner_name in result.all()
    ]
    await _annotate_template_upgrades(db, evaluators)
    return evaluators



# ── Variable Registry Endpoints ──────────────────────────────────────
# These MUST be before /{evaluator_id} routes — otherwise FastAPI
# treats "variables" / "validate-prompt" as a UUID path parameter.


@router.get("/variables")
async def list_variables(
    app_id: str = Query(..., alias="appId"),
    source_type: str | None = Query(None, alias="sourceType"),
    _auth: AuthContext = require_app_access(),
):
    """List available template variables for custom evaluator prompts."""
    from app.services.evaluators.variable_registry import get_registry
    variables = get_registry().get_for_app(app_id, source_type)
    return [
        {
            "key": v.key,
            "displayName": v.display_name,
            "description": v.description,
            "category": v.category,
            "valueType": v.value_type,
            "requiresAudio": v.requires_audio,
            "requiresEvalOutput": v.requires_eval_output,
            "sourceTypes": v.source_types,
            "example": v.example,
        }
        for v in variables
    ]


@router.post("/validate-prompt")
async def validate_prompt(
    app_id: str = Query(..., alias="appId"),
    source_type: str | None = Query(None, alias="sourceType"),
    body: dict = Body(...),
    _auth: AuthContext = require_app_access(),
):
    """Validate template variables in a prompt against the registry."""
    prompt = body.get("prompt", "")
    if not prompt:
        raise HTTPException(status_code=400, detail="'prompt' field is required")
    from app.services.evaluators.variable_registry import get_registry
    return get_registry().validate_prompt(prompt, app_id, source_type)


@router.post("/seed-defaults", response_model=list[EvaluatorResponse], status_code=201)
async def seed_defaults(
    app_id: str = Query(..., alias="appId"),
    listing_id: str | None = Query(None, alias="listingId"),
    auth: AuthContext = require_permission('asset:create'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Create recommended evaluators for an app.

    - voice-rx: requires listingId, seeds per-listing evaluators based on source_type.
    - kaira-bot: no listingId needed, seeds app-level evaluators.
    """
    if app_id == "voice-rx":
        return await _seed_voice_rx(listing_id, auth, db)
    elif app_id == "kaira-bot":
        return await _seed_kaira_bot(auth, db)
    elif app_id == "inside-sales":
        return await _seed_inside_sales(auth, db)
    else:
        raise HTTPException(status_code=400, detail=f"Seed evaluators not available for app '{app_id}'")


async def _seed_voice_rx(listing_id: str | None, auth: AuthContext, db: AsyncSession) -> list[Evaluator]:
    """Seed recommended evaluators for a voice-rx listing."""
    if not listing_id:
        raise HTTPException(status_code=400, detail="listingId is required for voice-rx")

    listing = await db.scalar(
        select(Listing).where(
            Listing.id == listing_id,
            Listing.tenant_id == auth.tenant_id,
            Listing.user_id == auth.user_id,
        )
    )
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if listing.app_id != "voice-rx":
        raise HTTPException(status_code=400, detail="Listing does not belong to voice-rx")

    source_type = listing.source_type
    if source_type == "upload":
        from app.services.seed_defaults import VOICE_RX_UPLOAD_EVALUATORS
        seeds = VOICE_RX_UPLOAD_EVALUATORS
    elif source_type == "api":
        from app.services.seed_defaults import VOICE_RX_API_EVALUATORS
        seeds = VOICE_RX_API_EVALUATORS
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Listing source type '{source_type}' is not supported",
        )

    # Idempotency: check existing evaluators on this listing for this user
    result = await db.execute(
        select(Evaluator)
        .where(
            Evaluator.listing_id == listing.id,
            Evaluator.app_id == "voice-rx",
            Evaluator.tenant_id == auth.tenant_id,
            Evaluator.user_id == auth.user_id,
        )
    )
    existing_names = {e.name for e in result.scalars().all()}

    created = []
    for seed in seeds:
        if seed["name"] in existing_names:
            continue
        evaluator = Evaluator(
            app_id="voice-rx",
            listing_id=listing.id,
            name=seed["name"],
            prompt=seed["prompt"],
            output_schema=seed["output_schema"],
            model_id=None,
            visibility=Visibility.PRIVATE,
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
        )
        db.add(evaluator)
        created.append(evaluator)

    if created:
        await db.commit()
        for e in created:
            await db.refresh(e)

    return created


async def _seed_kaira_bot(auth: AuthContext, db: AsyncSession) -> list[Evaluator]:
    """Seed recommended app-level evaluators for kaira-bot."""
    from app.services.seed_defaults import KAIRA_BOT_EVALUATORS

    # Idempotency: check existing app-level evaluators for this user
    result = await db.execute(
        select(Evaluator).where(
            Evaluator.app_id == "kaira-bot",
            Evaluator.listing_id == None,
            Evaluator.tenant_id == auth.tenant_id,
            Evaluator.user_id == auth.user_id,
        )
    )
    existing_names = {e.name for e in result.scalars().all()}

    created = []
    for seed in KAIRA_BOT_EVALUATORS:
        if seed["name"] in existing_names:
            continue
        evaluator = Evaluator(
            app_id=seed["app_id"],
            listing_id=None,
            name=seed["name"],
            prompt=seed["prompt"],
            output_schema=seed["output_schema"],
            model_id=None,
            visibility=Visibility.normalize(seed.get("visibility")) or Visibility.SHARED,
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
        )
        db.add(evaluator)
        created.append(evaluator)

    if created:
        await db.commit()
        for e in created:
            await db.refresh(e)

    return created


async def _seed_inside_sales(auth: AuthContext, db: AsyncSession) -> list[Evaluator]:
    """Seed recommended evaluators for inside-sales."""
    from app.services.seed_defaults import INSIDE_SALES_EVALUATORS

    result = await db.execute(
        select(Evaluator).where(
            Evaluator.app_id == "inside-sales",
            Evaluator.listing_id == None,
            Evaluator.tenant_id == auth.tenant_id,
            Evaluator.user_id == auth.user_id,
        )
    )
    existing_map = {e.name: e for e in result.scalars().all()}

    created = []
    for seed in INSIDE_SALES_EVALUATORS:
        existing = existing_map.get(seed["name"])
        if existing:
            existing.output_schema = seed["output_schema"]
            existing.prompt = seed["prompt"]
            continue
        evaluator = Evaluator(
            app_id=seed["app_id"],
            listing_id=None,
            name=seed["name"],
            prompt=seed["prompt"],
            output_schema=seed["output_schema"],
            model_id=None,
            visibility=Visibility.normalize(seed.get("visibility")) or Visibility.SHARED,
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
        )
        db.add(evaluator)
        created.append(evaluator)

    await db.commit()
    for e in created:
        await db.refresh(e)

    return created


@router.get("/variables/api-paths")
async def list_api_paths(
    listing_id: str = Query(..., alias="listingId"),
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Extract available variable paths from a listing's API response."""
    listing = await db.scalar(
        select(Listing).where(
            Listing.id == listing_id,
            Listing.tenant_id == auth.tenant_id,
            Listing.user_id == auth.user_id,
        )
    )
    if not listing or not listing.api_response:
        return []
    return _extract_paths(listing.api_response, prefix="")


# ── Evaluator CRUD ───────────────────────────────────────────────────


@router.get("/{evaluator_id}", response_model=EvaluatorResponse)
async def get_evaluator(
    evaluator_id: UUID,
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Get a single evaluator by ID."""
    result = await db.execute(
        select(Evaluator, User.display_name).outerjoin(
            User,
            and_(User.id == Evaluator.user_id, User.tenant_id == Evaluator.tenant_id),
        ).where(
            Evaluator.id == evaluator_id,
            readable_scope_clause(Evaluator, auth),
        )
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Evaluator not found")
    evaluator, owner_name = row
    _annotate_owner_metadata(evaluator, owner_name)
    await _annotate_template_upgrades(db, [evaluator])
    return evaluator


@router.post("", response_model=EvaluatorResponse, status_code=201)
async def create_evaluator(
    body: EvaluatorCreate,
    auth: AuthContext = require_permission('asset:create'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Create a new evaluator."""
    evaluator = Evaluator(
        **body.model_dump(),
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
    )
    db.add(evaluator)
    await db.commit()
    await db.refresh(evaluator)
    return evaluator


@router.put("/{evaluator_id}", response_model=EvaluatorResponse)
async def update_evaluator(
    evaluator_id: UUID,
    body: EvaluatorUpdate,
    auth: AuthContext = require_permission('asset:edit'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Update an evaluator. Cannot edit system evaluators."""
    result = await db.execute(
        select(Evaluator).where(
            Evaluator.id == evaluator_id,
            Evaluator.tenant_id == auth.tenant_id,
            Evaluator.user_id == auth.user_id,
        )
    )
    evaluator = result.scalar_one_or_none()
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(evaluator, key, value)

    await db.commit()
    await db.refresh(evaluator)
    return evaluator


@router.delete("/{evaluator_id}")
async def delete_evaluator(
    evaluator_id: UUID,
    auth: AuthContext = require_permission('asset:delete'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Delete an evaluator. Cannot delete system evaluators."""
    result = await db.execute(
        select(Evaluator).where(
            Evaluator.id == evaluator_id,
            Evaluator.tenant_id == auth.tenant_id,
            Evaluator.user_id == auth.user_id,
        )
    )
    evaluator = result.scalar_one_or_none()
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found")

    await db.delete(evaluator)
    await db.commit()
    return {"deleted": True, "id": str(evaluator_id)}


@router.post("/{evaluator_id}/fork", response_model=EvaluatorResponse, status_code=201)
async def fork_evaluator(
    evaluator_id: UUID,
    listing_id: str = Query(None),
    auth: AuthContext = require_permission('asset:create'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Fork an evaluator. Source can be own, tenant-shared, or system-shared."""
    result = await db.execute(
        select(Evaluator).where(
            Evaluator.id == evaluator_id,
            readable_scope_clause(Evaluator, auth),
        )
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Evaluator not found")

    forked = Evaluator(
        app_id=source.app_id,
        listing_id=UUID(listing_id) if listing_id else None,
        name=source.name,
        prompt=source.prompt,
        model_id=source.model_id,
        output_schema=source.output_schema,
        linked_rule_ids=source.linked_rule_ids,
        visibility=Visibility.PRIVATE,
        forked_from=source.id,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
    )
    db.add(forked)
    await db.commit()
    await db.refresh(forked)
    return forked


@router.patch("/{evaluator_id}/visibility", response_model=EvaluatorResponse)
async def patch_evaluator_visibility(
    evaluator_id: UUID,
    body: dict,
    auth: AuthContext = require_permission('asset:share'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Change visibility on an evaluator. Only the owner can change visibility."""
    from sqlalchemy import func as sqlfunc

    result = await db.execute(
        select(Evaluator).where(
            Evaluator.id == evaluator_id,
            Evaluator.tenant_id == auth.tenant_id,
            Evaluator.user_id == auth.user_id,
        )
    )
    evaluator = result.scalar_one_or_none()
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found or not owned by you")

    try:
        new_visibility = Visibility.normalize(body.get("visibility"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="visibility must be 'private' or 'shared'") from exc
    if new_visibility is None:
        raise HTTPException(status_code=422, detail="visibility must be 'private' or 'shared'")

    evaluator.visibility = new_visibility
    if new_visibility == Visibility.SHARED:
        evaluator.shared_by = auth.user_id
        evaluator.shared_at = sqlfunc.now()

    await db.commit()
    await db.refresh(evaluator)
    return evaluator
