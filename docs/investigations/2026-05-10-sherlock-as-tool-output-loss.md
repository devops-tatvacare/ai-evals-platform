# Sherlock v3 — `Agent.as_tool` Output Loss + UI Plumbing Rot

**Date:** 2026-05-10
**Branch:** `feat/sherlock-v3`
**Triggered by:** Phase 1A verification (Q1 audit run revealed UI rot)

## Symptoms

Live Q1 ("Show evaluation runs by status as a chart") produced:
- **No chart card** — markdown ASCII bars in the prose instead of a Recharts card.
- **`0ms` specialist latency** in the chip.
- **Inert footnote `↩` glyphs** referencing UUIDs that had no corresponding evidence chips in the UI.
- **Generic `Used N tools` chip** that did not narrate the supervisor → specialist hand-off.

Backend telemetry (Phase 1A `sherlock_v3.routing` log lines) showed the work was correct — `chart_payload_kind='chart'`, `latency_ms=56`, `evidence` rows persisted to `platform.sherlock_evidence`, projected tables matched intent.

## Root cause (single)

When `supervisor.build_supervisor` calls `data_specialist.as_tool(...)`, the OpenAI Agents SDK's documented default for `custom_output_extractor` is *"the last message from the agent will be used"* as the tool output. So the supervisor receives the data_specialist's LLM-rendered final-answer prose — **not** the rich `SpecialistResult` JSON that `submit_sql` produced inside the data_specialist's run.

`runtime.normalize_to_v3_events._extract_specialist_result` then fails the `'status' in decoded` check, returns `None`, and every wire field defaults: `result_summary=""`, `evidence_refs=[]`, `artifact_refs=[]`, `duration_ms=0`. Worse, `_specialist_artifacts` returns `[]`, so the `artifact_emitted` event never fires — the chart card has no payload to mount.

Wire-stream evidence (Q2, before fix):
```
event: specialist_finished
data: {"specialist": "data_specialist", "status": "ok",
       "result_summary": "", "evidence_refs": [], "artifact_refs": [],
       "duration_ms": 0, "seq": 77}
```

Wire-stream evidence (Q2, after fix):
```
event: specialist_finished
data: {... "result_summary": "table: 2 rows for: …",
       "evidence_refs": ["7642e407...", "a5e93873..."],
       "artifact_refs": ["artifact_1"], "duration_ms": 51,
       "routing": {... grounding: {intent_class: aggregate, projected_tables: [agg_evaluation_run]}},
       "row_count": 2}
event: artifact_emitted
data: {"kind": "table", "payload": {... CG_DEGENERATE_MEASURE …}}
```

## Fix

`extract_data_specialist_output(run_result)` (in `data_specialist.py`) walks `run_result.new_items` in reverse, finds the most recent `submit_sql` `ToolCallOutputItem`, and returns its raw JSON string. Wired into `data_spec.as_tool(custom_output_extractor=…)`.

That single backend change unblocks:
- chart card mounting (artifact_emitted now fires),
- real specialist latency (duration_ms reaches the wire),
- evidence + routing telemetry (chip narrates `agg_evaluation_run · 2 rows · 2 evidence · aggregate`).

Three follow-ons in the same commit:
- `runtime.normalize_to_v3_events` also surfaces `routing` + `row_count` on `specialist_finished` so the chip can show grounded context.
- Frontend `useChatWidget.onDone` no longer clobbers the live `durationMs` with `undefined` from the redundant `executionMs` reconciliation.
- Frontend `ToolItem` / `ToolGroup` redesigned: "Sherlock consulted the data specialist" copy + telemetry chips (`projected_table · row_count · evidence · intent_class`) + collapsible SQL detail.
- Supervisor prompt: explicit "no ASCII charts in prose" + "no inline `Evidence ref <uuid>` citations" rules.

## Why it landed in Phase 1A territory

The plan said Phase 1A would surface routing telemetry on every `submit_sql` attempt. It did, in backend logs. But the wire vocabulary downstream had been silently broken since the v2 → v3 cutover — nothing in the v3 happy path actually exercised the as_tool boundary against a real chart payload before this verification pass. The Phase 1A plan's "Live verification (Playwright + DB)" gate is what surfaced it.

## Tests

- `test_data_specialist_output_extractor_unittest.py` (7 tests): pins extractor behavior across happy path, fallback to final_output text, dict-output serialization, alternate raw_item shapes.
- All Phase 1A tests still green: 46/46 in the touched modules.

## Out of scope (deliberate)

- Footnote/evidence chip side panel — the wire now carries `evidence_refs`, but rendering them as clickable chips with row previews is a Phase 2 concern (verified queries / evidence side panel design).
- Cross-app verification of Q3–Q10 — gated on this fix landing; resumes next turn.
