"""Sherlock v3 smoke test — runs one war-game question end-to-end.

Spawns the v3 supervisor + data_specialist against a real Azure OpenAI
deployment and prints every normalized SSE event. Verifies that:
  * tenant-scoped credential resolution works (azure_client.py)
  * the supervisor invokes the data_specialist tool
  * the tool generates SQL via the manifest, executes it, and emits a
    chart payload
  * the runtime streams normalized v3 events end-to-end
  * costs land somewhere sane (printed at the end)

Defaults pin the tenant + user + app to a known-configured triple in
local dev. Override via env if you want to run as someone else:
  SHERLOCK_SMOKE_TENANT_ID, SHERLOCK_SMOKE_USER_ID,
  SHERLOCK_SMOKE_APP_ID, SHERLOCK_SMOKE_CHAT_SESSION_ID

Usage:
  docker compose exec backend python scripts/spikes/sherlock_v3_smoke.py q1
  docker compose exec backend python scripts/spikes/sherlock_v3_smoke.py q8
  docker compose exec backend python scripts/spikes/sherlock_v3_smoke.py "any question"
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid

from app.services.sherlock_v3.runtime import SherlockTurnContext, run_turn


# Defaults pin to a known-configured triple in local dev. Override via env.
DEFAULT_TENANT_ID = os.getenv(
    'SHERLOCK_SMOKE_TENANT_ID', 'af2fcf2b-40a7-4b1a-8fb1-6da0bed73383',
)
DEFAULT_USER_ID = os.getenv(
    'SHERLOCK_SMOKE_USER_ID', '44a3afdf-78f8-4789-9f1f-96184359439a',
)
DEFAULT_APP_ID = os.getenv('SHERLOCK_SMOKE_APP_ID', 'inside-sales')
DEFAULT_CHAT_SESSION_ID = os.getenv(
    'SHERLOCK_SMOKE_CHAT_SESSION_ID', 'ffaecc9d-513a-44b0-bfa1-3e97ae12f3d6',
)


WAR_GAME_QUESTIONS = {
    'q1': 'Provide a failure summary for the last 4 evaluation runs.',
    'q2': 'What is the most common failure type in voice-rx evaluations?',
    'q3': 'Which API field is most often violated in inside-sales calls?',
    'q4': 'Which agent has the most compliance issues this month?',
    'q5': 'Who is the most rude agent over the last 30 days?',
    'q6': 'Compare voice-rx week-over-week failure rate this week vs last week.',
    'q7': 'Show me transcript snippets for that agent.',
    'q8': 'Which evaluators have NOT been used this month?',
}


async def main(question: str) -> int:
    ctx = SherlockTurnContext(
        tenant_id=uuid.UUID(DEFAULT_TENANT_ID),
        user_id=uuid.UUID(DEFAULT_USER_ID),
        app_id=DEFAULT_APP_ID,
        chat_session_id=uuid.UUID(DEFAULT_CHAT_SESSION_ID),
        turn_id=uuid.uuid4(),
        previous_response_id=None,
    )
    print(f'[smoke] question: {question}')
    print(f'[smoke] tenant={ctx.tenant_id} user={ctx.user_id} app={ctx.app_id}')
    print(f'[smoke] chat_session={ctx.chat_session_id} turn={ctx.turn_id}')
    print('---')

    started = time.monotonic()
    event_count = 0
    final = None
    seen_specialist = False
    final_text_parts: list[str] = []

    async for event in run_turn(question, ctx, max_turns=8):
        event_count += 1
        kind = event.get('type', '?')
        if kind == 'content_delta':
            text = event.get('text', '')
            phase = event.get('phase', '')
            print(f'[{kind}] phase={phase} {text!r}')
            if phase == 'final_answer':
                final_text_parts.append(text)
        elif kind == 'specialist_started':
            seen_specialist = True
            print(f'[{kind}] specialist={event.get("specialist")} '
                  f'call_id={event.get("call_id")}')
        elif kind == 'specialist_finished':
            print(f'[{kind}] specialist={event.get("specialist")} '
                  f'status={event.get("status")} '
                  f'result_summary={event.get("result_summary")!r}')
        elif kind == 'turn_finished':
            final = event
            usage = event.get('usage', {})
            print(f'[{kind}] status={event.get("status")} '
                  f'last_response_id={event.get("last_response_id")}')
            print(f'[{kind}] usage: input={usage.get("input_tokens")} '
                  f'cached={usage.get("cached_read_tokens")} '
                  f'output={usage.get("output_tokens")} '
                  f'calls={usage.get("call_count")}')
        elif kind == 'error_emitted':
            print(f'[{kind}] source={event.get("source")} '
                  f'msg={event.get("message")} '
                  f'recoverable={event.get("recoverable")}')
        else:
            print(f'[{kind}] {json.dumps(event, default=str)[:200]}')

    elapsed = time.monotonic() - started
    print('---')
    print(f'[smoke] done in {elapsed:.2f}s, {event_count} events')
    print(f'[smoke] specialist invoked: {seen_specialist}')
    if final_text_parts:
        text = ''.join(final_text_parts)
        print(f'[smoke] final answer ({len(text)} chars):')
        print(text)
    return 0 if (final and final.get('status') in ('done', 'partial')) else 1


def _resolve_question(arg: str) -> str:
    return WAR_GAME_QUESTIONS.get(arg.lower(), arg)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.stderr.write(__doc__ or '')
        sys.exit(2)
    sys.exit(asyncio.run(main(_resolve_question(sys.argv[1]))))
