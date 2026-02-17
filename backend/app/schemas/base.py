"""Base schema classes with camelCase alias generation.

All API schemas inherit from these instead of BaseModel directly.
Backend Python code stays snake_case. API JSON output becomes camelCase.
"""
import uuid
from pydantic import BaseModel
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base for request schemas (Create/Update). Accepts and outputs camelCase."""
    model_config = {
        "alias_generator": to_camel,
        "populate_by_name": True,
        "protected_namespaces": (),
    }


class CamelORMModel(BaseModel):
    """Base for response schemas. Reads from SQLAlchemy, outputs camelCase."""
    model_config = {
        "alias_generator": to_camel,
        "populate_by_name": True,
        "from_attributes": True,
        "protected_namespaces": (),
    }
