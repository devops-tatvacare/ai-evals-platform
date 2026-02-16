"""Listing request/response schemas."""
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime


class ListingCreate(BaseModel):
    app_id: str
    title: str = ""
    status: str = "draft"
    source_type: str = "upload"
    audio_file: Optional[dict] = None
    transcript_file: Optional[dict] = None
    structured_json_file: Optional[dict] = None
    transcript: Optional[dict] = None
    api_response: Optional[dict] = None
    structured_output_references: list = []
    structured_outputs: list = []
    ai_eval: Optional[dict] = None
    human_eval: Optional[dict] = None
    evaluator_runs: list = []


class ListingUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    source_type: Optional[str] = None
    audio_file: Optional[dict] = None
    transcript_file: Optional[dict] = None
    structured_json_file: Optional[dict] = None
    transcript: Optional[dict] = None
    api_response: Optional[dict] = None
    structured_output_references: Optional[list] = None
    structured_outputs: Optional[list] = None
    ai_eval: Optional[dict] = None
    human_eval: Optional[dict] = None
    evaluator_runs: Optional[list] = None


class ListingResponse(BaseModel):
    id: str
    app_id: str
    title: str
    status: str
    source_type: str
    audio_file: Optional[dict] = None
    transcript_file: Optional[dict] = None
    structured_json_file: Optional[dict] = None
    transcript: Optional[dict] = None
    api_response: Optional[dict] = None
    structured_output_references: list = []
    structured_outputs: list = []
    ai_eval: Optional[dict] = None
    human_eval: Optional[dict] = None
    evaluator_runs: list = []
    created_at: datetime
    updated_at: datetime
    user_id: str = "default"

    model_config = {"from_attributes": True}
