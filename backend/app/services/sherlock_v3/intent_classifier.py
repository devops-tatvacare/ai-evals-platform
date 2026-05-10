"""Sherlock v3 intent classifier (Phase 1A).

Pure-Python deterministic classifier: NO LLM call.

Maps a user question to one of five intent classes that
``manifest_projection`` uses to decide which tables the
``data_specialist`` agent is allowed to see:

    aggregate    pre-aggregated rollups (analytics_aggregate)
    fact_grain   per-event fact rows / per-dimension rollups (analytics_fact)
    identity     entity lookups (identity dims)
    detail       single-row transactional lookups (transactional)
    mixed        identity + fact, or no clear signal (union projection)

The classifier is intentionally conservative: when in doubt it returns
``mixed`` so projection degrades to the union of allowed layers and the
specialist still sees enough schema to answer. Hard misroutes are worse
than soft ones — never strip a table the LLM might genuinely need.

Plan: docs/plans/2026-05-10-sherlock-grounded-routing.md §Phase 1.1.
"""
from __future__ import annotations

import re
from typing import Literal

IntentClass = Literal["aggregate", "fact_grain", "identity", "detail", "mixed"]

ALLOWED_INTENT_CLASSES: tuple[IntentClass, ...] = (
    "aggregate", "fact_grain", "identity", "detail", "mixed",
)


# ── signal patterns ────────────────────────────────────────────────
#
# All patterns operate on a lowercased, single-space-padded question so
# `\b` boundaries fire on phrase-leading tokens too.

_DETAIL_RE = re.compile(
    r"\b("
    r"the\s+(latest|most\s+recent|newest|oldest|first|last)"
    r"|find\s+(the|a|that|one|me\s+the)"
    r"|what\s+(is|was)\s+the"
    r"|show\s+me\s+the\s+(latest|most\s+recent)"
    r")\b"
)

_IDENTITY_NOUN_RE = re.compile(
    r"\b(evaluators?|agents?|users?|leads?|members?|reviewers?)\b"
)

# Verbs/qualifiers that, with an identity noun, indicate an entity lookup.
_IDENTITY_VERB_RE = re.compile(
    r"\b("
    r"list|show\s+all|all\s+the|every|which|who|whom|names?\s+of"
    r"|not\s+used|unused|never\s+used|with\s+no\b|having\s+no\b"
    r"|haven'?t\s+been|hasn'?t\s+been"
    r"|assigned|inactive|dormant|missing"
    r")\b"
)

# "Negative usage" qualifiers REQUIRE joining identity to fact rows
# (e.g. "evaluators not used this month") — force mixed even though the
# question reads identity-y.
_NEG_USAGE_RE = re.compile(
    r"\b(not\s+used|unused|never\s+used|with\s+no\b|having\s+no\b"
    r"|haven'?t\s+been|hasn'?t\s+been|missing|dormant)\b"
)

_AGGREGATE_RE = re.compile(
    r"\b("
    r"trend|over\s+time"
    r"|by\s+(week|month|day|hour|quarter|status|day\s+of\s+week)"
    r"|weekly|monthly|daily|hourly|quarterly"
    r"|distribution|breakdown|histogram"
    r"|rate|ratio|percentage|percent\b"
    r"|as\s+a\s+chart|chart\s+of"
    r"|how\s+many|count\s+of|number\s+of|total\s+(of|number)"
    r")\b"
)

# Fact-grain language: top-N, per-X rollups, "most/highest/lowest <noun>".
# `most\s+(?!recent)\w+` deliberately excludes "most recent" (a detail
# phrase) while still matching "most violated", "most active", etc.
_FACT_GRAIN_RE = re.compile(
    r"\b("
    r"top\s*\d*\s*\w*"
    r"|highest|lowest|biggest|smallest"
    r"|average|avg\b|mean\b"
    r"|by\s+(evaluator|agent|criterion|criteria|run|call|lead|prospect)"
    r"|per\s+(evaluator|agent|criterion|run|call|lead|prospect)"
    r"|violated"
    r"|most\s+(?!recent)\w+"
    r")\b"
)


def classify_intent(question: str) -> IntentClass:
    """Classify ``question`` into one of five intent classes.

    Empty / whitespace-only questions degrade to ``mixed`` so the
    specialist sees the full schema rather than a blank projection.
    """
    if not question or not question.strip():
        return "mixed"

    q = " " + question.lower().strip() + " "

    has_detail = bool(_DETAIL_RE.search(q))
    has_identity_noun = bool(_IDENTITY_NOUN_RE.search(q))
    has_identity_verb = bool(_IDENTITY_VERB_RE.search(q))
    has_neg_usage = bool(_NEG_USAGE_RE.search(q))
    has_aggregate = bool(_AGGREGATE_RE.search(q))
    has_fact_grain = bool(_FACT_GRAIN_RE.search(q))

    # Identity-anchored question with aggregation OR negative-usage
    # qualifier — needs identity AND fact tables to answer (e.g.
    # "evaluators not used this month").
    if has_identity_noun and has_identity_verb:
        if has_neg_usage or has_aggregate or has_fact_grain:
            return "mixed"
        return "identity"

    # Pure single-row transactional lookup, no aggregation language.
    if has_detail and not has_aggregate and not has_fact_grain:
        return "detail"

    # Fact-grain wins over aggregate when both fire (e.g. "top agents
    # by evaluation count" reads aggregate-ish but is a per-agent
    # fact rollup).
    if has_fact_grain:
        return "fact_grain"

    if has_aggregate:
        return "aggregate"

    if has_detail:
        return "detail"

    return "mixed"


__all__ = ["IntentClass", "ALLOWED_INTENT_CLASSES", "classify_intent"]
