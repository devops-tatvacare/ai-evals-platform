"""Sherlock v3 runtime — one-turn execution that emits typed Parts via PartEmitter."""
from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from agents import Runner

from app.auth.context import AuthContext
from app.services.orchestration_authoring.builder_snapshot import BuilderSnapshot
from app.services.sherlock_v3.azure_client import get_sherlock_azure_client
from app.services.sherlock_v3.contracts import (
    AssistantTextPart,
    Attempt,
    CompactionPart,
    ErrorPart,
    ReasoningPart,
    RetryPart,
    SpecialistBrief,
    SpecialistScope,
    StepFinishPart,
    StepStartPart,
    SubtaskPart,
    SubtaskStateCompleted,
    SubtaskStateError,
    SubtaskStateRunning,
    UserMessagePart,
    new_part_id,
)
from app.services.sherlock_v3.emitter import PartEmitter
from app.services.sherlock_v3.subtask_result import project_specialist_output
from app.services.sherlock_v3.limits import MAX_SPECIALIST_ATTEMPTS
from app.services.sherlock_v3.grounding import (
    GroundingContext,
    VerifiedExampleRef,
)
from app.services.sherlock_v3.state_store import (
    SherlockStateSnapshot,
    load_state,
)
from app.services.sherlock_v3.supervisor import build_supervisor

logger = logging.getLogger(__name__)


@dataclass
class SherlockTurnContext:
    """Per-turn handles passed to the SDK as ``RunContextWrapper.context``."""

    tenant_id: uuid.UUID
    user_id: uuid.UUID
    app_id: str
    chat_session_id: uuid.UUID
    turn_id: uuid.UUID
    auth: AuthContext
    emitter: PartEmitter | None = None
    previous_response_id: str | None = None
    streamed_text_parts: list[str] = field(default_factory=list)
    scratch: dict[str, Any] = field(default_factory=dict)
    builder_context: BuilderSnapshot | None = None


_STALE_PREVIOUS_RESPONSE_ID_MARKERS = (
    'previous_response_not_found',
    'previous_response was not found',
    'previous response not found',
)


def _is_stale_previous_response_id(exc: BaseException) -> bool:
    raw = repr(exc).lower()
    return any(marker in raw for marker in _STALE_PREVIOUS_RESPONSE_ID_MARKERS)


@dataclass
class TurnResult:
    """Returned by run_turn — usage + chain head for the caller's finalization."""

    status: str
    usage: dict[str, Any]
    last_response_id: str | None
    error: str | None = None


async def _compute_grounding(
    app_id: str,
    user_message: str,
    *,
    tenant_id: uuid.UUID,
) -> GroundingContext | None:
    try:
        from app.database import async_session
        from app.services.sherlock_v3.instructions import load_instructions
        from app.services.sherlock_v3.verified_queries import retrieve_top_k

        async with async_session() as db:
            hits = await retrieve_top_k(
                user_message,
                tenant_id=tenant_id,
                app_id=app_id,
                db=db,
                k=5,
            )
            instructions_block = await load_instructions(
                app_id, tenant_id=tenant_id, db=db,
            )
        verified = tuple(
            VerifiedExampleRef(
                id=str(h.id), question=h.question, sql=h.sql,
                score=h.score, source=h.source,
            )
            for h in hits
        )
        return GroundingContext(
            app_id=app_id,
            user_message=user_message,
            verified_examples=verified,
            instructions_block=instructions_block,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            'sherlock_v3 grounding enrichment failed for app=%s: %s',
            app_id, exc,
        )
        return GroundingContext(app_id=app_id, user_message=user_message)


async def _load_turn_state(chat_session_id: uuid.UUID) -> SherlockStateSnapshot:
    try:
        from app.database import async_session
        async with async_session() as db:
            return await load_state(db, chat_session_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            'sherlock_v3 state load failed for chat_session=%s: %s',
            chat_session_id, exc,
        )
        return SherlockStateSnapshot(resolved_entities={}, active_filters={})


