"""SynthesisBrief — query_synthesis_specialist's structured output.

The supervisor always calls synthesis first, then dispatches each
sub-question to the named target. ``available_targets`` is pinned to the
supervisor's actual toolbelt at runtime so synthesis cannot name a
specialist that isn't wired in this turn.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


SynthesisTarget = Literal['data_specialist', 'authoring_specialist']
SynthesisClassification = Literal[
    'answerable',
    'ambiguous',
    'non_data',
    'non_sql_data',
]


class SubQuestion(BaseModel):
    model_config = ConfigDict(extra='forbid')

    sub_question: str
    target: SynthesisTarget
    depends_on_sub_question: int | None = None


class SynthesisBrief(BaseModel):
    model_config = ConfigDict(extra='forbid')

    rewritten_question: str
    classification: SynthesisClassification
    reason: str = ''
    suggested_followups: list[str] = Field(default_factory=list)
    available_targets: list[SynthesisTarget] = Field(default_factory=list)
    decomposition: list[SubQuestion] = Field(default_factory=list)

    @classmethod
    def model_validate_with_targets(
        cls,
        raw: Any,
        *,
        available_targets: list[SynthesisTarget],
    ) -> 'SynthesisBrief':
        brief = cls.model_validate(raw)
        brief = brief.model_copy(update={'available_targets': list(available_targets)})

        if not brief.rewritten_question.strip():
            raise ValueError('SynthesisBrief.rewritten_question must be non-empty')

        targets_allowed = set(available_targets)
        if brief.classification == 'answerable':
            if not brief.decomposition:
                raise ValueError(
                    "SynthesisBrief.classification='answerable' requires "
                    'a non-empty decomposition'
                )
            for idx, sq in enumerate(brief.decomposition):
                if sq.target not in targets_allowed:
                    raise ValueError(
                        f'SynthesisBrief.decomposition[{idx}].target='
                        f'{sq.target!r} is not in available_targets='
                        f'{sorted(targets_allowed)}'
                    )
                if sq.depends_on_sub_question is not None and (
                    sq.depends_on_sub_question < 0
                    or sq.depends_on_sub_question >= idx
                ):
                    raise ValueError(
                        f'SynthesisBrief.decomposition[{idx}].depends_on_sub_question'
                        f'={sq.depends_on_sub_question} must reference an earlier index'
                    )
        elif brief.classification == 'ambiguous':
            if brief.decomposition:
                raise ValueError(
                    "SynthesisBrief.classification='ambiguous' must have an empty decomposition"
                )
            if not brief.suggested_followups:
                raise ValueError(
                    "SynthesisBrief.classification='ambiguous' requires "
                    'non-empty suggested_followups'
                )
        else:
            if brief.decomposition:
                raise ValueError(
                    f"SynthesisBrief.classification={brief.classification!r} "
                    'must have an empty decomposition'
                )
        return brief


SYNTHESIS_BRIEF_JSON_SCHEMA: dict[str, Any] = SynthesisBrief.model_json_schema()
