"""Evaluators API routes."""
from uuid import UUID
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.evaluator import Evaluator
from app.models.listing import Listing
from app.schemas.evaluator import EvaluatorCreate, EvaluatorUpdate, EvaluatorSetGlobal, EvaluatorResponse

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


@router.get("", response_model=list[EvaluatorResponse])
async def list_evaluators(
    app_id: str = Query(...),
    listing_id: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List evaluators for an app, optionally filtered by listing_id."""
    query = select(Evaluator).where(Evaluator.app_id == app_id)
    if listing_id:
        query = query.where(Evaluator.listing_id == UUID(listing_id))
    elif app_id == "kaira-bot":
        # For kaira-bot without listing_id, return app-level evaluators only
        query = query.where(Evaluator.listing_id == None)
    query = query.order_by(desc(Evaluator.created_at))

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/registry", response_model=list[EvaluatorResponse])
async def list_registry(
    app_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """List all global evaluators (the registry) for an app."""
    query = (
        select(Evaluator)
        .where(Evaluator.app_id == app_id, Evaluator.is_global == True)
        .order_by(desc(Evaluator.created_at))
    )
    result = await db.execute(query)
    return result.scalars().all()



# ── Variable Registry Endpoints ──────────────────────────────────────
# These MUST be before /{evaluator_id} routes — otherwise FastAPI
# treats "variables" / "validate-prompt" as a UUID path parameter.


@router.get("/variables")
async def list_variables(
    app_id: str = Query(..., alias="appId"),
    source_type: str | None = Query(None, alias="sourceType"),
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
):
    """Validate template variables in a prompt against the registry."""
    prompt = body.get("prompt", "")
    if not prompt:
        raise HTTPException(status_code=400, detail="'prompt' field is required")
    from app.services.evaluators.variable_registry import get_registry
    return get_registry().validate_prompt(prompt, app_id, source_type)


@router.post("/seed-defaults", response_model=list[EvaluatorResponse], status_code=201)
async def seed_defaults(
    listing_id: str = Query(..., alias="listingId"),
    db: AsyncSession = Depends(get_db),
):
    """Create recommended evaluators for a voice-rx listing based on its source type."""
    listing = await db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if listing.app_id != "voice-rx":
        raise HTTPException(status_code=400, detail="Seed evaluators are only available for voice-rx listings")

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

    # Idempotency: check existing evaluators on this listing
    result = await db.execute(
        select(Evaluator)
        .where(Evaluator.listing_id == listing.id, Evaluator.app_id == "voice-rx")
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
            is_global=False,
            show_in_header=seed["name"] == "Critical Safety Audit",
        )
        db.add(evaluator)
        created.append(evaluator)

    if created:
        await db.commit()
        for e in created:
            await db.refresh(e)

    return created


@router.get("/variables/api-paths")
async def list_api_paths(
    listing_id: str = Query(..., alias="listingId"),
    db: AsyncSession = Depends(get_db),
):
    """Extract available variable paths from a listing's API response."""
    listing = await db.get(Listing, listing_id)
    if not listing or not listing.api_response:
        return []
    return _extract_paths(listing.api_response, prefix="")


# ── Evaluator CRUD ───────────────────────────────────────────────────


@router.get("/{evaluator_id}", response_model=EvaluatorResponse)
async def get_evaluator(
    evaluator_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single evaluator by ID."""
    result = await db.execute(
        select(Evaluator).where(Evaluator.id == evaluator_id)
    )
    evaluator = result.scalar_one_or_none()
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found")
    return evaluator


@router.post("", response_model=EvaluatorResponse, status_code=201)
async def create_evaluator(
    body: EvaluatorCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new evaluator."""
    evaluator = Evaluator(**body.model_dump())
    db.add(evaluator)
    await db.commit()
    await db.refresh(evaluator)
    return evaluator


@router.put("/{evaluator_id}", response_model=EvaluatorResponse)
async def update_evaluator(
    evaluator_id: UUID,
    body: EvaluatorUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an evaluator. Only provided fields are updated."""
    result = await db.execute(select(Evaluator).where(Evaluator.id == evaluator_id))
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
    db: AsyncSession = Depends(get_db),
):
    """Delete an evaluator."""
    result = await db.execute(select(Evaluator).where(Evaluator.id == evaluator_id))
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
    db: AsyncSession = Depends(get_db),
):
    """Fork an evaluator for a specific listing (or app-level if listing_id is empty)."""
    result = await db.execute(select(Evaluator).where(Evaluator.id == evaluator_id))
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
        is_global=False,
        show_in_header=source.show_in_header,
        forked_from=source.id,
    )
    db.add(forked)
    await db.commit()
    await db.refresh(forked)
    return forked


@router.put("/{evaluator_id}/global", response_model=EvaluatorResponse)
async def set_global(
    evaluator_id: UUID,
    body: EvaluatorSetGlobal,
    db: AsyncSession = Depends(get_db),
):
    """Set the is_global flag on an evaluator."""
    result = await db.execute(select(Evaluator).where(Evaluator.id == evaluator_id))
    evaluator = result.scalar_one_or_none()
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found")

    evaluator.is_global = body.is_global
    await db.commit()
    await db.refresh(evaluator)
    return evaluator
