"""Sherlock v3 turn orchestrator — owns DB side-effects around one Part-stream turn."""
from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update

from app.auth.context import AuthContext
from app.database import async_session
from app.models.sherlock_runtime import SherlockAgentSession
from app.services.orchestration_authoring.builder_snapshot import BuilderSnapshot
from app.services.report_builder.runtime_store import (
    SherlockAgentSessionState,
    create_assistant_message,
    finalize_assistant_message,
)
from app.services.report_builder.turn_store import (
    SherlockConversationTurnState,
    mark_turn_active,
    mark_turn_terminal,
)
from app.services.sherlock_v3.compaction import (
    CONTEXT_COMPACT_THRESHOLD_TOKENS,
    CONTEXT_PROGRESS_START_RATIO,
    CONTEXT_PROGRESS_TICK_RATIO,
)
from app.services.sherlock_v3.emitter import PartEmitter, PublishFn
from app.services.sherlock_v3.runtime import (
    SherlockTurnContext,
    TurnResult,
    run_turn,
)

logger = logging.getLogger(__name__)


PublishToTransport = Callable[[dict[str, Any]], Awaitable[None]]


async def run_chat_turn(
    *,
    runtime_session: SherlockAgentSessionState,
    user_message: str,
    turn: SherlockConversationTurnState,
    on_event: PublishToTransport,
    auth: AuthContext,
    builder_context: BuilderSnapshot | None = None,
) -> None:
    """Drive one Sherlock v3 turn — PartEmitter persists Parts, on_event ships them to the SSE wire."""
    async with async_session() as db:
        assistant_message_id = await create_assistant_message(
            runtime_session=runtime_session, db=db,
        )
        await mark_turn_active(
            turn_id=turn.id,
            assistant_message_id=assistant_message_id,
            db=db,
        )
        await db.commit()

    collected: dict[str, Any] = {
        'final_text': [],
        'compaction_fired': False,
        'last_seq': turn.last_event_seq,
        'error_message': None,
    }

    async def _publish(_turn_id: str, payload: dict[str, Any]) -> None:
        part = payload.get('part') or {}
        seq = int(payload.get('seq') or 0)
        collected['last_seq'] = seq
        part_type = part.get('type')
        if part_type == 'assistant_text':
            if part.get('final'):
                collected['final_text'].append(str(part.get('text') or ''))
        elif part_type == 'compaction':
            collected['compaction_fired'] = True
        elif part_type == 'error':
            collected['error_message'] = str(part.get('message') or '')
        await on_event({
            'event': str(payload.get('kind') or 'part_added'),
            'data': {'seq': seq, 'part': part},
        })

    async with async_session() as emitter_db:
        emitter = PartEmitter(
            db=emitter_db,
            chat_session_id=uuid.UUID(runtime_session.chat_session_id),
            tenant_id=uuid.UUID(runtime_session.tenant_id),
            user_id=uuid.UUID(runtime_session.user_id),
            app_id=runtime_session.app_id,
            turn_id=turn.id,
            publish=_wrap_publish(_publish, turn.id),
        )
        ctx = SherlockTurnContext(
            tenant_id=uuid.UUID(runtime_session.tenant_id),
            user_id=uuid.UUID(runtime_session.user_id),
            app_id=runtime_session.app_id,
            chat_session_id=uuid.UUID(runtime_session.chat_session_id),
            turn_id=uuid.UUID(turn.id),
            auth=auth,
            emitter=emitter,
            builder_context=builder_context,
            previous_response_id=runtime_session.last_response_id,
        )

        try:
            result: TurnResult = await run_turn(user_message, ctx)
        except Exception as exc:  # noqa: BLE001
            logger.exception('sherlock_v3 turn orchestrator failed')
            result = TurnResult(
                status='error', usage={}, last_response_id=None,
                error=f'{type(exc).__name__}: {exc}',
            )
            collected['error_message'] = result.error
        finally:
            await emitter_db.commit()

    if collected['compaction_fired']:
        await _reset_cumulative_tokens(runtime_session=runtime_session)

    usage = await _price_usage(result.usage, runtime_session=runtime_session)
    await _record_turn_llm_usage(
        usage=usage,
        runtime_session=runtime_session,
        turn=turn,
        terminal_status=result.status,
    )
    context_info = await _bump_and_read_context_window(
        runtime_session=runtime_session,
        usage=usage,
    )

    terminal_status = result.status
    final_text = ''.join(collected['final_text'])
    final_message_status = 'complete' if collected['error_message'] is None else 'error'
    final_error = collected['error_message']

    async with async_session() as db:
        metadata = {
            'terminalStatus': _to_frontend_terminal_status(terminal_status),
            'usage': _usage_to_camel(usage),
            'context': context_info,
        }
        await finalize_assistant_message(
            runtime_session=runtime_session,
            message_id=assistant_message_id,
            content=final_text,
            metadata=metadata,
            status=final_message_status,
            error_message=final_error,
            db=db,
        )
        await mark_turn_terminal(
            turn_id=turn.id,
            status=terminal_status,
            last_event_seq=int(collected['last_seq']),
            last_error=final_error,
            db=db,
        )
        if result.last_response_id:
            await db.execute(
                update(SherlockAgentSession)
                .where(SherlockAgentSession.chat_session_id == uuid.UUID(runtime_session.chat_session_id))
                .values(last_response_id=result.last_response_id),
            )
        await db.commit()


