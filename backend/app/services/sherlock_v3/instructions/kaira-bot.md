# kaira-bot data_specialist instructions

Residual rules that the schema and verified queries do not encode. Apply
in addition to the safety contract and SQL rules already in the prompt.

## Output formatting

- Render rates and percentages with **one decimal place** (e.g. `87.4`).
- Round average scores to two decimals (`avg_score = 0.83`).

## Time windows

- Use **ISO weeks (Monday start)** for any "by week" bucket.
- "This month" = `date_trunc('month', now())` to `now()`.

## Result shape

- Cap result sets at **200 rows** unless the user explicitly asks for
  more.
- For "how many" / "count" questions, return ONE column (`COUNT(*)`)
  so the chartability gate emits a KPI card, not a degraded summary.
