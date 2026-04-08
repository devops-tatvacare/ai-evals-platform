import os
import sys
import unittest
from unittest.mock import patch

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.services import lsq_client  # noqa: E402
from app.routes.inside_sales import _translate_lsq_error  # noqa: E402


class _FakeAsyncClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.requests = []

    async def request(self, method, url, **kwargs):
        self.requests.append((method, url, kwargs))
        return self._responses.pop(0)


class LsqClientTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        lsq_client._next_request_slot_at = 0.0

    async def test_rate_limited_request_retries_after_429(self):
        request = httpx.Request('GET', 'https://example.com/lsq')
        client = _FakeAsyncClient([
            httpx.Response(429, headers={'retry-after': '1'}, request=request),
            httpx.Response(200, json={'ok': True}, request=request),
        ])
        sleep_calls: list[float] = []

        async def fake_sleep(delay: float):
            sleep_calls.append(delay)

        with patch.object(lsq_client.asyncio, 'sleep', side_effect=fake_sleep), patch.object(
            lsq_client.time,
            'monotonic',
            return_value=0.0,
        ):
            response = await lsq_client._rate_limited_request(client, 'GET', 'https://example.com/lsq')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(client.requests), 2)
        self.assertIn(1.0, sleep_calls)

    async def test_rate_limited_request_raises_domain_error_after_retry_budget(self):
        request = httpx.Request('GET', 'https://example.com/lsq')
        client = _FakeAsyncClient([
            httpx.Response(429, headers={'retry-after': '2'}, request=request),
            httpx.Response(429, headers={'retry-after': '2'}, request=request),
            httpx.Response(429, headers={'retry-after': '2'}, request=request),
        ])

        async def fake_sleep(_delay: float):
            return None

        with patch.object(lsq_client.asyncio, 'sleep', side_effect=fake_sleep), patch.object(
            lsq_client.time,
            'monotonic',
            return_value=0.0,
        ):
            with self.assertRaises(lsq_client.LsqRateLimitError) as ctx:
                await lsq_client._rate_limited_request(client, 'GET', 'https://example.com/lsq')

        self.assertEqual(ctx.exception.status_code, 429)
        self.assertEqual(ctx.exception.retry_after_seconds, 2.0)

    def test_translate_lsq_error_maps_rate_limits_to_retryable_http_error(self):
        exc = lsq_client.LsqRateLimitError(url='https://example.com/lsq', retry_after_seconds=2.1)

        http_error = _translate_lsq_error(exc)

        self.assertEqual(http_error.status_code, 503)
        self.assertEqual(http_error.detail, 'LeadSquared rate limit reached. Please retry shortly.')
        self.assertEqual(http_error.headers, {'Retry-After': '3'})


if __name__ == '__main__':
    unittest.main()
