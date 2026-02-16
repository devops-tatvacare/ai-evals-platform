"""Shared Pydantic schemas."""
from pydantic import BaseModel
from typing import Optional


class PaginationParams(BaseModel):
    limit: int = 50
    offset: int = 0


class DeleteResponse(BaseModel):
    deleted: bool = True
    id: str = ""
