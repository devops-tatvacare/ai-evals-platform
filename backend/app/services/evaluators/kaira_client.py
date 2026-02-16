"""Async Kaira API client for live adversarial testing.

Ported from kaira-evals/src/kaira_client.py — converted to async using aiohttp.
"""
import json
import logging
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field

import aiohttp

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
        is_first_message: bool = False,
        thread_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> KairaStreamResponse:
        url = f"{self.base_url}/chat/stream"

        payload: Dict[str, Any] = {
            "query": query,
            "user_id": user_id,
            "context": {"additionalProp1": {}},
            "stream": False,
        }

        if is_first_message:
            payload["session_id"] = user_id
            payload["end_session"] = True
        else:
            if not session_id or not thread_id:
                raise ValueError("session_id and thread_id required for subsequent messages")
            payload["session_id"] = session_id
            payload["thread_id"] = thread_id
            payload["end_session"] = False

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
                            self._process_chunk(chunk, result)
                        except json.JSONDecodeError:
                            logger.warning(f"Failed to parse chunk: {json_str[:100]}")

        return result

    @staticmethod
    def _process_chunk(chunk: Dict[str, Any], result: KairaStreamResponse):
        chunk_type = chunk.get("type")

        if chunk_type == "session_context":
            result.thread_id = chunk.get("thread_id")
            result.session_id = chunk.get("session_id")
            result.response_id = chunk.get("response_id")
        elif chunk_type == "intent_classification":
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
