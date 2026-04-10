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
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import text
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

ALLOWED_TABLES = {"eval_runs", "thread_evaluations", "adversarial_evaluations", "evaluation_analytics"}
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
    missing_filters = []
    if ":tenant_id" not in cleaned:
        missing_filters.append("e.tenant_id = :tenant_id")
    if ":app_id" not in cleaned:
        missing_filters.append("e.app_id = :app_id")

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
- Only tables: eval_runs (alias e), thread_evaluations (alias t), adversarial_evaluations (alias a).
- Always JOIN child tables to eval_runs via run_id: JOIN thread_evaluations t ON t.run_id = e.id
- EVERY query MUST have a WHERE clause with these EXACT filters:
    WHERE e.app_id = :app_id AND e.tenant_id = :tenant_id
  Add any additional filters AFTER those two.
- Use :app_id and :tenant_id as bind parameters (they are pre-bound, do not quote them).
- The result column in thread_evaluations is JSON (not JSONB). ALWAYS cast with ::jsonb:
    CROSS JOIN LATERAL jsonb_array_elements((t.result::jsonb)->'correctness_evaluations') AS ce(val)
    CROSS JOIN LATERAL jsonb_array_elements(ce.val->'rule_compliance') AS rc(val)
  Do NOT put jsonb_array_elements in FROM with commas — use CROSS JOIN LATERAL.
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
    Returns a dict suitable for returning from a tool handler.
    """
    try:
        # 1. Check for matching common query first (exact semantic match)
        common_sql = _match_common_query(question)

        if common_sql:
            logger.info("SQL agent: matched common query pattern")
            sql = common_sql
        else:
            # 2. Generate SQL via inner LLM call
            logger.info("SQL agent: generating SQL for: %s", question[:100])
            sql = await generate_sql(
                question,
                tenant_id=str(getattr(auth, "tenant_id", "")),
                user_id=str(getattr(auth, "user_id", "")),
            )

        logger.info("SQL agent: generated SQL: %s", sql[:200])

        # 3. Validate
        validated_sql = validate_sql(sql)

        # 4. Inject access filters
        safe_sql, params = prepare_query(validated_sql, auth, app_id)

        logger.info("SQL agent: executing with params: %s", list(params.keys()))

        # 5. Execute
        rows = await execute_query(safe_sql, params, db)

        return {
            "status": "ok",
            "question": question,
            "row_count": len(rows),
            "data": rows[:MAX_RESULT_ROWS],
            "sql_used": safe_sql[:300],  # truncated for transparency
        }

    except SQLValidationError as e:
        logger.warning("SQL agent: validation failed: %s", e)
        await db.rollback()
        return {
            "status": "error",
            "error": f"Generated query failed validation: {e}",
            "question": question,
        }
    except Exception as e:
        logger.warning("SQL agent: execution failed: %s", e)
        await db.rollback()
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
