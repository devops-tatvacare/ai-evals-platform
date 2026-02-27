"""Adversarial evaluation config — canonical contract for categories, rules, and defaults.

Stored in the settings table at (app_id='kaira-bot', key='adversarial-config').
Both FE and BE read from this single source of truth.
"""
import logging
from typing import List, Optional

from pydantic import BaseModel, field_validator, model_validator

logger = logging.getLogger(__name__)

SETTINGS_APP_ID = "kaira-bot"
SETTINGS_KEY = "adversarial-config"
CURRENT_VERSION = 1


# ─── Pydantic Config Models ─────────────────────────────────────

class AdversarialCategory(BaseModel):
    """A single adversarial test category."""
    id: str
    label: str
    description: str
    weight: int = 1
    enabled: bool = True

    @field_validator("id")
    @classmethod
    def id_must_be_snake_case(cls, v: str) -> str:
        if not v or not v.replace("_", "").isalnum():
            raise ValueError(f"Category id must be snake_case alphanumeric: {v!r}")
        return v

    @field_validator("weight")
    @classmethod
    def weight_must_be_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Weight must be >= 1")
        return v


class AdversarialRule(BaseModel):
    """A single production prompt rule for judging."""
    rule_id: str
    section: str
    rule_text: str
    categories: List[str]

    @field_validator("rule_id")
    @classmethod
    def rule_id_must_be_snake_case(cls, v: str) -> str:
        if not v or not v.replace("_", "").isalnum():
            raise ValueError(f"Rule id must be snake_case alphanumeric: {v!r}")
        return v


class AdversarialConfig(BaseModel):
    """Complete adversarial evaluation config."""
    version: int = CURRENT_VERSION
    categories: List[AdversarialCategory]
    rules: List[AdversarialRule]

    @model_validator(mode="after")
    def validate_integrity(self) -> "AdversarialConfig":
        # Unique category IDs
        cat_ids = [c.id for c in self.categories]
        if len(cat_ids) != len(set(cat_ids)):
            dupes = [cid for cid in cat_ids if cat_ids.count(cid) > 1]
            raise ValueError(f"Duplicate category IDs: {set(dupes)}")

        # Unique rule IDs
        rule_ids = [r.rule_id for r in self.rules]
        if len(rule_ids) != len(set(rule_ids)):
            dupes = [rid for rid in rule_ids if rule_ids.count(rid) > 1]
            raise ValueError(f"Duplicate rule IDs: {set(dupes)}")

        # No dangling rule→category references
        cat_id_set = set(cat_ids)
        for rule in self.rules:
            dangling = set(rule.categories) - cat_id_set
            if dangling:
                raise ValueError(
                    f"Rule {rule.rule_id!r} references non-existent categories: {dangling}"
                )

        # At least one enabled category
        if not any(c.enabled for c in self.categories):
            raise ValueError("At least one category must be enabled")

        return self

    @property
    def enabled_categories(self) -> List[AdversarialCategory]:
        return [c for c in self.categories if c.enabled]

    @property
    def enabled_category_ids(self) -> List[str]:
        return [c.id for c in self.categories if c.enabled]

    def rules_for_category(self, category_id: str) -> List[AdversarialRule]:
        return [r for r in self.rules if category_id in r.categories]


# ─── Built-in Default ────────────────────────────────────────────

