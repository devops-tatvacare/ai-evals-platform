"""LeadSquared API client for Inside Sales call data."""

import asyncio
import json
import os
import logging
import re as _re
import time
import uuid
from datetime import datetime as _dt, timezone as _tz
from typing import Any, Literal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ── MQL signal constants ──────────────────────────────────────────────────

MQL_TARGET_CITIES: frozenset[str] = frozenset({
    "mumbai", "bangalore", "bengaluru", "hyderabad", "chennai", "delhi",
    "new delhi", "pune", "ahmedabad", "kolkata", "surat", "jaipur",
    "lucknow", "kanpur", "nagpur", "indore", "thane", "bhopal", "visakhapatnam",
    "pimpri", "patna", "vadodara", "ghaziabad", "ludhiana", "agra",
})

MQL_RELEVANT_CONDITIONS: frozenset[str] = frozenset({
    "diabetes", "pcos", "fatty liver", "obesity", "hypertension",
})

# Age band strings (as returned by LSQ) that fall within 30–65
_MQL_AGE_IN_RANGE: frozenset[str] = frozenset({
    "31\u201340", "31-40",
    "41\u201350", "41-50",
    "51\u201360", "51-60",
    "61\u201365", "61-65",
    "61\u201370", "61-70",
})


def compute_mql_score(lead: dict) -> tuple[int, dict[str, bool]]:
    """Compute MQL signal score (0–5) from a raw LSQ lead field dict.

    Returns (score, signals).  signals keys: age, city, condition, hba1c, intent.
    Each signal is True (1 point) or False (0 points).
    Null/blank fields always yield False — never inferred.

    This is a pure function: no side effects, no I/O, no DB access.
    """
    # Signal 1: age in range 30–65
    age_group = (lead.get("mx_Age_Group") or "").strip()
    sig_age = age_group in _MQL_AGE_IN_RANGE

    # Signal 2: city in target list (case-insensitive)
    city = (lead.get("mx_City") or "").strip().lower()
    sig_city = city in MQL_TARGET_CITIES if city else False

    # Signal 3: condition relevant (case-insensitive substring match)
    condition = (lead.get("mx_utm_disease") or "").strip().lower()
    sig_condition = any(c in condition for c in MQL_RELEVANT_CONDITIONS) if condition else False

    # Signal 4: HbA1c ≥ 5.7 — extract first numeric token from the band string
    hba1c_raw = (lead.get("mx_Do_you_remember_your_HbA1c_levels") or "").strip().lower()
    sig_hba1c = False
    if hba1c_raw:
        m = _re.search(r"(\d+\.?\d*)", hba1c_raw)
        if m:
            try:
                sig_hba1c = float(m.group(1)) >= 5.7
            except ValueError:
                pass

    # Signal 5: intent not negative (non-null AND value does not contain "no")
    intent_raw = (lead.get("mx_Are_you_open_to_investing_in_this_paid_program_of") or "").strip().lower()
    sig_intent = bool(intent_raw) and "no" not in intent_raw

    signals: dict[str, bool] = {
        "age": sig_age,
        "city": sig_city,
        "condition": sig_condition,
        "hba1c": sig_hba1c,
        "intent": sig_intent,
    }
    return sum(1 for v in signals.values() if v), signals


_LEAD_FIELDS_CSV = (
    "ProspectID,FirstName,LastName,Phone,EmailAddress,ProspectStage,"
    "mx_City,mx_Age_Group,mx_utm_disease,"
    "mx_Do_you_remember_your_HbA1c_levels,"
    "mx_Do_you_know_your_recent_blood_sugar_level,"
    "mx_Are_you_open_to_investing_in_this_paid_program_of,"
    "mx_Diabetes_Duration,mx_Current_diabetes_management,"
    "mx_What_is_your_main_health_goal,mx_Job_Title_or_Occupation,"
    "mx_Preferred_Time_for_Call_with_Health_Counsellor,"
    "mx_RNR_Count,mx_Answered_Call_Count,mx_Lead_Status,"
    "CreatedOn,ModifiedOn,ProspectActivityDate_Min,ProspectActivityDate_Max,"
    "OwnerIdName,Source,SourceCampaign,"
    # Plan-purchase surface. These fields populate ``raw_payload`` on
    # sync so the leads list API can derive the ``plan`` object without
    # making a per-lead call to LSQ.
    "LeadConversionDate,"
    "mx_Plan_Name,mx_Duration_or_Quantity,mx_program_price,mx1_Invoice_amount,"
    "mx_Payment_ID,mx_Payment_Date_and_Time,mx_Assign_plan_Date_Time,"
    "mx_Sign_Up_Date,mx_Program_Start_Date,mx_Program_End_Date,"
    "mx_Plan_includes_CGM,mx_CGM,mx_CGM_Brand,"
    "mx_Sensor_Count,mx_Transmitter_count,"
    "mx_BCA_Device,mx_Nutraceuticals_Sold,mx_Sales_Team,"
    "mx_AWB_number_of_Device"
)

