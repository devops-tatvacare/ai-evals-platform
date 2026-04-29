"""Analytics-pack-owned question-contract hint generation.

Phase 3 clarity change: the logic that maps raw user terms to canonical
manifest/semantic-model fields, and decides whether the question carries
terms that need discovery/clarification before direct analytical use,
lives inside the analytics pack — not in harness-core.

Relocated from ``report_builder.chat_handler`` so the flow is:

    chat_handler
        → AnalyticsPack.question_hints(...)
            → compute_question_hints(...)  # this module
                → ToolVocabulary.resolve_* and the clarity helpers

Nothing in this module reaches back into chat_handler; every dependency is
either the pack's own vocabulary module or the shared semantic model.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Callable, Mapping

from app.services.report_builder.analytics.vocabulary import ToolVocabulary

_log = logging.getLogger(__name__)

_SCHEMA_TERM_PATTERN = re.compile(r'\b[a-z][a-z0-9]*_[a-z0-9_]+\b')
_QUESTION_WORD_PATTERN = re.compile(r'[a-z][a-z0-9_]*')


def _normalize_question_term(term: str) -> str:
    return '_'.join(str(term or '').strip().lower().split())


def _semantic_name_candidates(semantic_model: Mapping[str, Any]) -> set[str]:
    """Canonical term set drawn from the app's semantic model.

    Mirrors the three places an analytical name can be declared:
    dimensions (list of dicts), metrics (dict keyed by metric name or
    list of dicts), and table columns. Keeps the surface small and
    tolerant of partial shapes.
    """
    names: set[str] = set()

    dimensions = semantic_model.get('dimensions') or []
    if isinstance(dimensions, list):
        for dimension in dimensions:
            if isinstance(dimension, dict):
                name = _normalize_question_term(str(dimension.get('name') or ''))
                if name:
                    names.add(name)

    metrics = semantic_model.get('metrics') or []
    if isinstance(metrics, dict):
        iterable = metrics.keys()
    elif isinstance(metrics, list):
        iterable = [
            metric.get('name')
            for metric in metrics
            if isinstance(metric, dict)
        ]
    else:
        iterable = []
    for metric_name in iterable:
        name = _normalize_question_term(str(metric_name or ''))
        if name:
            names.add(name)

    tables = semantic_model.get('tables') or {}
    if isinstance(tables, dict):
        for table_payload in tables.values():
            columns = table_payload.get('columns') if isinstance(table_payload, dict) else {}
            if not isinstance(columns, dict):
                continue
            for column_name in columns.keys():
                name = _normalize_question_term(str(column_name or ''))
                if name:
                    names.add(name)

    return names


def compute_question_hints(
    *,
    question: str,
    app_id: str,
    semantic_model: Mapping[str, Any],
    tool_vocabulary: Callable[[str, Mapping[str, Any]], ToolVocabulary],
) -> dict[str, Any]:
    """Build the ``{context, needs_discovery}`` hint bundle for one question.

    The returned ``context`` is a human-readable block appended to the
    outer-agent system prompt; ``needs_discovery`` flags that at least
    one ambiguous or unknown schema term was seen and the agent should
    discover/clarify before ``data_query``.

    ``tool_vocabulary`` is passed as a callable so callers (the analytics
    pack) own the vocabulary source; this module never imports pack
    internals directly.
    """
    if not question.strip() or not app_id:
        return {'context': '', 'needs_discovery': False}

    try:
        vocab = tool_vocabulary(app_id, semantic_model)
    except Exception:
        _log.debug('analytics question hints: failed to build vocabulary', exc_info=True)
        return {'context': '', 'needs_discovery': False}

    mapped_terms: list[str] = []
    unresolved_terms: list[str] = []
    seen_terms = sorted({
        _normalize_question_term(match.group(0))
        for match in _SCHEMA_TERM_PATTERN.finditer(question.lower())
    })
    for term in seen_terms:
        dimension_resolution = vocab.resolve_dimension(term)
        column_resolution = vocab.resolve_column(term)
        if dimension_resolution.status == 'unique' and dimension_resolution.canonical is not None:
            canonical_dimension = _normalize_question_term(dimension_resolution.canonical.name)
            if canonical_dimension != term:
                mapped_terms.append(
                    f'`{term}` means the `{dimension_resolution.canonical.name}` dimension.'
                )
            continue
        if column_resolution.status == 'unique' and column_resolution.canonical is not None:
            canonical_column = _normalize_question_term(column_resolution.canonical.column)
            if canonical_column != term:
                mapped_terms.append(
                    f'`{term}` means `{column_resolution.canonical.table}.{column_resolution.canonical.column}`.'
                )
            continue
        if vocab.needs_clarification(term):
            unresolved_terms.append(term)

    ambiguous_metric_terms: list[str] = []
    question_words = set(_QUESTION_WORD_PATTERN.findall(question.lower()))
    known_names = _semantic_name_candidates(semantic_model)
    score_candidates = sorted(
        name for name in known_names
        if name == 'score' or name.endswith('_score')
    )
    if 'score' in question_words and 'score' not in seen_terms and len(score_candidates) > 1:
        ambiguous_metric_terms.append('score')

    # M2 c02_pie_donut lesson: ``status`` alone is the canonical ambiguous
    # term for apps that project both ``analytics.agg_evaluation_run.status``
    # (run-level) and ``analytics.fact_evaluation.result_status`` (per-item
    # verdict). The SQL agent can't disambiguate without a nudge; flagging
    # the bare word here so the outer agent discovers/clarifies before
    # data_query.
    status_candidates = sorted(
        name for name in known_names
        if name == 'status' or name.endswith('_status')
    )
    if 'status' in question_words and 'status' not in seen_terms and len(status_candidates) > 1:
        ambiguous_metric_terms.append('status')

    if not mapped_terms and not unresolved_terms and not ambiguous_metric_terms:
        return {'context': '', 'needs_discovery': False}

    lines = ['Question contract notes:']
    lines.extend(f'- {line}' for line in mapped_terms)
    lines.extend(
        f'- `{term}` is not a declared field in this app. Discover or clarify it first; never substitute a nearby column.'
        for term in unresolved_terms
    )
    lines.extend(
        f'- `{term}` is ambiguous in this app. Discover or clarify the intended field before data_query.'
        for term in ambiguous_metric_terms
    )
    return {
        'context': '\n'.join(lines),
        'needs_discovery': bool(unresolved_terms or ambiguous_metric_terms),
    }


__all__ = ['compute_question_hints']
