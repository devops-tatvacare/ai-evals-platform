"""Few-shot SQL exemplars for the data_specialist (per-app).

These are the verified queries the architecture spec §9.3 calls out as the
single highest-value lever for SQL accuracy. Each entry is a hand-written
question→SQL pair that the SQL generator sees as part of its CONTEXT
payload, which trains the model on the right column names and join
conventions for our schema (post-roadmap-01 — all schema-qualified).

This module is the first home for them. When the manifest schema gains a
formal ``verified_queries`` block (per the manifest spec refresh), these
move into the YAML and load through ``manifest.py``. Until then, this is
where new exemplars get added.

Format kept deliberately simple: a list of {question, sql} dicts. The SQL
uses ``:tenant_id`` and ``:app_id`` bind params so the model picks up the
tenant-scoping convention; ``prepare_query`` will not need to inject the
WHERE clause if these are followed.
"""
from __future__ import annotations

from typing import Any


_INSIDE_SALES_EXEMPLARS: list[dict[str, str]] = [
    # Q1 — last 4 evaluation runs failure summary.
    # Tables: analytics.agg_evaluation_run (per-run aggregates).
    {
        'question': 'Provide a failure summary for the last 4 evaluation runs.',
        'sql': (
            'SELECT '
            '  rf.run_id, '
            '  rf.run_name, '
            '  rf.created_at, '
            '  rf.thread_count, '
            '  rf.pass_count, '
            '  rf.fail_count, '
            '  rf.error_count, '
            '  rf.pass_rate '
            'FROM analytics.agg_evaluation_run rf '
            "WHERE rf.tenant_id = :tenant_id AND rf.app_id = :app_id "
            'ORDER BY rf.created_at DESC '
            'LIMIT 4'
        ),
    },
    # Q8 — evaluators not used in the current calendar month.
    # Tables: platform.evaluators (roster) LEFT JOIN
    #   analytics.fact_evaluation (usage facts).
    {
        'question': 'Which evaluators have not been used this month?',
        'sql': (
            'WITH used AS ( '
            '  SELECT DISTINCT ef.evaluator_name '
            '    FROM analytics.fact_evaluation ef '
            '   WHERE ef.tenant_id = :tenant_id AND ef.app_id = :app_id '
            "     AND ef.created_at >= date_trunc('month', now()) "
            ') '
            'SELECT '
            '  e.id      AS evaluator_id, '
            '  e.name    AS evaluator_name, '
            '  e.eval_type, '
            '  e.created_at '
            'FROM platform.evaluators e '
            "WHERE e.tenant_id = :tenant_id AND e.app_id = :app_id "
            '  AND NOT EXISTS ( '
            '    SELECT 1 FROM used u WHERE u.evaluator_name = e.name '
            '  ) '
            'ORDER BY e.name'
        ),
    },
    # Most common failing criterion this week. Useful for the model to
    # learn the criterion_facts + status filter pattern; only meaningful
    # when fact_evaluation_criterion has rows for this tenant/app.
    {
        'question': 'Which criteria have the most violations this week?',
        'sql': (
            'SELECT '
            '  cf.criterion_label, '
            "  COUNT(*) FILTER (WHERE cf.status = 'VIOLATED') AS violations, "
            '  COUNT(*)                                         AS evaluated '
            'FROM analytics.fact_evaluation_criterion cf '
            'WHERE cf.tenant_id = :tenant_id AND cf.app_id = :app_id '
            "  AND cf.created_at >= date_trunc('week', now()) "
            'GROUP BY cf.criterion_label '
            'ORDER BY violations DESC '
            'LIMIT 10'
        ),
    },
    # Top agents by evaluation volume + pass rate.
    # Tables: analytics.fact_evaluation grouped by agent.
    {
        'question': 'Which agents have the most evaluations and what is their pass rate?',
        'sql': (
            'SELECT '
            '  ef.agent, '
            '  COUNT(*) AS evaluations, '
            "  COUNT(*) FILTER (WHERE ef.result_status = 'PASS')      AS passes, "
            "  COUNT(*) FILTER (WHERE ef.result_status = 'HARD FAIL') AS hard_fails, "
            "  COUNT(*) FILTER (WHERE ef.result_status = 'SOFT FAIL') AS soft_fails, "
            "  ROUND( "
            "    100.0 * COUNT(*) FILTER (WHERE ef.result_status = 'PASS') "
            '    / NULLIF(COUNT(*), 0), 1 '
            '  ) AS pass_rate_pct '
            'FROM analytics.fact_evaluation ef '
            'WHERE ef.tenant_id = :tenant_id AND ef.app_id = :app_id '
            '  AND ef.agent IS NOT NULL '
            'GROUP BY ef.agent '
            'ORDER BY evaluations DESC '
            'LIMIT 20'
        ),
    },
    # Run trend by week — Q6 style.
    # Tables: analytics.agg_evaluation_run rolled up to ISO week.
    {
        'question': 'Show me the weekly trend of pass rate across all runs.',
        'sql': (
            'SELECT '
            "  date_trunc('week', rf.created_at) AS week, "
            '  COUNT(*)                           AS run_count, '
            '  ROUND(AVG(rf.pass_rate)::numeric, 2) AS avg_pass_rate, '
            '  SUM(rf.fail_count)                  AS total_fails, '
            '  SUM(rf.error_count)                 AS total_errors '
            'FROM analytics.agg_evaluation_run rf '
            'WHERE rf.tenant_id = :tenant_id AND rf.app_id = :app_id '
            "  AND rf.created_at >= now() - interval '12 weeks' "
            'GROUP BY week '
            'ORDER BY week'
        ),
    },
    # Most active evaluators this month.
    # Tables: analytics.fact_evaluation grouped by evaluator_name.
    {
        'question': 'Which evaluators ran the most evaluations this month?',
        'sql': (
            'SELECT '
            '  ef.evaluator_name, '
            '  COUNT(*) AS evaluations, '
            '  ROUND(AVG(ef.result_score)::numeric, 2) AS avg_score '
            'FROM analytics.fact_evaluation ef '
            'WHERE ef.tenant_id = :tenant_id AND ef.app_id = :app_id '
            "  AND ef.created_at >= date_trunc('month', now()) "
            'GROUP BY ef.evaluator_name '
            'ORDER BY evaluations DESC '
            'LIMIT 10'
        ),
    },
    # Average call duration this month — uses the CRM source records.
    # Tables: analytics.crm_call_record (duration_seconds first-class).
    {
        'question': 'What is the average call duration this month?',
        'sql': (
            'SELECT '
            '  COUNT(*)                                 AS calls, '
            '  ROUND(AVG(c.duration_seconds)::numeric, 1) AS avg_duration_seconds, '
            '  ROUND(MIN(c.duration_seconds)::numeric, 1) AS min_seconds, '
            '  ROUND(MAX(c.duration_seconds)::numeric, 1) AS max_seconds '
            'FROM analytics.crm_call_record c '
            'WHERE c.tenant_id = :tenant_id AND c.app_id = :app_id '
            "  AND c.call_started_at >= date_trunc('month', now())"
        ),
    },
]