# Mapping from raw LSQ field names to the clean camelCase keys exposed on
# our API. Kept here (not in inside_sales_queries) because the source of
# truth for the field names is the LSQ payload shape.
#
# Anything listed here is considered part of the "plan purchased" surface
# and will appear in the structured ``plan`` object returned by the leads
# API + lead-detail API.
LEAD_PLAN_FIELDS: list[tuple[str, str]] = [
    ("planName", "mx_Plan_Name"),
    ("durationOrQuantity", "mx_Duration_or_Quantity"),
    ("programPrice", "mx_program_price"),
    ("invoiceAmount", "mx1_Invoice_amount"),
    ("paymentId", "mx_Payment_ID"),
    ("paymentDateAndTime", "mx_Payment_Date_and_Time"),
    ("planAssignedAt", "mx_Assign_plan_Date_Time"),
    ("signUpDate", "mx_Sign_Up_Date"),
    ("programStartDate", "mx_Program_Start_Date"),
    ("programEndDate", "mx_Program_End_Date"),
    ("planIncludesCgm", "mx_Plan_includes_CGM"),
    ("cgm", "mx_CGM"),
    ("cgmBrand", "mx_CGM_Brand"),
    ("sensorCount", "mx_Sensor_Count"),
    ("transmitterCount", "mx_Transmitter_count"),
    ("bcaDevice", "mx_BCA_Device"),
    ("nutraceuticalsSold", "mx_Nutraceuticals_Sold"),
    ("salesTeam", "mx_Sales_Team"),
    ("deviceAwbNumber", "mx_AWB_number_of_Device"),
    ("leadConversionDate", "LeadConversionDate"),
]