def _wrap_publish(inner: Any, _turn_id: str) -> PublishFn:
    """Adapt the PartEmitter publish signature (turn_id + payload) to the SSE bridge."""
    async def _publish(passed_turn_id: str, payload: dict[str, Any]) -> None:
        await inner(passed_turn_id, payload)
    return _publish


def _to_frontend_terminal_status(status: Any) -> str:
    if status in {'done', 'error', 'interrupted'}:
        return str(status)
    return 'done'


def _usage_to_camel(usage: dict[str, Any]) -> dict[str, Any]:
    input_tokens = int(usage.get('input_tokens') or usage.get('inputTokens') or 0)
    output_tokens = int(usage.get('output_tokens') or usage.get('outputTokens') or 0)
    cached_read_tokens = int(usage.get('cached_read_tokens') or usage.get('cachedReadTokens') or 0)
    cached_write_tokens = int(usage.get('cached_write_tokens') or usage.get('cachedWriteTokens') or 0)
    reasoning_tokens = int(usage.get('reasoning_tokens') or usage.get('reasoningTokens') or 0)
    tool_use_prompt_tokens = int(usage.get('tool_use_prompt_tokens') or usage.get('toolUsePromptTokens') or 0)
    return {
        'inputTokens': input_tokens,
        'outputTokens': output_tokens,
        'cachedReadTokens': cached_read_tokens,
        'cachedWriteTokens': cached_write_tokens,
        'reasoningTokens': reasoning_tokens,
        'toolUsePromptTokens': tool_use_prompt_tokens,
        'totalTokens': (
            input_tokens + output_tokens + cached_read_tokens
            + cached_write_tokens + reasoning_tokens + tool_use_prompt_tokens
        ),
        'costUsd': float(usage.get('cost_usd') or usage.get('costUsd') or 0.0),
        'callCount': int(usage.get('call_count') or usage.get('callCount') or 0),
    }


async def _resolved_supervisor(
    runtime_session: SherlockAgentSessionState,
) -> tuple[str, str]:
    from app.services.llm_credentials import resolve_llm_call
    try:
        async with async_session() as db:
            resolved = await resolve_llm_call(
                db,
                uuid.UUID(runtime_session.tenant_id),
                'analytics_supervisor',
            )
        return resolved.credentials.provider, resolved.model
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            'sherlock_v3 supervisor call-site resolution failed for '
            'chat_session=%s: %s — falling back to session.provider/model',
            runtime_session.chat_session_id, exc,
        )
        return runtime_session.provider, runtime_session.model


async def _price_usage(
    usage: dict[str, Any],
    *,
    runtime_session: SherlockAgentSessionState,
) -> dict[str, Any]:
    from app.services.cost_tracking.pricing import compute_cost
    from app.services.cost_tracking.pricing_cache import pricing_cache

    priced = dict(usage)
    if not priced:
        return priced
    provider, model = await _resolved_supervisor(runtime_session)
    async with async_session() as db:
        pricing = await pricing_cache.get(
            db,
            provider,
            model,
            datetime.now(UTC),
            tenant_id=uuid.UUID(runtime_session.tenant_id),
        )
    cost_usd, _breakdown, _fallback = compute_cost(
        pricing,
        input_tokens=int(priced.get('input_tokens') or 0),
        output_tokens=int(priced.get('output_tokens') or 0),
        cached_read_tokens=int(priced.get('cached_read_tokens') or 0),
        cached_write_tokens=int(priced.get('cached_write_tokens') or 0),
        reasoning_tokens=int(priced.get('reasoning_tokens') or 0),
        tool_use_prompt_tokens=int(priced.get('tool_use_prompt_tokens') or 0),
    )
    priced['cost_usd'] = float(cost_usd)
    return priced


