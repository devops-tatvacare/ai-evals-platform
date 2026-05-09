"""Sherlock v3 — supervisor → specialist runtime, single-brain-at-a-time.

One LLM call is in flight at a time, fully orchestrated by the OpenAI
Agents SDK. The supervisor decomposes; the data_specialist generates SQL
inline (no second LLM call) and runs it through the chart pipeline. State
lives in ``platform.sherlock_state`` and ``platform.sherlock_evidence``;
no module-level adapters to legacy chat handlers.
"""
