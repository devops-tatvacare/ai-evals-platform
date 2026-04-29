"""Aggregates custom evaluation outputs across threads.

Pure computation — no DB access, no LLM calls.
"""

from __future__ import annotations

import logging

from app.models.eval_run import EvaluationRunThreadResult
from app.services.evaluators.output_schema_utils import (
    find_primary_field,
    is_visible_output_field,
)

from .schemas import (
    CustomEvaluationsReport,
    EvaluatorSection,
    FieldAggregation,
    ThresholdPassRates,
)

logger = logging.getLogger(__name__)


def _is_visible_field(field: dict) -> bool:
    """Check if a field should be visible in reports under output-schema v2."""
    return is_visible_output_field(field)


class CustomEvaluationsAggregator:
    """Aggregates per-field metrics for all custom evaluators in a run.

    Constructor args:
        threads: list of EvaluationRunThreadResult rows (already loaded).
        evaluator_schemas: {eval_id: {"name": str, "output_schema": list[dict], "prompt": str}}
    """

    def __init__(
        self,
        threads: list[EvaluationRunThreadResult],
        evaluator_schemas: dict[str, dict],
    ):
        self.threads = threads
        self.evaluator_schemas = evaluator_schemas

    def aggregate(self) -> CustomEvaluationsReport | None:
        """Build per-evaluator sections with field-level aggregation.

        Returns None if no custom evaluations data exists across threads.
        """
        if not self.evaluator_schemas:
            return None

        sections: list[EvaluatorSection] = []

        for eval_id, schema_info in self.evaluator_schemas.items():
            output_schema = schema_info.get("output_schema", [])
            visible_fields = [
                f for f in output_schema
                if _is_visible_field(f)
            ]
            if not visible_fields:
                continue

            # Collect outputs across threads
            total = 0
            completed = 0
            errors = 0
            field_values: dict[str, list] = {f["key"]: [] for f in visible_fields}

            for thread in self.threads:
                result = thread.result or {}
                custom_evals = result.get("custom_evaluations", {})
                eval_data = custom_evals.get(eval_id)
                if eval_data is None:
                    continue

                total += 1

                if isinstance(eval_data, dict) and eval_data.get("error"):
                    errors += 1
                    continue

                completed += 1
                output = eval_data.get("output", {}) if isinstance(eval_data, dict) else {}

                for f in visible_fields:
                    key = f["key"]
                    val = output.get(key)
                    if val is not None:
                        field_values[key].append(val)

            if total == 0:
                continue

            # Aggregate each visible field
            field_aggs: list[FieldAggregation] = []
            for f in visible_fields:
                agg = self._aggregate_field(f, field_values[f["key"]])
                if agg:
                    field_aggs.append(agg)

            # Identify primary field
            primary_info = find_primary_field(output_schema)
            primary_agg = None
            if primary_info:
                for fa in field_aggs:
                    if fa.key == primary_info["key"]:
                        primary_agg = fa
                        break

            error_rate = round(errors / total, 3) if total > 0 else 0.0

            sections.append(EvaluatorSection(
                evaluator_id=eval_id,
                evaluator_name=schema_info.get("name", eval_id),
                total_threads=total,
                completed=completed,
                errors=errors,
                error_rate=error_rate,
                primary_field=primary_agg,
                fields=field_aggs,
            ))

        if not sections:
            return None

        return CustomEvaluationsReport(evaluator_sections=sections)

    def compute_custom_scores_for_exemplars(self) -> dict[str, float]:
        """Compute per-thread normalized score from custom evaluator primary fields.

        Returns {thread_id: avg_normalized_score} for threads with custom eval data.
        Only numeric and boolean primary fields contribute.
        """
        thread_scores: dict[str, list[float]] = {}

        for eval_id, schema_info in self.evaluator_schemas.items():
            output_schema = schema_info.get("output_schema", [])
            primary_info = find_primary_field(output_schema)
            if not primary_info:
                continue

            primary_key = primary_info["key"]
            primary_type = primary_info.get("type", "text")
            thresholds = primary_info.get("thresholds")

            if primary_type not in ("number", "boolean"):
                continue

            for thread in self.threads:
                result = thread.result or {}
                custom_evals = result.get("custom_evaluations", {})
                eval_data = custom_evals.get(eval_id)
                if not isinstance(eval_data, dict) or eval_data.get("error"):
                    continue

                output = eval_data.get("output", {})
                val = output.get(primary_key)
                if val is None:
                    continue

                score = self._normalize_value(val, primary_type, thresholds)
                if score is not None:
                    thread_scores.setdefault(thread.thread_id, []).append(score)

        # Average across evaluators per thread
        return {
            tid: round(sum(scores) / len(scores), 3)
            for tid, scores in thread_scores.items()
            if scores
        }

    def collect_text_samples(
        self,
        eval_id: str,
        field_keys: list[str],
        k: int = 10,
    ) -> dict[str, list[str]]:
        """Collect text/array field samples for narrative LLM context.

        Args:
            eval_id: evaluator ID to collect from.
            field_keys: list of field keys to sample.
            k: max threads to sample from.

        Returns {field_key: [sample_str, ...]}.
        """
        samples: dict[str, list[str]] = {key: [] for key in field_keys}
        sampled = 0

        for thread in self.threads:
            if sampled >= k:
                break

            result = thread.result or {}
            eval_data = result.get("custom_evaluations", {}).get(eval_id)
            if not isinstance(eval_data, dict) or eval_data.get("error"):
                continue

            output = eval_data.get("output", {})
            found_any = False
            for key in field_keys:
                val = output.get(key)
                if val is None:
                    continue
                found_any = True
                if isinstance(val, list):
                    # Array: join first 5 items
                    items = [str(v)[:300] for v in val[:5]]
                    samples[key].append(", ".join(items))
                else:
                    samples[key].append(str(val)[:300])

            if found_any:
                sampled += 1

        return samples

    # --- Private helpers ---

    @staticmethod
    def _aggregate_field(
        field_def: dict,
        values: list,
    ) -> FieldAggregation | None:
        """Aggregate a single field's values based on its type."""
        field_type = field_def.get("type", "text")
        role = field_def.get("role", "detail")
        is_main_metric = field_def.get("isMainMetric", False)
        display_mode = "header" if is_main_metric else ("card" if role in ("metric", "detail") else "hidden")
        label = field_def.get("description") or field_def.get("key", "")
        key = field_def["key"]

        if not values:
            return FieldAggregation(
                key=key,
                field_type=field_type,
                display_mode=display_mode,
                role=role,
                is_main_metric=is_main_metric,
                label=label,
                sample_count=0,
            )

        if field_type == "number":
            nums = [v for v in values if isinstance(v, (int, float))]
            if not nums:
                return FieldAggregation(
                    key=key, field_type=field_type, display_mode=display_mode,
                    role=role, is_main_metric=is_main_metric,
                    label=label, sample_count=len(values),
                )

            avg = round(sum(nums) / len(nums), 2)
            thresholds = field_def.get("thresholds")
            pass_rates = None
            if thresholds:
                pass_rates = _compute_threshold_pass_rates(nums, thresholds)

            return FieldAggregation(
                key=key,
                field_type=field_type,
                display_mode=display_mode,
                role=role,
                is_main_metric=is_main_metric,
                label=label,
                sample_count=len(nums),
                average=avg,
                threshold_pass_rates=pass_rates,
            )

        if field_type == "boolean":
            bools = [v for v in values if isinstance(v, bool)]
            if not bools:
                return FieldAggregation(
                    key=key, field_type=field_type, display_mode=display_mode,
                    role=role, is_main_metric=is_main_metric,
                    label=label, sample_count=len(values),
                )

            true_count = sum(1 for b in bools if b)
            false_count = len(bools) - true_count
            pass_rate = round(true_count / len(bools), 3) if bools else 0.0

            return FieldAggregation(
                key=key,
                field_type=field_type,
                display_mode=display_mode,
                role=role,
                is_main_metric=is_main_metric,
                label=label,
                sample_count=len(bools),
                pass_rate=pass_rate,
                true_count=true_count,
                false_count=false_count,
            )

        if field_type == "enum":
            dist: dict[str, int] = {}
            for v in values:
                sv = str(v)
                dist[sv] = dist.get(sv, 0) + 1

            return FieldAggregation(
                key=key,
                field_type=field_type,
                display_mode=display_mode,
                role=role,
                is_main_metric=is_main_metric,
                label=label,
                sample_count=len(values),
                distribution=dist,
            )

        # text / array — sample count only (data sent to narrator)
        return FieldAggregation(
            key=key,
            field_type=field_type,
            display_mode=display_mode,
            role=role,
            is_main_metric=is_main_metric,
            label=label,
            sample_count=len(values),
        )

    @staticmethod
    def _normalize_value(
        val: object,
        field_type: str,
        thresholds: dict | None,
    ) -> float | None:
        """Normalize a value to 0-1 for exemplar scoring."""
        if field_type == "boolean":
            return 1.0 if val else 0.0

        if field_type == "number" and isinstance(val, (int, float)):
            if thresholds and thresholds.get("green"):
                green = float(thresholds["green"])
                return min(val / green, 1.0) if green > 0 else 0.5
            if 0 <= val <= 1:
                return float(val)
            if val > 1:
                return min(val / 100, 1.0)  # assume 0-100 scale
            return 0.0

        return None


def _compute_threshold_pass_rates(
    nums: list[float | int],
    thresholds: dict,
) -> ThresholdPassRates | None:
    """Compute green/yellow/red pass rate percentages from threshold config."""
    green_val = thresholds.get("green")
    if green_val is None:
        return None

    green_threshold = float(green_val)
    yellow_val = thresholds.get("yellow")
    yellow_threshold = float(yellow_val) if yellow_val is not None else None

    total = len(nums)
    if total == 0:
        return None

    green_count = sum(1 for n in nums if n >= green_threshold)

    if yellow_threshold is not None:
        yellow_count = sum(1 for n in nums if yellow_threshold <= n < green_threshold)
        red_count = total - green_count - yellow_count
    else:
        yellow_count = 0
        red_count = total - green_count

    return ThresholdPassRates(
        green_pct=round(green_count / total * 100, 1),
        yellow_pct=round(yellow_count / total * 100, 1),
        red_pct=round(red_count / total * 100, 1),
        green_threshold=green_threshold,
        yellow_threshold=yellow_threshold,
    )