def _wrap_user_message_as_brief(
    *,
    user_message: str,
    ctx: SherlockTurnContext,
) -> str:
    """Always pass the supervisor a typed envelope as input — supervisor's prompt then crafts SpecialistBriefs for each as_tool dispatch."""
    return user_message


async def run_turn(
    user_message: str,
    ctx: SherlockTurnContext,
    *,
    max_turns: int = 10,
) -> TurnResult:
    """Execute one Sherlock v3 turn, emitting typed Parts via ctx.emitter."""
    if ctx.emitter is None:
        raise RuntimeError('SherlockTurnContext.emitter must be set before run_turn')

    client, supervisor_model = await get_sherlock_azure_client(
        tenant_id=ctx.tenant_id, call_site="analytics_supervisor",
    )
    _spec_client, specialist_model = await get_sherlock_azure_client(
        tenant_id=ctx.tenant_id, call_site="analytics_specialist",
    )
    del _spec_client

    grounding = await _compute_grounding(
        ctx.app_id, user_message, tenant_id=ctx.tenant_id,
    )
    state_snapshot = await _load_turn_state(ctx.chat_session_id)
    supervisor = build_supervisor(
        ctx.app_id,
        client,
        supervisor_model=supervisor_model,
        specialist_model=specialist_model,
        grounding=grounding,
        builder_context=ctx.builder_context,
        auth=ctx.auth,
        state_snapshot=state_snapshot,
    )

    await ctx.emitter.emit(StepStartPart(
        id=new_part_id(),
        chat_session_id='',
        seq=0,
        created_at=0,
        turn_id=str(ctx.turn_id),
    ))
    await ctx.emitter.emit(UserMessagePart(
        id=new_part_id(),
        chat_session_id='',
        seq=0,
        created_at=0,
        text=user_message,
    ))

    try:
        usage, last_response_id = await _stream_once(
            supervisor, _wrap_user_message_as_brief(user_message=user_message, ctx=ctx),
            ctx, ctx.previous_response_id, max_turns,
        )
    except Exception as exc:
        if not _is_stale_previous_response_id(exc):
            await ctx.emitter.emit(ErrorPart(
                id=new_part_id(),
                chat_session_id='',
                seq=0,
                created_at=0,
                source='supervisor',
                message=f'{type(exc).__name__}: {exc}',
            ))
            await ctx.emitter.emit(StepFinishPart(
                id=new_part_id(),
                chat_session_id='',
                seq=0,
                created_at=0,
                turn_id=str(ctx.turn_id),
                status='error',
            ))
            return TurnResult(status='error', usage={}, last_response_id=None, error=str(exc))
        logger.warning(
            'sherlock_v3.run_turn previous_response_id is stale '
            '(>30d); replaying turn=%s without prior chain',
            ctx.turn_id,
        )
        try:
            replay_input = await _history_input_for_context(ctx)
            if not replay_input or replay_input[-1] != {'role': 'user', 'content': user_message}:
                replay_input.append({'role': 'user', 'content': user_message})
            usage, last_response_id = await _stream_once(
                supervisor, replay_input or user_message, ctx, None, max_turns,
            )
        except Exception as exc2:  # noqa: BLE001
            await ctx.emitter.emit(ErrorPart(
                id=new_part_id(),
                chat_session_id='',
                seq=0,
                created_at=0,
                source='supervisor',
                message=f'{type(exc2).__name__}: {exc2}',
            ))
            await ctx.emitter.emit(StepFinishPart(
                id=new_part_id(),
                chat_session_id='',
                seq=0,
                created_at=0,
                turn_id=str(ctx.turn_id),
                status='error',
            ))
            return TurnResult(status='error', usage={}, last_response_id=None, error=str(exc2))

    await ctx.emitter.emit(StepFinishPart(
        id=new_part_id(),
        chat_session_id='',
        seq=0,
        created_at=0,
        turn_id=str(ctx.turn_id),
        status='done',
        last_response_id=last_response_id,
        tokens_in=usage.get('input_tokens'),
        tokens_out=usage.get('output_tokens'),
    ))
    return TurnResult(
        status='done',
        usage=usage,
        last_response_id=last_response_id,
    )


