"""Pure helpers for evaluator output-schema v2 semantics."""


def find_primary_field(output_schema: list[dict]) -> dict | None:
    """Find the primary field for summary aggregation.

    Priority: isMainMetric=True -> first number field -> first text field -> first field.
    """
    if not output_schema:
        return None

    for field in output_schema:
        if field.get("isMainMetric"):
            return {
                "key": field["key"],
                "type": field.get("type", "text"),
                "thresholds": field.get("thresholds"),
            }

    for field in output_schema:
        if field.get("type") == "number":
            return {
                "key": field["key"],
                "type": "number",
                "thresholds": field.get("thresholds"),
            }

    for field in output_schema:
        if field.get("type") == "text":
            return {"key": field["key"], "type": "text"}

    return {"key": output_schema[0]["key"], "type": output_schema[0].get("type", "text")}


def is_visible_output_field(field: dict) -> bool:
    """Return True when an output field should appear in user-visible summaries."""

    role = field.get("role", "detail")
    return role in ("metric", "detail")


def build_visible_breakdown(output: dict, output_schema: list[dict]) -> dict:
    """Project evaluator output down to user-visible fields only."""

    return {
        field["key"]: output[field["key"]]
        for field in output_schema
        if is_visible_output_field(field) and field["key"] in output
    }


def primary_score(output: dict, output_schema: list[dict]) -> float | None:
    """Extract the numeric primary-metric value from an evaluator output.

    Returns None when the schema has no numeric primary field or the output
    is missing / non-numeric. Used by runners, analytics extractors, and
    reports to get a single comparable number per evaluator per item.

    Defensive against malformed inputs: returns None for non-dict outputs,
    non-list schemas, or schemas containing non-dict entries.
    """
    if not isinstance(output, dict) or not output:
        return None
    if not isinstance(output_schema, list) or not output_schema:
        return None
    if not all(isinstance(field, dict) for field in output_schema):
        return None
    primary = find_primary_field(output_schema)
    if not primary or primary.get("type") != "number":
        return None
    value = output.get(primary["key"])
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    return float(value)
