"""Adversarial evaluation runner — orchestrates stress tests and persists results.

Goal-framework v3: uses goals + traits (no categories). Each test case has
goal_flow and active_traits. Runner snapshots the full config, passes
generation selections to test-case generation, and persists goal_flow and
active_traits as JSONB on adversarial_evaluations rows.
"""
import logging
import time
import uuid
from typing import Optional, Callable, List

from sqlalchemy import update

from app.config import settings
from app.database import async_session
from app.models.eval_run import AdversarialEvaluation as DBAdversarialEval, EvalRun
from app.services.adversarial_test_case_service import (
    dedupe_test_cases,
    list_saved_test_cases,
    load_retry_test_cases,
    mark_cases_used,
    model_to_runtime,
    payload_to_runtime,
)
from app.services.evaluators.llm_base import (
    BaseLLMProvider, LoggingLLMWrapper, create_llm_provider,
)
from app.services.evaluators.adversarial_evaluator import AdversarialEvaluator
from app.services.evaluators.adversarial_evaluator import (
    normalize_persona_mixing_mode,
    normalize_selected_personas,
)
from app.services.evaluators.adversarial_canonical import build_canonical_adversarial_case
from app.services.evaluators.adversarial_config import (
    load_config_from_db,
)
from app.services.evaluators.credential_lane_scheduler import (
    normalize_kaira_credential_pool,
    run_cases_with_credential_lanes,
)
from app.services.evaluators.kaira_client import KairaClient
from app.services.evaluators.models import serialize
from app.services.evaluators.runner_utils import (
    save_api_log, create_eval_run, finalize_eval_run,
)
from app.services.job_worker import (
    JobCancelledError, is_job_cancelled, safe_error_message, update_job_progress,
)

logger = logging.getLogger(__name__)

ProgressCallback = Callable  # async (job_id, current, total, message) -> None


def _should_generate_cases(case_mode: str) -> bool:
    return case_mode in {"generate", "hybrid"}


def _normalize_identifier_list(values: list[str] | None) -> list[str]:
    normalized: list[str] = []
    for value in values or []:
        candidate = str(value).strip()
        if candidate and candidate not in normalized:
            normalized.append(candidate)
    return normalized


def _normalize_manual_cases(raw_cases: list[dict] | None) -> list:
    cases = []
    for item in raw_cases or []:
        if not isinstance(item, dict):
            continue
        normalized = {
            "synthetic_input": item.get("synthetic_input") or item.get("syntheticInput", ""),
            "difficulty": item.get("difficulty", "MEDIUM"),
            "goal_flow": item.get("goal_flow") or item.get("goalFlow", []),
            "active_traits": item.get("active_traits") or item.get("activeTraits", []),
            "expected_challenges": item.get("expected_challenges") or item.get("expectedChallenges", []),
            "expected_behavior": item.get("expected_behavior") or item.get("expectedBehavior", ""),
        }
        if not normalized["synthetic_input"]:
            continue
        cases.append(payload_to_runtime(normalized))
    return cases


async def _count_pinned_cases(tenant_id: uuid.UUID, user_id: uuid.UUID) -> int:
    async with async_session() as db:
        records = await list_saved_test_cases(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            pinned_only=True,
        )
        return len(records)


async def _load_saved_and_pinned_cases(
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    saved_case_ids: list[uuid.UUID],
    include_pinned_cases: bool,
) -> tuple[list, list[uuid.UUID]]:
    async with async_session() as db:
        selected_records = await list_saved_test_cases(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            ids=saved_case_ids or None,
        ) if saved_case_ids else []
        pinned_records = await list_saved_test_cases(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            pinned_only=True,
        ) if include_pinned_cases else []

        records_by_id = {record.id: record for record in [*pinned_records, *selected_records]}
        used_ids = list(records_by_id.keys())
        if used_ids:
            await mark_cases_used(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                case_ids=used_ids,
            )
        runtime_cases = [model_to_runtime(record) for record in records_by_id.values()]
        return runtime_cases, used_ids


