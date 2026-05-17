"""Live model discovery against a tenant-owned credential row.

Two entry points:

    list_models_for_credential(db, credential) -> list[str]
        Used by ``/api/admin/ai-settings/credentials/{id}/discover-models``.
        Reads ``provider`` from the credential row itself, decrypts the
        ``secret_blob_encrypted`` via the resolver, then either hits the
        upstream API or (for Azure) joins the deployments table with the
        catalog.

    validate_credentials(creds) -> None
        Connectivity probe used by ``/api/admin/ai-settings/credentials/{id}/validate``.
        For Azure, hits the resource directly so an empty deployment list can
        still surface auth/endpoint problems. For other providers, runs the
        same listing flow.

Raises ``ValueError`` on credential / auth failures (caller maps to
``validation_status='invalid'``). Other errors (network, transient SDK
failures) propagate so unexpected bugs surface instead of being swallowed.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost import RefLlmModelsCatalog
from app.models.tenant_llm_credential import TenantLlmCredential
from app.models.tenant_llm_deployment import TenantLlmDeployment
from app.services.llm_credentials import ResolvedCredentials
from app.services.llm_credentials.crypto import decrypt_json


logger = logging.getLogger(__name__)


def _dedupe_preserving_order(names: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def _resolved_from_row(row: TenantLlmCredential) -> ResolvedCredentials:
    """Decrypt the row's secret blob into an in-memory ResolvedCredentials.

    Bypasses the cache deliberately — admin operations want fresh reads.
    """
    secret = decrypt_json(row.secret_blob_encrypted)
    if not isinstance(secret, dict):
        secret = {}
    return ResolvedCredentials(
        provider=row.provider,
        name=row.name,
        secret=dict(secret),
        extra_config=dict(row.extra_config or {}),
        service_account_path=None,
    )


async def list_models_for_credential(
    db: AsyncSession, credential: TenantLlmCredential
) -> list[str]:
    """Return the live model id list for one credential row.

    - ``openai`` / ``anthropic`` / ``gemini`` / ``vertex`` / ``bedrock``
      query the upstream provider SDK ``models.list`` (or equivalent).
    - ``azure_openai`` is forward-declared via
      ``platform.tenant_llm_deployments``; we join with
      ``analytics.ref_llm_models_catalog`` and return the deployment names
      (operator-facing string), excluding rows still flagged
      ``needs_mapping``.
    """
    provider = credential.provider
    if provider == "azure_openai":
        return await _list_azure_deployments(db, credential)

    creds = _resolved_from_row(credential)
    if provider == "openai":
        return await _list_openai(creds)
    if provider == "anthropic":
        return await _list_anthropic(creds)
    if provider == "gemini":
        return await _list_gemini(creds)
    if provider == "vertex":
        return await _list_vertex(creds)
    if provider == "bedrock":
        return await _list_bedrock(creds)
    raise ValueError(f"Unsupported provider for model discovery: {provider}")


async def validate_credentials(
    db: AsyncSession, credential: TenantLlmCredential
) -> None:
    """Hit the upstream provider with the stored credential to confirm auth.

    Azure has no public key-based deployment listing — we call
    ``client.models.list()`` directly so a 401/403 surfaces as ``ValueError``.
    Other providers reuse the listing flow.
    """
    if credential.provider == "azure_openai":
        await _validate_azure(_resolved_from_row(credential))
        return
    await list_models_for_credential(db, credential)


# ── Per-provider listing helpers ─────────────────────────────────────


async def _list_openai(creds: ResolvedCredentials) -> list[str]:
    api_key = creds.secret.get("api_key", "")
    if not api_key:
        raise ValueError("OpenAI API key not configured")
    try:
        import openai
    except ImportError as exc:
        raise ValueError(f"openai SDK unavailable: {exc}") from exc
    client = openai.OpenAI(
        api_key=api_key, base_url=creds.extra_config.get("base_url") or None
    )
    try:
        raw = await asyncio.to_thread(lambda: list(client.models.list()))
    except openai.AuthenticationError as exc:
        raise ValueError(f"OpenAI authentication failed: {exc}") from exc
    except openai.PermissionDeniedError as exc:
        raise ValueError(f"OpenAI permission denied: {exc}") from exc
    names = [m.id for m in raw if getattr(m, "id", None)]
    names.sort()
    return _dedupe_preserving_order(names)


async def _list_anthropic(creds: ResolvedCredentials) -> list[str]:
    api_key = creds.secret.get("api_key", "")
    if not api_key:
        raise ValueError("Anthropic API key not configured")
    try:
        import anthropic
    except ImportError as exc:
        raise ValueError(f"anthropic SDK unavailable: {exc}") from exc
    client = anthropic.Anthropic(api_key=api_key)
    try:
        raw = await asyncio.to_thread(lambda: list(client.models.list()))
    except anthropic.AuthenticationError as exc:
        raise ValueError(f"Anthropic authentication failed: {exc}") from exc
    except anthropic.PermissionDeniedError as exc:
        raise ValueError(f"Anthropic permission denied: {exc}") from exc
    names = [m.id for m in raw if getattr(m, "id", None)]
    names.sort()
    return _dedupe_preserving_order(names)


async def _list_gemini(creds: ResolvedCredentials) -> list[str]:
    """Google AI Studio (API key) path."""
    api_key = creds.secret.get("api_key", "")
    sa_path = creds.service_account_path or ""
    try:
        from google import genai
    except ImportError as exc:
        raise ValueError(f"google-genai SDK unavailable: {exc}") from exc

    if sa_path and os.path.isfile(sa_path):
        # System-tenant SA fallback (only reachable on the SYSTEM tenant).
        import json as _json

        from google.oauth2 import service_account

        with open(sa_path) as f:
            sa_info = _json.load(f)
        project_id = sa_info.get("project_id", "")
        sa_creds = service_account.Credentials.from_service_account_file(
            sa_path, scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        client = genai.Client(vertexai=True, project=project_id, credentials=sa_creds)
    elif api_key:
        client = genai.Client(api_key=api_key)
    else:
        raise ValueError("Gemini credentials missing: no API key and no service account")

    return await _collect_gemini_models(client)


async def _list_vertex(creds: ResolvedCredentials) -> list[str]:
    """Vertex AI (service-account-JSON) path — distinct from Gemini API-key path."""
    sa_json_str = creds.secret.get("service_account_json", "")
    if not sa_json_str:
        raise ValueError("Vertex credentials missing service_account_json")
    try:
        from google import genai
        from google.oauth2 import service_account
    except ImportError as exc:
        raise ValueError(f"google-genai/google-auth SDK unavailable: {exc}") from exc

    try:
        sa_info = json.loads(sa_json_str)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Vertex service_account_json is not valid JSON: {exc}") from exc
    project_id = creds.extra_config.get("project_id") or sa_info.get("project_id", "")
    if not project_id:
        raise ValueError("Vertex credentials missing project_id")
    sa_creds = service_account.Credentials.from_service_account_info(
        sa_info, scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    client_kwargs: dict = {
        "vertexai": True, "project": project_id, "credentials": sa_creds,
    }
    location = creds.extra_config.get("location")
    if location:
        client_kwargs["location"] = location
    client = genai.Client(**client_kwargs)
    return await _collect_gemini_models(client)


async def _collect_gemini_models(client) -> list[str]:
    def _collect() -> list[str]:
        names: list[str] = []
        for model in client.models.list():
            name = getattr(model, "name", None) or ""
            if not name or "gemini" not in name or "embedding" in name:
                continue
            for prefix in (
                "publishers/google/models/",
                "publishers/google/",
                "models/",
            ):
                if name.startswith(prefix):
                    name = name[len(prefix):]
                    break
            names.append(name)
        names.sort()
        return names

    return _dedupe_preserving_order(await asyncio.to_thread(_collect))


async def _list_bedrock(creds: ResolvedCredentials) -> list[str]:
    """Bedrock model listing via boto3.

    Bedrock model IDs follow ``anthropic.claude-<variant>-<date>-v<rev>:<level>``.
    Optional — requires ``boto3`` installed at runtime; raises ``ValueError`` if
    the SDK is missing or the IAM principal lacks ``bedrock:ListFoundationModels``.
    """
    access_key_id = creds.secret.get("access_key_id", "")
    secret_access_key = creds.secret.get("secret_access_key", "")
    if not access_key_id or not secret_access_key:
        raise ValueError("Bedrock credentials missing access_key_id / secret_access_key")
    try:
        import boto3  # type: ignore[import-untyped]
        from botocore.exceptions import ClientError  # type: ignore[import-untyped]
    except ImportError as exc:
        raise ValueError(f"boto3 SDK unavailable: {exc}") from exc

    region = creds.extra_config.get("default_region") or "us-east-1"
    session_token = creds.secret.get("session_token") or None

    def _list_sync() -> list[str]:
        client = boto3.client(
            "bedrock",
            region_name=region,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            aws_session_token=session_token,
        )
        try:
            resp = client.list_foundation_models()
        except ClientError as exc:
            raise ValueError(f"Bedrock list_foundation_models failed: {exc}") from exc
        summaries = resp.get("modelSummaries", []) or []
        out: list[str] = []
        for m in summaries:
            model_id = m.get("modelId")
            if model_id:
                out.append(str(model_id))
        out.sort()
        return out

    return _dedupe_preserving_order(await asyncio.to_thread(_list_sync))


async def _list_azure_deployments(
    db: AsyncSession, credential: TenantLlmCredential
) -> list[str]:
    """Return mapped Azure deployment names for this credential.

    Rows still flagged ``needs_mapping`` are excluded — admin must map them
    via the Phase-3 editor before they appear in dropdowns.
    """
    rows = (
        await db.execute(
            select(TenantLlmDeployment.deployment_name)
            .where(
                TenantLlmDeployment.credential_id == credential.id,
                TenantLlmDeployment.enabled.is_(True),
                TenantLlmDeployment.needs_mapping.is_(False),
                TenantLlmDeployment.canonical_model_id.is_not(None),
            )
            .order_by(TenantLlmDeployment.deployment_name)
        )
    ).scalars().all()
    return _dedupe_preserving_order(list(rows))


async def _validate_azure(creds: ResolvedCredentials) -> None:
    """Hit the Azure resource with the saved key + endpoint + api_version.

    Uses ``client.models.list()``, which the Azure data-plane exposes at
    ``GET /openai/models?api-version=...`` for key-authenticated callers.
    A 401/403 surfaces as ``ValueError``; other failures propagate.
    """
    api_key = creds.secret.get("api_key", "")
    base_url = creds.extra_config.get("base_url") or ""
    if not api_key:
        raise ValueError("Azure OpenAI API key not configured")
    if not base_url:
        raise ValueError("Azure OpenAI endpoint not configured")
    try:
        import openai
    except ImportError as exc:
        raise ValueError(f"openai SDK unavailable: {exc}") from exc
    client = openai.AzureOpenAI(
        api_key=api_key,
        azure_endpoint=base_url,
        api_version=creds.extra_config.get("api_version") or "2025-04-01-preview",
    )
    try:
        await asyncio.to_thread(lambda: list(client.models.list()))
    except openai.AuthenticationError as exc:
        raise ValueError(f"Azure OpenAI authentication failed: {exc}") from exc
    except openai.PermissionDeniedError as exc:
        raise ValueError(f"Azure OpenAI permission denied: {exc}") from exc
    except openai.NotFoundError as exc:
        # Wrong endpoint or wrong api_version comes back as 404.
        raise ValueError(f"Azure OpenAI endpoint/api-version invalid: {exc}") from exc


# Catalog helper — used by Phase 2 capability gating but lives next to
# discovery so both surfaces share one DB module.
async def list_catalog_models(
    db: AsyncSession, provider: str | None = None
) -> list[RefLlmModelsCatalog]:
    stmt = select(RefLlmModelsCatalog).where(
        RefLlmModelsCatalog.status == "active"
    )
    if provider:
        stmt = stmt.where(RefLlmModelsCatalog.provider == provider)
    return list((await db.execute(stmt)).scalars().all())
