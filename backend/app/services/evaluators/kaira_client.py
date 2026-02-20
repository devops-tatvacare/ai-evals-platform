"""Async Kaira API client for live adversarial testing.

Ported from kaira-evals/src/kaira_client.py — converted to async using aiohttp.
"""
import asyncio
import json
import logging
import time
from typing import Optional, List, Dict, Any, Callable
from dataclasses import dataclass, field

import aiohttp

from app.services.evaluators.models import KairaSessionState

logger = logging.getLogger(__name__)


class KairaAPIError(Exception):
    """Rich error from Kaira API calls — carries status, message, and URL."""

    def __init__(self, status: int, message: str, url: str):
        self.status = status
        self.message = message
        self.url = url
        super().__init__(str(self))

    def __str__(self) -> str:
        if self.status:
            return f"HTTP {self.status} from {self.url}: {self.message}"
        return f"Connection error for {self.url}: {self.message}"


@dataclass
class KairaStreamResponse:
    full_message: str = ""
    thread_id: Optional[str] = None
    session_id: Optional[str] = None
    response_id: Optional[str] = None
    detected_intents: List[Dict] = field(default_factory=list)
    agent_responses: List[Dict] = field(default_factory=list)
    is_multi_intent: bool = False


class KairaClient:
    """Async HTTP client for the Kaira chat API.

    Supports async context manager for connection pooling across multiple
    calls (recommended for adversarial tests with many turns). Falls back
    to a per-call session if used without ``async with``.
    """

    def __init__(
        self, auth_token: str, base_url: str,
        log_callback: Optional[Callable] = None,
        run_id: Optional[str] = None,
        timeout: float = 120,
    ):
        if not auth_token:
            raise ValueError("KAIRA_AUTH_TOKEN not set. Cannot run live tests.")
        self.auth_token = auth_token
        self.base_url = base_url
        self._session: Optional[aiohttp.ClientSession] = None
        self._log_callback = log_callback
        self._run_id = run_id
        self._timeout = aiohttp.ClientTimeout(sock_read=timeout)

    async def open(self) -> None:
        """Open a persistent session for connection pooling."""
        if not self._session:
            self._session = aiohttp.ClientSession()

    async def close(self) -> None:
        """Close the persistent session."""
        if self._session:
            await self._session.close()
            self._session = None

    async def __aenter__(self) -> "KairaClient":
        await self.open()
        return self

    async def __aexit__(self, *exc) -> None:
        await self.close()

    async def stream_message(
        self, query: str, user_id: str,
        session_state: KairaSessionState,
        test_case_label: Optional[str] = None,
    ) -> KairaStreamResponse:
        url = f"{self.base_url}/chat/stream"

        payload = session_state.build_request_payload(query)

        headers = {
            "Content-Type": "application/json",
            "Accept": "*/*",
            "token": self.auth_token,
        }

        result = KairaStreamResponse()
        start = time.monotonic()
        error_text = None
        response_summary = None

        try:
            # Use persistent session if available, otherwise create one-off
            if self._session:
                await self._stream_request(self._session, url, payload, headers, session_state, result, self._timeout)
            else:
                async with aiohttp.ClientSession() as session:
                    await self._stream_request(session, url, payload, headers, session_state, result, self._timeout)

            # Copy final identifiers from session_state into response
            result.thread_id = session_state.thread_id
            result.session_id = session_state.session_id
            result.response_id = session_state.response_id

            response_summary = (
                f"[{len(result.agent_responses)} agents] "
                f"{result.full_message[:200]}"
            )
            return result

        except Exception as e:
            error_text = str(e)
            raise

        finally:
            duration_ms = (time.monotonic() - start) * 1000
            if self._log_callback:
                try:
                    await self._log_callback({
                        "run_id": self._run_id,
                        "thread_id": session_state.thread_id,
                        "test_case_label": test_case_label,
                        "provider": "KairaAPI",
                        "model": "chat/stream",
                        "method": "stream_message",
                        "prompt": json.dumps(payload)[:5000],
                        "system_prompt": None,
                        "response": response_summary,
                        "error": error_text,
                        "duration_ms": round(duration_ms, 2),
                        "tokens_in": None,
                        "tokens_out": None,
                    })
                except Exception as log_err:
                    logger.warning(f"Failed to log Kaira API call: {log_err}")

    @staticmethod
    async def _stream_request(
        session: aiohttp.ClientSession, url: str,
        payload: dict, headers: dict,
        session_state: KairaSessionState, result: KairaStreamResponse,
        timeout: Optional[aiohttp.ClientTimeout] = None,
    ) -> None:
        """Execute a single streaming request and accumulate chunks into result."""
        try:
            async with session.post(url, json=payload, headers=headers, timeout=timeout or aiohttp.ClientTimeout(sock_read=120)) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    raise KairaAPIError(
                        status=resp.status,
                        message=body[:500] or resp.reason or "No response body",
                        url=url,
                    )
                async for line in resp.content:
                    decoded = line.decode("utf-8").strip()
                    if not decoded:
                        continue
                    if decoded == "data: [DONE]":
                        break
                    if decoded.startswith("data: "):
                        json_str = decoded[6:]
                        if not json_str.strip() or json_str.strip().isdigit():
                            continue
                        try:
                            chunk = json.loads(json_str)
                            session_state.apply_chunk(chunk)
                            KairaClient._process_chunk(chunk, result)
                        except json.JSONDecodeError:
                            logger.warning(f"Failed to parse chunk: {json_str[:100]}")
        except KairaAPIError:
            raise
        except asyncio.TimeoutError as e:
            raise KairaAPIError(
                status=0,
                message="Request timed out — Kaira API did not respond in time",
                url=url,
            ) from e
        except aiohttp.ClientError as e:
            raise KairaAPIError(
                status=0,
                message=str(e) or type(e).__name__,
                url=url,
            ) from e

    @staticmethod
    def _process_chunk(chunk: Dict[str, Any], result: KairaStreamResponse):
        """Accumulate content-only data (intents, agent responses, summaries)."""
        chunk_type = chunk.get("type")

        if chunk_type == "intent_classification":
            result.detected_intents = chunk.get("detected_intents", [])
            result.is_multi_intent = chunk.get("is_multi_intent", False)
        elif chunk_type == "agent_response":
            result.agent_responses.append({
                "agent": chunk.get("agent"),
                "message": chunk.get("message"),
                "success": chunk.get("success"),
                "data": chunk.get("data"),
            })
            if chunk.get("success") and chunk.get("message"):
                result.full_message = chunk.get("message")
        elif chunk_type == "summary":
            if chunk.get("message"):
                result.full_message = chunk.get("message")
        elif chunk_type == "error":
            logger.error(f"Stream error: {chunk.get('error')}")
