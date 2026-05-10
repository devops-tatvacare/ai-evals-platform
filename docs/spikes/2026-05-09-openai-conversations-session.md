# Sherlock v3 — `OpenAIConversationsSession` Phase-0 Spike

**Date opened:** 2026-05-09
**Owner:** pareekshith.bompally@tatvacare.in
**Spike harness:** `backend/scripts/spikes/conversations_session_spike.py`
**Reference:** `docs/specs/2026-04-26-sherlock-v3-architecture.md` §7
**Status:** **CLOSED — NO-GO. Fall back to `previous_response_id`.**

---

## Why

The architecture spec D4 commits to `OpenAIConversationsSession` for Sherlock v3, but with a hard prerequisite: **prove it works for our deployment before P1 starts.** If any criterion fails, P1 falls back to the documented `previous_response_id` pattern (already in `openai_agents_adapter.py:560` and `report_builder/chat_handler.py:1430`) and the architecture spec's §11 wiring + §14 reconnect logic adjusts accordingly.

## Acceptance criteria — verbatim from §7

1. `OpenAIConversationsSession` instantiates against the configured Sherlock model using our existing API key + endpoint.
2. Multi-turn: 5 sequential `Runner.run` calls share state through the same `conversation_id`; the LLM remembers turn 1 in turn 5.
3. Token billing: input-token counts on turn N include cached-prefix discounts (verified via `usage` field).
4. Conversation object survives 24 h with no items written to it (no TTL).
5. Items persisted across worker process restarts (multi-worker safety check).

## How to run

```bash
cd backend
pyenv activate venv-python-ai-evals-arize

# Set the keys/model the spike will use. Match what production Sherlock will use.
export OPENAI_API_KEY=sk-...
export SHERLOCK_SUPERVISOR_MODEL=gpt-5.4-mini   # or whatever you intend to pin

# C1 + C2 + C3 — runs in ~2 min, costs roughly $0.05.
python scripts/spikes/conversations_session_spike.py quick

# C5 round-trip — seed then verify in two separate process invocations.
python scripts/spikes/conversations_session_spike.py c5-seed
# … exit, restart your shell or open a new terminal …
python scripts/spikes/conversations_session_spike.py c5-verify

# C4 — needs a 24h gap. Seed today, verify tomorrow.
python scripts/spikes/conversations_session_spike.py c4-seed
# … wait ≥24 h …
python scripts/spikes/conversations_session_spike.py c4-verify

# When done, drop the test conversations from your OpenAI org.
python scripts/spikes/conversations_session_spike.py cleanup
```

State persists at `/tmp/sherlock_v3_spike_state.json` between runs so C4/C5 can resume.

## Results

Aborted at C0 — pre-spike probe — because it answered the whole question.

**C0 — does Azure expose the Conversations API at all?**

```
client built ok against Azure (https://products-ai.cognitiveservices.azure.com)
conversations.create FAILED: NotFoundError: 404 — Resource not found
```

Azure OpenAI's preview surfaces (`api-version=2025-04-01-preview`) include the
Responses API but **do not** include `client.conversations.*`. There is no
`OpenAIConversationsSession`-compatible endpoint on Azure today.

Criteria 1–5 in the harness are moot — they all assume the SDK can call
Conversations API endpoints, and those endpoints don't exist on our provider.

| # | Criterion | Result | Notes |
|---|---|---|---|
| 0 | Conversations API reachable on Azure | **FAIL — 404** | Pre-spike probe; cancelled remaining criteria |
| 1 | Instantiate + 1 turn | N/A | Blocked by C0 |
| 2 | 5-turn recall | N/A | Blocked by C0 |
| 3 | Cached-prefix discount visible | N/A | Blocked by C0 |
| 4 | 24h survival | N/A | Blocked by C0 |
| 5 | Cross-process resumption | N/A | Blocked by C0 |

## Verdict

- [ ] **GO** — all 5 PASS. Architecture spec §11 wiring proceeds as written.
- [x] **NO-GO** — Conversations API is OpenAI-direct only; our deployment is Azure-only. P1 falls back to `previous_response_id`. The fallback path is already implemented in `openai_agents_adapter.py:560` and `report_builder/chat_handler.py:1430` — v3 reuses it.

## Decision

**Decided by:** pareekshith.bompally@tatvacare.in
**Decided at:** 2026-05-09
**Outcome:** NO-GO on `OpenAIConversationsSession`. Architecture spec updated in the same commit to drop §7 and rewrite §11/§14 against `previous_response_id`. P1 starts immediately.
**P1 start date:** 2026-05-09

### Why this isn't a setback

The spike's whole purpose was to surface this mismatch before we built P1 on top of it. The fallback is documented, already implemented, and works today. Trade-off: `previous_response_id` chains expire after 30 days — `_is_stale_previous_response_id` already handles refresh-on-expiry, so the architecture impact is one helper, not a redesign.
