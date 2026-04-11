"""
Semantic SQL Agent — generates, validates, and executes SQL from natural language.

Architecture:
  1. Loads semantic model (YAML) describing tables, relationships, metrics
  2. Inner LLM call generates SQL from the question + semantic model
  3. Validator checks: SELECT-only, allowed tables, no dangerous patterns
  4. Access control filters auto-injected (tenant, visibility, app)
  5. Executes against read-only connection with timeout
  6. Returns structured results for the outer LLM to format
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import text, select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_MODEL_DIR = Path(__file__).parent
_SEMANTIC_MODEL_PATH = _MODEL_DIR / "semantic_model.yaml"
_model_cache: dict[str, Any] = {}


def _load_semantic_model() -> dict:
    """Load and cache the semantic model YAML."""
    content = _SEMANTIC_MODEL_PATH.read_text()
    cache_key = hashlib.md5(content.encode()).hexdigest()
    if cache_key in _model_cache:
        return _model_cache[cache_key]
    model = yaml.safe_load(content)
    _model_cache.clear()
    _model_cache[cache_key] = model
    return model


# ── SQL Validation ───────────────────────────────────────────────────

ALLOWED_TABLES = {
    "eval_runs", "thread_evaluations", "adversarial_evaluations", "evaluation_analytics",
    "analytics_run_facts", "analytics_eval_facts", "analytics_criterion_facts",
}
DANGEROUS_PATTERNS = [
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b",
    r"\b(INTO|SET)\b",
    r";\s*\w",          # multiple statements
    r"--",              # SQL comments (could hide injections)
    r"/\*",             # block comments
    r"\bpg_\w+",        # postgres system catalogs
    r"\binformation_schema\b",
]
MAX_RESULT_ROWS = 200
QUERY_TIMEOUT_SECONDS = 10


class SQLValidationError(Exception):
    pass


def validate_sql(sql: str) -> str:
    """
    Validate generated SQL is safe to execute.
    Returns cleaned SQL or raises SQLValidationError.
    """
    cleaned = sql.strip().rstrip(";")

    # Must be a SELECT
    if not cleaned.upper().lstrip().startswith("SELECT"):
        raise SQLValidationError("Only SELECT queries are allowed")

    # Check for dangerous patterns
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, cleaned, re.IGNORECASE):
            raise SQLValidationError(f"Query contains disallowed pattern: {pattern}")

    # Check tables are in allowlist
    # Extract table names from FROM and JOIN clauses, skip LATERAL and functions
    table_pattern = r"(?:FROM|JOIN)\s+(\w+)"
    found_tables = {t.lower() for t in re.findall(table_pattern, cleaned, re.IGNORECASE)}

    # These are keywords/functions, not tables
    non_tables = {"lateral", "jsonb_array_elements", "jsonb_each", "jsonb_each_text",
                  "unnest", "generate_series", "json_array_elements"}
    disallowed = found_tables - ALLOWED_TABLES - non_tables
    if disallowed:
        raise SQLValidationError(f"Query references disallowed tables: {disallowed}")

    return cleaned


def prepare_query(sql: str, auth: Any, app_id: str) -> tuple[str, dict]:
    """
    Prepare a generated SQL query for safe execution.
    The LLM is instructed to include :app_id and :tenant_id in its WHERE clause.
    We validate they're present and supply the bound parameters.
    Returns (sql, params_dict).
    """
    params = {
        "app_id": app_id,
        "tenant_id": str(getattr(auth, "tenant_id", "")),
        "user_id": str(getattr(auth, "user_id", "")),
    }

    # Strip any leftover placeholders
    cleaned = sql.replace("{access_filter}", "").strip()

    # If the LLM forgot mandatory filters, inject them rather than rejecting.
    # This is a safety net — the prompt instructs the LLM to include them,
    # but we can't trust it 100%.

    # Detect the primary table alias used in the query
    alias = "e"  # default
    for candidate in ("rf", "cf", "ef"):
        if f"{candidate}." in cleaned:
            alias = candidate
            break

    missing_filters = []
    if ":tenant_id" not in cleaned:
        missing_filters.append(f"{alias}.tenant_id = :tenant_id")
    if ":app_id" not in cleaned:
        missing_filters.append(f"{alias}.app_id = :app_id")

    if missing_filters:
        inject = " AND ".join(missing_filters)
        upper = cleaned.upper()
        where_idx = upper.find("WHERE")
        if where_idx >= 0:
            # Insert after WHERE
            insert_pos = where_idx + len("WHERE")
            while insert_pos < len(cleaned) and cleaned[insert_pos] in (" ", "\n"):
                insert_pos += 1
            cleaned = cleaned[:insert_pos] + inject + " AND " + cleaned[insert_pos:]
        else:
            # Find insertion point before GROUP BY/ORDER BY/LIMIT
            insert_before = len(cleaned)
            for kw in ["GROUP BY", "ORDER BY", "LIMIT", "HAVING"]:
                idx = upper.find(kw)
                if 0 < idx < insert_before:
                    insert_before = idx
            cleaned = cleaned[:insert_before].rstrip() + " WHERE " + inject + " " + cleaned[insert_before:]

    return cleaned, params


# ── SQL Generation via LLM ──────────────────────────────────────────

SQL_AGENT_PROMPT = """\
You are a SQL query generator for a PostgreSQL evaluation analytics database.

