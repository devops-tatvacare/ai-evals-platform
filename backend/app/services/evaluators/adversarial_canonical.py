"""Canonical adversarial case adapters for persistence, API, and analytics."""

from __future__ import annotations

from typing import Any

from app.services.evaluators.models import (
    normalize_adversarial_failure_mode,
    normalize_rule_outcome_status,
)

_TECHNICAL_FAILURE_MODES = {
    "TECHNICAL_ERROR",
    "BOT_CRASHED",
    "EMPTY_RESPONSE",
    "USER_VISIBLE_INTERNAL_ERROR",
}


def normalize_adversarial_verdict(raw_verdict: str | None) -> str | None:
    if not raw_verdict:
        return None
    return str(raw_verdict).replace("_", " ").upper()


def _normalize_test_case(
    result: dict[str, Any],
    *,
    row_goal_flow: list[str] | None,
    row_active_traits: list[str] | None,
) -> dict[str, Any]:
    test_case = result.get("test_case") or result.get("testCase") or {}
    return {
        "goalFlow": list(test_case.get("goal_flow") or test_case.get("goalFlow") or row_goal_flow or []),
        "difficulty": test_case.get("difficulty"),
        "activeTraits": list(test_case.get("active_traits") or test_case.get("activeTraits") or row_active_traits or []),
        "syntheticInput": test_case.get("synthetic_input") or test_case.get("syntheticInput") or "",
        "expectedChallenges": list(test_case.get("expected_challenges") or test_case.get("expectedChallenges") or []),
    }


def _normalize_transcript(result: dict[str, Any], *, row_total_turns: int | None) -> dict[str, Any]:
    transcript = result.get("transcript") or {}
    turns = list(transcript.get("turns") or [])
    turn_count = transcript.get("total_turns")
    if turn_count is None:
        turn_count = transcript.get("turnCount")
    if turn_count is None:
        turn_count = row_total_turns if row_total_turns is not None else len(turns)
    return {
        "turns": turns,
        "turnCount": turn_count,
    }


def _normalize_transport(result: dict[str, Any]) -> dict[str, Any]:
    transcript = result.get("transcript") or {}
    transport = transcript.get("transport") or result.get("transport") or {}
    error_message = result.get("error")
    http_errors = list(transport.get("http_errors") or transport.get("httpErrors") or [])
    if error_message and not http_errors:
        http_errors = [str(error_message)]
    return {
        "hadHttpError": bool(transport.get("had_http_error") or transport.get("hadHttpError") or (error_message and not transport.get("had_timeout"))),
        "hadStreamError": bool(transport.get("had_stream_error") or transport.get("hadStreamError")),
        "hadTimeout": bool(transport.get("had_timeout") or transport.get("hadTimeout")),
        "hadEmptyFinalAssistantMessage": bool(
            transport.get("had_empty_final_assistant_message")
            or transport.get("hadEmptyFinalAssistantMessage")
        ),
        "hadPartialResponse": bool(transport.get("had_partial_response") or transport.get("hadPartialResponse")),
        "httpErrors": http_errors,
        "streamErrors": list(transport.get("stream_errors") or transport.get("streamErrors") or []),
    }


def _normalize_simulator(result: dict[str, Any], *, row_goal_achieved: bool | None) -> dict[str, Any]:
    transcript = result.get("transcript") or {}
    simulator = transcript.get("simulator") or result.get("simulator") or {}
    goals_attempted = list(
        simulator.get("goals_attempted")
        or simulator.get("goalsAttempted")
        or transcript.get("goals_attempted")
        or []
    )
    goals_completed = list(
        simulator.get("goals_completed")
        or simulator.get("goalsCompleted")
        or transcript.get("goals_completed")
        or []
    )
    goals_abandoned = list(
        simulator.get("goals_abandoned")
        or simulator.get("goalsAbandoned")
        or transcript.get("goals_abandoned")
        or []
    )
    goal_transitions = list(
        simulator.get("goal_transitions")
        or simulator.get("goalTransitions")
        or transcript.get("goal_transitions")
        or []
    )
    goal_achieved = simulator.get("goal_achieved")
    if goal_achieved is None:
        goal_achieved = simulator.get("goalAchieved")
    if goal_achieved is None:
        goal_achieved = transcript.get("goal_achieved")
    if goal_achieved is None:
        goal_achieved = row_goal_achieved
    goal_abandoned = simulator.get("goal_abandoned")
    if goal_abandoned is None:
        goal_abandoned = simulator.get("goalAbandoned")
    if goal_abandoned is None:
        goal_abandoned = bool(goals_abandoned)
    failure_reason = (
        simulator.get("failure_reason")
        or simulator.get("failureReason")
        or transcript.get("failure_reason")
        or transcript.get("abandonment_reason")
        or ""
    )
    return {
        "goalAchieved": bool(goal_achieved),
        "goalAbandoned": bool(goal_abandoned),
        "goalsAttempted": goals_attempted,
        "goalsCompleted": goals_completed,
        "goalsAbandoned": goals_abandoned,
        "goalTransitions": goal_transitions,
        "stopReason": simulator.get("stop_reason") or simulator.get("stopReason") or transcript.get("stop_reason") or "",
        "failureReason": failure_reason,
    }


