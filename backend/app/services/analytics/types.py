"""Analytics data types — row dataclasses for fact extraction."""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID


@dataclass
class RunFactRow:
    run_id: UUID
    app_id: str
    tenant_id: UUID
    user_id: UUID
    eval_type: str
    status: str
    created_at: datetime
    completed_at: datetime | None
    duration_ms: float | None
    thread_count: int
    pass_count: int
    fail_count: int
    error_count: int
    pass_rate: float | None
    avg_intent_accuracy: float | None
    adversarial_total: int | None
    adversarial_blocked: int | None
    adversarial_block_rate: float | None
    run_name: str | None = None
    avg_score: float | None = None
    context: dict = field(default_factory=dict)


@dataclass
class EvalFactRow:
    run_id: UUID
    app_id: str
    tenant_id: UUID
    eval_type: str
    item_id: str
    item_type: str
    evaluator_type: str
    evaluator_name: str
    evaluator_id: UUID | None
    result_status: str | None
    result_score: float | None
    result_verdict: str | None
    success: bool | None
    agent: str | None = None
    direction: str | None = None
    duration_seconds: float | None = None
    intent: str | None = None
    route: str | None = None
    query_type: str | None = None
    difficulty: str | None = None
    total_turns: int | None = None
    result_detail: dict = field(default_factory=dict)
    context: dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now())


@dataclass
class CriterionFactRow:
    run_id: UUID
    app_id: str
    tenant_id: UUID
    item_id: str
    criterion_source: str
    criterion_id: str
    criterion_label: str | None
    evaluator_type: str
    status: str
    passed: bool | None
    evidence: str | None
    created_at: datetime = field(default_factory=lambda: datetime.now())


@dataclass
class FactSet:
    run_fact: RunFactRow
    eval_facts: list[EvalFactRow] = field(default_factory=list)
    criterion_facts: list[CriterionFactRow] = field(default_factory=list)


@dataclass
class PopulationResult:
    run_id: UUID
    rows_inserted: int
    duration_ms: float
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "run_id": str(self.run_id),
            "rows_inserted": self.rows_inserted,
            "duration_ms": round(self.duration_ms, 2),
            "errors": self.errors,
        }