SEMANTIC MODEL:
{semantic_model}

TASK: Generate a single SELECT query to answer this question:
"{question}"

MANDATORY RULES:
- PostgreSQL syntax only.
- Allowed tables: analytics_run_facts (alias rf), analytics_eval_facts (alias ef), analytics_criterion_facts (alias cf), eval_runs (alias e).
- Prefer fact tables (rf, ef, cf) over eval_runs for analytics queries.
- JOIN fact tables via run_id: JOIN analytics_eval_facts ef ON ef.run_id = rf.run_id
- EVERY query MUST have a WHERE clause with these EXACT filters:
    WHERE <table>.app_id = :app_id AND <table>.tenant_id = :tenant_id
  Add any additional filters AFTER those two.
- Use :app_id and :tenant_id as bind parameters (they are pre-bound, do not quote them).
- JSONB context columns use arrow operators: context->>'run_name', context->>'agent'
- LIMIT results to {max_rows} rows max.
- Return useful column aliases.
- Output ONLY the raw SQL. No markdown. No backticks. No explanation.
"""


async def generate_sql(
    question: str,
    *,
    tenant_id: str,
    user_id: str,
    model_override: str | None = None,
) -> str:
    """
    Use a fast LLM to generate SQL from a natural language question.
    Returns the raw SQL string.
    """
    from app.services.evaluators.settings_helper import get_llm_settings_from_db
    from app.services.evaluators.llm_base import create_llm_provider, GeminiProvider

    semantic_model = _load_semantic_model()
    # Compact the model for the prompt — skip common_queries to save tokens
    model_for_prompt = {
        "tables": semantic_model["tables"],
        "metrics": semantic_model.get("metrics", {}),
    }
    model_yaml = yaml.dump(model_for_prompt, default_flow_style=False, width=120)

    prompt = SQL_AGENT_PROMPT.format(
        semantic_model=model_yaml,
        question=question,
        max_rows=MAX_RESULT_ROWS,
    )

    # Use a fast/cheap model for SQL generation
    sql_model = model_override or os.getenv("SQL_AGENT_MODEL", "") or "gemini-2.0-flash"
    sql_provider = os.getenv("SQL_AGENT_PROVIDER", "") or "gemini"

    creds = await get_llm_settings_from_db(
        tenant_id=tenant_id, user_id=user_id,
        provider_override=sql_provider, auth_intent="interactive",
    )

    provider = create_llm_provider(
        provider=sql_provider,
        api_key=creds.get("api_key", ""),
        model_name=sql_model,
        temperature=0,
        service_account_path=creds.get("service_account_path", ""),
    )

    if isinstance(provider, GeminiProvider):
        from google.genai import types as genai_types

        config = genai_types.GenerateContentConfig(
            temperature=0,
            system_instruction="You are a SQL query generator. Output ONLY valid PostgreSQL SQL. No markdown. No explanation.",
        )
        resp = await provider.client.aio.models.generate_content(
            model=sql_model,
            contents=[genai_types.Content(
                role="user",
                parts=[genai_types.Part.from_text(text=prompt)],
            )],
            config=config,
        )
        raw = resp.text or ""
    else:
        import openai as openai_mod

        client = openai_mod.AsyncOpenAI(api_key=creds.get("api_key", ""))
        resp = await client.chat.completions.create(
            model=sql_model,
            messages=[
                {"role": "system", "content": "You are a SQL query generator. Output ONLY valid PostgreSQL SQL. No markdown. No explanation."},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )
        raw = resp.choices[0].message.content or ""

    # Clean up — strip markdown fences if present
    sql = raw.strip()
    if sql.startswith("```"):
        sql = re.sub(r"^```(?:sql)?\n?", "", sql)
        sql = re.sub(r"\n?```$", "", sql)

    return sql.strip()


# ── Query Execution ─────────────────────────────────────────────────

async def _check_query_cost(sql: str, params: dict, db: AsyncSession, max_cost: float = 50000) -> None:
    """Run EXPLAIN to estimate query cost. Raises if too expensive."""
    try:
        explain_sql = f"EXPLAIN (FORMAT JSON) {sql}"
        result = await db.execute(text(explain_sql), params)
        plan = result.scalar()
        if plan and isinstance(plan, list) and plan:
            total_cost = plan[0].get("Plan", {}).get("Total Cost", 0)
            if total_cost > max_cost:
                raise SQLValidationError(
                    f"Query too expensive (estimated cost={total_cost:.0f}, max={max_cost:.0f}). Try a narrower question."
                )
    except SQLValidationError:
        raise
    except Exception as e:
        logger.warning("EXPLAIN check failed (proceeding anyway): %s", e)


async def execute_query(
    sql: str,
    params: dict,
    db: AsyncSession,
) -> list[dict]:
    """Execute a validated SQL query and return results as list of dicts."""
    # Add LIMIT if not present
    if "LIMIT" not in sql.upper():
        sql += f" LIMIT {MAX_RESULT_ROWS}"

    result = await db.execute(
        text(sql).execution_options(timeout=QUERY_TIMEOUT_SECONDS),
        params,
    )
    rows = result.fetchall()
    columns = list(result.keys())

    return [
        {col: _serialize_value(row[i]) for i, col in enumerate(columns)}
        for row in rows
    ]


def _serialize_value(val: Any) -> Any:
    """Make a DB value JSON-safe."""
    if val is None:
        return None
    if isinstance(val, (int, float, bool, str)):
        return val
    return str(val)


# ── Query Cache ─────────────────────────────────────────────────────

async def _get_cache(db: AsyncSession, sql_hash: str, tenant_id: str, app_id: str) -> dict | None:
    """Check query cache. Returns cached result or None."""
    try:
        from app.models.analytics_log import AnalyticsQueryCache
        result = await db.execute(
            select(AnalyticsQueryCache.result_json, AnalyticsQueryCache.row_count)
            .where(
                AnalyticsQueryCache.sql_hash == sql_hash,
                AnalyticsQueryCache.tenant_id == tenant_id,
                AnalyticsQueryCache.app_id == app_id,
                AnalyticsQueryCache.expires_at > func.now(),
            )
        )
        row = result.first()
        if row:
            return {"data": row[0], "row_count": row[1]}
    except Exception:
        pass
    return None


async def _set_cache(db: AsyncSession, sql_hash: str, tenant_id: str, app_id: str, rows: list[dict], ttl_seconds: int = 120) -> None:
    """Store query result in cache."""
    try:
        from app.models.analytics_log import AnalyticsQueryCache
        from datetime import datetime, timezone, timedelta

        # Upsert: delete old entry first
        await db.execute(
            delete(AnalyticsQueryCache).where(
                AnalyticsQueryCache.sql_hash == sql_hash,
                AnalyticsQueryCache.tenant_id == tenant_id,
                AnalyticsQueryCache.app_id == app_id,
            )
        )
        cache_entry = AnalyticsQueryCache(
            sql_hash=sql_hash,
            tenant_id=tenant_id,
            app_id=app_id,
            result_json=rows,
            row_count=len(rows),
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds),
        )
        db.add(cache_entry)
        await db.flush()
    except Exception:
        pass  # Cache failures are non-fatal


# ── Public API ──────────────────────────────────────────────────────

async def analyze(
    question: str,
    *,
    db: AsyncSession,
    auth: Any,
    app_id: str,
) -> dict:
    """
    End-to-end: question → SQL generation → validation → execution → results.
    Uses analytics_session for query execution (dedicated pool with 15s timeout).
    Returns a dict suitable for returning from a tool handler.
    """
    from app.database import analytics_session

    try:
        # 1. Match common query OR generate SQL via LLM
        common_sql = _match_common_query(question)

        if common_sql:
            logger.info("SQL agent: matched common query pattern")
            sql = common_sql
        else:
            logger.info("SQL agent: generating SQL for: %s", question[:100])
            sql = await generate_sql(
                question,
                tenant_id=str(getattr(auth, "tenant_id", "")),
                user_id=str(getattr(auth, "user_id", "")),
            )

        logger.info("SQL agent: generated SQL: %s", sql[:200])

        # 2. Validate SQL
        validated_sql = validate_sql(sql)

        # 3. Inject access filters
        safe_sql, params = prepare_query(validated_sql, auth, app_id)

        logger.info("SQL agent: executing with params: %s", list(params.keys()))

        # 4. Check cache
        sql_hash = hashlib.sha256(safe_sql.encode()).hexdigest()
        tenant_id = str(getattr(auth, "tenant_id", ""))

        async with analytics_session() as a_db:
            cached = await _get_cache(a_db, sql_hash, tenant_id, app_id)
            if cached:
                logger.info("SQL agent: cache hit (hash=%s)", sql_hash[:8])
                return {
                    "status": "ok",
                    "question": question,
                    "row_count": cached["row_count"],
                    "data": cached["data"][:MAX_RESULT_ROWS],
                    "generated_sql": sql[:300],
                    "sql_used": safe_sql[:300],
                    "cache_hit": True,
                }

            # 5. EXPLAIN cost check
            await _check_query_cost(safe_sql, params, a_db)

            # 6. Execute query — on failure, ask LLM to fix and retry once
            try:
                rows = await execute_query(safe_sql, params, a_db)
            except Exception as first_err:
                logger.warning("SQL agent: first attempt failed: %s — asking LLM to fix", first_err)
                await a_db.rollback()

                # Ask the same generate_sql with error context
                fix_question = (
                    f"The following SQL failed with this error:\n{first_err}\n\n"
                    f"Original question: {question}\n\n"
                    f"Failing SQL:\n{safe_sql}\n\n"
                    f"Generate a corrected SQL query."
                )
                fixed_sql = await generate_sql(
                    fix_question,
                    tenant_id=tenant_id,
                    user_id=str(getattr(auth, "user_id", "")),
                )
                logger.info("SQL agent: retry SQL: %s", fixed_sql[:200])

                # Full validation pipeline on the fix
                fixed_validated = validate_sql(fixed_sql)
                safe_sql, params = prepare_query(fixed_validated, auth, app_id)
                sql_hash = hashlib.sha256(safe_sql.encode()).hexdigest()
                await _check_query_cost(safe_sql, params, a_db)
                rows = await execute_query(safe_sql, params, a_db)

            # 7. Store in cache
            await _set_cache(a_db, sql_hash, tenant_id, app_id, rows)
            await a_db.commit()

        return {
            "status": "ok",
            "question": question,
            "row_count": len(rows),
            "data": rows[:MAX_RESULT_ROWS],
            "generated_sql": sql[:300],
            "sql_used": safe_sql[:300],
        }

    except SQLValidationError as e:
        logger.warning("SQL agent: validation failed: %s", e)
        return {
            "status": "error",
            "error": f"Generated query failed validation: {e}",
            "question": question,
        }
    except Exception as e:
        logger.warning("SQL agent: execution failed: %s", e)
        return {
            "status": "error",
            "error": f"Query execution failed: {str(e)}",
            "question": question,
        }


def _match_common_query(question: str) -> str | None:
    """Try to match the question to a pre-defined common query pattern."""
    model = _load_semantic_model()
    common = model.get("common_queries", [])
    q_lower = question.lower()

    for entry in common:
        intent = entry.get("intent", "").lower()
        # Simple keyword overlap scoring
        intent_words = set(intent.split())
        question_words = set(q_lower.split())
        overlap = len(intent_words & question_words)
        if overlap >= len(intent_words) * 0.6:  # 60% keyword match
            return entry.get("sql", "")

    return None
