"""Typed bouncer outputs — Verdict + Diagnostic with positive recovery complements."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


ExpectedRowBound = Literal['single', 'small', 'medium', 'large', 'unbounded']
VerdictStatus = Literal['ok', 'invalid']


class JoinKey(BaseModel):
    """One declared relationship column pair."""

    model_config = ConfigDict(extra='forbid', frozen=True)

    many_col: str
    one_col: str


class AvailableJoin(BaseModel):
    """One declared relationship between two catalog tables."""

    model_config = ConfigDict(extra='forbid', frozen=True)

    many_table: str
    one_table: str
    columns: list[JoinKey] = Field(default_factory=list)


class Diagnostic(BaseModel):
    """Bouncer rule rejection — failure plus the recovery surface (available_*/did_you_mean)."""

    model_config = ConfigDict(extra='forbid', frozen=True)

    rule_id: str
    rule_number: int
    rule_name: str
    message: str
    hint: str | None = None
    offending_tables: list[str] = Field(default_factory=list)
    offending_columns: list[str] = Field(default_factory=list)
    available_tables: list[str] = Field(default_factory=list)
    available_columns_for: dict[str, list[str]] = Field(default_factory=dict)
    available_joins: list[AvailableJoin] = Field(default_factory=list)
    missing_group_by_keys: list[str] = Field(default_factory=list)
    required_scope_predicates: list[str] = Field(default_factory=list)
    did_you_mean: dict[str, str] = Field(default_factory=dict)

    def to_telemetry(self) -> dict[str, Any]:
        return self.model_dump(exclude_defaults=True, exclude_none=True)


class Verdict(BaseModel):
    """Bouncer pre/post-execution outcome — ok carries safe_sql, invalid carries diagnostic."""

    model_config = ConfigDict(extra='forbid', frozen=True)

    status: VerdictStatus
    diagnostic: Diagnostic | None = None
    safe_sql: str | None = None
    limit_applied: int | None = None
    row_cap: int | None = None
    declared_grain: list[str] = Field(default_factory=list)
    expected_row_bound: ExpectedRowBound | None = None
    more_rows_exist: bool | None = None
    displayed_row_count: int | None = None

    @property
    def ok(self) -> bool:
        return self.status == 'ok'

    def to_telemetry(self) -> dict[str, Any]:
        out: dict[str, Any] = {'status': self.status}
        if self.diagnostic is not None:
            out['diagnostic'] = self.diagnostic.to_telemetry()
            out['rule_id'] = self.diagnostic.rule_id
        if self.declared_grain:
            out['declared_grain'] = list(self.declared_grain)
        if self.expected_row_bound is not None:
            out['expected_row_bound'] = self.expected_row_bound
        if self.row_cap is not None:
            out['row_cap'] = self.row_cap
        if self.limit_applied is not None:
            out['limit_applied'] = self.limit_applied
        if self.more_rows_exist is not None:
            out['more_rows_exist'] = self.more_rows_exist
        if self.displayed_row_count is not None:
            out['displayed_row_count'] = self.displayed_row_count
        return out
