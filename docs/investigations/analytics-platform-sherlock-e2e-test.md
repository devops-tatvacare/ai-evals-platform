# Analytics Platform E2E Test — Sherlock Chat Integration

**Date:** 2026-04-11
**Context:** After implementing the analytics platform (fact tables, extractors, cache, SQL agent hardening), ran a 10-turn live test against the Sherlock chat endpoint to validate the full pipeline.

## Test Setup

- Endpoint: `POST /api/report-builder/chat` (non-streaming)
- App: `kaira-bot` (5 runs with fact data: 1 batch_thread, 3 batch_adversarial, 1 custom)
- Provider: `gemini` via service account (gemini-2.0-flash)
- Auth: JWT for real user (Tatvacare tenant)
- Session: single session across all 10 turns

## Turn Results

| Turn | Question | Tool | Status | Rows | Notes |
|------|----------|------|--------|------|-------|
| 1 | Overall pass rate across all runs | analyze | OK | 1 | Returned 51.33%. Used `analytics_run_facts`. |
| 2 | Which rules are most violated | analyze | OK | 23 | Used `analytics_criterion_facts`. Correctly identified `single_item_one_table` at 16.7% compliance. |
| 3 | Pass rate trend over time | analyze | OK | 5 | Matched common_query pattern. Correct dates, run names, thread counts. |
| 4 | Adversarial block rate by difficulty | analyze | OK | 1 | Returned 32.22% avg. Said "no difficulty breakdown" — **GAP: adversarial context doesn't store difficulty in eval_facts context**. |
| 5 | Worst performing threads | analyze | OK | 2 | Correctly identified HARD FAIL threads with intent accuracy. |
| 6 | Repeat pass rate (cache test) | analyze | OK | 5 | Returned correct data. **Cache working** — 7 unique entries in `analytics_query_cache`. |
| 7 | Report section types | list_app_sections | OK | 9 | Listed all 9 kaira-bot sections correctly. |
| 8 | Compose report with 3 sections | compose_report | OK | 3 | Created report with summary_cards, compliance_table, exemplars. `composedReport` in response. |
| 9 | Save as template | save_template | OK | — | Saved "Compliance Deep Dive" to `report_configs` table. Verified in DB. |
| 10 | Evaluator types breakdown | analyze | OK | 5 | Found 5 types: custom(1), efficiency(5), correctness(5), intent(5), adversarial_judge(65). |

**All 10 turns succeeded. No errors. No timeouts.**

## DB Audit After Test

### agent_tool_logs: 1 row (BUG)

**Expected:** ~10 rows (one per tool call)
**Actual:** 1 row (only `save_template`)

**Root cause:** `_log_tool_call` in `tool_handlers.py` calls `db.flush()` to write the log row, but the chat handler (`chat_handler.py:174`) only calls `await db.commit()` for the `save_template` tool. For all other tools (analyze, list_app_sections, compose_report), the flushed rows are never committed and are discarded when the session closes.

**Fix:** Change `_log_tool_call` to use its own session for the insert so it doesn't depend on the caller's commit behavior:

```python
async def _log_tool_call(...):
    try:
        from app.database import async_session
        from app.models.analytics_log import AgentToolLog
        async with async_session() as log_db:
            log = AgentToolLog(...)
            log_db.add(log)
            await log_db.commit()
    except Exception:
        pass
```

**Status: FIXED.** Changed `_log_tool_call` to open its own `async_session`, insert, and commit independently. Verified: 2/2 tool calls logged after fix (analyze with gen_sql+val_sql, list_section_types without).

### analytics_query_cache: 7 rows (WORKING)

Seven unique SQL queries cached with 120s TTL. Cache is correctly scoped by `(sql_hash, tenant_id, app_id)`.

### analytics_jobs: 31 rows (WORKING)

From backfill (18 runs) + earlier testing. All `status=completed`.

### report_configs: Template saved (WORKING)

"Compliance Deep Dive" template with 3 sections persisted correctly.

## Gaps Found

### GAP 1: Agent tool logging not persisting (CRITICAL)

See above. Only 1 of ~10 tool calls logged. The fire-and-forget pattern depends on a commit that doesn't happen.

### GAP 2: Adversarial difficulty not in eval_facts context (MINOR)

Turn 4 asked for block rate by difficulty. The LLM queried `analytics_eval_facts` but the `context` JSONB for adversarial entries stores `{"difficulty": ..., "total_turns": ...}` — however the query `context->>'difficulty'` returned NULL because the adversarial extractor stores difficulty from `case.difficulty` which is a string. The actual issue: the LLM generated a query against `analytics_run_facts` (which has `adversarial_block_rate` but no per-difficulty breakdown) instead of joining to `analytics_eval_facts` where difficulty lives in context.

**Impact:** Low. The data IS in the fact tables, the LLM just chose the wrong table for this question. A common_query pattern for "adversarial by difficulty" would fix this.

### GAP 3: generated_sql vs validated_sql in tool logs (MINOR)

The single logged row (`save_template`) has `generated_sql=NULL` and `validated_sql=NULL` — correct because `save_template` doesn't generate SQL. For `analyze` calls, we can't verify because they aren't persisted (GAP 1). Once GAP 1 is fixed, these columns should populate correctly.

### GAP 4: No cache_hit flag in tool logs (MINOR)

Turn 6 was likely a cache hit (same pass rate question as Turn 1) but we can't verify because the log wasn't persisted. The `analyze` function returns `cache_hit: True` which `_log_tool_call` maps to the `cache_hit` column — but again, depends on GAP 1 fix.

## Recommendations

1. **Fix GAP 1 immediately** — tool logging is useless without commits. Use a separate session for log writes.
2. **Add common_query for adversarial by difficulty** — add to `semantic_model.yaml` common_queries section.
3. **Verify cache_hit logging** after GAP 1 fix — re-run the test and confirm the column populates.
4. **Consider adding `db.commit()` after every tool dispatch** in the chat handler — not just for `save_template`. This would also fix any other tools that write to the DB (e.g., `compose_report` doesn't write, but future tools might).

## What's Working Well

- **Fact tables are fast.** All SQL queries executed in <200ms with no JSONB lateral joins.
- **Semantic model v2 works.** The LLM generates clean `SELECT ... FROM analytics_criterion_facts` queries — no `::jsonb` cast issues, no lateral join syntax errors.
- **Common query matching works.** Turn 3 (pass rate trend) matched the pre-built pattern.
- **Cache works correctly.** 7 entries stored, TTL is 120s, tenant-scoped.
- **Report builder integration intact.** Sections listed, report composed, template saved — all via the same chat session.
- **Idempotent backfill confirmed.** 18/18 runs backfilled, re-runs produce identical row counts.
- **Service account auth resolves correctly.** No API key needed — `settings_helper.py` auto-detects the service account file.