async def _stream_once(
    supervisor: Any,
    input_payload: Any,
    ctx: SherlockTurnContext,
    previous_response_id: str | None,
    max_turns: int,
) -> tuple[dict[str, Any], str | None]:
    streaming = Runner.run_streamed(
        supervisor,
        input_payload,
        context=ctx,
        max_turns=max_turns,
        previous_response_id=previous_response_id,
    )
    async for event in streaming.stream_events():
        await _emit_part_for_sdk_event(event, ctx)

    last_response_id = getattr(streaming, 'last_response_id', None)
    usage = _extract_usage(streaming)
    return usage, last_response_id


async def _emit_part_for_sdk_event(event: Any, ctx: SherlockTurnContext) -> None:
    """Translate one Agents-SDK stream event into Part emission.

    Supervisor text → AssistantTextPart streaming updates.
    Reasoning → ReasoningPart streaming updates.
    Supervisor's tool_called (calling a specialist) → SubtaskPart with brief.
    Server-side compaction → CompactionPart.
    Specialist's submit_sql lifecycle is owned by the specialist handler (ToolPart).
    """
    emitter = ctx.emitter
    assert emitter is not None
    event_type = type(event).__name__

    if event_type == 'RawResponsesStreamEvent':
        data = getattr(event, 'data', None)
        raw_type = str(getattr(data, 'type', '') or '')
        delta = getattr(data, 'delta', None)
        if isinstance(delta, str) and delta:
            if raw_type == 'response.output_text.delta':
                await _accrete_text_part(ctx, kind='assistant_text', delta=delta)
                return
            if raw_type == 'response.reasoning_summary_text.delta':
                await _accrete_text_part(ctx, kind='reasoning', delta=delta)
                return
        if 'compact' in raw_type.lower():
            comp = _compaction_payload(raw_type, data)
            if comp is not None:
                await emitter.emit(CompactionPart(
                    id=new_part_id(),
                    chat_session_id='',
                    seq=0,
                    created_at=0,
                    summary=comp.get('summary', ''),
                    tokens_before=comp.get('tokens_before'),
                ))
        if raw_type in (
            'response.output_text.done',
            'response.reasoning_summary_text.done',
            'response.completed',
        ):
            await _finalize_active_text_part(ctx)
        return

    if event_type == 'RunItemStreamEvent':
        item_name = getattr(event, 'name', '')
        if item_name == 'tool_called':
            tool_call = getattr(event, 'item', None)
            specialist = _tool_call_name(tool_call)
            call_id = _tool_call_call_id(tool_call) or f'call_{uuid.uuid4().hex[:12]}'
            counts = ctx.scratch.setdefault('_specialist_dispatch_counts', {})
            counts[specialist] = counts.get(specialist, 0) + 1
            attempt_number = counts[specialist]
            if attempt_number > 1:
                prior = ctx.scratch.get('_last_data_specialist_attempt') if specialist == 'data_specialist' else None
                if isinstance(prior, Attempt):
                    await emitter.emit(RetryPart(
                        id=new_part_id(),
                        chat_session_id='',
                        seq=0,
                        created_at=0,
                        specialist=specialist,
                        attempt_number=attempt_number,
                        failed_attempt=prior,
                    ))
            brief = await _tool_call_brief(tool_call, ctx=ctx)
            emitted = await emitter.emit(SubtaskPart(
                id=new_part_id(),
                chat_session_id='',
                seq=0,
                created_at=0,
                specialist=specialist,
                call_id=call_id,
                brief=brief,
                state=SubtaskStateRunning(started_at=int(time.monotonic() * 1000)),
            ))
            ctx.scratch.setdefault('_subtask_parts_by_call_id', {})[call_id] = emitted
            return
        if item_name == 'tool_output':
            await _close_subtask_on_output(getattr(event, 'item', None), ctx)
        return


