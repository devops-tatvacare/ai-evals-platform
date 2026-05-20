"""Base report service with shared data loading and LLM setup."""

from abc import ABC, abstractmethod
import logging
import uuid
from uuid import UUID
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eval_run import EvaluationRun, EvaluationRunThreadResult, EvaluationRunAdversarialResult
from app.schemas.base import CamelModel
from app.services.access_control import readable_scope_clause
from app.services.evaluators.llm_base import LoggingLLMWrapper, create_llm_provider
from app.services.evaluators.runner_utils import save_api_log, make_usage_callback
from app.services.llm_credentials import resolve_llm_call

logger = logging.getLogger(__name__)


class BaseReportService(ABC):
    """Shared plumbing for report generation services.

    Subclasses implement `generate()` with app-specific aggregation and narration.
    """

    payload_model: type[CamelModel]

    def __init__(self, db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID):
        self.db = db
        self.tenant_id = tenant_id
        self.user_id = user_id

    async def build_payload_for_composer(
        self,
        run_id: str,
        *,
        llm_provider: str | None = None,
        llm_model: str | None = None,
        include_narrative: bool = False,
    ) -> CamelModel:
        run = await self._load_run(run_id)
        source_data = await self._load_source_data(run_id)
        return await self._build_payload(
            run=run,
            source_data=source_data,
            llm_provider=llm_provider,
            llm_model=llm_model,
            include_narrative=include_narrative,
        )

    # --- Data loading ---

    async def _load_run(self, run_id: str) -> EvaluationRun:
        access_user = type(
            'AccessUser',
            (),
            {
                'tenant_id': self.tenant_id,
                'user_id': self.user_id,
                'app_access': frozenset(),
            },
        )()
        run = await self.db.scalar(
            select(EvaluationRun).where(
                EvaluationRun.id == UUID(run_id),
                readable_scope_clause(EvaluationRun, access_user),
            )
        )
        if not run:
            raise ValueError(f"Eval run not found: {run_id}")
        return run

    async def _load_threads(self, run_id: str) -> list[EvaluationRunThreadResult]:
        result = await self.db.execute(
            select(EvaluationRunThreadResult).where(EvaluationRunThreadResult.run_id == UUID(run_id))
        )
        return list(result.scalars().all())

    async def _load_adversarial(self, run_id: str) -> list[EvaluationRunAdversarialResult]:
        result = await self.db.execute(
            select(EvaluationRunAdversarialResult).where(
                EvaluationRunAdversarialResult.run_id == UUID(run_id)
            )
        )
        return list(result.scalars().all())

    async def _load_source_data(self, run_id: str) -> dict[str, Any]:
        return {
            "threads": await self._load_threads(run_id),
            "adversarial": await self._load_adversarial(run_id),
        }

    @abstractmethod
    async def _build_payload(
        self,
        run: EvaluationRun,
        source_data: dict[str, Any],
        llm_provider: str | None = None,
        llm_model: str | None = None,
        include_narrative: bool = True,
    ) -> CamelModel:
        """Build the app-specific report payload from loaded source data."""

    # --- LLM provider setup ---

    async def _create_llm_provider(
        self,
        run: EvaluationRun,
        thread_id: str,
        provider_override: str | None = None,
        model_override: str | None = None,
    ) -> tuple[LoggingLLMWrapper, str] | tuple[None, None]:
        try:
            effective_provider = provider_override or run.llm_provider
            effective_model = model_override or run.llm_model

            if not effective_provider:
                logger.warning("LLM setup skipped: no provider specified")
                return None, None
            if not effective_model:
                logger.warning("LLM setup skipped: no model specified")
                return None, None

            resolved = await resolve_llm_call(
                self.db, self.tenant_id, "report_generation",
                provider_override=effective_provider or None,
                model_override=effective_model or None,
            )

            factory_kwargs: dict[str, Any] = {}
            if resolved.provider == "azure_openai":
                factory_kwargs["azure_endpoint"] = resolved.credentials.extra_config.get("base_url") or ""
                factory_kwargs["api_version"] = (
                    resolved.api_version
                    or resolved.credentials.extra_config.get("api_version")
                    or "2025-03-01-preview"
                )

            provider = create_llm_provider(
                provider=resolved.provider,
                api_key=resolved.credentials.secret.get("api_key", ""),
                model_name=resolved.model,
                service_account_path=resolved.credentials.service_account_path or "",
                **factory_kwargs,
            )
            # downstream log attribution should reflect what we used
            effective_provider = resolved.provider
            effective_model = resolved.model

            usage_cb = make_usage_callback(
                tenant_id=self.tenant_id,
                user_id=self.user_id,
                app_id=run.app_id,
                owner_type='eval_run',
                owner_id=run.id,
                subsystem='report_builder',
                default_call_purpose='report_generation',
            )
            llm = LoggingLLMWrapper(
                provider, log_callback=save_api_log, usage_callback=usage_cb,
            )
            llm.set_context(run_id=str(run.id), thread_id=thread_id)
            return llm, effective_model
        except Exception as e:
            logger.warning("LLM setup failed: %s", e)
            return None, None
