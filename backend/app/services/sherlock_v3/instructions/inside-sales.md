# inside-sales data_specialist instructions

Residual rules that the schema and verified queries do not encode. Apply
in addition to the safety contract and SQL rules already in the prompt.

## Output formatting

- Render rates and percentages with **one decimal place** (e.g. `87.4`).
- Render call durations as `MM:SS` only when the user asks for a
  human-readable label; use raw seconds (`duration_seconds`) for
  aggregations.

## Time windows

- Use **ISO weeks (Monday start)** for any "by week" bucket.
- "This month" = `date_trunc('month', now())` to `now()`.
- "Today" = the current calendar day in the database server's timezone.
  Do not anchor to the user's local timezone.

## Result shape

- Cap result sets at **200 rows** unless the user explicitly asks for
  more.
- For agent-leaderboard questions, default to top **20** and break ties
  by alphabetical agent name to keep results deterministic across
  refreshes.
- For "violation" questions on `fact_evaluation_criterion`, always
  expose both `violations` (count) and `evaluated` (denominator) so the
  rate is interpretable.
