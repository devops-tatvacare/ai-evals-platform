"""JSON Schema generator from field-based output definitions.

Ported from src/services/evaluators/schemaGenerator.ts — converts
EvaluatorOutputField[] (visual builder format) to JSON Schema for
structured LLM output enforcement.
"""


def generate_json_schema(fields: list[dict]) -> dict:
    """Convert field-based output schema to JSON Schema.

    Args:
        fields: List of field definitions, each with:
            - key: str (field name)
            - type: str ("number", "text", "boolean", "array")
            - description: str
            - arrayItemSchema: dict | None (for array type)

    Returns:
        JSON Schema object:
        {
            "type": "object",
            "properties": {...},
            "required": [...],
            "additionalProperties": false
        }
    """
    properties = {}
    required = []

    for field in fields:
        properties[field["key"]] = _generate_field_schema(field)
        required.append(field["key"])

    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


def _generate_field_schema(field: dict) -> dict:
    """Generate JSON Schema for a single field."""
    base = {}
    if field.get("description"):
        base["description"] = field["description"]

    field_type = field.get("type", "text")

    if field_type == "number":
        return {**base, "type": "number"}
    elif field_type == "text":
        return {**base, "type": "string"}
    elif field_type == "boolean":
        return {**base, "type": "boolean"}
    elif field_type == "array":
        return {
            **base,
            "type": "array",
            "items": _generate_array_item_schema(field),
        }
    else:
        return {**base, "type": "string"}


def _generate_array_item_schema(field: dict) -> dict:
    """Generate JSON Schema for array items."""
    item_schema = field.get("arrayItemSchema")
    if not item_schema:
        return {"type": "string"}

    item_type = item_schema.get("itemType", "string")

    if item_type == "string":
        return {"type": "string"}
    if item_type == "number":
        return {"type": "number"}
    if item_type == "boolean":
        return {"type": "boolean"}

    if item_type == "object":
        props = item_schema.get("properties", [])
        if props:
            object_properties = {}
            obj_required = []
            for prop in props:
                object_properties[prop["key"]] = {
                    "type": prop.get("type", "string"),
                }
                if prop.get("description"):
                    object_properties[prop["key"]]["description"] = prop["description"]
                obj_required.append(prop["key"])
            return {
                "type": "object",
                "properties": object_properties,
                "required": obj_required,
            }

    return {"type": "string"}