def _tool_output_text(item: Any) -> str:
    output = getattr(item, 'output', None)
    if isinstance(output, str):
        return output
    if isinstance(output, dict):
        return json.dumps(output, default=str)
    return ''


async def _close_subtask_on_output(output_item: Any, ctx: SherlockTurnContext) -> None:
    """Resolve the matching SubtaskPart's lifecycle when the specialist returns."""
    emitter = ctx.emitter
    if emitter is None or output_item is None:
        return
    call_id = _tool_call_call_id(output_item)
    subtask = ctx.scratch.get('_subtask_parts_by_call_id', {}).get(call_id)
    if subtask is None:
        return
    result, is_error = project_specialist_output(
        subtask.specialist, _tool_output_text(output_item),
    )
    started_at = subtask.state.started_at if isinstance(subtask.state, SubtaskStateRunning) else 0
    ended_at = int(time.monotonic() * 1000)
    new_state = (
        SubtaskStateError(started_at=started_at, ended_at=ended_at, error=result.summary or 'specialist failed')
        if is_error
        else SubtaskStateCompleted(started_at=started_at, ended_at=ended_at, result=result)
    )
    await emitter.update(subtask.model_copy(update={'state': new_state}))


async def _accrete_text_part(
    ctx: SherlockTurnContext,
    *,
    kind: str,
    delta: str,
) -> None:
    """Stream tokens into an active AssistantTextPart / ReasoningPart, emitting on first delta + updating thereafter."""
    emitter = ctx.emitter
    assert emitter is not None
    scratch_key = f'_active_{kind}_part'
    active = ctx.scratch.get(scratch_key)
    if active is None:
        if kind == 'assistant_text':
            part = AssistantTextPart(
                id=new_part_id(),
                chat_session_id='',
                seq=0,
                created_at=0,
                text=delta,
            )
        else:
            part = ReasoningPart(
                id=new_part_id(),
                chat_session_id='',
                seq=0,
                created_at=0,
                text=delta,
            )
        emitted = await emitter.emit(part)
        ctx.scratch[scratch_key] = emitted
        return
    updated = active.model_copy(update={'text': (active.text or '') + delta})
    await emitter.update(updated)
    ctx.scratch[scratch_key] = updated


async def _finalize_active_text_part(ctx: SherlockTurnContext) -> None:
    """Mark whichever streaming Part is open as final + clear scratch."""
    emitter = ctx.emitter
    assert emitter is not None
    for key in ('_active_assistant_text_part', '_active_reasoning_part'):
        active = ctx.scratch.pop(key, None)
        if active is None:
            continue
        finalized = active.model_copy(update={'final': True})
        await emitter.update(finalized)


def _tool_call_name(item: Any) -> str:
    raw = getattr(item, 'raw_item', item)
    if isinstance(raw, dict):
        return str(raw.get('name') or 'data_specialist')
    return str(getattr(raw, 'name', '') or 'data_specialist')


def _tool_call_call_id(item: Any) -> str:
    raw = getattr(item, 'raw_item', item)
    if isinstance(raw, dict):
        return str(raw.get('call_id') or '')
    return str(getattr(raw, 'call_id', '') or '')