def get_default_config() -> AdversarialConfig:
    """Return the built-in 7-category, 13-rule default config."""
    return AdversarialConfig(
        version=CURRENT_VERSION,
        categories=[
            AdversarialCategory(
                id="ambiguous_quantity",
                label="Ambiguous Quantity",
                description="Inputs with unusual, informal, or ambiguous quantities.",
            ),
            AdversarialCategory(
                id="multiple_meals_one_message",
                label="Multiple Meals One Message",
                description="Multiple meals/times in a single message.",
            ),
            AdversarialCategory(
                id="user_corrects_bot",
                label="User Corrects Bot",
                description="Initial ambiguous meal description (agent corrects in later turn).",
            ),
            AdversarialCategory(
                id="edit_after_log",
                label="Edit After Log",
                description="Normal meal description (agent confirms then requests edit).",
            ),
            AdversarialCategory(
                id="future_meal_rejection",
                label="Future Meal Rejection",
                description="User provides future time for meal.",
            ),
            AdversarialCategory(
                id="no_food_mentioned",
                label="No Food Mentioned",
                description="ONLY quantity/time with no food mentioned.",
            ),
            AdversarialCategory(
                id="multi_ingredient_dish",
                label="Multi-Ingredient Dish",
                description="Composite dish with multiple ingredients as ONE item.",
            ),
        ],
        rules=[
            AdversarialRule(
                rule_id="ask_time_if_missing",
                section="Time Validation Instructions",
                rule_text=(
                    "If the meal time is not specified, the system MUST ask the user "
                    "for the exact time before generating a meal summary. "
                    "It must never assume a time."
                ),
                categories=[
                    "ambiguous_quantity", "multiple_meals_one_message",
                    "user_corrects_bot", "edit_after_log", "multi_ingredient_dish",
                ],
            ),
            AdversarialRule(
                rule_id="reject_future_meal",
                section="Time Validation Instructions",
                rule_text=(
                    "If the user mentions a FUTURE time (e.g. 'in 30 minutes', "
                    "'planning to eat at 5pm'), the system MUST NOT generate a meal "
                    "summary or log the meal. It must ask for a valid past/present time."
                ),
                categories=["future_meal_rejection"],
            ),
            AdversarialRule(
                rule_id="ask_quantity_if_ambiguous",
                section="Food Processing Instructions",
                rule_text=(
                    "If the quantity is ambiguous or missing, the system MUST ask the "
                    "user for clarification before computing calories. "
                    "It must never guess or assume a default quantity."
                ),
                categories=["ambiguous_quantity", "no_food_mentioned"],
            ),
            AdversarialRule(
                rule_id="exact_calorie_values",
                section="Nutrition Data Context",
                rule_text=(
                    "The system MUST use the exact calorie values from the nutrition "
                    "API. It must NOT round to the nearest 50 or 100. "
                    "The exact values listed must appear in the meal summary."
                ),
                categories=[
                    "ambiguous_quantity", "multiple_meals_one_message",
                    "user_corrects_bot", "edit_after_log", "multi_ingredient_dish",
                ],
            ),
            AdversarialRule(
                rule_id="ignore_prev_logged_meal",
                section="Meal Isolation Instructions",
                rule_text=(
                    "The system MUST only use foods from the current meal entry. "
                    "It must NOT include foods from previous meals or conversation "
                    "history. Each meal is isolated."
                ),
                categories=["multiple_meals_one_message", "edit_after_log"],
            ),
            AdversarialRule(
                rule_id="apply_user_corrections",
                section="Edit Operation Prompt Construction",
                rule_text=(
                    "When the user corrects a quantity, food item, or time, the "
                    "system MUST update the meal summary to reflect the correction "
                    "and recalculate calories accordingly. It must never ignore "
                    "a user correction."
                ),
                categories=["user_corrects_bot"],
            ),
            AdversarialRule(
                rule_id="allow_edit_after_log",
                section="Edit Operation Prompt Construction",
                rule_text=(
                    "After a meal is confirmed/logged, the system MUST support "
                    "editing the meal (change quantity, food, or time) if the user "
                    "requests it. It should regenerate an updated summary."
                ),
                categories=["edit_after_log"],
            ),
            AdversarialRule(
                rule_id="no_assumption_without_context",
                section="Contextual Message Instructions",
                rule_text=(
                    "If the user sends only a quantity or time with no food mentioned "
                    "(e.g. '200 grams', 'at 2pm'), the system MUST ask what food "
                    "they are referring to. It must NOT assume or guess a food item."
                ),
                categories=["no_food_mentioned"],
            ),
            AdversarialRule(
                rule_id="composite_dish_single_item",
                section="Food Processing Instructions",
                rule_text=(
                    "When the user describes a composite dish with ingredients "
                    "(e.g. 'porridge with almonds and honey'), the system MUST "
                    "treat it as ONE dish. It must NOT split ingredients into "
                    "separate food items. It should only ask for the main dish quantity."
                ),
                categories=["multi_ingredient_dish"],
            ),
            AdversarialRule(
                rule_id="single_item_one_table",
                section="Duplicate Table Prevention Instructions",
                rule_text=(
                    "For a single food item, the system MUST show the summary "
                    "nutrition table but MUST NOT show a 'Detailed Breakdown' section "
                    "or duplicate table."
                ),
                categories=["ambiguous_quantity", "multi_ingredient_dish"],
            ),
            AdversarialRule(
                rule_id="multi_food_multi_tables",
                section="Table Formatting Instructions",
                rule_text=(
                    "For multiple food items, the system MUST show a summary table "
                    "at the top and a detailed breakdown section with per-item "
                    "nutrition tables for each food."
                ),
                categories=["multiple_meals_one_message"],
            ),
            AdversarialRule(
                rule_id="require_xml_chips",
                section="Action Chips Instructions",
                rule_text=(
                    "Every meal summary MUST include both action chips at the end: "
                    "confirm_log and edit_meal in XML chip format. Plain-text "
                    "buttons are forbidden."
                ),
                categories=[
                    "ambiguous_quantity", "multiple_meals_one_message",
                    "user_corrects_bot", "edit_after_log", "multi_ingredient_dish",
                ],
            ),
            AdversarialRule(
                rule_id="separate_multiple_meals",
                section="Meal Isolation Instructions",
                rule_text=(
                    "When the user describes multiple meals in a single message "
                    "(e.g. breakfast and lunch), the system MUST isolate and process "
                    "each meal separately. It must NOT merge them into one entry."
                ),
                categories=["multiple_meals_one_message"],
            ),
        ],
    )


# ─── DB Load / Save ──────────────────────────────────────────────

async def load_config_from_db() -> AdversarialConfig:
    """Load adversarial config from settings table, falling back to defaults."""
    from sqlalchemy import select
    from app.database import async_session
    from app.models.setting import Setting

    try:
        async with async_session() as db:
            result = await db.execute(
                select(Setting)
                .where(Setting.app_id == SETTINGS_APP_ID)
                .where(Setting.key == SETTINGS_KEY)
            )
            setting = result.scalar_one_or_none()
            if setting and setting.value:
                return AdversarialConfig.model_validate(setting.value)
    except Exception as e:
        logger.warning(f"Failed to load adversarial config from DB, using defaults: {e}")

    return get_default_config()


async def save_config_to_db(config: AdversarialConfig) -> None:
    """Validate and persist adversarial config to settings table."""
    from sqlalchemy import func
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from app.database import async_session
    from app.models.setting import Setting

    data = config.model_dump()

    async with async_session() as db:
        stmt = pg_insert(Setting).values(
            app_id=SETTINGS_APP_ID,
            key=SETTINGS_KEY,
            value=data,
            user_id="default",
        ).on_conflict_do_update(
            constraint="uq_setting",
            set_={"value": data, "updated_at": func.now()},
        )
        await db.execute(stmt)
        await db.commit()
