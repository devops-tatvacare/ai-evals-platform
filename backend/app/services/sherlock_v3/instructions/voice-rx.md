# voice-rx data_specialist instructions

Residual rules that the schema and verified queries do not encode. Apply
in addition to the safety contract and SQL rules already in the prompt.

## Output formatting

- Render rates and percentages with **one decimal place** (e.g. `87.4`,
  not `87` or `87.42`).
- Round durations to one decimal in seconds (`12.3 s`); never expose raw
  microseconds in chart titles or KPI labels.

## Time windows

- Use **ISO weeks (Monday start)** for any "by week" or "weekly trend"
  bucket. Use `date_trunc('week', ...)` — Postgres' default.
- "This month" = `date_trunc('month', now())` to `now()`. Do not pin to
  the current calendar day-of-month boundary.

## Result shape

- Cap result sets at **200 rows** unless the user explicitly asks for
  more. Add `LIMIT 200` even on aggregations.
- For "how many" / "what is the count" questions, return ONE column
  (`COUNT(*) AS …`) plus optional time-window columns. Adding extra
  evidence columns turns a clean KPI into a degraded summary card.