def extract_lead_plan_fields(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Extract the ``plan`` object from a raw LSQ lead payload.

    Pure function: reads the raw payload, returns a new dict keyed by
    clean camelCase names. Empty / whitespace / null values become
    ``None`` so the UI can reliably render em-dashes.
    """
    if not raw:
        return {entry[0]: None for entry in LEAD_PLAN_FIELDS}

    def _clean(value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    out: dict[str, Any] = {}
    for clean_key, raw_key in LEAD_PLAN_FIELDS:
        out[clean_key] = _clean(raw.get(raw_key))
    return out

LSQ_BASE_URL = os.getenv("LSQ_BASE_URL", "https://api-in21.leadsquared.com/v2")
LSQ_ACCESS_KEY = os.getenv("LSQ_ACCESS_KEY", "")
LSQ_SECRET_KEY = os.getenv("LSQ_SECRET_KEY", "")

# Rate limit: 25 requests per 5 seconds → semaphore + delay
_LSQ_RATE_WINDOW_SECONDS = 5.0
_LSQ_MAX_REQUESTS_PER_WINDOW = 25
_LSQ_REQUEST_INTERVAL_SECONDS = _LSQ_RATE_WINDOW_SECONDS / _LSQ_MAX_REQUESTS_PER_WINDOW
_LSQ_MAX_RETRIES = 2
_LSQ_MAX_RETRY_DELAY_SECONDS = 5.0
_LSQ_RETRYABLE_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})

_rate_limit_lock = asyncio.Lock()
_next_request_slot_at = 0.0


class LsqRequestError(RuntimeError):
    def __init__(
        self,
        *,
        url: str,
        status_code: int | None,
        detail: str = "LeadSquared request failed.",
        retry_after_seconds: float | None = None,
        retryable: bool = False,
    ) -> None:
        self.url = url
        self.status_code = status_code
        self.retry_after_seconds = retry_after_seconds
        self.retryable = retryable
        super().__init__(detail)


class LsqRateLimitError(LsqRequestError):
    def __init__(self, *, url: str, retry_after_seconds: float | None = None) -> None:
        super().__init__(
            url=url,
            status_code=429,
            detail="LeadSquared rate limit reached. Please retry shortly.",
            retry_after_seconds=retry_after_seconds,
        )


def _auth_params() -> dict[str, str]:
    return {"accessKey": LSQ_ACCESS_KEY, "secretKey": LSQ_SECRET_KEY}


def _is_retryable_request_error(exc: httpx.RequestError) -> bool:
    return isinstance(exc, (httpx.TimeoutException, httpx.NetworkError))


def _compute_retry_delay(attempt: int, *, retry_after_seconds: float | None = None) -> float:
    if retry_after_seconds is not None and retry_after_seconds > 0:
        return min(retry_after_seconds, _LSQ_MAX_RETRY_DELAY_SECONDS)
    return min(2 ** attempt, _LSQ_MAX_RETRY_DELAY_SECONDS)


async def _rate_limited_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    **kwargs: Any,
) -> httpx.Response:
    """Execute an HTTP request with global pacing and bounded retries for transient failures."""
    for attempt in range(_LSQ_MAX_RETRIES + 1):
        await _wait_for_rate_limit_slot()
        try:
            resp = await client.request(method, url, **kwargs)
        except httpx.RequestError as exc:
            retryable = _is_retryable_request_error(exc)
            if retryable and attempt < _LSQ_MAX_RETRIES:
                delay = _compute_retry_delay(attempt)
                logger.warning(
                    "LeadSquared transport error %s %s (attempt %d/%d); retrying in %.1fs: %s",
                    method,
                    url,
                    attempt + 1,
                    _LSQ_MAX_RETRIES + 1,
                    delay,
                    exc,
                )
                await asyncio.sleep(delay)
                continue
            raise LsqRequestError(url=url, status_code=None, retryable=retryable) from exc

        if resp.status_code in _LSQ_RETRYABLE_STATUS_CODES:
            retry_after_seconds = _parse_retry_after_seconds(resp)
            if resp.status_code == 429:
                if attempt < _LSQ_MAX_RETRIES:
                    delay = _compute_retry_delay(attempt, retry_after_seconds=retry_after_seconds)
                    logger.warning(
                        "LeadSquared rate limited %s %s (attempt %d/%d); retrying in %.1fs",
                        method,
                        url,
                        attempt + 1,
                        _LSQ_MAX_RETRIES + 1,
                        delay,
                    )
                    await asyncio.sleep(delay)
                    continue
                raise LsqRateLimitError(url=url, retry_after_seconds=retry_after_seconds)

            if attempt < _LSQ_MAX_RETRIES:
                delay = _compute_retry_delay(attempt, retry_after_seconds=retry_after_seconds)
                logger.warning(
                    "LeadSquared transient HTTP %d for %s %s (attempt %d/%d); retrying in %.1fs",
                    resp.status_code,
                    method,
                    url,
                    attempt + 1,
                    _LSQ_MAX_RETRIES + 1,
                    delay,
                )
                await asyncio.sleep(delay)
                continue
            raise LsqRequestError(
                url=url,
                status_code=resp.status_code,
                retry_after_seconds=retry_after_seconds,
                retryable=True,
            )

        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise LsqRequestError(
                url=url,
                status_code=exc.response.status_code,
                retryable=False,
            ) from exc
        return resp

    raise RuntimeError("LeadSquared request retry loop exhausted unexpectedly.")


async def _wait_for_rate_limit_slot() -> None:
    """Pace requests globally so the whole process stays under 25 requests / 5 seconds."""
    global _next_request_slot_at

    async with _rate_limit_lock:
        now = time.monotonic()
        delay = max(0.0, _next_request_slot_at - now)
        slot_at = now + delay
        _next_request_slot_at = slot_at + _LSQ_REQUEST_INTERVAL_SECONDS

    if delay > 0:
        await asyncio.sleep(delay)


def _parse_retry_after_seconds(resp: httpx.Response) -> float | None:
    retry_after_ms = resp.headers.get("retry-after-ms")
    if retry_after_ms:
        try:
            return max(float(retry_after_ms) / 1000.0, 0.0)
        except ValueError:
            pass

    retry_after = resp.headers.get("retry-after")
    if retry_after:
        try:
            return max(float(retry_after), 0.0)
        except ValueError:
            return None

    return None


async def fetch_call_activities(
    date_from: str,
    date_to: str,
    event_codes: list[int] | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    """Fetch phone call activities from LSQ.

    Returns: { "activities": [...], "total": int }
    """
    if event_codes is None:
        event_codes = [21, 22]  # Inbound + Outbound system telephony

    all_activities: list[dict[str, Any]] = []
    total_record_count = 0

    async with httpx.AsyncClient(timeout=30) as client:
        for event_code in event_codes:
            url = f"{LSQ_BASE_URL}/ProspectActivity.svc/CustomActivity/RetrieveByActivityEvent"
            body = {
                "Parameter": {
                    "FromDate": date_from,
                    "ToDate": date_to,
                    "ActivityEvent": event_code,
                },
                "Paging": {
                    "PageIndex": page,
                    "PageSize": page_size,
                },
                "Sorting": {
                    "ColumnName": "CreatedOn",
                    "Direction": 1,  # Descending
                },
            }
            resp = await _rate_limited_request(
                client, "POST", url, params=_auth_params(), json=body
            )
            data = resp.json()
            if isinstance(data, dict) and data.get("List"):
                all_activities.extend(data["List"])
                total_record_count += data.get("RecordCount", len(data["List"]))
            elif isinstance(data, list):
                all_activities.extend(data)
                total_record_count += len(data)

    return {"activities": all_activities, "total": total_record_count}


async def fetch_leads(
    date_from: str,
    date_to: str,
    *,
    filter_field: Literal["CreatedOn", "ModifiedOn"] = "CreatedOn",
    sort_field: Literal["CreatedOn", "ModifiedOn"] | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    """Fetch one page of leads from LSQ by date range.

    ``filter_field`` controls which timestamp the ``LookupName`` / server-side
    filter uses. ``ModifiedOn`` is the authoritative delta field for updated
    leads and is the right choice for incremental syncs; ``CreatedOn`` is the
    right choice for backfills / date-range seeds.

    ``sort_field`` defaults to ``filter_field`` when not set, keeping the page
    order aligned with the filter and giving deterministic paging.

    ``date_to`` is applied client-side against the same field that drove the
    request (LSQ Leads.Get only supports a single ``>=`` operator).

    Returns: {"leads": list[raw_lead_dict], "has_more": bool}
    has_more is True when LSQ returned a full page (there may be more).
    """
    sort_column = sort_field or filter_field
    async with httpx.AsyncClient(timeout=30) as client:
        body = {
            "Parameter": {
                "LookupName": filter_field,
                "LookupValue": date_from,
                "SqlOperator": ">=",
            },
            "Paging": {"PageIndex": page - 1, "PageSize": page_size},
            "Columns": {"Include_CSV": _LEAD_FIELDS_CSV},
            "Sorting": {"ColumnName": sort_column, "Direction": 1},
        }
        resp = await _rate_limited_request(
            client, "POST",
            f"{LSQ_BASE_URL}/LeadManagement.svc/Leads.Get",
            params=_auth_params(),
            json=body,
        )
        raw_page: list[dict[str, Any]] = resp.json()
        if not isinstance(raw_page, list):
            return {"leads": [], "has_more": False}

        # Apply upper bound client-side on the same field that drove the
        # server-side filter, so the window is bounded on both sides by the
        # same timestamp (strip fractional seconds to match LSQ's string
        # comparison).
        leads = [
            l for l in raw_page
            if (l.get(filter_field) or "").split(".")[0] <= date_to
        ]
        return {"leads": leads, "has_more": len(raw_page) >= page_size}


MAX_LEAD_CALL_HISTORY = 200  # cap on matched records returned per drilldown


async def fetch_lead_activities_for_prospect(
    prospect_id: str,
    date_from: str,
    date_to: str,
) -> tuple[list[dict[str, Any]], bool]:
    """Fetch all call activities for a single prospect across their lifetime.

    Paginates RetrieveByActivityEvent for event codes 21+22 over [date_from, date_to],
    filters server-side by RelatedProspectId == prospect_id.

    Returns: (matched_activities, history_truncated)
    history_truncated is True when matched records exceeded MAX_LEAD_CALL_HISTORY.
    """
    matched: list[dict[str, Any]] = []
    truncated = False

    async with httpx.AsyncClient(timeout=30) as client:
        for event_code in [21, 22]:
            page_idx = 1
            while True:
                body = {
                    "Parameter": {
                        "FromDate": date_from,
                        "ToDate": date_to,
                        "ActivityEvent": event_code,
                    },
                    "Paging": {"PageIndex": page_idx, "PageSize": 500},
                    "Sorting": {"ColumnName": "CreatedOn", "Direction": 1},
                }
                resp = await _rate_limited_request(
                    client, "POST",
                    f"{LSQ_BASE_URL}/ProspectActivity.svc/CustomActivity/RetrieveByActivityEvent",
                    params=_auth_params(),
                    json=body,
                )
                data = resp.json()
                if isinstance(data, dict):
                    activities = data.get("List") or []
                    record_count = data.get("RecordCount", len(activities))
                elif isinstance(data, list):
                    activities = data
                    record_count = len(activities)
                else:
                    break

                for a in activities:
                    if a.get("RelatedProspectId") == prospect_id:
                        if len(matched) >= MAX_LEAD_CALL_HISTORY:
                            truncated = True
                        else:
                            matched.append(a)

                # Stop paginating when we've fetched all pages
                fetched_so_far = (page_idx - 1) * 500 + len(activities)
                if fetched_so_far >= record_count or len(activities) < 500:
                    break
                page_idx += 1

    # Sort matched activities by CreatedOn descending
    matched.sort(key=lambda a: a.get("CreatedOn", ""), reverse=True)
    return matched, truncated


def _parse_lsq_dt(s: str | None) -> _dt | None:
    """Parse LSQ datetime string 'YYYY-MM-DD HH:MM:SS[.fff]' to UTC datetime."""
    if not s:
        return None
    try:
        s = s.split(".")[0]  # strip milliseconds
        return _dt.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=_tz.utc)
    except ValueError:
        return None


def compute_frt_seconds(created_on: str, first_activity: str | None) -> int | None:
    """Compute first response time in seconds. Returns None if negative or missing."""
    created = _parse_lsq_dt(created_on)
    first = _parse_lsq_dt(first_activity)
    if not created or not first:
        return None
    delta = int((first - created).total_seconds())
    return delta if delta >= 0 else None


def compute_lead_metrics(
    created_on: str,
    last_activity_on: str | None,
    rnr_count: int,
    answered_count: int,
    first_activity_on: str | None = None,
) -> dict[str, Any]:
    """Compute listing-level metrics from lead record fields."""
    now = _dt.now(_tz.utc)
    created = _parse_lsq_dt(created_on)

    total_dials = rnr_count + answered_count
    connect_rate: float | None = (answered_count / total_dials * 100) if total_dials > 0 else None
    lead_age_days = int((now - created).total_seconds() / 86400) if created else 0

    last_dt = _parse_lsq_dt(last_activity_on)
    days_since_last = int((now - last_dt).total_seconds() / 86400) if last_dt else None

    frt = compute_frt_seconds(created_on, first_activity_on)

    return {
        "total_dials": total_dials,
        "connect_rate": round(connect_rate, 1) if connect_rate is not None else None,
        "lead_age_days": lead_age_days,
        "days_since_last_contact": days_since_last,
        "frt_seconds": frt,
    }


def compute_drilldown_metrics(
    created_on: str,
    last_activity_on: str | None,
    call_history: list[dict[str, Any]],
    preferred_call_time_str: str | None,
) -> dict[str, Any]:
    """Compute drilldown-level metrics from per-call history.

    call_history entries must have 'callTime', 'durationSeconds', 'status' keys
    (already normalized by normalize_activity).
    """
    # Total dials and answered from history (not from LSQ counters)
    total_dials = len(call_history)
    answered_history = [c for c in call_history if c.get("status", "").lower() == "answered"]
    answered_count = len(answered_history)
    connect_rate: float | None = (
        round(answered_count / total_dials * 100, 1) if total_dials > 0 else None
    )

    # Exact FRT — earliest call in history
    call_times = [c.get("callTime") for c in call_history if c.get("callTime")]
    first_call_time = min(call_times) if call_times else None
    frt = compute_frt_seconds(created_on, first_call_time)

    # Counseling sessions (>= 10 minutes = 600s)
    counseling = [c for c in call_history if (c.get("durationSeconds") or 0) >= 600]
    counseling_count = len(counseling)
    counseling_rate: float | None = (
        round(counseling_count / answered_count * 100, 1) if answered_count > 0 else None
    )

    # Callback adherence
    adherence_seconds: int | None = None
    if preferred_call_time_str:
        pref_dt = _parse_lsq_dt(preferred_call_time_str)
        if pref_dt:
            after_pref = [
                c for c in call_history
                if (_parse_lsq_dt(c.get("callTime")) or _dt.min.replace(tzinfo=_tz.utc)) > pref_dt
            ]
            if after_pref:
                earliest_after = min(after_pref, key=lambda c: c.get("callTime", ""))
                earliest_dt = _parse_lsq_dt(earliest_after.get("callTime"))
                if earliest_dt:
                    adherence_seconds = int((earliest_dt - pref_dt).total_seconds())

    # Lead age + days since last contact
    now = _dt.now(_tz.utc)
    created = _parse_lsq_dt(created_on)
    lead_age_days = int((now - created).total_seconds() / 86400) if created else 0
    last_dt = _parse_lsq_dt(last_activity_on)
    days_since_last = int((now - last_dt).total_seconds() / 86400) if last_dt else None

    return {
        "frt_seconds": frt,
        "total_dials": total_dials,
        "connect_rate": connect_rate,
        "counseling_count": counseling_count,
        "counseling_rate": counseling_rate,
        "callback_adherence_seconds": adherence_seconds,
        "lead_age_days": lead_age_days,
        "days_since_last_contact": days_since_last,
    }


def normalize_lead(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a raw Leads.Get record into a clean field dict."""
    return {
        "prospectId": raw.get("ProspectID", ""),
        "firstName": raw.get("FirstName", ""),
        "lastName": raw.get("LastName"),
        "phone": raw.get("Phone", ""),
        "email": raw.get("EmailAddress"),
        "prospectStage": raw.get("ProspectStage", ""),
        "city": raw.get("mx_City"),
        "ageGroup": raw.get("mx_Age_Group"),
        "condition": raw.get("mx_utm_disease"),
        "hba1cBand": raw.get("mx_Do_you_remember_your_HbA1c_levels"),
        "bloodSugarBand": raw.get("mx_Do_you_know_your_recent_blood_sugar_level"),
        "intentToPay": raw.get("mx_Are_you_open_to_investing_in_this_paid_program_of"),
        "diabetesDuration": raw.get("mx_Diabetes_Duration"),
        "currentManagement": raw.get("mx_Current_diabetes_management"),
        "goal": raw.get("mx_What_is_your_main_health_goal"),
        "jobTitle": raw.get("mx_Job_Title_or_Occupation"),
        "preferredCallTime": raw.get("mx_Preferred_Time_for_Call_with_Health_Counsellor"),
        "rnrCount": int(raw.get("mx_RNR_Count") or 0),
        "answeredCount": int(raw.get("mx_Answered_Call_Count") or 0),
        "agentName": raw.get("OwnerIdName"),
        "createdOn": (raw.get("CreatedOn") or "").split(".")[0],
        "firstActivityOn": (raw.get("ProspectActivityDate_Min") or "").split(".")[0] or None,
        "lastActivityOn": (raw.get("ProspectActivityDate_Max") or "").split(".")[0] or None,
        "source": raw.get("Source"),
        "sourceCampaign": raw.get("SourceCampaign"),
        # Plan-purchase surface. ``planName`` lands in its own indexed
        # column; the rest of the plan object is derived from raw_payload
        # via ``extract_lead_plan_fields`` at API-response time.
        "planName": raw.get("mx_Plan_Name"),
        # MQL input fields (passed through for compute_mql_score)
        "mx_Age_Group": raw.get("mx_Age_Group"),
        "mx_City": raw.get("mx_City"),
        "mx_utm_disease": raw.get("mx_utm_disease"),
        "mx_Do_you_remember_your_HbA1c_levels": raw.get("mx_Do_you_remember_your_HbA1c_levels"),
        "mx_Are_you_open_to_investing_in_this_paid_program_of": raw.get(
            "mx_Are_you_open_to_investing_in_this_paid_program_of"
        ),
    }


def _parse_source_data(note: str) -> dict[str, Any]:
    """Parse ActivityEvent_Note to extract SourceData JSON."""
    try:
        if "SourceData" in note:
            start = note.index('{"')
            brace_count = 0
            for i, c in enumerate(note[start:], start):
                if c == "{":
                    brace_count += 1
                elif c == "}":
                    brace_count -= 1
                if brace_count == 0:
                    return json.loads(note[start : i + 1])
        return {}
    except (ValueError, json.JSONDecodeError):
        return {}


def normalize_activity(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a raw LSQ activity into a clean call record."""
    source_data = _parse_source_data(raw.get("ActivityEvent_Note", ""))
    event_code = int(raw.get("ActivityEvent", 0))

    return {
        "activityId": raw.get("ProspectActivityId", ""),
        "prospectId": raw.get("RelatedProspectId", ""),
        "agentId": raw.get("CreatedBy", ""),
        "agentName": raw.get("CreatedByName", ""),
        "agentEmail": raw.get("CreatedByEmailAddress", ""),
        "eventCode": event_code,
        "direction": "inbound" if event_code == 21 else "outbound",
        "status": raw.get("Status", ""),
        "callStartTime": raw.get("mx_Custom_2", ""),
        "durationSeconds": int(raw.get("mx_Custom_3", 0) or 0),
        "recordingUrl": raw.get("mx_Custom_4", ""),
        "phoneNumber": source_data.get("SourceNumber", "") if event_code == 21 else source_data.get("DestinationNumber", ""),
        "displayNumber": raw.get("mx_Custom_1", ""),
        "callNotes": source_data.get("CallNotes", ""),
        "callSessionId": source_data.get("CallSessionId", ""),
        "createdOn": raw.get("CreatedOn", ""),
    }


async def fetch_lead_by_id(prospect_id: str) -> dict[str, Any]:
    """Fetch a single lead from LSQ by prospect ID.

    Returns the raw lead dict (all fields) or {} if not found.
    """
    if not prospect_id:
        return {}

    async with httpx.AsyncClient(timeout=30) as client:
        url = f"{LSQ_BASE_URL}/LeadManagement.svc/Leads.GetById"
        params = {**_auth_params(), "id": prospect_id}
        try:
            resp = await _rate_limited_request(client, "GET", url, params=params)
            data = resp.json()
            if isinstance(data, list) and len(data) > 0:
                return data[0]
        except LsqRequestError:
            raise
        except Exception as e:
            logger.warning("Lead fetch failed for %s: %s", prospect_id, e)

    return {}


async def upsert_external_agent(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    lsq_user_id: str,
    name: str,
    email: str | None = None,
) -> uuid.UUID:
    """Upsert an LSQ agent into external_agents. Returns the agent UUID."""
    from app.models.application_external_agent_connector import ApplicationExternalAgentConnector

    result = await db.execute(
        select(ApplicationExternalAgentConnector).where(
            ApplicationExternalAgentConnector.tenant_id == tenant_id,
            ApplicationExternalAgentConnector.source == "lsq",
            ApplicationExternalAgentConnector.external_id == lsq_user_id,
        )
    )
    agent = result.scalar_one_or_none()

    if agent:
        agent.name = name
        if email:
            agent.email = email
    else:
        agent = ApplicationExternalAgentConnector(
            tenant_id=tenant_id,
            source="lsq",
            external_id=lsq_user_id,
            name=name,
            email=email,
        )
        db.add(agent)

    await db.flush()
    return agent.id