async def _record_turn_llm_usage(
    *,
    usage: dict[str, Any],
    runtime_session: SherlockAgentSessionState,
    turn: SherlockConversationTurnState,
    terminal_status: str,
) -> None:
    if not usage:
        return
    from app.services.cost_tracking.recorder import record_llm_usage

    metadata: dict[str, Any] = {
        'input_tokens': int(usage.get('input_tokens') or 0),
        'output_tokens': int(usage.get('output_tokens') or 0),
        'cached_read_tokens': int(usage.get('cached_read_tokens') or 0),
        'reasoning_tokens': int(usage.get('reasoning_tokens') or 0),
        'tool_use_prompt_tokens': int(usage.get('tool_use_prompt_tokens') or 0),
        'duration_ms': int(usage.get('duration_ms') or 0) or None,
        'status': 'ok' if terminal_status == 'done' else terminal_status,
    }

    provider, model = await _resolved_supervisor(runtime_session)
    await record_llm_usage(
        tenant_id=uuid.UUID(runtime_session.tenant_id),
        user_id=uuid.UUID(runtime_session.user_id),
        app_id=runtime_session.app_id,
        owner_type='sherlock_turn',
        owner_id=uuid.UUID(turn.id),
        subsystem='sherlock_v3',
        provider=provider,
        model=model,
        api_surface='responses',
        call_purpose='chat_turn',
        metadata=metadata,  # type: ignore[arg-type]
    )


def _input_token_estimate(usage: dict[str, Any]) -> int:
    input_tokens = usage.get('inputTokens') or usage.get('input_tokens')
    cached = usage.get('cachedInputTokens') or usage.get('cached_input_tokens') or 0
    if isinstance(input_tokens, int):
        return max(0, input_tokens - (cached if isinstance(cached, int) else 0))
    prompt = usage.get('promptTokens') or usage.get('prompt_tokens') or 0
    return prompt if isinstance(prompt, int) else 0


async def _reset_cumulative_tokens(
    *, runtime_session: SherlockAgentSessionState,
) -> None:
    try:
        async with async_session() as db:
            await db.execute(
                update(SherlockAgentSession)
                .where(
                    SherlockAgentSession.chat_session_id
                    == uuid.UUID(runtime_session.chat_session_id)
                )
                .values(cumulative_input_tokens=0)
            )
            await db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            'sherlock_v3 cumulative_input_tokens reset failed for '
            'chat_session=%s: %s', runtime_session.chat_session_id, exc,
        )


async def _bump_and_read_context_window(
    *,
    runtime_session: SherlockAgentSessionState,
    usage: dict[str, Any],
) -> dict[str, Any]:
    increment = _input_token_estimate(usage)
    tokens_used = 0
    try:
        async with async_session() as db:
            result = await db.execute(
                update(SherlockAgentSession)
                .where(
                    SherlockAgentSession.chat_session_id
                    == uuid.UUID(runtime_session.chat_session_id)
                )
                .values(
                    cumulative_input_tokens=(
                        SherlockAgentSession.cumulative_input_tokens + increment
                    )
                )
                .returning(SherlockAgentSession.cumulative_input_tokens),
            )
            row = result.first()
            await db.commit()
            tokens_used = int(row[0]) if row is not None else increment
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            'sherlock_v3 cumulative_input_tokens bump failed for '
            'chat_session=%s: %s', runtime_session.chat_session_id, exc,
        )
        tokens_used = increment

    return {
        'tokensUsed': tokens_used,
        'thresholdTokens': CONTEXT_COMPACT_THRESHOLD_TOKENS,
        'progressStartRatio': CONTEXT_PROGRESS_START_RATIO,
        'progressTickRatio': CONTEXT_PROGRESS_TICK_RATIO,
    }


__all__ = ['run_chat_turn']