async def _tool_call_brief(item: Any, *, ctx: SherlockTurnContext) -> SpecialistBrief:
    """Parse the supervisor's tool args into a typed SpecialistBrief, emitting an ErrorPart when the payload does not match — so a malformed brief is visible in the timeline instead of silently downgraded."""
    raw = getattr(item, 'raw_item', item)
    args = raw.get('arguments') if isinstance(raw, dict) else getattr(raw, 'arguments', None)
    scope = SpecialistScope(
        tenant_id=str(ctx.tenant_id),
        app_id=ctx.app_id,
        user_id=str(ctx.user_id),
    )
    emitter = ctx.emitter
    if not (isinstance(args, str) and args.strip()):
        return SpecialistBrief(question=str(args or '')[:2000], scope=scope)
    try:
        payload = json.loads(args)
    except json.JSONDecodeError as exc:
        if emitter is not None:
            await emitter.emit(ErrorPart(
                id=new_part_id(),
                chat_session_id='',
                seq=0,
                created_at=0,
                source='supervisor',
                message=f'SpecialistBrief was not valid JSON: {exc.msg}',
                recoverable=True,
            ))
        return SpecialistBrief(question=args[:2000], scope=scope)
    if not isinstance(payload, dict):
        if emitter is not None:
            await emitter.emit(ErrorPart(
                id=new_part_id(),
                chat_session_id='',
                seq=0,
                created_at=0,
                source='supervisor',
                message='SpecialistBrief must be a JSON object',
                recoverable=True,
            ))
        return SpecialistBrief(question=str(payload)[:2000], scope=scope)
    try:
        return SpecialistBrief.model_validate({
            'question': payload.get('question') or '',
            'scope': scope.model_dump(),
            'prior_attempts': payload.get('prior_attempts') or [],
            'retry_hint': payload.get('retry_hint'),
        })
    except Exception as exc:  # noqa: BLE001
        if emitter is not None:
            await emitter.emit(ErrorPart(
                id=new_part_id(),
                chat_session_id='',
                seq=0,
                created_at=0,
                source='supervisor',
                message=f'SpecialistBrief failed validation: {exc}',
                recoverable=True,
            ))
        return SpecialistBrief(
            question=str(payload.get('question') or payload.get('task') or args)[:2000],
            scope=scope,
        )


def _compaction_payload(raw_type: str, data: Any) -> dict[str, Any] | None:
    if 'compaction' not in raw_type.lower():
        return None
    summary_text = ''
    tokens_before: int | None = None
    item = getattr(data, 'item', None)
    if item is not None:
        summary_text = (
            getattr(item, 'summary', None)
            or getattr(item, 'text', None)
            or getattr(item, 'content', None)
            or ''
        )
        token_field = getattr(item, 'tokens_before', None) or getattr(item, 'compacted_tokens', None)
        if isinstance(token_field, int):
            tokens_before = token_field
    if not summary_text:
        compaction = getattr(data, 'compaction', None)
        if compaction is not None:
            summary_text = getattr(compaction, 'summary', '') or ''
    return {'summary': str(summary_text or ''), 'tokens_before': tokens_before}


async def _history_input_for_context(ctx: SherlockTurnContext) -> list[dict[str, str]]:
    from app.database import async_session
    from app.models.chat import ChatMessage
    from sqlalchemy import select

    async with async_session() as db:
        rows = (
            await db.execute(
                select(ChatMessage.role, ChatMessage.content)
                .where(
                    ChatMessage.session_id == ctx.chat_session_id,
                    ChatMessage.tenant_id == ctx.tenant_id,
                    ChatMessage.user_id == ctx.user_id,
                    ChatMessage.status.in_(('complete', 'streaming')),
                    ChatMessage.role.in_(('user', 'assistant')),
                )
                .order_by(ChatMessage.created_at, ChatMessage.id)
            )
        ).all()
    return [
        {'role': role, 'content': content}
        for role, content in rows
        if role in {'user', 'assistant'} and content
    ]


def _extract_usage(streaming: Any) -> dict[str, Any]:
    ctx_wrapper = getattr(streaming, 'context_wrapper', None)
    usage = getattr(ctx_wrapper, 'usage', None) if ctx_wrapper else None
    if usage is None:
        return {
            'input_tokens': 0, 'output_tokens': 0, 'cached_read_tokens': 0,
            'cost_usd': 0.0, 'call_count': 0,
        }
    return {
        'input_tokens': getattr(usage, 'input_tokens', 0),
        'output_tokens': getattr(usage, 'output_tokens', 0),
        'cached_read_tokens': getattr(usage, 'cached_input_tokens', 0),
        'cost_usd': 0.0,
        'call_count': getattr(usage, 'requests', 0),
    }


__all__ = [
    'MAX_SPECIALIST_ATTEMPTS',
    'SherlockTurnContext',
    'TurnResult',
    'run_turn',
]
