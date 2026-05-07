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

    def __init__(self, status: int, message: str, url: str, kind: str = "http"):
        self.status = status
        self.message = message
        self.url = url
        self.kind = kind
        super().__init__(str(self))

    def __str__(self) -> str:
        if self.status:
            return f"HTTP {self.status} from {self.url}: {self.message}"
        return f"Connection error for {self.url}: {self.message}"


@dataclass
class KairaStreamResponse:
    full_message: str = ""              # from done.full_response
    session_id: Optional[str] = None   # from classification.session_id
    classification: Optional[Dict] = None   # the entire classification chunk
    food_card: Optional[Dict] = None   # structured data object if emitted
    token_stream: List[str] = field(default_factory=list)  # raw token fragments (debug)
    stream_errors: List[str] = field(default_factory=list)
    saw_done: bool = False
    saw_food_card: bool = False
    stream_completed: bool = False
    had_partial_response: bool = False
    had_empty_final_assistant_message: bool = False

    # ── Backward-compat properties (used by conversation_agent.py and graders) ──

    @property
    def agent_success(self) -> bool:
        return self.saw_done

    @property
    def detected_intents(self) -> List[Dict]:
        if not self.classification:
            return []
        return [{"intent": self.classification["intent"], "confidence": self.classification["confidence"]}]

    @property
    def is_multi_intent(self) -> bool:
        return False

    @property
    def agent_responses(self) -> List[Dict]:
        if not self.saw_done:
            return []
        return [{
            "agent": self.classification.get("agent") if self.classification else None,
            "message": self.full_message,
            "success": True,
            "data": self.food_card,
        }]

    @property
    def thread_id(self) -> Optional[str]:
        # adversarial_runner.py writes ConversationTurn.thread_id from this
        return self.session_id

    @property
    def response_id(self) -> None:
        # adversarial_runner.py writes ConversationTurn.response_id from this
        return None


class KairaClient:
    """Async HTTP client for the Kaira chat API.

    Supports async context manager for connection pooling across multiple
    calls (recommended for adversarial tests with many turns). Falls back
    to a per-call session if used without ``async with``.
    """

    def __init__(
        self,
        auth_token: str,
        base_url: str,
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

    async def upload_image(self, image: "str | bytes") -> str:
        """Upload an image to Kaira and return the single-use image_id.

        Args:
            image: File path (str) or raw bytes of the image to upload.

        Returns:
            image_id string returned by ``POST /api/upload-image``.
        """
        url = f"{self.base_url}/api/upload-image"
        headers = {"token": self.auth_token}

        if isinstance(image, str):
            with open(image, "rb") as fh:
                image_bytes = fh.read()
        else:
            image_bytes = image

        data = aiohttp.FormData()
        data.add_field("file", image_bytes, filename="image.jpg", content_type="image/jpeg")

        if self._session:
            session = self._session
            own = False
        else:
            session = aiohttp.ClientSession()
            own = True

        try:
            async with session.post(url, data=data, headers=headers) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    raise KairaAPIError(
                        status=resp.status,
                        message=body[:500] or resp.reason or "No response body",
                        url=url,
                        kind="http",
                    )
                result = await resp.json()
                return result["image_id"]
        finally:
            if own:
                await session.close()

    async def stream_message(
        self,
        query: str,
        user_id: str,
        session_state: KairaSessionState,
        test_case_label: Optional[str] = None,
        image_id: Optional[str] = None,
    ) -> KairaStreamResponse:
        url = f"{self.base_url}/api/chat"

        payload = session_state.build_request_payload(query)
        if image_id:
            payload["image_id"] = image_id

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
                await self._stream_request(
                    self._session,
                    url,
                    payload,
                    headers,
                    session_state,
                    result,
                    self._timeout,
                )
            else:
                async with aiohttp.ClientSession() as session:
                    await self._stream_request(
                        session,
                        url,
                        payload,
                        headers,
                        session_state,
                        result,
                        self._timeout,
                    )

            # Copy final identifiers from session_state into response
            result.session_id = session_state.session_id
            result.had_partial_response = bool(
                result.token_stream and not result.saw_done
            )
            result.had_empty_final_assistant_message = not bool(
                (result.full_message or "").strip()
            )

            response_summary = (
                f"[session={result.session_id}] {result.full_message[:200]}"
            )
            return result

        except Exception as e:
            error_text = str(e)
            raise

        finally:
            duration_ms = (time.monotonic() - start) * 1000
            if self._log_callback:
                try:
                    await self._log_callback(
                        {
                            "run_id": self._run_id,
                            "thread_id": session_state.session_id,
                            "test_case_label": test_case_label,
                            "provider": "KairaAPI",
                            "model": "chat",
                            "method": "stream_message",
                            "prompt": json.dumps(payload)[:5000],
                            "system_prompt": None,
                            "response": response_summary,
                            "error": error_text,
                            "duration_ms": round(duration_ms, 2),
                            "tokens_in": None,
                            "tokens_out": None,
                        }
                    )
                except Exception as log_err:
                    logger.warning(f"Failed to log Kaira API call: {log_err}")

    @staticmethod
    async def _stream_request(
        session: aiohttp.ClientSession,
        url: str,
        payload: dict,
        headers: dict,
        session_state: KairaSessionState,
        result: KairaStreamResponse,
        timeout: Optional[aiohttp.ClientTimeout] = None,
    ) -> None:
        """Execute a single streaming request and accumulate chunks into result."""
        try:
            async with session.post(
                url,
                json=payload,
                headers=headers,
                timeout=timeout or aiohttp.ClientTimeout(sock_read=120),
            ) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    raise KairaAPIError(
                        status=resp.status,
                        message=body[:500] or resp.reason or "No response body",
                        url=url,
                        kind="http",
                    )
                async for line in resp.content:
                    decoded = line.decode("utf-8").strip()
                    if not decoded:
                        continue
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
                kind="timeout",
            ) from e
        except aiohttp.ClientError as e:
            raise KairaAPIError(
                status=0,
                message=str(e) or type(e).__name__,
                url=url,
                kind="client",
            ) from e

    @staticmethod
    def _process_chunk(chunk: Dict[str, Any], result: KairaStreamResponse):
        """Accumulate content from new SSE chunk vocabulary (classification/token/done/food_card/error)."""
        chunk_type = chunk.get("type")

        if chunk_type == "classification":
            result.classification = chunk
            result.session_id = chunk.get("session_id")
        elif chunk_type == "token":
            content = chunk.get("content")
            if content:
                result.token_stream.append(content)
        elif chunk_type == "done":
            result.full_message = chunk.get("full_response", "")
            result.saw_done = True
            result.stream_completed = True
        elif chunk_type == "food_card":
            result.food_card = chunk.get("data")
            result.saw_food_card = True
        elif chunk_type == "error":
            error_message = str(chunk.get("detail") or "Unknown stream error")
            result.stream_errors.append(error_message)
            logger.error(f"Stream error: {error_message}")
