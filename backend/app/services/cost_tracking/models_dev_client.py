"""HTTP client for ``https://models.dev/api.json``.

Fetches the full models catalogue, honouring ETag-based conditional GETs when
a previous snapshot's etag is supplied. Retries three times on transient
network errors with exponential backoff. 304 Not Modified is surfaced as a
``None`` return so the refresh flow can dedupe without touching the DB.

Never raises for a missing payload — on exhaustion, raises
``ModelsDevFetchError`` so the caller can respond 502 with the last snapshot
id (matches the failure contract in §15 of the spec).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import aiohttp

_log = logging.getLogger(__name__)

_DEFAULT_URL = 'https://models.dev/api.json'
_DEFAULT_TIMEOUT_SECONDS = 30
_MAX_ATTEMPTS = 3
_BACKOFF_BASE_SECONDS = 1.0


class ModelsDevFetchError(Exception):
    """Raised when the models.dev endpoint cannot be reached after retries."""


async def fetch_models_dev_api(
    url: str = _DEFAULT_URL,
    *,
    if_none_match: str | None = None,
    timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """Fetch and parse the models.dev catalogue.

    Returns the parsed JSON payload. Raises ``ModelsDevFetchError`` on fatal
    failure. A 304 Not Modified (when ``if_none_match`` matches the current
    etag) is currently surfaced as an error — the caller is expected to short-
    circuit *before* calling fetch if a previously-computed payload hash
    matches (§7.8 step 4). The etag path is kept for a future optimisation.
    """
    headers: dict[str, str] = {'Accept': 'application/json'}
    if if_none_match:
        headers['If-None-Match'] = if_none_match

    timeout = aiohttp.ClientTimeout(total=timeout_seconds)
    last_exc: Exception | None = None

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, headers=headers) as resp:
                    if resp.status == 304:
                        # Caller must fall through to the cached snapshot.
                        raise ModelsDevFetchError('not modified (304)')
                    if resp.status >= 500:
                        raise aiohttp.ClientResponseError(
                            request_info=resp.request_info,
                            history=resp.history,
                            status=resp.status,
                            message=f'models.dev {resp.status}',
                        )
                    if resp.status != 200:
                        raise ModelsDevFetchError(
                            f'unexpected status {resp.status}'
                        )
                    payload = await resp.json(content_type=None)
                    if not isinstance(payload, dict):
                        raise ModelsDevFetchError('payload is not a JSON object')
                    return payload
        except ModelsDevFetchError:
            raise
        except (aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError) as exc:
            last_exc = exc
            if attempt >= _MAX_ATTEMPTS:
                break
            delay = _BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
            _log.info('models.dev fetch attempt %d failed: %s; retrying in %.1fs', attempt, exc, delay)
            await asyncio.sleep(delay)

    raise ModelsDevFetchError(f'models.dev unreachable after {_MAX_ATTEMPTS} attempts: {last_exc}')


__all__ = ['ModelsDevFetchError', 'fetch_models_dev_api']
