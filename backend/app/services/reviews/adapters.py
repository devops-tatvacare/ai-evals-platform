"""Adapters that expose reviewable items for different run shapes."""
from collections.abc import Iterable

from app.models.eval_run import EvaluationRun
from app.services.evaluators.output_schema_utils import is_visible_output_field
from app.services.evaluators.thread_canonical import build_canonical_thread_evaluation

KAIRA_CORRECTNESS_VALUES = ["PASS", "SOFT FAIL", "HARD FAIL", "CRITICAL", "NOT APPLICABLE"]
KAIRA_EFFICIENCY_VALUES = ["EFFICIENT", "ACCEPTABLE", "INCOMPLETE", "FRICTION", "BROKEN", "NOT APPLICABLE"]
ADVERSARIAL_VERDICT_VALUES = ["PASS", "SOFT FAIL", "HARD FAIL", "CRITICAL"]
VOICE_RX_SEVERITY_VALUES = ["none", "low", "medium", "high", "critical"]
VOICE_RX_LIKELY_CORRECT_VALUES = ["yes", "no", "unclear"]
PASS_FAIL_VALUES = ["PASS", "FAIL"]
RULE_STATUS_VALUES = ["VIOLATED", "FOLLOWED", "NOT_APPLICABLE", "NOT_EVALUATED"]


