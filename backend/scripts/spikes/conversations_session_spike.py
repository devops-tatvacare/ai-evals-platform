"""Sherlock v3 — Phase-0 spike for `OpenAIConversationsSession`.

Validates the 5 acceptance criteria from
`docs/specs/2026-04-26-sherlock-v3-architecture.md` §7 before P1 starts:

  1. Instantiates against the configured Sherlock model with our API key.
  2. Multi-turn (5 sequential Runner.run) shares state through one conversation_id;
     the LLM remembers turn 1 in turn 5.
  3. Token billing on turn N includes cached-prefix discounts (visible in `usage`).
  4. Conversation object survives 24h with no items written (no TTL).
  5. Items persist across worker process restarts (multi-worker safety).

Run as:

    cd backend
    pyenv activate venv-python-ai-evals-arize
    OPENAI_API_KEY=sk-... \
    SHERLOCK_SUPERVISOR_MODEL=gpt-5.4-mini \
        python scripts/spikes/conversations_session_spike.py <subcommand>

Subcommands:
    c1                  Criterion 1 — instantiate + single Runner.run.
    c2                  Criterion 2 — 5-turn recall.
    c3                  Criterion 3 — measure cached_tokens across sequential calls.
    c4-seed             Criterion 4 step A — create empty conversation, persist id.
    c4-verify           Criterion 4 step B — re-open the persisted id ≥24h later.
    c5-seed             Criterion 5 step A — populate a conversation, persist id.
    c5-verify           Criterion 5 step B — re-open from a fresh process.
    quick               Runs c1 + c2 + c3 (~2 min, ~$0.05).
    full                Runs quick + c5 round-trip.
    cleanup             Deletes all conversations recorded in the state file.

State persisted at /tmp/sherlock_v3_spike_state.json so the multi-step criteria
can resume across invocations.

Exits 0 on PASS, 1 on FAIL, 2 on operator error (missing env, etc.). Each
subcommand prints a single-line PASS/FAIL summary the operator can paste into
the report at docs/spikes/2026-05-09-openai-conversations-session.md.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Imports must succeed against the project's existing openai-agents pin.
from agents import Agent, Runner
from agents.memory import OpenAIConversationsSession
from agents.models.openai_responses import OpenAIResponsesModel
from openai import AsyncOpenAI

STATE_PATH = Path('/tmp/sherlock_v3_spike_state.json')


def _model_name() -> str:
    return (
        os.getenv('SHERLOCK_SUPERVISOR_MODEL')
        or os.getenv('SQL_AGENT_MODEL')
        or 'gpt-5.4-mini'
    )


def _require_api_key() -> str:
    key = os.getenv('OPENAI_API_KEY')
    if not key:
        sys.stderr.write('FATAL: OPENAI_API_KEY not set.\n')
        sys.exit(2)
    return key


def _load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {}
    return json.loads(STATE_PATH.read_text())


def _save_state(state: dict[str, Any]) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True))


def _build_agent(client: AsyncOpenAI) -> Agent:
    return Agent(
        name='sherlock-v3-spike',
        instructions=(
            'You are a terse research assistant participating in a multi-turn '
            'protocol test. Always answer in one short sentence. When asked to '
            'recall an earlier value, repeat it verbatim.'
        ),
        model=OpenAIResponsesModel(_model_name(), client),
    )


@dataclass
class TurnUsage:
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int


def _extract_usage(result: Any) -> TurnUsage:
    """Pull token counts from a Runner result regardless of SDK minor version."""
    usage = getattr(result, 'context_wrapper', None)
    if usage is not None:
        usage = getattr(usage, 'usage', None)
    if usage is None:
        usage = getattr(result, 'usage', None)
    if usage is None:
        return TurnUsage(0, 0, 0)
    return TurnUsage(
        input_tokens=getattr(usage, 'input_tokens', 0) or 0,
        cached_input_tokens=(
            getattr(usage, 'cached_input_tokens', 0)
            or getattr(usage, 'cached_tokens', 0)
            or 0
        ),
        output_tokens=getattr(usage, 'output_tokens', 0) or 0,
    )


# ────────────────────────── criteria ──────────────────────────

async def c1_instantiate() -> int:
    _require_api_key()
    client = AsyncOpenAI()
    session = OpenAIConversationsSession(openai_client=client)
    agent = _build_agent(client)
    started = time.monotonic()
    result = await Runner.run(agent, 'Reply with the literal word PING.', session=session)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    convo_id = await session._get_session_id()  # noqa: SLF001 — spike only
    output = (result.final_output or '').strip()
    state = _load_state()
    state.setdefault('conversations', []).append(convo_id)
    _save_state(state)

    ok = 'PING' in output.upper()
    print(
        f'c1: {"PASS" if ok else "FAIL"} model={_model_name()} '
        f'convo_id={convo_id} latency_ms={elapsed_ms} output={output!r}'
    )
    return 0 if ok else 1


async def c2_multi_turn() -> int:
    _require_api_key()
    secret = 'AUBERGINE-7741'
    client = AsyncOpenAI()
    session = OpenAIConversationsSession(openai_client=client)
    agent = _build_agent(client)

    prompts = [
        f'Remember the codeword: {secret}. Acknowledge with OK.',
        'Pick a number between 1 and 100. Just the number.',
        'What letter does "platypus" start with? One letter.',
        'Name a primary color. One word.',
        'What was the codeword I gave you? Repeat it verbatim.',
    ]
    outputs: list[str] = []
    for prompt in prompts:
        result = await Runner.run(agent, prompt, session=session)
        outputs.append((result.final_output or '').strip())

    convo_id = await session._get_session_id()  # noqa: SLF001
    state = _load_state()
    state.setdefault('conversations', []).append(convo_id)
    _save_state(state)

    final = outputs[-1].upper()
    ok = secret.upper() in final
    print(f'c2: {"PASS" if ok else "FAIL"} convo_id={convo_id} final={outputs[-1]!r}')
    if not ok:
        for i, o in enumerate(outputs, 1):
            print(f'  turn {i}: {o!r}')
    return 0 if ok else 1


async def c3_caching() -> int:
    _require_api_key()
    client = AsyncOpenAI()
    session = OpenAIConversationsSession(openai_client=client)
    agent = _build_agent(client)

    # Pad the first turn with a long stable prefix so the cache has something
    # worth reusing on turns 2+.
    long_prefix = (
        'Context (do not summarize, just hold in memory): '
        + ('lorem ipsum dolor sit amet ' * 200)
    )

    usages: list[TurnUsage] = []
    for i in range(3):
        prompt = f'{long_prefix}\n\nTurn {i + 1}: reply with the integer {i + 1}.'
        result = await Runner.run(agent, prompt, session=session)
        usages.append(_extract_usage(result))

    convo_id = await session._get_session_id()  # noqa: SLF001
    state = _load_state()
    state.setdefault('conversations', []).append(convo_id)
    _save_state(state)

    cached_seen = any(u.cached_input_tokens > 0 for u in usages[1:])
    print(f'c3: {"PASS" if cached_seen else "FAIL"} convo_id={convo_id}')
    for i, u in enumerate(usages, 1):
        print(
            f'  turn {i}: input={u.input_tokens} cached={u.cached_input_tokens} '
            f'output={u.output_tokens}'
        )
    return 0 if cached_seen else 1


async def c4_seed() -> int:
    _require_api_key()
    client = AsyncOpenAI()
    convo = await client.conversations.create(items=[])
    state = _load_state()
    state['c4_convo_id'] = convo.id
    state['c4_seeded_at'] = int(time.time())
    state.setdefault('conversations', []).append(convo.id)
    _save_state(state)
    print(f'c4-seed: PASS convo_id={convo.id} seeded_at={state["c4_seeded_at"]}')
    print('  Re-run `c4-verify` AT LEAST 24h from now (ideally 25h+).')
    return 0


async def c4_verify() -> int:
    _require_api_key()
    state = _load_state()
    convo_id = state.get('c4_convo_id')
    seeded_at = state.get('c4_seeded_at')
    if not convo_id or not seeded_at:
        print('c4-verify: FAIL no c4 seed in state file. Run c4-seed first.')
        return 1
    age_h = (time.time() - seeded_at) / 3600
    if age_h < 24:
        print(f'c4-verify: SKIP age={age_h:.1f}h — wait until ≥24h before verifying.')
        return 2

    client = AsyncOpenAI()
    try:
        # Conversations Items list will 404 if the conversation expired.
        items_iter = client.conversations.items.list(conversation_id=convo_id, order='asc')
        item_count = 0
        async for _ in items_iter:
            item_count += 1
    except Exception as exc:
        print(f'c4-verify: FAIL convo_id={convo_id} age_h={age_h:.1f} error={exc!r}')
        return 1

    print(
        f'c4-verify: PASS convo_id={convo_id} age_h={age_h:.1f} '
        f'items_in_empty_conversation={item_count}'
    )
    return 0


async def c5_seed() -> int:
    _require_api_key()
    client = AsyncOpenAI()
    session = OpenAIConversationsSession(openai_client=client)
    agent = _build_agent(client)
    secret = 'BANANA-9912'
    await Runner.run(agent, f'The watchword is {secret}. Just say OK.', session=session)
    convo_id = await session._get_session_id()  # noqa: SLF001
    state = _load_state()
    state['c5_convo_id'] = convo_id
    state['c5_secret'] = secret
    state.setdefault('conversations', []).append(convo_id)
    _save_state(state)
    print(f'c5-seed: PASS convo_id={convo_id} secret={secret}')
    print('  Now run `c5-verify` in a SEPARATE process to simulate worker restart.')
    return 0


async def c5_verify() -> int:
    _require_api_key()
    state = _load_state()
    convo_id = state.get('c5_convo_id')
    secret = state.get('c5_secret')
    if not convo_id or not secret:
        print('c5-verify: FAIL no c5 seed in state file. Run c5-seed first.')
        return 1
    # Brand-new session object (and brand-new process if the operator follows
    # instructions) bound to the stored conversation_id.
    client = AsyncOpenAI()
    session = OpenAIConversationsSession(conversation_id=convo_id, openai_client=client)
    agent = _build_agent(client)
    result = await Runner.run(
        agent, 'Repeat the watchword I gave you, verbatim.', session=session
    )
    output = (result.final_output or '').strip()
    ok = secret.upper() in output.upper()
    print(f'c5-verify: {"PASS" if ok else "FAIL"} convo_id={convo_id} output={output!r}')
    return 0 if ok else 1


async def cleanup() -> int:
    state = _load_state()
    ids = state.get('conversations', [])
    if not ids:
        print('cleanup: nothing to delete.')
        return 0
    client = AsyncOpenAI()
    deleted = 0
    failed: list[tuple[str, str]] = []
    for convo_id in ids:
        try:
            await client.conversations.delete(conversation_id=convo_id)
            deleted += 1
        except Exception as exc:
            failed.append((convo_id, repr(exc)))
    state['conversations'] = []
    state.pop('c4_convo_id', None)
    state.pop('c4_seeded_at', None)
    state.pop('c5_convo_id', None)
    state.pop('c5_secret', None)
    _save_state(state)
    print(f'cleanup: deleted={deleted} failed={len(failed)}')
    for cid, err in failed:
        print(f'  {cid}: {err}')
    return 0


# ────────────────────────── dispatcher ──────────────────────────

SUBCOMMANDS = {
    'c1': c1_instantiate,
    'c2': c2_multi_turn,
    'c3': c3_caching,
    'c4-seed': c4_seed,
    'c4-verify': c4_verify,
    'c5-seed': c5_seed,
    'c5-verify': c5_verify,
    'cleanup': cleanup,
}


async def quick() -> int:
    rc = 0
    for name in ('c1', 'c2', 'c3'):
        sub_rc = await SUBCOMMANDS[name]()
        rc = rc or sub_rc
    return rc


async def full() -> int:
    rc = await quick()
    rc = rc or await c5_seed()
    rc = rc or await c5_verify()
    return rc


SUBCOMMANDS['quick'] = quick
SUBCOMMANDS['full'] = full


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in SUBCOMMANDS:
        sys.stderr.write(__doc__ or '')
        return 2
    return asyncio.run(SUBCOMMANDS[sys.argv[1]]())


if __name__ == '__main__':
    sys.exit(main())
