"""Phase 1A — typed Sherlock contracts: discriminated unions, round-trip."""
from __future__ import annotations

from pydantic import TypeAdapter

from app.services.sherlock_v3.contracts import (
    Attempt,
    AvailableJoin,
    ChartPart,
    Diagnostic,
    EvidenceRef,
    JoinKey,
    RetryPart,
    SherlockPart,
    SpecialistBrief,
    SpecialistResult,
    SpecialistScope,
    SubtaskPart,
    ToolPart,
    ToolStateCompleted,
    ToolStateError,
    ToolStatePending,
    ToolStateRunning,
    UserMessagePart,
    Verdict,
    new_part_id,
)


PART_ADAPTER = TypeAdapter(SherlockPart)


def _common_part_fields(**overrides):
    base = {
        'id': new_part_id(),
        'chat_session_id': 'sess_abc',
        'seq': 1,
        'created_at': 1700000000,
    }
    base.update(overrides)
    return base


def test_user_message_part_round_trip():
    p = UserMessagePart(**_common_part_fields(), text='top 10 evals')
    js = p.model_dump_json()
    parsed = PART_ADAPTER.validate_json(js)
    assert parsed.type == 'user_message'
    assert parsed.text == 'top 10 evals'


def test_tool_part_state_machine_round_trip():
    pending = ToolPart(
        **_common_part_fields(seq=2),
        call_id='call_BD3',
        tool='submit_sql',
        state=ToolStatePending(input={'sql': 'SELECT 1'}),
    )
    parsed = PART_ADAPTER.validate_json(pending.model_dump_json())
    assert parsed.type == 'tool'
    assert parsed.state.status == 'pending'

    running = ToolPart(
        **_common_part_fields(seq=3),
        call_id='call_BD3',
        tool='submit_sql',
        state=ToolStateRunning(input={'sql': 'SELECT 1'}, started_at=1700000001),
    )
    assert PART_ADAPTER.validate_json(running.model_dump_json()).state.status == 'running'

    completed = ToolPart(
        **_common_part_fields(seq=4),
        call_id='call_BD3',
        tool='submit_sql',
        state=ToolStateCompleted(
            input={'sql': 'SELECT 1'}, output='{}', title='ok',
            started_at=1700000001, ended_at=1700000002,
        ),
    )
    assert PART_ADAPTER.validate_json(completed.model_dump_json()).state.status == 'completed'

    errored = ToolPart(
        **_common_part_fields(seq=5),
        call_id='call_BD3',
        tool='submit_sql',
        state=ToolStateError(
            input={'sql': 'SELECT 1'}, error='boom',
            started_at=1700000001, ended_at=1700000002,
        ),
    )
    assert PART_ADAPTER.validate_json(errored.model_dump_json()).state.status == 'error'


def test_subtask_part_carries_typed_brief():
    brief = SpecialistBrief(
        question='top 10 evals last week',
        scope=SpecialistScope(tenant_id='t', app_id='inside-sales', user_id='u'),
    )
    p = SubtaskPart(
        **_common_part_fields(seq=2),
        specialist='data_specialist',
        call_id='call_xyz',
        brief=brief,
    )
    parsed = PART_ADAPTER.validate_json(p.model_dump_json())
    assert parsed.type == 'subtask'
    assert parsed.brief.question == 'top 10 evals last week'
    assert parsed.brief.is_retry is False


def test_specialist_brief_is_retry_flag():
    diag = Diagnostic(
        rule_id='R4.allowed_columns', rule_number=4, rule_name='Allowed columns',
        message='Rule 4 — Allowed columns: rn missing',
        offending_columns=['rn'],
    )
    failed = Attempt(
        sql='SELECT rn FROM …', verdict=Verdict(status='invalid', diagnostic=diag),
        status='bouncer_rejected_before',
    )
    brief = SpecialistBrief(
        question='top 10',
        scope=SpecialistScope(tenant_id='t', app_id='a', user_id='u'),
        prior_attempts=[failed],
        retry_hint='use a different windowing approach',
    )
    assert brief.is_retry is True
    assert brief.prior_attempts[0].verdict.diagnostic.rule_number == 4


