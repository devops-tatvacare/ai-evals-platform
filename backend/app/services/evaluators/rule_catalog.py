"""Production prompt rule catalog for adversarial evaluation.

Ported from kaira-evals/src/data/rule_catalog.py.
"""
import re
from dataclasses import dataclass
from typing import List


def normalize_rule_id(raw: str) -> str:
    """Strip number prefix and markdown bold from LLM-returned rule_id.

    LLMs copy formatting from the prompt, e.g. "1. **ask_time_if_missing**"
    instead of just "ask_time_if_missing".
    """
    cleaned = raw.strip()
    cleaned = re.sub(r'^\d+\.\s*', '', cleaned)  # strip "1. " prefix
    cleaned = cleaned.strip('*')                   # strip markdown bold
    return cleaned


@dataclass(frozen=True)
class PromptRule:
    rule_id: str
    section: str
    rule_text: str
    goal_ids: List[str]


# Default rules — used by get_default_config() in adversarial_config.py.
# All 13 current rules apply to meal_logged only.
_DEFAULT_RULES: List[PromptRule] = [
    PromptRule(
        rule_id="ask_time_if_missing",
        section="Time Validation Instructions",
        rule_text=(
            "If the meal time is not specified, the system MUST ask the user "
            "for the exact time before generating a meal summary. "
            "It must never assume a time."
        ),
        goal_ids=["meal_logged"],
    ),
    PromptRule(
        rule_id="reject_future_meal",
        section="Time Validation Instructions",
        rule_text=(
            "If the user mentions a FUTURE time (e.g. 'in 30 minutes', "
            "'planning to eat at 5pm'), the system MUST NOT generate a meal "
            "summary or log the meal. It must ask for a valid past/present time."
        ),
        goal_ids=["meal_logged"],
    ),
    PromptRule(
        rule_id="ask_quantity_if_ambiguous",
        section="Food Processing Instructions",
        rule_text=(
            "If the quantity is ambiguous or missing, the system MUST ask the "
            "user for clarification before computing calories. "
            "It must never guess or assume a default quantity."
        ),
        goal_ids=["meal_logged"],
    ),
    PromptRule(
        rule_id="exact_calorie_values",
        section="Nutrition Data Context",
        rule_text=(
            "The system MUST use the exact calorie values from the nutrition "
            "API. It must NOT round to the nearest 50 or 100. "
            "The exact values listed must appear in the meal summary."
        ),
        goal_ids=["meal_logged"],
    ),
    PromptRule(
        rule_id="ignore_prev_logged_meal",
        section="Meal Isolation Instructions",
        rule_text=(
            "The system MUST only use foods from the current meal entry. "
            "It must NOT include foods from previous meals or conversation "
            "history. Each meal is isolated."
        ),
        goal_ids=["meal_logged"],
    ),
    PromptRule(
        rule_id="apply_user_corrections",
        section="Edit Operation Prompt Construction",
        rule_text=(
            "When the user corrects a quantity, food item, or time, the "
            "system MUST update the meal summary to reflect the correction "
            "and recalculate calories accordingly. It must never ignore "
            "a user correction."
        ),
        goal_ids=["meal_logged"],
    ),
    PromptRule(
        rule_id="allow_edit_after_log",
        section="Edit Operation Prompt Construction",
        rule_text=(
            "After a meal is confirmed/logged, the system MUST support "
            "editing the meal (change quantity, food, or time) if the user "
            "requests it. It should regenerate an updated summary."
        ),
        goal_ids=["meal_logged"],
    ),
    PromptRule(
        rule_id="no_assumption_without_context",
        section="Contextual Message Instructions",
        rule_text=(
            "If the user sends only a quantity or time with no food mentioned "
            "(e.g. '200 grams', 'at 2pm'), the system MUST ask what food "
            "they are referring to. It must NOT assume or guess a food item."
        ),
        goal_ids=["meal_logged"],
    ),
    PromptRule(
        rule_id="composite_dish_single_item",
        section="Food Processing Instructions",
        rule_text=(
            "When the user describes a composite dish with ingredients "
            "(e.g. 'porridge with almonds and honey'), the system MUST "
            "treat it as ONE dish. It must NOT split ingredients into "
            "separate food items. It should only ask for the main dish quantity."
        ),
        goal_ids=["meal_logged"],
    ),
    PromptRule(
        rule_id="single_item_one_table",
        section="Duplicate Table Prevention Instructions",
        rule_text=(
            "For a single food item, the system MUST show the summary "
            "nutrition table but MUST NOT show a 'Detailed Breakdown' section "
            "or duplicate table."
        ),
        goal_ids=["meal_logged"],
    ),
    PromptRule(
        rule_id="multi_food_multi_tables",
        section="Table Formatting Instructions",
        rule_text=(
            "For multiple food items, the system MUST show a summary table "
            "at the top and a detailed breakdown section with per-item "
            "nutrition tables for each food."
        ),
        goal_ids=["meal_logged"],
    ),
    PromptRule(
        rule_id="require_xml_chips",
        section="Action Chips Instructions",
        rule_text=(
            "Every meal summary MUST include both action chips at the end: "
            "confirm_log and edit_meal in XML chip format. Plain-text "
            "buttons are forbidden."
        ),
        goal_ids=["meal_logged"],
    ),
    PromptRule(
        rule_id="separate_multiple_meals",
        section="Meal Isolation Instructions",
        rule_text=(
            "When the user describes multiple meals in a single message "
            "(e.g. breakfast and lunch), the system MUST isolate and process "
            "each meal separately. It must NOT merge them into one entry."
        ),
        goal_ids=["meal_logged"],
    ),
]


# Backward compat alias
RULES = _DEFAULT_RULES

# ─── Correctness rules ──────────────────────────────────────────
_CORRECTNESS_RULE_IDS = {
    "exact_calorie_values", "single_item_one_table",
    "multi_food_multi_tables", "require_xml_chips",
    "composite_dish_single_item",
}

# ─── Efficiency rules ───────────────────────────────────────────
_EFFICIENCY_RULE_IDS = {
    "ask_time_if_missing", "reject_future_meal",
    "ask_quantity_if_ambiguous",
    "apply_user_corrections", "ignore_prev_logged_meal",
    "no_assumption_without_context", "allow_edit_after_log",
    "separate_multiple_meals",
}


def get_rules_for_goals(goal_ids: List[str], rules: List[PromptRule] | None = None) -> List[PromptRule]:
    """Return rules whose goal_ids overlap with the given goal IDs (union)."""
    source = rules if rules is not None else _DEFAULT_RULES
    goal_set = set(goal_ids)
    return [r for r in source if goal_set & set(r.goal_ids)]


def get_rules_for_correctness(rules: List[PromptRule] | None = None) -> List[PromptRule]:
    source = rules if rules is not None else _DEFAULT_RULES
    return [r for r in source if r.rule_id in _CORRECTNESS_RULE_IDS]


def get_rules_for_efficiency(rules: List[PromptRule] | None = None) -> List[PromptRule]:
    source = rules if rules is not None else _DEFAULT_RULES
    return [r for r in source if r.rule_id in _EFFICIENCY_RULE_IDS]
