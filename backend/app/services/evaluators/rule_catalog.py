"""Production prompt rule catalog for adversarial evaluation.

Ported from kaira-evals/src/data/rule_catalog.py.
"""
from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class PromptRule:
    rule_id: str
    section: str
    rule_text: str
    categories: List[str]


# Default categories — used by get_default_config() in adversarial_config.py.
# New code should use the config-driven categories instead.
_DEFAULT_CATEGORIES = [
    "quantity_ambiguity",
    "multi_meal_single_message",
    "correction_contradiction",
    "edit_after_confirmation",
    "future_time_rejection",
    "contextual_without_context",
    "composite_dish",
]

# Backward compat alias
ALL_CATEGORIES = _DEFAULT_CATEGORIES

# Default rules — used by get_default_config() in adversarial_config.py.
# New code should use config-driven rules instead.
_DEFAULT_RULES: List[PromptRule] = [
    PromptRule(
        rule_id="ask_time_if_missing",
        section="Time Validation Instructions",
        rule_text=(
            "If the meal time is not specified, the system MUST ask the user "
            "for the exact time before generating a meal summary. "
            "It must never assume a time."
        ),
        categories=[
            "quantity_ambiguity", "multi_meal_single_message",
            "correction_contradiction", "edit_after_confirmation", "composite_dish",
        ],
    ),
    PromptRule(
        rule_id="reject_future_time",
        section="Time Validation Instructions",
        rule_text=(
            "If the user mentions a FUTURE time (e.g. 'in 30 minutes', "
            "'planning to eat at 5pm'), the system MUST NOT generate a meal "
            "summary or log the meal. It must ask for a valid past/present time."
        ),
        categories=["future_time_rejection"],
    ),
    PromptRule(
        rule_id="ask_quantity_if_ambiguous",
        section="Food Processing Instructions",
        rule_text=(
            "If the quantity is ambiguous or missing, the system MUST ask the "
            "user for clarification before computing calories. "
            "It must never guess or assume a default quantity."
        ),
        categories=["quantity_ambiguity", "contextual_without_context"],
    ),
    PromptRule(
        rule_id="exact_calorie_values",
        section="Nutrition Data Context",
        rule_text=(
            "The system MUST use the exact calorie values from the nutrition "
            "API. It must NOT round to the nearest 50 or 100. "
            "The exact values listed must appear in the meal summary."
        ),
        categories=[
            "quantity_ambiguity", "multi_meal_single_message",
            "correction_contradiction", "edit_after_confirmation", "composite_dish",
        ],
    ),
    PromptRule(
        rule_id="meal_isolation",
        section="Meal Isolation Instructions",
        rule_text=(
            "The system MUST only use foods from the current meal entry. "
            "It must NOT include foods from previous meals or conversation "
            "history. Each meal is isolated."
        ),
        categories=["multi_meal_single_message", "edit_after_confirmation"],
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
        categories=["correction_contradiction"],
    ),
    PromptRule(
        rule_id="support_post_confirmation_edit",
        section="Edit Operation Prompt Construction",
        rule_text=(
            "After a meal is confirmed/logged, the system MUST support "
            "editing the meal (change quantity, food, or time) if the user "
            "requests it. It should regenerate an updated summary."
        ),
        categories=["edit_after_confirmation"],
    ),
    PromptRule(
        rule_id="no_assume_without_context",
        section="Contextual Message Instructions",
        rule_text=(
            "If the user sends only a quantity or time with no food mentioned "
            "(e.g. '200 grams', 'at 2pm'), the system MUST ask what food "
            "they are referring to. It must NOT assume or guess a food item."
        ),
        categories=["contextual_without_context"],
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
        categories=["composite_dish"],
    ),
    PromptRule(
        rule_id="single_food_no_breakdown",
        section="Duplicate Table Prevention Instructions",
        rule_text=(
            "For a single food item, the system MUST show the summary "
            "nutrition table but MUST NOT show a 'Detailed Breakdown' section "
            "or duplicate table."
        ),
        categories=["quantity_ambiguity", "composite_dish"],
    ),
    PromptRule(
        rule_id="multi_food_per_item_tables",
        section="Table Formatting Instructions",
        rule_text=(
            "For multiple food items, the system MUST show a summary table "
            "at the top and a detailed breakdown section with per-item "
            "nutrition tables for each food."
        ),
        categories=["multi_meal_single_message"],
    ),
    PromptRule(
        rule_id="action_chips_present",
        section="Action Chips Instructions",
        rule_text=(
            "Every meal summary MUST include both action chips at the end: "
            "confirm_log and edit_meal in XML chip format. Plain-text "
            "buttons are forbidden."
        ),
        categories=[
            "quantity_ambiguity", "multi_meal_single_message",
            "correction_contradiction", "edit_after_confirmation", "composite_dish",
        ],
    ),
    PromptRule(
        rule_id="separate_multiple_meals",
        section="Meal Isolation Instructions",
        rule_text=(
            "When the user describes multiple meals in a single message "
            "(e.g. breakfast and lunch), the system MUST isolate and process "
            "each meal separately. It must NOT merge them into one entry."
        ),
        categories=["multi_meal_single_message"],
    ),
]


# Backward compat alias
RULES = _DEFAULT_RULES

# ─── Correctness rules ──────────────────────────────────────────
_CORRECTNESS_RULE_IDS = {
    "exact_calorie_values", "single_food_no_breakdown",
    "multi_food_per_item_tables", "action_chips_present",
    "composite_dish_single_item",
}

# ─── Efficiency rules ───────────────────────────────────────────
_EFFICIENCY_RULE_IDS = {
    "ask_time_if_missing", "ask_quantity_if_ambiguous",
    "apply_user_corrections", "meal_isolation",
    "no_assume_without_context", "support_post_confirmation_edit",
    "separate_multiple_meals",
}


def get_rules_for_category(category: str, rules: List[PromptRule] | None = None) -> List[PromptRule]:
    source = rules if rules is not None else _DEFAULT_RULES
    return [r for r in source if category in r.categories]


def get_rules_for_correctness(rules: List[PromptRule] | None = None) -> List[PromptRule]:
    source = rules if rules is not None else _DEFAULT_RULES
    return [r for r in source if r.rule_id in _CORRECTNESS_RULE_IDS]


def get_rules_for_efficiency(rules: List[PromptRule] | None = None) -> List[PromptRule]:
    source = rules if rules is not None else _DEFAULT_RULES
    return [r for r in source if r.rule_id in _EFFICIENCY_RULE_IDS]
