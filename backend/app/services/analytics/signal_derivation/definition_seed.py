"""Seed the default ``mql`` signal definition.

Phase 11A of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

``mql`` ships as a seeded ``rule`` definition under ``SYSTEM_TENANT_ID`` —
the same pattern as every other system default. It is NOT Python code: the
band lists, target cities, conditions, and hba1c threshold that used to
live in ``compute_mql_score`` are now declared config in the definition
body, evaluated by the ``rule`` strategy over the normalized ``dim_lead``
surface.

Idempotent and operator-respecting: if a row already exists for
``(SYSTEM_TENANT_ID, inside-sales, mql)`` it is left alone — a tenant can
re-tune the definition through the admin screen (Phase 11C) without it
being stomped on the next boot.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.analytics_signal_definition import SignalDefinition
from app.services.analytics.signal_derivation.registry import get_strategy

_log = logging.getLogger(__name__)

# Age band strings (as LSQ returns them) that fall within 30-65. Both the
# en-dash and hyphen variants are listed because LSQ is inconsistent and
# the rule predicate matches on the literal value.
_MQL_AGE_BANDS = [
    "31–40", "31-40",
    "41–50", "41-50",
    "51–60", "51-60",
    "61–65", "61-65",
    "61–70", "61-70",
]

_MQL_TARGET_CITIES = [
    "mumbai", "bangalore", "bengaluru", "hyderabad", "chennai", "delhi",
    "new delhi", "pune", "ahmedabad", "kolkata", "surat", "jaipur",
    "lucknow", "kanpur", "nagpur", "indore", "thane", "bhopal",
    "visakhapatnam", "pimpri", "patna", "vadodara", "ghaziabad",
    "ludhiana", "agra",
]

_MQL_RELEVANT_CONDITIONS = [
    "diabetes", "pcos", "fatty liver", "obesity", "hypertension",
]

# The `mql` definition body — the former compute_mql_score, as data.
MQL_DEFINITION_BODY: dict = {
    "signals": [
        {
            "signal_type": "mql_age",
            "field": "attributes_at_first_seen.age_group",
            "predicate": "in_set",
            "args": {"values": _MQL_AGE_BANDS},
            "description": "Lead's age band falls within the 30-65 target range.",
        },
        {
            "signal_type": "mql_city",
            "field": "city",
            "predicate": "in_set",
            "args": {"values": _MQL_TARGET_CITIES},
            "description": "Lead is in a serviceable metro.",
        },
        {
            "signal_type": "mql_condition",
            "field": "attributes_at_first_seen.condition",
            "predicate": "contains_any",
            "args": {"values": _MQL_RELEVANT_CONDITIONS},
            "description": "Lead reports a condition the program targets.",
        },
        {
            "signal_type": "mql_hba1c",
            "field": "attributes_at_first_seen.hba1c_band",
            "predicate": "numeric_gte",
            "args": {"threshold": 5.7},
            "description": "Reported HbA1c is at or above the pre-diabetes line.",
        },
        {
            "signal_type": "mql_intent",
            "field": "attributes_at_first_seen.intent_to_pay",
            "predicate": "present_and_not_contains",
            "args": {"exclude": ["no"]},
            "description": "Lead expressed non-negative intent to invest.",
        },
    ],
    "score": {"signal_type": "mql_score", "kind": "count_true"},
}

# The system-tenant signal definition seeds. Each is a platform template
# that applies to every tenant with the app (resolution.py); a tenant can
# override by creating its own (tenant_id, app_id, signal_set) row.
_SIGNAL_DEFINITION_SEEDS: list[dict] = [
    {
        "app_id": "inside-sales",
        "signal_set": "mql",
        "strategy": "rule",
        "source_surface": "dim_lead",
        "definition": MQL_DEFINITION_BODY,
    },
    {
        # Eval-run-extracted call signals. Invoked per-eval-run by
        # fact_populator when a call_quality eval completes; the LLM ran
        # in the eval runner, this projects result.signals.
        "app_id": "inside-sales",
        "signal_set": "call_transcript_signals",
        "strategy": "llm_transcript",
        "source_surface": "evaluation_run_thread_results",
        "definition": {},
    },
    {
        # Lead-profile LLM signals. Invoked by the operator-triggered
        # backfill-lead-signals job, reading the normalized dim_lead surface.
        "app_id": "inside-sales",
        "signal_set": "lead_profile_signals",
        "strategy": "llm_profile",
        "source_surface": "dim_lead",
        "definition": {},
    },
]


async def seed_default_signal_definitions(session: AsyncSession) -> int:
    """Insert any missing default signal definitions under SYSTEM_TENANT_ID.

    Idempotent on ``(tenant_id, app_id, signal_set)`` — an existing row
    (including a tenant's edit) is left alone. Each body is validated
    against its strategy before insert: a malformed seed is a boot-time
    failure, not a silent skip. Returns the number of rows inserted.
    """
    inserted = 0
    for seed in _SIGNAL_DEFINITION_SEEDS:
        existing = await session.scalar(
            select(SignalDefinition).where(
                SignalDefinition.tenant_id == SYSTEM_TENANT_ID,
                SignalDefinition.app_id == seed["app_id"],
                SignalDefinition.signal_set == seed["signal_set"],
            )
        )
        if existing is not None:
            continue
        # Fail loud if a seed body ever drifts from what its strategy accepts.
        get_strategy(seed["strategy"]).validate(seed["definition"])
        session.add(
            SignalDefinition(
                tenant_id=SYSTEM_TENANT_ID,
                app_id=seed["app_id"],
                signal_set=seed["signal_set"],
                strategy=seed["strategy"],
                source_surface=seed["source_surface"],
                definition=seed["definition"],
                enabled=True,
                created_by_user_id=SYSTEM_USER_ID,
            )
        )
        inserted += 1
        _log.info(
            "signal_definition.seed.inserted app_id=%s signal_set=%s strategy=%s",
            seed["app_id"],
            seed["signal_set"],
            seed["strategy"],
        )
    if inserted:
        await session.flush()
    return inserted
