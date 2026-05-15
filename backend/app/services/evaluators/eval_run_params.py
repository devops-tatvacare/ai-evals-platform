"""Typed contract for the params dict that the evaluation runner consumes.

Validated at job-submit time. `extra='forbid'` so any fabricated key from the
UI fails the submit request, not the worker. Selection logic lives in
`EvaluationSelectionSpec`.
"""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.services.evaluators.selection import EvaluationSelectionSpec


class LLMConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    model: str
    temperature: float = 0.1
    thinking: str | None = None


class TranscriptionConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: str = "auto"
    script: str = "auto"
    model: str = "gemini"
    speaker_diarization: bool = True
    preserve_code_switching: bool = True
    force_retranscribe: bool = False


class EvalRunParams(BaseModel):
    """Job-params contract for evaluation runners.

    The job handler validates the incoming dict into this model before doing
    anything else. The runner shell consumes the typed model — never raw dicts.
    """

    model_config = ConfigDict(extra="forbid")

    # Identity
    eval_run_id: uuid.UUID
    app_id: str
    dataset_id: str  # which app config dataset to evaluate (e.g., "calls")

    # Run metadata
    run_name: str
    run_description: str = ""

    # What to evaluate
    selection: EvaluationSelectionSpec
    evaluator_ids: list[uuid.UUID] = Field(min_length=1)

    # How to evaluate
    llm_config: LLMConfig
    transcription_config: TranscriptionConfig = Field(default_factory=TranscriptionConfig)
    parallel_workers: int = 1

    # Optional UI breadcrumb captured at submit time, not consumed by the runner.
    preview_records: list[dict[str, Any]] = Field(default_factory=list)
