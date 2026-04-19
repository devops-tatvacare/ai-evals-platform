"""Per-request correlation id middleware.

Sets ``CORRELATION_ID`` for the duration of a request so every ``llm_usage``
row recorded downstream carries the same id. Honors an inbound
``X-Correlation-Id`` header when the caller supplies one (useful for tracing
across services); otherwise generates a fresh UUIDv4.

The middleware echoes the resolved id back to clients via ``X-Correlation-Id``
on the response so operators can correlate logs with recorded rows.
"""
from __future__ import annotations

import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.services.cost_tracking.correlation import (
    reset_correlation_id,
    set_correlation_id,
)

_HEADER = b'x-correlation-id'


class CorrelationIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return

        incoming = _read_incoming_header(scope)
        try:
            correlation_id = uuid.UUID(incoming) if incoming else uuid.uuid4()
        except ValueError:
            correlation_id = uuid.uuid4()

        token = set_correlation_id(correlation_id)

        async def _send(message: Message) -> None:
            if message.get('type') == 'http.response.start':
                headers = list(message.get('headers') or [])
                headers.append((_HEADER, str(correlation_id).encode('ascii')))
                message = {**message, 'headers': headers}
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            reset_correlation_id(token)


def _read_incoming_header(scope: Scope) -> str | None:
    for name, value in scope.get('headers') or []:
        if name.lower() == _HEADER:
            try:
                return value.decode('ascii')
            except UnicodeDecodeError:
                return None
    return None
