"""Canonical (vendor-agnostic) request, response, and event shapes for capability adapters.

Every dispatch action MUST carry ``contact`` and ``provider_correlation_id`` per the
CLAUDE.md invariant; both fields are required on the canonical response and event types.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Optional


@dataclass(frozen=True)
class CanonicalSendRequest:
    contact: str
    template_slug: str
    variables: dict[str, str] = field(default_factory=dict)
    reply_context_id: Optional[str] = None


@dataclass(frozen=True)
class CanonicalSendResponse:
    provider_correlation_id: str
    contact: str
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CanonicalMessagingEvent:
    status: str
    contact: str
    provider_correlation_id: str
    reply_context_id: Optional[str] = None
    reply_type: Optional[str] = None
    reply_text: Optional[str] = None
    button_id: Optional[str] = None
    list_id: Optional[str] = None
    vendor_raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CanonicalVoiceRequest:
    contact: str
    agent_id: str
    variables: dict[str, str] = field(default_factory=dict)
    from_phone: Optional[str] = None


@dataclass(frozen=True)
class CanonicalVoiceResponse:
    provider_correlation_id: str
    contact: str
    mode: str
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CanonicalVoiceEvent:
    outcome: str
    contact: str
    provider_correlation_id: str
    duration_sec: Optional[int] = None
    transcript: Optional[str] = None
    recording_url: Optional[str] = None
    vendor_raw: dict[str, Any] = field(default_factory=dict)


class CancelDispatchOutcome(StrEnum):
    stopped = "stopped"
    cancelled = "cancelled"
    noop_unsupported = "noop_unsupported"
    noop_already_delivered = "noop_already_delivered"
    noop_already_terminal = "noop_already_terminal"
    provider_error = "provider_error"


@dataclass(frozen=True)
class CancelDispatchResult:
    outcome: CancelDispatchOutcome
    provider_status_code: Optional[int] = None
    provider_message: Optional[str] = None
