"""Phase 13 / D.2 — Bolna batch surface (POST /batches).

Bolna's per-call ``POST /call`` is fine for small cohorts but caps at
the paid tier's concurrency (10). Above that, ``POST /batches`` accepts
a multipart CSV upload, queues the dial-out internally, and exposes
``GET /batches/{id}`` + ``GET /batches/{id}/executions`` for status.

Lives in its own module because the batch surface is multipart +
paginated and warrants a different transport shape than the per-call
JSON in ``bolna.py``. Both modules share the same rate-limit bucket
(``bolna:call``) since Bolna doesn't enumerate ``/batches`` separately
and the safest default is to charge the same quota.

Reference: https://www.bolna.ai/docs/list-batches (retrieved 2026-05-04).
"""
from __future__ import annotations

import uuid
from io import BytesIO
from typing import Any, Optional

import httpx

from app.services.orchestration.integrations._rate_limiter import (
    acquire_bolna,
)
from app.services.orchestration.integrations.bolna import (
    BolnaServiceError,
)


def _make_client(timeout: float) -> httpx.AsyncClient:
    """Hook for tests: monkeypatch this to inject httpx.MockTransport."""
    return httpx.AsyncClient(timeout=timeout)


class BolnaBatchService:
    """POST /batches + status + stop. Constructed alongside the
    per-call :class:`BolnaService` from the same connection config.

    ``connection_id`` is required at construction time (unlike legacy
    ``BolnaService``) because every batch surface call passes through
    the rate limiter — there's no test-only path to support."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        connection_id: uuid.UUID,
        timeout: float = 60.0,
        default_from_phone: Optional[str] = None,
    ) -> None:
        if not base_url or not api_key:
            raise ValueError("BolnaBatchService requires base_url and api_key")
        self._url = base_url.rstrip("/")
        self._auth_header = {"Authorization": f"Bearer {api_key}"}
        self._timeout = timeout
        self._connection_id = connection_id
        # Same fallback chain as the per-call service: dispatch-node
        # override > connection default > Bolna agent default. Used when
        # the dispatch node passes an empty ``from_phone_numbers`` list.
        self._default_from_phone = (default_from_phone or "").strip() or None

    async def _acquire(self) -> None:
        await acquire_bolna(self._connection_id, "bolna:call")

    @staticmethod
    def _raise_on_error(resp: httpx.Response) -> None:
        if 400 <= resp.status_code < 500:
            try:
                err = resp.json()
            except Exception:
                err = {"text": resp.text[:200]}
            raise BolnaServiceError(f"Bolna {resp.status_code}: {err}")
        resp.raise_for_status()

    async def create_batch(
        self,
        *,
        agent_id: str,
        from_phone_numbers: list[str],
        csv_bytes: bytes,
        filename: str = "cohort.csv",
        batch_name: Optional[str] = None,
    ) -> dict[str, Any]:
        """Multipart POST /batches.

        Bolna expects ``agent_id`` + ``from_phone_numbers`` (CSV-string of
        E.164s) as form fields and the cohort CSV as a file. The CSV
        must contain a ``contact_number`` column; any extra columns flow
        through to the per-execution ``user_data``.
        """
        await self._acquire()
        # Empty per-call list → fall back to the connection's
        # ``default_from_phone``; empty default → omit the field so Bolna
        # uses the agent's per-agent caller-id.
        effective_numbers = list(from_phone_numbers)
        if not effective_numbers and self._default_from_phone:
            effective_numbers = [self._default_from_phone]
        data: dict[str, Any] = {"agent_id": agent_id}
        if effective_numbers:
            data["from_phone_numbers"] = ",".join(effective_numbers)
        if batch_name:
            data["batch_name"] = batch_name
        files = {"file": (filename, BytesIO(csv_bytes), "text/csv")}
        async with _make_client(self._timeout) as client:
            resp = await client.post(
                f"{self._url}/batches",
                data=data,
                files=files,
                headers=self._auth_header,
            )
            self._raise_on_error(resp)
            return resp.json()

    async def get_batch(self, batch_id: str) -> dict[str, Any]:
        if not batch_id:
            raise ValueError("BolnaBatchService.get_batch requires batch_id")
        await self._acquire()
        async with _make_client(self._timeout) as client:
            resp = await client.get(
                f"{self._url}/batches/{batch_id}",
                headers=self._auth_header,
            )
            self._raise_on_error(resp)
            return resp.json()

    async def list_batch_executions(
        self,
        batch_id: str,
        *,
        page: int = 1,
        page_size: int = 100,
    ) -> dict[str, Any]:
        """``GET /batches/{id}/executions`` paginated. Returns the raw
        envelope (``{executions, page, total, ...}``) — the poller
        consumes this and walks pages itself."""
        if not batch_id:
            raise ValueError("BolnaBatchService.list_batch_executions requires batch_id")
        await self._acquire()
        async with _make_client(self._timeout) as client:
            resp = await client.get(
                f"{self._url}/batches/{batch_id}/executions",
                params={"page": page, "page_size": page_size},
                headers=self._auth_header,
            )
            self._raise_on_error(resp)
            return resp.json()

    async def stop_batch(self, batch_id: str) -> None:
        """``POST /batches/{id}/stop`` — used when a workflow run is
        cancelled mid-batch. Bolna stops queuing new dial-outs; in-flight
        calls complete on their own schedule."""
        if not batch_id:
            raise ValueError("BolnaBatchService.stop_batch requires batch_id")
        await self._acquire()
        async with _make_client(self._timeout) as client:
            resp = await client.post(
                f"{self._url}/batches/{batch_id}/stop",
                headers=self._auth_header,
            )
            self._raise_on_error(resp)


def build_cohort_csv(
    rows: list[tuple[str, dict[str, Any]]],
    *,
    extra_columns: Optional[list[str]] = None,
) -> bytes:
    """Serialise a cohort to a CSV the Bolna batch endpoint accepts.

    Bolna requires ``contact_number``; we add ``recipient_id`` so the
    poller can correlate per-execution status back to a workflow
    recipient (see Phase E §3 — match-by-recipient via
    ``user_data.recipient_id``). Caller passes a deterministic list of
    extra columns via ``extra_columns`` so column order is stable across
    calls — Bolna's worker reads by header name, so order is purely
    cosmetic for them, but stability matters for our golden tests.
    """
    import csv as _csv
    import io as _io

    extras = list(extra_columns or [])
    columns = ["contact_number", "recipient_id", *extras]
    buf = _io.StringIO()
    writer = _csv.DictWriter(buf, fieldnames=columns)
    writer.writeheader()
    for recipient_id, payload in rows:
        row: dict[str, Any] = {
            "contact_number": str(payload.get("contact_number") or payload.get("phone") or ""),
            "recipient_id": recipient_id,
        }
        for col in extras:
            row[col] = "" if payload.get(col) is None else str(payload[col])
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")