def _normalize_goal_verdicts(result: dict[str, Any], goal_flow: list[str]) -> list[dict[str, Any]]:
    goal_verdicts = []
    seen: set[str] = set()
    for item in result.get("goal_verdicts") or result.get("goalVerdicts") or []:
        goal_id = item.get("goal_id") or item.get("goalId")
        if not goal_id or goal_id in seen:
            continue
        seen.add(goal_id)
        goal_verdicts.append(
            {
                "goalId": goal_id,
                "achieved": bool(item.get("achieved")),
                "reasoning": item.get("reasoning", ""),
            }
        )
    for goal_id in goal_flow:
        if goal_id not in seen:
            goal_verdicts.append(
                {
                    "goalId": goal_id,
                    "achieved": False,
                    "reasoning": "Not evaluated by judge",
                }
            )
    return goal_verdicts


def _normalize_rule_outcomes(result: dict[str, Any]) -> list[dict[str, Any]]:
    outcomes = []
    for item in result.get("rule_compliance") or result.get("ruleOutcomes") or []:
        rule_id = item.get("rule_id") or item.get("ruleId")
        if not rule_id:
            continue
        status = normalize_rule_outcome_status(item.get("status"), item.get("followed"))
        outcomes.append(
            {
                "ruleId": rule_id,
                "status": status,
                "evidence": item.get("evidence", ""),
                "section": item.get("section", ""),
            }
        )
    return outcomes


def _normalize_failure_modes(result: dict[str, Any]) -> list[str]:
    normalized: list[str] = []
    for item in result.get("failure_modes") or result.get("failureModes") or []:
        mode = normalize_adversarial_failure_mode(item)
        if mode and mode not in normalized:
            normalized.append(mode)
    return normalized


