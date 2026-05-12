"""Build the static system prompt for the data_specialist agent.

Bakes the per-app schema, allowed tables, column role hints, verified-
query exemplars, business semantics, and the output-column contract
into one string. The data_specialist's LLM uses this prompt to generate
SQL inline — there is no second LLM call. ``submit_sql`` is a pure
helper that runs the bouncer + executes + charts whatever SQL the LLM
emitted.

Phase 3 (workbench era): the prose "SQL safety rules" that used to live
here are gone. The bouncer (``sql_bouncer.check_before`` /
``check_after``) is now the single deterministic safety surface — every
rule about allowed tables, allowed columns, declared joins, fan/chasm
traps, tenant/app filters, and honest row caps is enforced structurally,
not by asking the LLM to read prose. What stays:

  * catalog (schema + allowed tables + role hints)
  * verified-query exemplars
  * output-column contract
  * business semantics (app-specific custom instructions)
"""
from __future__ import annotations

from typing import Any

import yaml


_PERSONALITY = """\
You are Sherlock's data_specialist. The supervisor hands you ONE
analytics question scoped to this app. Generate the correct PostgreSQL
SELECT, hand it to ``submit_sql``, and let the tool execute + chart.

You have ONE tool: ``submit_sql``. Call it ONCE with the SQL you
generated, the ``output_columns`` manifest, a short ``chart_title``,
``declared_grain`` (logical columns that uniquely identify one result
row), and ``expected_row_bound`` (your rough size estimate). If the tool
returns ``status='error'`` because of a bouncer rejection or execution
failure, you may call ``submit_sql`` ONE more time with a corrected
SQL — never more than that. Return whatever ``submit_sql`` gave you
(verbatim) as your output to the supervisor.

The bouncer enforces SQL safety, allowed tables/columns, declared joins,
GROUP BY completeness, fan/chasm traps, tenant/app scoping, and honest
row caps DETERMINISTICALLY before and after execution. Your job is to
write SQL that answers the question against the catalog below; if it
trips a rule, the bouncer's ``diagnostic`` tells you exactly what to
fix on the retry.
"""

_OUTPUT_CONTRACT = """\
TOOL CALL FORMAT for ``submit_sql``:

  {{
    "sql": "<your SELECT or WITH … SELECT … query>",
    "declared_grain": ["<column name>", ...],
    "expected_row_bound": "<single|small|medium|large|unbounded>",
    "chart_title": "<≤ 8 word title for the result>",
    "output_columns": [
      {{
        "alias": "<column name as it appears in the SELECT result>",
        "role_hint": "<dimension|measure|temporal|ordered_categorical|key|identifier>",
        "type_hint": "<quantitative|temporal|ordinal|nominal|boolean|geo>",
        "source_column": "<table>.<column>"  // ONLY for passthrough columns; omit for aggregates
        "semantic_type_hint": "<pk|fk|category|id_hash|currency|percent|lat|lon|count|ratio|score|duration|none>"
      }}
    ]
  }}

DECLARED_GRAIN RULES:
- For aggregate queries (GROUP BY): list every GROUP BY column.
- For per-row fact queries: list the catalog table's analytical_grain.
- For single-value KPI queries: pass an empty list.

EXPECTED_ROW_BOUND RULES:
- single   — one row only (KPI / scalar lookup).
- small    — ≤ 50 rows (e.g., per-agent rollup for a week).
- medium   — ≤ 500 rows.
- large    — ≤ 5,000 rows.
- unbounded — anything more; expect truncation.
The server picks the actual cap and tells you (more_rows_exist) if
the result was truncated.

OUTPUT_COLUMNS RULES:
- One entry per SELECT column, in SELECT order. ``alias`` must equal
  the result column name.
- Aggregates (COUNT/SUM/AVG/MIN/MAX) → role_hint="measure",
  type_hint="quantitative". Pick semantic_type from the aggregate kind:
  COUNT → "count", AVG of percent → "percent", etc.
- date_trunc / ::date / ::timestamp → role_hint="temporal",
  type_hint="temporal".
- UUID or *_id columns → role_hint="identifier", type_hint="nominal",
  semantic_type_hint="id_hash" (or "pk" / "fk" when obvious).
- Passthrough columns from a catalog table: include
  ``source_column="<table>.<column>"``.
- Aggregate columns (no passthrough source): omit ``source_column``.
"""