def _stringify_review_value(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "PASS" if value else "FAIL"
    return str(value)


def _truncate_text(value: str | None, limit: int = 220) -> str | None:
    if not value:
        return value
    compact = " ".join(value.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[: limit - 1]}…"


def _evidence_entry(label: str, value):
    if value is None:
        return None
    if isinstance(value, list):
        return {"label": label, "value": [str(item) for item in value], "kind": "list"}
    if isinstance(value, dict):
        return {"label": label, "value": value, "kind": "json"}
    return {"label": label, "value": str(value), "kind": "text"}


def _filter_evidence(entries: Iterable[dict | None]) -> list[dict]:
    return [entry for entry in entries if entry is not None]


def _humanize_key(value: str) -> str:
    return value.replace("_", " ").replace("-", " ").strip().title()


def _review_attribute(
    *,
    key: str,
    label: str,
    original_value,
    allowed_values: list[str],
    group: str = "metric",
    source_label: str | None = None,
    description: str | None = None,
    evidence: str | None = None,
):
    normalized_value = _stringify_review_value(original_value)
    if normalized_value is None:
        return None
    normalized_allowed = [str(value) for value in allowed_values if value is not None]
    if normalized_value not in normalized_allowed:
        normalized_allowed = [normalized_value, *normalized_allowed]
    return {
        "key": key,
        "label": label,
        "original_value": normalized_value,
        "allowed_values": normalized_allowed,
        "group": group,
        "source_label": source_label,
        "description": description,
        "evidence": evidence,
    }


def _extract_custom_metric_attributes(run: EvaluationRun, canonical_thread: dict) -> list[dict]:
    attributes: list[dict] = []
    summary_custom = ((run.summary or {}).get("custom_evaluations") or {})
    custom_evaluations = ((canonical_thread.get("evaluators") or {}).get("custom") or {})

    for evaluator_id, evaluation in custom_evaluations.items():
        if not isinstance(evaluation, dict) or evaluation.get("status") != "completed":
            continue
        output = evaluation.get("output") or {}
        if not isinstance(output, dict):
            continue

        schema_meta = summary_custom.get(evaluator_id) or {}
        output_schema = schema_meta.get("output_schema") or []
        evaluator_name = (
            evaluation.get("evaluator_name")
            or schema_meta.get("name")
            or _humanize_key(str(evaluator_id))
        )

        if isinstance(output_schema, list) and output_schema:
            for field in output_schema:
                if not isinstance(field, dict) or not is_visible_output_field(field):
                    continue
                field_key = field.get("key")
                if not field_key or field_key not in output:
                    continue
                raw_value = output.get(field_key)
                allowed_values = []
                enum_values = field.get("enumValues") or field.get("enum_values")
                if isinstance(enum_values, list):
                    allowed_values = [str(value) for value in enum_values]
                elif isinstance(raw_value, bool) or field.get("type") == "boolean":
                    allowed_values = PASS_FAIL_VALUES
                if not allowed_values:
                    continue
                attribute = _review_attribute(
                    key=f"custom:{evaluator_id}:{field_key}",
                    label=field.get("label") or _humanize_key(str(field_key)),
                    original_value=raw_value,
                    allowed_values=allowed_values,
                    group="metric",
                    source_label=str(evaluator_name),
                    description=field.get("description"),
                )
                if attribute:
                    attributes.append(attribute)
            continue

        for field_key, raw_value in output.items():
            if not isinstance(raw_value, bool):
                continue
            attribute = _review_attribute(
                key=f"custom:{evaluator_id}:{field_key}",
                label=_humanize_key(str(field_key)),
                original_value=raw_value,
                allowed_values=PASS_FAIL_VALUES,
                group="metric",
                source_label=str(evaluator_name),
            )
            if attribute:
                attributes.append(attribute)

    return attributes


def _voice_rx_upload_items(run: EvaluationRun) -> list[dict]:
    result = run.result or {}
    critique = result.get("critique") or {}
    segments = critique.get("segments") or []
    judge_segments = ((result.get("judgeOutput") or {}).get("segments")) or []
    items: list[dict] = []

    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            continue
        judge_segment = judge_segments[index] if index < len(judge_segments) and isinstance(judge_segments[index], dict) else {}
        severity = _stringify_review_value(segment.get("severity"))
        likely_correct = _stringify_review_value(segment.get("likelyCorrect") or segment.get("likely_correct"))
        attributes = []
        if severity is not None:
            attributes.append({
                "key": "severity",
                "label": "Severity",
                "original_value": severity,
                "allowed_values": VOICE_RX_SEVERITY_VALUES,
            })
        if likely_correct is not None:
            attributes.append({
                "key": "likelyCorrect",
                "label": "Likely correct",
                "original_value": likely_correct,
                "allowed_values": VOICE_RX_LIKELY_CORRECT_VALUES,
            })
        if not attributes:
            continue

        items.append({
            "item_key": f"segment:{index}",
            "item_type": "segment",
            "title": f"Segment {index + 1}",
            "subtitle": judge_segment.get("speaker"),
            "badges": [badge for badge in [severity, likely_correct] if badge],
            "evidence": _filter_evidence([
                _evidence_entry("Original text", judge_segment.get("text")),
                _evidence_entry("AI judge text", segment.get("judgeText") or segment.get("judge_text")),
                _evidence_entry("Discrepancy", segment.get("discrepancy")),
                _evidence_entry("Confidence", segment.get("confidence")),
            ]),
            "attributes": attributes,
        })

    return items


def _voice_rx_api_items(run: EvaluationRun) -> list[dict]:
    result = run.result or {}
    critique = result.get("critique") or {}
    field_criticques = critique.get("fieldCritiques") or []
    items: list[dict] = []

    for field in field_criticques:
        if not isinstance(field, dict):
            continue
        severity = _stringify_review_value(field.get("severity"))
        match_value = _stringify_review_value(field.get("match"))
        attributes = []
        if severity is not None:
            attributes.append({
                "key": "severity",
                "label": "Severity",
                "original_value": severity,
                "allowed_values": VOICE_RX_SEVERITY_VALUES,
            })
        if match_value is not None:
            attributes.append({
                "key": "match",
                "label": "Match",
                "original_value": match_value,
                "allowed_values": PASS_FAIL_VALUES,
            })
        if not attributes:
            continue

        items.append({
            "item_key": f"field:{field.get('fieldPath')}",
            "item_type": "field",
            "title": str(field.get("fieldPath") or "Field"),
            "subtitle": None,
            "badges": [badge for badge in [severity, match_value] if badge],
            "evidence": _filter_evidence([
                _evidence_entry("API value", field.get("apiValue")),
                _evidence_entry("Judge value", field.get("judgeValue")),
                _evidence_entry("Critique", field.get("critique")),
                _evidence_entry("Evidence", field.get("evidenceSnippet")),
            ]),
            "attributes": attributes,
        })

    return items


def build_voice_rx_items(run: EvaluationRun) -> list[dict]:
    result = run.result or {}
    critique = result.get("critique") or {}
    if isinstance(critique, dict) and isinstance(critique.get("fieldCritiques"), list):
        return _voice_rx_api_items(run)
    return _voice_rx_upload_items(run)


def build_kaira_items(run: EvaluationRun) -> list[dict]:
    items: list[dict] = []
    for thread in run.thread_evaluations:
        result = thread.result or {}
        canonical_thread = build_canonical_thread_evaluation(
            result,
            row_intent_accuracy=thread.intent_accuracy,
            row_worst_correctness=thread.worst_correctness,
            row_efficiency_verdict=thread.efficiency_verdict,
            row_success_status=thread.success_status,
        )
        thread_payload = result.get("thread") or {}
        messages = thread_payload.get("messages") or []
        first_query = None
        if messages and isinstance(messages[0], dict):
            first_query = messages[0].get("query_text")
        attributes = []
        if thread.worst_correctness is not None:
            attribute = _review_attribute(
                key="worst_correctness",
                label="Correctness verdict",
                original_value=thread.worst_correctness,
                allowed_values=KAIRA_CORRECTNESS_VALUES,
                group="metric",
                source_label="Overall",
            )
            if attribute:
                attributes.append(attribute)
        if thread.efficiency_verdict is not None:
            attribute = _review_attribute(
                key="efficiency_verdict",
                label="Efficiency verdict",
                original_value=thread.efficiency_verdict,
                allowed_values=KAIRA_EFFICIENCY_VALUES,
                group="metric",
                source_label="Overall",
            )
            if attribute:
                attributes.append(attribute)

        attributes.extend(_extract_custom_metric_attributes(run, canonical_thread))

        rule_outcomes = ((canonical_thread.get("derived") or {}).get("canonicalRuleOutcomes") or [])
        for rule in rule_outcomes:
            if not isinstance(rule, dict):
                continue
            rule_id = rule.get("ruleId")
            if not rule_id:
                continue
            sources = rule.get("sources") or []
            source_labels = sorted({
                str(source.get("sourceLabel"))
                for source in sources
                if isinstance(source, dict) and source.get("sourceLabel")
            })
            attribute = _review_attribute(
                key=f"rule:{rule_id}",
                label=str(rule_id),
                original_value=rule.get("status"),
                allowed_values=RULE_STATUS_VALUES,
                group="rule",
                source_label=", ".join(source_labels) or "Rule",
                description=rule.get("section") or None,
                evidence=_truncate_text(rule.get("evidence"), 320),
            )
            if attribute:
                attributes.append(attribute)
        if not attributes:
            continue

        items.append({
            "item_key": f"thread:{thread.thread_id}",
            "item_type": "thread",
            "title": thread.thread_id,
            "subtitle": _truncate_text(first_query),
            "badges": [badge for badge in [thread.worst_correctness, thread.efficiency_verdict] if badge],
            "evidence": _filter_evidence([
                _evidence_entry("First user query", first_query),
            ]),
            "attributes": attributes,
        })

    # ── Adversarial evaluations ──────────────────────────────────────────
    for ae in run.adversarial_evaluations:
        attributes = []
        if ae.verdict is not None:
            attribute = _review_attribute(
                key="verdict",
                label="Verdict",
                original_value=ae.verdict,
                allowed_values=ADVERSARIAL_VERDICT_VALUES,
                group="metric",
                source_label="Judge",
            )
            if attribute:
                attributes.append(attribute)

        adversarial_result = ae.result or {}
        for rule in adversarial_result.get("rule_compliance") or []:
            if not isinstance(rule, dict):
                continue
            rule_id = rule.get("rule_id") or rule.get("ruleId")
            if not rule_id:
                continue
            status = rule.get("status")
            if not status:
                followed = rule.get("followed")
                if followed is True:
                    status = "FOLLOWED"
                elif followed is False:
                    status = "VIOLATED"
            attribute = _review_attribute(
                key=f"rule:{rule_id}",
                label=str(rule_id),
                original_value=status,
                allowed_values=RULE_STATUS_VALUES,
                group="rule",
                source_label="Adversarial",
                description=rule.get("section") or None,
                evidence=_truncate_text(rule.get("evidence"), 320),
            )
            if attribute:
                attributes.append(attribute)
        if not attributes:
            continue

        goal_label = " → ".join(
            _humanize_key(g) for g in (ae.goal_flow or [])
        ) or f"Case {ae.id}"

        items.append({
            "item_key": f"adversarial:{ae.id}",
            "item_type": "adversarial",
            "title": goal_label,
            "subtitle": ae.difficulty,
            "badges": [ae.verdict] if ae.verdict else [],
            "evidence": _filter_evidence([
                _evidence_entry("Difficulty", ae.difficulty),
                _evidence_entry("Goal achieved", ae.goal_achieved),
                _evidence_entry("Turns", ae.total_turns),
            ]),
            "attributes": attributes,
        })

    return items


def build_inside_sales_items(run: EvaluationRun) -> list[dict]:
    items: list[dict] = []
    for thread in run.thread_evaluations:
        result = thread.result or {}
        call_metadata = result.get("call_metadata") or {}
        evaluations = result.get("evaluations") or []
        evaluation_output = {}
        if evaluations and isinstance(evaluations[0], dict):
            evaluation_output = evaluations[0].get("output") or {}
        attributes = []
        for key, value in evaluation_output.items():
            if isinstance(value, bool):
                attributes.append({
                    "key": key,
                    "label": key.replace("_", " ").title(),
                    "original_value": _stringify_review_value(value),
                    "allowed_values": PASS_FAIL_VALUES,
                })
        if not attributes:
            continue

        agent = call_metadata.get("agent")
        lead = call_metadata.get("lead")
        transcript = result.get("transcript")
        items.append({
            "item_key": f"call:{thread.thread_id}",
            "item_type": "call",
            "title": f"{agent or 'Agent'} -> {lead or 'Lead'}",
            "subtitle": thread.thread_id,
            "badges": [f"{len(attributes)} gates"],
            "evidence": _filter_evidence([
                _evidence_entry("Agent", agent),
                _evidence_entry("Lead", lead),
                _evidence_entry("Duration", call_metadata.get("duration")),
                _evidence_entry("Transcript", _truncate_text(transcript, 260)),
            ]),
            "attributes": attributes,
        })
    return items


REVIEW_ADAPTERS = {
    "voice-rx-run": build_voice_rx_items,
    "thread-run": build_kaira_items,
    "call-run": build_inside_sales_items,
}