_BY_APP: dict[str, list[dict[str, str]]] = {
    'inside-sales': _INSIDE_SALES_EXEMPLARS,
}


def exemplars_for(app_id: str) -> list[dict[str, str]]:
    """Return the verified-query exemplars to inject for ``app_id``.

    Empty list for apps without exemplars yet — the SQL generator works
    without them, just less accurately on novel questions.
    """
    return _BY_APP.get(app_id, [])


def build_context_payload(
    app_id: str,
    *,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a ``context_payload`` for ``sql_agent.generate_sql``.

    Bundles the per-app exemplars under ``verified_query_examples`` and
    merges any caller-supplied extra context. The CONTEXT: block in the
    SQL prompt is rendered as JSON, so anything in here surfaces to the
    model as structured context — no prompt-template surgery needed.
    """
    payload: dict[str, Any] = {}
    examples = exemplars_for(app_id)
    if examples:
        payload['verified_query_examples'] = examples
        payload['verified_query_usage_hint'] = (
            'These are correct, hand-verified question→SQL pairs for this '
            'application schema. Use them to learn column names, join '
            'conventions, and tenant/app scoping. Adapt one when the user '
            'question is similar; never copy verbatim if the user asked '
            'something else.'
        )
    if extra:
        payload.update(extra)
    return payload
