"""Capability adapter Protocols — messaging (WhatsApp et al.) and voice."""
from __future__ import annotations

from typing import Any, ClassVar, Mapping, Optional, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.orchestration.adapters.canonical import (
    CancelDispatchResult,
    CanonicalMessagingEvent,
    CanonicalSendRequest,
    CanonicalSendResponse,
    CanonicalVoiceEvent,
    CanonicalVoiceRequest,
    CanonicalVoiceResponse,
)


class MessagingAdapter(Protocol):
    capability: ClassVar[str]
    vendor: ClassVar[str]

    async def send_template(
        self, *, connection: Any, request: CanonicalSendRequest,
    ) -> CanonicalSendResponse: ...

    def normalize_webhook(self, raw: dict[str, Any]) -> CanonicalMessagingEvent: ...

    def verify_signature(self, raw: bytes, headers: Mapping[str, str]) -> bool: ...

    async def handle_webhook(
        self,
        db: AsyncSession,
        *,
        tenant_id: Any,
        app_id: str,
        payload: dict[str, Any],
    ) -> None: ...

    async def cancel_dispatch(
        self, *, connection: Any, action: Any,
    ) -> CancelDispatchResult: ...

    async def cancel_run_actions(
        self, *, connection: Any, actions: list[Any],
    ) -> list[CancelDispatchResult]: ...


class VoiceAdapter(Protocol):
    capability: ClassVar[str]
    vendor: ClassVar[str]
    # None means "vendor never batches"; integer is the cohort size at
    # or above which the node flips from per-recipient ``place_call`` to
    # a single ``place_call_batch`` upload.
    batch_threshold: ClassVar[Optional[int]]

    async def place_call(
        self, *, connection: Any, request: CanonicalVoiceRequest,
    ) -> CanonicalVoiceResponse: ...

    async def place_call_batch(
        self,
        *,
        connection: Any,
        requests: list[CanonicalVoiceRequest],
        recipient_ids: list[str],
    ) -> list[CanonicalVoiceResponse]: ...

    def normalize_webhook(self, raw: dict[str, Any]) -> CanonicalVoiceEvent: ...

    def verify_signature(self, raw: bytes, headers: Mapping[str, str]) -> bool: ...

    async def handle_webhook(
        self,
        db: AsyncSession,
        *,
        tenant_id: Any,
        app_id: str,
        payload: dict[str, Any],
    ) -> None: ...

    async def cancel_dispatch(
        self, *, connection: Any, action: Any,
    ) -> CancelDispatchResult: ...

    async def cancel_batch(
        self, *, connection: Any, batch_id: str,
    ) -> CancelDispatchResult: ...

    async def cancel_run_actions(
        self, *, connection: Any, actions: list[Any],
    ) -> list[CancelDispatchResult]: ...
