"""Base report service with shared cache, data loading, and LLM setup."""

from abc import ABC, abstractmethod
import logging
import uuid
from datetime import datetime, timezone
from uuid import UUID
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eval_run import EvalRun, ThreadEvaluation, AdversarialEvaluation
from app.models.evaluation_analytics import EvaluationAnalytics
from app.schemas.base import CamelModel
from app.services.access_control import readable_scope_clause
from app.services.evaluators.llm_base import LoggingLLMWrapper, create_llm_provider
from app.services.evaluators.runner_utils import save_api_log, make_usage_callback
from app.services.evaluators.settings_helper import get_llm_settings_from_db

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

    async def generate(
        self,
        run_id: str,
        force_refresh: bool = False,
        llm_provider: str | None = None,
        llm_model: str | None = None,
    ) -> CamelModel:
        """Standard single-run report lifecycle for all analytics-enabled apps."""
        run = await self._load_run(run_id)

        if not force_refresh:
            cached = await self._load_cache(run_id, run.app_id)
            if cached:
                validated = self._validate_cached_payload(cached, run_id)
                if validated is not None:
                    return validated

        source_data = await self._load_source_data(run_id)
        payload = await self._build_payload(
            run=run,
            source_data=source_data,
            llm_provider=llm_provider,
            llm_model=llm_model,
            include_narrative=True,
        )
        await self._save_cache(run_id, run.app_id, payload.model_dump(by_alias=True))
        return payload

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

    def _validate_cached_payload(self, cached: dict, run_id: str) -> CamelModel | None:
        try:
            return self.payload_model.model_validate(cached)
        except Exception:
            logger.warning("Report cache corrupted for run %s, regenerating", run_id)
            return None

    # --- Data loading ---

    async def _load_run(self, run_id: str) -> EvalRun:
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
            select(EvalRun).where(
                EvalRun.id == UUID(run_id),
                readable_scope_clause(EvalRun, access_user),
            )
        )
        if not run:
            raise ValueError(f"Eval run not found: {run_id}")
        return run

    async def _load_threads(self, run_id: str) -> list[ThreadEvaluation]:
        result = await self.db.execute(
            select(ThreadEvaluation).where(ThreadEvaluation.run_id == UUID(run_id))
        )
        return list(result.scalars().all())

    async def _load_adversarial(self, run_id: str) -> list[AdversarialEvaluation]:
        result = await self.db.execute(
            select(AdversarialEvaluation).where(
                AdversarialEvaluation.run_id == UUID(run_id)
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
        run: EvalRun,
        source_data: dict[str, Any],
        llm_provider: str | None = None,
        llm_model: str | None = None,
        include_narrative: bool = True,
    ) -> CamelModel:
        """Build the app-specific report payload from loaded source data."""

    # --- Cache ---

    async def _load_cache(self, run_id: str, app_id: str) -> dict | None:
        try:
            result = await self.db.execute(
                select(EvaluationAnalytics.analytics_data).where(
                    EvaluationAnalytics.scope == "single_run",
                    EvaluationAnalytics.run_id == UUID(run_id),
                    EvaluationAnalytics.app_id == app_id,
                    EvaluationAnalytics.tenant_id == self.tenant_id,
                )
            )
            row = result.scalar_one_or_none()
            return row if row else None
        except Exception as e:
            logger.warning("Failed to load cache for run %s: %s", run_id, e)
            return None

    async def _save_cache(self, run_id: str, app_id: str, data: dict) -> None:
        try:
            now = datetime.now(timezone.utc)

            result = await self.db.execute(
                select(EvaluationAnalytics).where(
                    EvaluationAnalytics.scope == "single_run",
                    EvaluationAnalytics.run_id == UUID(run_id),
                    EvaluationAnalytics.app_id == app_id,
                    EvaluationAnalytics.tenant_id == self.tenant_id,
                )
            )
            existing = result.scalar_one_or_none()

            if existing:
                existing.analytics_data = data
                existing.computed_at = now
            else:
                row = EvaluationAnalytics(
                    tenant_id=self.tenant_id,
                    app_id=app_id,
                    scope="single_run",
                    run_id=UUID(run_id),
                    analytics_data=data,
                    computed_at=now,
                )
                self.db.add(row)

            await self.db.commit()
        except Exception as e:
            logger.warning("Failed to cache report for run %s: %s", run_id, e)

    # --- LLM provider setup ---

    async def _create_llm_provider(
        self,
        run: EvalRun,
        thread_id: str,
        provider_override: str | None = None,
        model_override: str | None = None,
    ) -> tuple[LoggingLLMWrapper, str] | tuple[None, None]:
        try:
            settings = await get_llm_settings_from_db(
                tenant_id=self.tenant_id,
                user_id=self.user_id,
                auth_intent="managed_job",
                provider_override=provider_override or None,
            )

            effective_provider = provider_override or settings["provider"]
            effective_model = model_override or settings["selected_model"]

            if not effective_model:
                logger.warning("LLM setup skipped: no model specified")
                return None, None

            factory_kwargs = {}
            if effective_provider == "azure_openai":
                factory_kwargs["azure_endpoint"] = settings.get("azure_endpoint", "")
                factory_kwargs["api_version"] = settings.get("api_version", "")

            provider = create_llm_provider(
                provider=effective_provider,
                api_key=settings["api_key"],
                model_name=effective_model,
                service_account_path=settings.get("service_account_path", ""),
                **factory_kwargs,
            )

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