def test_specialist_result_with_attempts_round_trip():
    diag = Diagnostic(
        rule_id='R4.allowed_columns', rule_number=4, rule_name='Allowed columns',
        message='Rule 4 — Allowed columns: bogus column',
        offending_columns=['bogus_col'],
        available_columns_for={'fact_evaluation': ['agent', 'created_at']},
        did_you_mean={'bogus_col': 'created_at'},
    )
    failed = Attempt(
        sql='SELECT bogus_col FROM …', verdict=Verdict(status='invalid', diagnostic=diag),
        status='bouncer_rejected_before',
    )
    res = SpecialistResult(
        kind='data',
        status='error',
        summary='bouncer rejected; retry possible',
        attempts=[failed],
    )
    js = res.model_dump_json()
    decoded = SpecialistResult.model_validate_json(js)
    assert decoded.status == 'error'
    assert len(decoded.attempts) == 1
    assert decoded.attempts[0].verdict.diagnostic.available_columns_for == {
        'fact_evaluation': ['agent', 'created_at']
    }
    assert decoded.attempts[0].verdict.diagnostic.did_you_mean == {'bogus_col': 'created_at'}


def test_retry_part_round_trip():
    diag = Diagnostic(
        rule_id='R4.allowed_columns', rule_number=4, rule_name='Allowed columns',
        message='rn', offending_columns=['rn'],
    )
    att = Attempt(
        sql='SELECT rn FROM …', verdict=Verdict(status='invalid', diagnostic=diag),
        status='bouncer_rejected_before',
    )
    rp = RetryPart(
        **_common_part_fields(seq=3),
        specialist='data_specialist',
        attempt_number=2,
        failed_attempt=att,
    )
    parsed = PART_ADAPTER.validate_json(rp.model_dump_json())
    assert parsed.type == 'retry'
    assert parsed.attempt_number == 2
    assert parsed.failed_attempt.status == 'bouncer_rejected_before'


def test_chart_part_round_trip():
    from app.services.sherlock_v3.contracts.artifact import Artifact

    p = ChartPart(
        **_common_part_fields(seq=6),
        artifact=Artifact(kind='chart', payload={'kind': 'chart', 'spec': {}, 'data': {'values': []}}),
    )
    parsed = PART_ADAPTER.validate_json(p.model_dump_json())
    assert parsed.type == 'chart'
    assert parsed.artifact.kind == 'chart'


def test_diagnostic_to_telemetry_strips_defaults():
    diag = Diagnostic(
        rule_id='R2.allowed_tables', rule_number=2, rule_name='Allowed tables',
        message='Rule 2 — Allowed tables: bogus_table not in catalog',
        offending_tables=['bogus_table'],
        available_tables=['fact_evaluation', 'dim_lead'],
    )
    out = diag.to_telemetry()
    assert out['rule_id'] == 'R2.allowed_tables'
    assert out['rule_number'] == 2
    assert out['offending_tables'] == ['bogus_table']
    assert out['available_tables'] == ['fact_evaluation', 'dim_lead']
    assert 'available_joins' not in out  # default-empty fields are stripped
    assert 'did_you_mean' not in out


def test_verdict_ok_property_and_telemetry():
    v_ok = Verdict(
        status='ok', safe_sql='SELECT 1 LIMIT 51', limit_applied=51, row_cap=50,
        declared_grain=['run_id'], expected_row_bound='small',
    )
    assert v_ok.ok is True
    tele = v_ok.to_telemetry()
    assert tele['status'] == 'ok'
    assert tele['declared_grain'] == ['run_id']
    assert tele['row_cap'] == 50

    v_bad = Verdict(
        status='invalid',
        diagnostic=Diagnostic(
            rule_id='R3.undeclared_join', rule_number=3, rule_name='Undeclared join',
            message='need a relationship',
            available_joins=[
                AvailableJoin(
                    many_table='fact_lead_activity', one_table='dim_lead',
                    columns=[JoinKey(many_col='lead_id', one_col='id')],
                ),
            ],
        ),
    )
    assert v_bad.ok is False
    tele_bad = v_bad.to_telemetry()
    assert tele_bad['rule_id'] == 'R3.undeclared_join'
    assert tele_bad['diagnostic']['available_joins'][0]['many_table'] == 'fact_lead_activity'


def test_evidence_ref_round_trip():
    import uuid as _u
    ref = EvidenceRef(
        ref_id=_u.uuid4(),
        source='sql_row',
        locator={'sql': 'SELECT 1', 'row_index': 0},
        snippet='{...}',
    )
    decoded = EvidenceRef.model_validate_json(ref.model_dump_json())
    assert decoded.source == 'sql_row'
    assert decoded.locator['row_index'] == 0