def _build_contract_block(contract_snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    if not contract_snapshot:
        return None
    return {
        "version": contract_snapshot.get("version"),
        "flowMode": contract_snapshot.get("flow_mode") or contract_snapshot.get("flowMode"),
        "goalIds": [goal.get("id") for goal in contract_snapshot.get("goals", []) if goal.get("id")],
        "traitIds": [trait.get("id") for trait in contract_snapshot.get("traits", []) if trait.get("id")],
        "ruleIds": [rule.get("rule_id") or rule.get("ruleId") for rule in contract_snapshot.get("rules", []) if (rule.get("rule_id") or rule.get("ruleId"))],
        "selectedRuleIds": [
            str(rule_id).strip()
            for rule_id in (contract_snapshot.get("selected_rule_ids") or contract_snapshot.get("selectedRuleIds") or [])
            if str(rule_id).strip()
        ],
    }


def _with_retryable_derived_fields(case: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(case)
    derived = dict(normalized.get("derived") or {})
    if "isRetryable" not in derived:
        derived["isRetryable"] = bool(derived.get("isInfraFailure"))
    normalized["derived"] = derived
    return normalized


def build_canonical_adversarial_case(
    result: dict[str, Any] | None,
    *,
    row_verdict: str | None = None,
    row_goal_achieved: bool | None = None,
    row_goal_flow: list[str] | None = None,
    row_active_traits: list[str] | None = None,
    row_total_turns: int | None = None,
    contract_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = dict(result or {})
    existing = payload.get("canonical_case") or payload.get("canonicalCase")
    if isinstance(existing, dict) and {"facts", "judge", "derived"} <= set(existing.keys()):
        return _with_retryable_derived_fields(existing)
    if {"facts", "judge", "derived"} <= set(payload.keys()):
        return _with_retryable_derived_fields(payload)

    test_case = _normalize_test_case(payload, row_goal_flow=row_goal_flow, row_active_traits=row_active_traits)
    facts = {
        "testCase": test_case,
        "transcript": _normalize_transcript(payload, row_total_turns=row_total_turns),
        "transport": _normalize_transport(payload),
        "simulator": _normalize_simulator(payload, row_goal_achieved=row_goal_achieved),
    }
    judge = {
        "verdict": normalize_adversarial_verdict(payload.get("verdict") or row_verdict),
        "goalAchieved": bool(payload.get("goal_achieved")) if payload.get("goal_achieved") is not None else False,
        "goalVerdicts": _normalize_goal_verdicts(payload, facts["testCase"]["goalFlow"]),
        "ruleOutcomes": _normalize_rule_outcomes(payload),
        "failureModes": _normalize_failure_modes(payload),
        "reasoning": payload.get("reasoning", ""),
    }
    if payload.get("goalAchieved") is not None:
        judge["goalAchieved"] = bool(payload.get("goalAchieved"))
    elif payload.get("goal_achieved") is None and row_goal_achieved is not None and not judge["goalVerdicts"]:
        judge["goalAchieved"] = bool(row_goal_achieved)

    contradiction_types: list[str] = []
    simulator = facts["simulator"]
    transport = facts["transport"]
    if simulator["goalAchieved"] and not judge["goalAchieved"]:
        contradiction_types.append("simulator_goal_vs_judge_goal")
    if simulator["goalAbandoned"] and judge["goalAchieved"]:
        contradiction_types.append("simulator_abandoned_vs_judge_achieved")
    has_transport_failure = any(
        [
            transport["hadHttpError"],
            transport["hadStreamError"],
            transport["hadTimeout"],
            transport["hadEmptyFinalAssistantMessage"],
            transport["hadPartialResponse"],
        ]
    )
    if has_transport_failure and not set(judge["failureModes"]) & _TECHNICAL_FAILURE_MODES:
        contradiction_types.append("transport_failure_without_judge_failure_mode")
    derived = {
        "hasContradiction": bool(contradiction_types),
        "contradictionTypes": contradiction_types,
        "isInfraFailure": has_transport_failure or bool(payload.get("error")),
    }
    derived["isRetryable"] = derived["isInfraFailure"]

    canonical = {
        "facts": facts,
        "judge": judge,
        "derived": derived,
    }
    contract = _build_contract_block(contract_snapshot)
    if contract:
        canonical["contract"] = contract
    return _with_retryable_derived_fields(canonical)


def enrich_adversarial_result_for_api(
    result: dict[str, Any] | None,
    *,
    row_verdict: str | None = None,
    row_goal_achieved: bool | None = None,
    row_goal_flow: list[str] | None = None,
    row_active_traits: list[str] | None = None,
    row_total_turns: int | None = None,
    contract_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    enriched = dict(result or {})
    canonical_case = build_canonical_adversarial_case(
        enriched,
        row_verdict=row_verdict,
        row_goal_achieved=row_goal_achieved,
        row_goal_flow=row_goal_flow,
        row_active_traits=row_active_traits,
        row_total_turns=row_total_turns,
        contract_snapshot=contract_snapshot,
    )
    enriched["canonical_case"] = canonical_case
    enriched["verdict"] = canonical_case["judge"]["verdict"]
    enriched["goal_achieved"] = canonical_case["judge"]["goalAchieved"]
    enriched["goal_verdicts"] = [
        {
            "goal_id": item["goalId"],
            "achieved": item["achieved"],
            "reasoning": item.get("reasoning", ""),
        }
        for item in canonical_case["judge"]["goalVerdicts"]
    ]
    enriched["rule_compliance"] = [
        {
            "rule_id": item["ruleId"],
            "status": item["status"],
            "followed": True if item["status"] == "FOLLOWED" else False if item["status"] == "VIOLATED" else None,
            "evidence": item.get("evidence", ""),
            "section": item.get("section", ""),
        }
        for item in canonical_case["judge"]["ruleOutcomes"]
    ]
    enriched["failure_modes"] = list(canonical_case["judge"]["failureModes"])
    return enriched