async def _resolve_test_cases(
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    evaluator: AdversarialEvaluator,
    case_mode: str,
    test_count: int,
    thinking: str,
    extra_instructions: Optional[str],
    selected_goals: Optional[List[str]],
    selected_traits: Optional[List[str]],
    selected_personas: Optional[List[str]],
    persona_mixing_mode: str,
    flow_mode: str,
    saved_case_ids: list[uuid.UUID],
    include_pinned_cases: bool,
    manual_cases: list[dict] | None,
    retry_eval_ids: list[int],
    source_run_id: uuid.UUID | None,
) -> tuple[list, dict]:
    generated_cases = []
    if _should_generate_cases(case_mode):
        generated_cases = await evaluator.generate_test_cases(
            test_count,
            thinking=thinking,
            extra_instructions=extra_instructions,
            selected_goals=selected_goals,
            selected_traits=selected_traits,
            flow_mode=flow_mode,
            selected_personas=selected_personas,
            persona_mixing_mode=persona_mixing_mode,
        )

    saved_cases, used_saved_case_ids = await _load_saved_and_pinned_cases(
        tenant_id=tenant_id,
        user_id=user_id,
        saved_case_ids=saved_case_ids,
        include_pinned_cases=include_pinned_cases,
    )
    manual_runtime_cases = _normalize_manual_cases(manual_cases)

    retry_cases = []
    if retry_eval_ids:
        if not source_run_id:
            raise RuntimeError("source_run_id is required when retry_eval_ids are provided")
        async with async_session() as db:
            retry_cases = await load_retry_test_cases(
                db,
                run_id=source_run_id,
                eval_ids=retry_eval_ids,
            )

    combined_cases = dedupe_test_cases(
        [
            *retry_cases,
            *saved_cases,
            *manual_runtime_cases,
            *generated_cases,
        ]
    )
    source_summary = {
        "case_mode": case_mode,
        "generated_count": len(generated_cases),
        "saved_count": len(saved_cases),
        "manual_count": len(manual_runtime_cases),
        "retry_count": len(retry_cases),
        "include_pinned_cases": include_pinned_cases,
        "saved_case_ids": [str(case_id) for case_id in used_saved_case_ids],
        "retry_eval_ids": retry_eval_ids,
        "source_run_id": str(source_run_id) if source_run_id else None,
    }
    return combined_cases, source_summary