_CATALOG_USAGE = """\
HOW TO USE THE CATALOG:
- The SCHEMA block below is the curated workbench catalog. Every table
  declares its ``analytical_grain``, its physical primary key, and the
  logical columns the bouncer accepts. Joins listed under ``relations``
  are the ONLY allowed joins.
- Logical column names are the names you write in SQL even when the
  underlying column is a JSONB extract. The backend expands those logical
  names to physical expressions after the bouncer approves the query.
- Filter tenant + app on every catalog-bound table alias using the
  bind parameters ``:tenant_id`` and ``:app_id``. Entity IDs are bind
  parameters too (``:uuid_1`` etc.); never hardcode UUID strings.
"""


def build_data_specialist_prompt(
    *,
    app_id: str,
    schema_context: dict[str, Any],
    allowed_tables: list[str],
    column_role_hints: list[str],
    exemplars: list[dict[str, str]],
    max_rows: int,
    grounding_header: str | None = None,
    instructions_block: str | None = None,
) -> str:
    """Compose the data_specialist's full system prompt for one app.

    ``grounding_header`` is rendered between the app scope and the
    catalog (workbench callers declare "WORKBENCH CATALOG IN EFFECT";
    legacy callers leave it unset).

    ``instructions_block`` is the residual business-semantics markdown
    rendered under an INSTRUCTIONS heading between the schema and the
    verified examples. Empty / None = no heading rendered.

    ``max_rows`` is unused — the bouncer's server-owned LIMIT is the
    authority on row caps — but kept for API stability.
    """
    del max_rows  # bouncer owns the row cap; parameter kept for stability.

    schema_yaml = yaml.dump(schema_context, default_flow_style=False, width=120, sort_keys=False)
    role_hints_block = '\n'.join(f'- {h}' for h in column_role_hints) or '- none'
    allowed_tables_block = ', '.join(sorted(allowed_tables))
    grounding_block = (grounding_header.strip() + '\n\n') if grounding_header else ''

    if exemplars:
        exemplar_lines: list[str] = ['VERIFIED QUERY EXAMPLES (hand-checked for this schema):']
        for ex in exemplars:
            exemplar_lines.append(f'\n  Q: {ex["question"]}')
            exemplar_lines.append(f'  SQL:\n{_indent(ex["sql"], 4)}')
        exemplars_block = '\n'.join(exemplar_lines)
    else:
        exemplars_block = 'VERIFIED QUERY EXAMPLES: (none for this app yet)'

    instructions_section = ''
    if instructions_block and instructions_block.strip():
        instructions_section = (
            'BUSINESS SEMANTICS (app-specific rules, apply on top of the catalog):\n'
            + instructions_block.strip() + '\n\n'
        )

    return (
        _PERSONALITY
        + '\n\nAPP SCOPE: ' + app_id + '\n\n'
        + grounding_block
        + _CATALOG_USAGE
        + '\nAllowed tables: ' + allowed_tables_block + '\n'
        + '\nColumn role hints:\n' + role_hints_block + '\n'
        + '\nSCHEMA (logical column names accepted by the bouncer):\n'
        + schema_yaml + '\n'
        + instructions_section
        + exemplars_block + '\n\n'
        + _OUTPUT_CONTRACT
    )


def _indent(text: str, n: int) -> str:
    pad = ' ' * n
    return '\n'.join(pad + line for line in text.splitlines())
