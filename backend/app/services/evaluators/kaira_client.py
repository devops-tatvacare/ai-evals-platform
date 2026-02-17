"""Async Kaira API client for live adversarial testing.

Ported from kaira-evals/src/kaira_client.py — converted to async using aiohttp.
"""
import json
import logging
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field

import aiohttp

from app.services.evaluators.models import KairaSessionState

logger = logging.getLogger(__name__)


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
    """Async HTTP client for the Kaira chat API."""

    def __init__(self, auth_token: str, base_url: str):
        if not auth_token:
            raise ValueError("KAIRA_AUTH_TOKEN not set. Cannot run live tests.")
        self.auth_token = auth_token
        self.base_url = base_url

    async def stream_message(
        self, query: str, user_id: str,
        session_state: KairaSessionState,
    ) -> KairaStreamResponse:
        url = f"{self.base_url}/chat/stream"

        payload = session_state.build_request_payload(query)

        headers = {
            "Content-Type": "application/json",
            "Accept": "*/*",
            "token": self.auth_token,
        }

        result = KairaStreamResponse()

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                resp.raise_for_status()
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
                            # Sync session identifiers from every chunk
                            session_state.apply_chunk(chunk)
                            # Accumulate content into result
                            self._process_chunk(chunk, result)
                        except json.JSONDecodeError:
                            logger.warning(f"Failed to parse chunk: {json_str[:100]}")

        # Copy final identifiers from session_state into response
        result.thread_id = session_state.thread_id
        result.session_id = session_state.session_id
        result.response_id = session_state.response_id

        return result

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