async def run_adversarial_evaluation(
    job_id,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    kaira_test_user_id: str = "",
    kaira_credential_pool: Optional[list[dict]] = None,
    kaira_api_url: str = "",
    kaira_auth_token: str = "",
    test_count: int = 15,
    turn_delay: float = 1.5,
    case_delay: float = 3.0,
    max_turns: int = settings.ADVERSARIAL_MAX_TURNS,
    llm_provider: str = "gemini",
    llm_model: Optional[str] = None,
    api_key: str = "",
    temperature: float = 0.1,
    progress_callback: Optional[ProgressCallback] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
    timeouts: Optional[dict] = None,
    parallel_cases: bool = False,
    case_workers: int = 1,
    thinking: str = "low",
    selected_goals: Optional[List[str]] = None,
    selected_traits: Optional[List[str]] = None,
    selected_rule_ids: Optional[List[str]] = None,
    selected_personas: Optional[List[str]] = None,
    persona_mixing_mode: str = "single",
    flow_mode: str = "single",
    extra_instructions: Optional[str] = None,
    case_mode: str = "generate",
    saved_case_ids: Optional[List[str]] = None,
    manual_cases: Optional[list[dict]] = None,
    include_pinned_cases: bool = False,
    retry_eval_ids: Optional[List[int]] = None,
    source_run_id: Optional[str] = None,
    kaira_timeout: float = 120,
    azure_endpoint: str = "",
    api_version: str = "",
) -> dict:
    """Run adversarial stress test against live Kaira API."""
    start_time = time.monotonic()
    run_id = uuid.uuid4()
    resolved_credentials = normalize_kaira_credential_pool(
        kaira_credential_pool,
        fallback_user_id=kaira_test_user_id,
        fallback_auth_token=kaira_auth_token,
    )
    if not resolved_credentials:
        raise RuntimeError("At least one Kaira credential pair is required")
    saved_case_uuid_ids = [uuid.UUID(str(case_id)) for case_id in (saved_case_ids or [])]
    retry_case_ids = [int(case_id) for case_id in (retry_eval_ids or [])]
    source_run_uuid = uuid.UUID(str(source_run_id)) if source_run_id else None
    requested_total = len(saved_case_uuid_ids) + len(_normalize_manual_cases(manual_cases)) + len(retry_case_ids)
    if include_pinned_cases:
        requested_total += await _count_pinned_cases(tenant_id, user_id)
    if _should_generate_cases(case_mode):
        requested_total += max(test_count, 0)
    requested_total = max(requested_total, test_count if _should_generate_cases(case_mode) else 0)

    # Resolve adversarial config (from DB or defaults)
    config = (await load_config_from_db(tenant_id=tenant_id, user_id=user_id)).model_copy(deep=True)
    resolved_selected_goal_ids: Optional[list[str]] = None
    if selected_goals is not None:
        resolved_selected_goal_ids = _normalize_identifier_list(selected_goals)
        if not resolved_selected_goal_ids:
            raise RuntimeError("At least one contract goal must be selected")
        enabled_goal_ids = set(config.enabled_goal_ids)
        resolved_selected_goal_ids = [
            goal_id for goal_id in resolved_selected_goal_ids if goal_id in enabled_goal_ids
        ]
        if not resolved_selected_goal_ids:
            raise RuntimeError("No enabled contract goals matched selected_goals")
    resolved_selected_trait_ids: Optional[list[str]] = None
    if selected_traits is not None:
        requested_trait_ids = _normalize_identifier_list(selected_traits)
        enabled_trait_ids = set(config.enabled_trait_ids)
        resolved_selected_trait_ids = [
            trait_id for trait_id in requested_trait_ids if trait_id in enabled_trait_ids
        ]
        if requested_trait_ids and not resolved_selected_trait_ids:
            raise RuntimeError("No enabled contract traits matched selected_traits")
    resolved_selected_rule_ids = _normalize_identifier_list(selected_rule_ids)
    if resolved_selected_rule_ids:
        enabled_adversarial_rule_ids = {
            rule.rule_id for rule in config.prompt_rules_for_scope("adversarial")
        }
        resolved_selected_rule_ids = [
            rule_id for rule_id in resolved_selected_rule_ids if rule_id in enabled_adversarial_rule_ids
        ]
        if not resolved_selected_rule_ids:
            raise RuntimeError("No enabled adversarial contract rules matched selected_rule_ids")
    resolved_selected_personas = normalize_selected_personas(selected_personas)
    resolved_persona_mixing_mode = normalize_persona_mixing_mode(persona_mixing_mode)

    # Build snapshot of resolved config for audit
    config_snapshot = {
        **config.snapshot(),
        "flow_mode": flow_mode,
        "selected_rule_ids": resolved_selected_rule_ids,
        "selected_personas": resolved_selected_personas,
        "persona_mixing_mode": resolved_persona_mixing_mode,
    }

    # Create eval run record FIRST so failures are always visible in the UI
    await create_eval_run(
        id=run_id,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id="kaira-bot",
        eval_type="batch_adversarial",
        job_id=job_id,
        llm_provider=llm_provider or "gemini",
        llm_model=llm_model or "",
        config={
            "kaira_api_url": kaira_api_url,
            "kaira_credential_pool": resolved_credentials,
        },
        batch_metadata={
            "name": name,
            "description": description,
            "command": "adversarial",
            "eval_temperature": temperature,
            "total_items": requested_total,
            "thinking": thinking,
            "adversarial_config": config_snapshot,
            "extra_instructions": extra_instructions,
            "flow_mode": flow_mode,
            "turn_delay": turn_delay,
            "case_delay": case_delay,
            "max_turns": max_turns,
            "parallel_cases": parallel_cases,
            "case_workers": case_workers,
            "kaira_api_url": kaira_api_url,
            "kaira_timeout": kaira_timeout,
            "credential_pool_size": len(resolved_credentials),
            "credential_user_ids": [credential["user_id"] for credential in resolved_credentials],
            "case_mode": case_mode,
            "saved_case_ids": [str(case_id) for case_id in saved_case_uuid_ids],
            "manual_case_count": len(_normalize_manual_cases(manual_cases)),
            "include_pinned_cases": include_pinned_cases,
            "retry_eval_ids": retry_case_ids,
            "selected_goals": resolved_selected_goal_ids,
            "selected_traits": resolved_selected_trait_ids,
            "selected_rule_ids": resolved_selected_rule_ids,
            "selected_personas": resolved_selected_personas,
            "persona_mixing_mode": resolved_persona_mixing_mode,
            "source_run_id": str(source_run_uuid) if source_run_uuid else None,
        },
    )

    # Write run_id to job progress so frontend can redirect early
    await update_job_progress(
        job_id, 0, requested_total or test_count, "Initializing...", run_id=str(run_id),
    )

    # Resolve API key from settings if not provided
    sa_path = ""
    db_settings = None
    auth_method = "api_key"  # default when caller provides api_key directly
    if not api_key:
        from app.services.evaluators.settings_helper import get_llm_settings_from_db
        db_settings = await get_llm_settings_from_db(
            tenant_id=tenant_id, user_id=user_id,
            auth_intent="managed_job", provider_override=llm_provider or None,
        )
        api_key = db_settings["api_key"]
        sa_path = db_settings.get("service_account_path", "")
        auth_method = db_settings.get("auth_method", "api_key")
        if not llm_provider:
            llm_provider = db_settings["provider"]
        if not llm_model:
            llm_model = db_settings["selected_model"]

    # Create LLM provider with logging wrapper
    if not azure_endpoint and llm_provider == "azure_openai":
        azure_endpoint = db_settings.get("azure_endpoint", "") if db_settings else ""
        api_version = db_settings.get("api_version", "") if db_settings else ""
    inner_llm = create_llm_provider(
        provider=llm_provider, api_key=api_key,
        model_name=llm_model or "", temperature=temperature,
        service_account_path=sa_path,
        azure_endpoint=azure_endpoint, api_version=api_version,
    )
    llm: BaseLLMProvider = LoggingLLMWrapper(inner_llm, log_callback=save_api_log)
    if timeouts:
        llm.set_timeouts(timeouts)
    llm.set_context(str(run_id))

    # Update run with resolved model name and auth method
    async with async_session() as db:
        await db.execute(
            update(EvalRun).where(EvalRun.id == run_id, EvalRun.tenant_id == tenant_id).values(
                llm_provider=llm_provider, llm_model=inner_llm.model_name,
                config={
                    "auth_method": auth_method,
                    "kaira_api_url": kaira_api_url,
                    "kaira_credential_pool": resolved_credentials,
                },
            )
        )
        await db.commit()

    # Create adversarial evaluator
    evaluator = AdversarialEvaluator(
        llm,
        config=config,
        max_turns=max_turns,
        selected_rule_ids=resolved_selected_rule_ids,
    )

    async def report_progress(current: int, total: int, message: str, **extra):
        await update_job_progress(
            job_id, current, total, message, run_id=str(run_id), **extra,
        )

    # Determine effective concurrency
    effective_concurrency = min(
        case_workers if parallel_cases else 1,
        len(resolved_credentials),
    )

    try:
        # Phase 1: Resolve requested test cases
        await report_progress(
            0,
            requested_total or test_count,
            "Preparing test cases...",
            details={
                "phase": "prepare_cases",
                "caseMode": case_mode,
            },
        )
        llm.set_test_case_label("Test Case Preparation")
        cases, case_source_summary = await _resolve_test_cases(
            tenant_id=tenant_id,
            user_id=user_id,
            evaluator=evaluator,
            case_mode=case_mode,
            test_count=test_count,
            thinking=thinking,
            extra_instructions=extra_instructions,
            selected_goals=resolved_selected_goal_ids,
            selected_traits=resolved_selected_trait_ids,
            selected_personas=resolved_selected_personas,
            persona_mixing_mode=resolved_persona_mixing_mode,
            flow_mode=flow_mode,
            saved_case_ids=saved_case_uuid_ids,
            include_pinned_cases=include_pinned_cases,
            manual_cases=manual_cases,
            retry_eval_ids=retry_case_ids,
            source_run_id=source_run_uuid,
        )
        llm.set_test_case_label(None)
        if not cases:
            raise RuntimeError("No adversarial test cases were selected or generated")
        actual_total = len(cases)
        async with async_session() as db:
            run = await db.get(EvalRun, run_id)
            if run and isinstance(run.batch_metadata, dict):
                run.batch_metadata = {
                    **run.batch_metadata,
                    "total_items": actual_total,
                    "case_source_summary": case_source_summary,
                }
                await db.commit()
        await report_progress(
            0,
            actual_total,
            "Running test cases...",
            details={
                "phase": "execution",
                **case_source_summary,
            },
        )

        # Phase 2: Run each test case with per-case error boundary.

        async def _evaluate_one_case(_index: int, tc, credential: dict, client: KairaClient, _lane_index: int) -> dict:
            """Evaluate a single adversarial test case on an assigned credential lane."""
            goals_label = "+".join(tc.goal_flow)
            case_label = f"Case {_index + 1}: {goals_label} [{credential['user_id']}]"

            worker_llm = llm.clone_for_thread(f"adversarial-{_index}") if effective_concurrency > 1 else llm
            worker_llm.set_test_case_label(case_label)
            worker_evaluator = AdversarialEvaluator(
                worker_llm,
                config=config,
                max_turns=max_turns,
                selected_rule_ids=resolved_selected_rule_ids,
            ) if effective_concurrency > 1 else evaluator

            i = _index + 1
            logger.info(f"Running live test {i}/{len(cases)}: {goals_label} on {credential['user_id']}")

            # Resolve goals for this test case's flow
            tc_goals = worker_evaluator.get_goals_for_test_case(tc)
            trait_hints_by_id = worker_evaluator.get_trait_hints_for_test_case(tc)

            transcript = None
            try:
                transcript = await worker_evaluator.conversation_agent.run_conversation(
                    test_case=tc, goals=tc_goals, client=client, user_id=credential["user_id"],
                    turn_delay=turn_delay, thinking=thinking, test_case_label=case_label,
                    trait_hints_by_id=trait_hints_by_id,
                )

                evaluation = await worker_evaluator.evaluate_transcript(tc, transcript, thinking=thinking)
                result_data = serialize(evaluation)
                result_data["execution_context"] = {"credential_user_id": credential["user_id"]}
                result_data["canonical_case"] = build_canonical_adversarial_case(
                    result_data,
                    row_verdict=evaluation.verdict,
                    row_goal_achieved=evaluation.goal_achieved,
                    row_goal_flow=tc.goal_flow,
                    row_active_traits=tc.active_traits,
                    row_total_turns=evaluation.transcript.total_turns,
                    contract_snapshot=config_snapshot,
                )
                canonical_case = result_data["canonical_case"]

                async with async_session() as db:
                    db.add(DBAdversarialEval(
                        run_id=run_id,
                        difficulty=tc.difficulty,
                        verdict=canonical_case["judge"]["verdict"],
                        goal_achieved=canonical_case["judge"]["goalAchieved"],
                        total_turns=evaluation.transcript.total_turns,
                        goal_flow=tc.goal_flow,
                        active_traits=tc.active_traits,
                        result=result_data,
                    ))
                    await db.commit()

                logger.info(
                    f"  -> {canonical_case['judge']['verdict']} (Goal: {canonical_case['judge']['goalAchieved']})"
                )
                return {
                    "verdict": canonical_case["judge"]["verdict"],
                    "goal_flow": tc.goal_flow,
                    "goal_achieved": canonical_case["judge"]["goalAchieved"],
                    "canonical_case": canonical_case,
                    "credential_user_id": credential["user_id"],
                }

            except JobCancelledError:
                raise

            except Exception as e:
                logger.error(f"Test case {i}/{len(cases)} ({goals_label}) failed: {e}")

                result_data = {
                    "test_case": serialize(tc),
                    "error": safe_error_message(e),
                    "execution_context": {"credential_user_id": credential["user_id"]},
                }
                if transcript:
                    result_data["transcript"] = serialize(transcript)
                result_data["canonical_case"] = build_canonical_adversarial_case(
                    result_data,
                    row_verdict=None,
                    row_goal_achieved=False,
                    row_goal_flow=tc.goal_flow,
                    row_active_traits=tc.active_traits,
                    row_total_turns=transcript.total_turns if transcript else 0,
                    contract_snapshot=config_snapshot,
                )
                canonical_case = result_data["canonical_case"]

                try:
                    async with async_session() as db:
                        db.add(DBAdversarialEval(
                            run_id=run_id,
                            difficulty=tc.difficulty,
                            verdict=None,
                            goal_achieved=False,
                            total_turns=transcript.total_turns if transcript else 0,
                            goal_flow=tc.goal_flow,
                            active_traits=tc.active_traits,
                            result=result_data,
                        ))
                        await db.commit()
                except Exception as save_err:
                    logger.warning(f"Failed to save error record for test case {i} ({goals_label}): {save_err}")

                return {
                    "verdict": None,
                    "goal_flow": tc.goal_flow,
                    "goal_achieved": False,
                    "canonical_case": canonical_case,
                    "credential_user_id": credential["user_id"],
                }

        async def _progress_bridge(current: int, total_count: int, message: str):
            await report_progress(current, total_count, message)

        def _progress_message(ok: int, err: int, current: int, tot: int) -> str:
            return f"Test case {current}/{tot} ({ok} ok, {err} errors)"

        case_results = await run_cases_with_credential_lanes(
            cases=cases,
            credentials=resolved_credentials,
            worker=_evaluate_one_case,
            concurrency=effective_concurrency,
            job_id=job_id,
            tenant_id=tenant_id,
            progress_callback=_progress_bridge,
            progress_message=_progress_message,
            inter_item_delay=case_delay,
            client_factory=lambda credential: KairaClient(
                auth_token=credential["auth_token"],
                base_url=kaira_api_url,
                log_callback=save_api_log,
                run_id=str(run_id),
                timeout=kaira_timeout,
            ),
            is_job_cancelled=is_job_cancelled,
            cancelled_error_cls=JobCancelledError,
        )

        # Aggregate results from worker return values
        verdicts: dict[str, int] = {}
        goal_counts: dict[str, int] = {}
        infra_error_count = 0
        goal_achieved_count = 0
        for r in case_results:
            if isinstance(r, BaseException):
                infra_error_count += 1
                continue
            canonical_case = r.get("canonical_case") or {}
            for goal_verdict in canonical_case.get("judge", {}).get("goalVerdicts", []):
                goal_id = goal_verdict.get("goalId", "unknown")
                goal_counts[goal_id] = goal_counts.get(goal_id, 0) + 1
            if canonical_case.get("derived", {}).get("isInfraFailure"):
                infra_error_count += 1
            if r.get("verdict"):
                verdicts[r["verdict"]] = verdicts.get(r["verdict"], 0) + 1
            if canonical_case.get("judge", {}).get("goalAchieved"):
                goal_achieved_count += 1

        # Finalize
        duration = time.monotonic() - start_time
        total_cases = len(cases)
        summary = {
            "total_tests": total_cases,
            "verdict_distribution": verdicts,
            "goal_distribution": goal_counts,
            "goal_achieved_count": goal_achieved_count,
            "errors": infra_error_count,
            "infra_error_count": infra_error_count,
            "flow_mode": flow_mode,
            "case_mode": case_mode,
            "case_sources": case_source_summary,
        }

        if infra_error_count == total_cases:
            final_status = "failed"
        elif infra_error_count > 0:
            final_status = "completed_with_errors"
        else:
            final_status = "completed"

        await finalize_eval_run(
            run_id,
            tenant_id,
            status=final_status,
            duration_ms=round(duration * 1000, 2),
            summary=summary,
        )

        return {"run_id": str(run_id), "duration_seconds": round(duration, 2), **summary}

    except JobCancelledError:
        duration = time.monotonic() - start_time
        summary = {"cancelled": True}
        await finalize_eval_run(
            run_id,
            tenant_id,
            status="cancelled",
            duration_ms=round(duration * 1000, 2),
            summary=summary,
        )
        logger.info(f"Adversarial run {run_id} cancelled")
        return {"run_id": str(run_id), "cancelled": True}

    except Exception as e:
        await finalize_eval_run(
            run_id,
            tenant_id,
            status="failed",
            duration_ms=round((time.monotonic() - start_time) * 1000, 2),
            error_message=safe_error_message(e),
        )
        raise
