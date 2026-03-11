"""Adversarial evaluation config — canonical contract for goals, traits, rules, and defaults.

Stored in the settings table at (app_id='kaira-bot', key='adversarial-config').
Both FE and BE read from this single source of truth.

v1 → v2 migration: Goals added, categories gain goal_ids.
v2 → v3 migration: Categories renamed to Traits (drop weight, drop goal_ids).
                    Rules: categories replaced by goal_ids.
                    Traits are independent — no goal/rule mapping.
"""

import logging
from typing import List, Optional

from pydantic import BaseModel, field_validator, model_validator

logger = logging.getLogger(__name__)

SETTINGS_APP_ID = "kaira-bot"
SETTINGS_KEY = "adversarial-config"
CURRENT_VERSION = 3


# ─── Pydantic Config Models ─────────────────────────────────────


class AdversarialGoal(BaseModel):
    """A single adversarial goal — defines what the agent is trying to achieve."""

    id: str  # "meal_logged", "question_answered", "cgm_insight"
    label: str  # "Meal Logging"
    description: str  # What this goal tests
    completion_criteria: List[str]  # Positive signals fed to agent + judge
    not_completion: List[str]  # Anti-signals ("this is NOT done yet")
    agent_behavior: str  # Goal-specific instruction block for conversation agent
    signal_patterns: List[
        str
    ]  # Lightweight text patterns for annotation only (not stopping)
    enabled: bool = True

    @field_validator("id")
    @classmethod
    def id_must_be_snake_case(cls, v: str) -> str:
        if not v or not v.replace("_", "").isalnum():
            raise ValueError(f"Goal id must be snake_case alphanumeric: {v!r}")
        return v


class AdversarialTrait(BaseModel):
    """A persona trait applied to adversarial test cases (renamed from Category in v3).

    Traits describe HOW the simulated user behaves (e.g. gives ambiguous quantities,
    corrects the bot). They are independent — no mapping to goals or rules.
    """

    id: str
    label: str
    description: str
    enabled: bool = True

    @field_validator("id")
    @classmethod
    def id_must_be_snake_case(cls, v: str) -> str:
        if not v or not v.replace("_", "").isalnum():
            raise ValueError(f"Trait id must be snake_case alphanumeric: {v!r}")
        return v


class AdversarialRule(BaseModel):
    """A single production prompt rule for judging."""

    rule_id: str
    section: str
    rule_text: str
    goal_ids: List[str]  # which goals exercise this rule

    @field_validator("rule_id")
    @classmethod
    def rule_id_must_be_snake_case(cls, v: str) -> str:
        if not v or not v.replace("_", "").isalnum():
            raise ValueError(f"Rule id must be snake_case alphanumeric: {v!r}")
        return v


class AdversarialConfig(BaseModel):
    """Complete adversarial evaluation config (v3)."""

    version: int = CURRENT_VERSION
    goals: List[AdversarialGoal] = []
    traits: List[AdversarialTrait] = []
    rules: List[AdversarialRule] = []

    @model_validator(mode="after")
    def validate_integrity(self) -> "AdversarialConfig":
        # Unique goal IDs
        goal_ids = [g.id for g in self.goals]
        if len(goal_ids) != len(set(goal_ids)):
            dupes = [gid for gid in goal_ids if goal_ids.count(gid) > 1]
            raise ValueError(f"Duplicate goal IDs: {set(dupes)}")

        goal_id_set = set(goal_ids)

        # At least one enabled goal (only enforced when goals are present)
        if self.goals and not any(g.enabled for g in self.goals):
            raise ValueError("At least one goal must be enabled")

        # Unique trait IDs
        trait_ids = [t.id for t in self.traits]
        if len(trait_ids) != len(set(trait_ids)):
            dupes = [tid for tid in trait_ids if trait_ids.count(tid) > 1]
            raise ValueError(f"Duplicate trait IDs: {set(dupes)}")

        # At least one enabled trait
        if self.traits and not any(t.enabled for t in self.traits):
            raise ValueError("At least one trait must be enabled")

        # Unique rule IDs
        rule_ids = [r.rule_id for r in self.rules]
        if len(rule_ids) != len(set(rule_ids)):
            dupes = [rid for rid in rule_ids if rule_ids.count(rid) > 1]
            raise ValueError(f"Duplicate rule IDs: {set(dupes)}")

        # No dangling rule→goal references
        for rule in self.rules:
            dangling = set(rule.goal_ids) - goal_id_set
            if dangling:
                raise ValueError(
                    f"Rule {rule.rule_id!r} references non-existent goals: {dangling}"
                )

        return self

    # ── Goal helpers ──

    @property
    def enabled_goals(self) -> List[AdversarialGoal]:
        return [g for g in self.goals if g.enabled]

    @property
    def enabled_goal_ids(self) -> List[str]:
        return [g.id for g in self.goals if g.enabled]

    def goal_by_id(self, goal_id: str) -> Optional[AdversarialGoal]:
        return next((g for g in self.goals if g.id == goal_id), None)

    # ── Trait helpers ──

    @property
    def enabled_traits(self) -> List[AdversarialTrait]:
        return [t for t in self.traits if t.enabled]

    @property
    def enabled_trait_ids(self) -> List[str]:
        return [t.id for t in self.traits if t.enabled]

    # ── Rule helpers ──

    def rules_for_goals(self, goal_ids: List[str]) -> List[AdversarialRule]:
        """Return rules relevant to any of the given goal IDs (union)."""
        goal_set = set(goal_ids)
        return [r for r in self.rules if goal_set & set(r.goal_ids)]


# ─── Built-in Default ────────────────────────────────────────────


def get_default_config() -> AdversarialConfig:
    """Return the built-in 3-goal, 7-trait, 13-rule default v3 config."""
    return AdversarialConfig(
        version=3,
        goals=[
            AdversarialGoal(
                id="meal_logged",
                label="Meal Logging",
                description=(
                    "User describes a meal and Kaira processes it through the "
                    "full logging pipeline: clarification, summary, confirmation, "
                    "and explicit log confirmation."
                ),
                completion_criteria=[
                    "Bot explicitly confirms the meal has been saved/logged to the diary",
                    "Response contains phrases like 'successfully logged', 'meal has been logged', 'saved to your diary'",
                    "The bot's agent_response indicates success after a meal-logging operation",
                ],
                not_completion=[
                    "Bot showing a meal summary with confirm/edit action chips is NOT completion — it is asking for user confirmation",
                    "Bot asking clarification questions about time, quantity, or food items",
                    "Bot presenting calorie calculations without explicit log confirmation",
                ],
                agent_behavior=(
                    "Drive the conversation until the bot explicitly confirms the meal "
                    "is logged. Answer all clarification questions about time, quantity, "
                    "and food items. When shown a meal summary with confirm/edit options, "
                    "confirm it (unless your traits require corrections/edits). Do NOT "
                    "say GOAL_COMPLETE until you see explicit log confirmation from the bot."
                ),
                signal_patterns=[
                    "successfully logged",
                    "meal has been logged",
                    "logged your meal",
                    "saved to your diary",
                    "meal logged successfully",
                ],
            ),
            AdversarialGoal(
                id="question_answered",
                label="Food QnA (FoodInsight)",
                description=(
                    "User asks a food or nutrition question and Kaira provides "
                    "a substantive, accurate answer that the user acknowledges."
                ),
                completion_criteria=[
                    "Bot provides a detailed, substantive answer about food or nutrition (not a clarification question)",
                    "The answer is relevant to the user's original question",
                    "User has acknowledged receiving the answer",
                ],
                not_completion=[
                    "Bot asking clarification about the question is NOT completion",
                    "Bot giving a brief or partial response before a full answer",
                    "Short responses under 50 characters are likely clarifications, not answers",
                ],
                agent_behavior=(
                    "Ask your food/nutrition question clearly. If the bot asks for "
                    "clarification, provide it. Wait for a full, substantive answer. "
                    "Once you receive a thorough answer, acknowledge it naturally "
                    "(e.g., 'thanks, that helps') and then say GOAL_COMPLETE."
                ),
                signal_patterns=[
                    "hope this helps",
                    "let me know if you have",
                    "here's what i found",
                    "based on nutritional data",
                ],
            ),
            AdversarialGoal(
                id="cgm_insight",
                label="CGM Insights",
                description=(
                    "User asks about their CGM (continuous glucose monitor) data "
                    "and Kaira queries the user's CGM data, presents insights in "
                    "table format, and explains what is happening."
                ),
                completion_criteria=[
                    "Bot presents CGM data insights in a structured format (table)",
                    "Bot explains the glucose patterns or trends observed",
                    "User has acknowledged the insights",
                ],
                not_completion=[
                    "Bot asking which time period or data range is NOT completion",
                    "Bot confirming it will look up CGM data is NOT completion",
                ],
                agent_behavior=(
                    "Ask about your glucose/CGM data. If the bot asks for time "
                    "range or specifics, provide them. Wait for the bot to present "
                    "data insights with explanation. Acknowledge the insights, then "
                    "say GOAL_COMPLETE."
                ),
                signal_patterns=[
                    "glucose levels",
                    "cgm data",
                    "blood sugar",
                    "spike",
                    "glucose trend",
                ],
                enabled=False,  # placeholder — enable when CGM feature ships
            ),
        ],
        traits=[
            AdversarialTrait(
                id="ambiguous_quantity",
                label="Ambiguous Quantity",
                description="User gives vague, informal, or ambiguous quantities (e.g. 'some', 'a bit', 'a plate').",
            ),
            AdversarialTrait(
                id="multiple_meals_one_message",
                label="Multiple Meals One Message",
                description="User describes multiple meals or meal times in a single message.",
            ),
            AdversarialTrait(
                id="user_corrects_bot",
                label="User Corrects Bot",
                description="User corrects the bot after it interprets something wrong (quantity, food item, or time).",
            ),
            AdversarialTrait(
                id="edit_after_log",
                label="Edit After Log",
                description="User cooperates fully, confirms the meal, then requests an edit afterward.",
            ),
            AdversarialTrait(
                id="future_meal_rejection",
                label="Future Meal Rejection",
                description="User provides a future time for a meal (e.g. 'in 30 minutes', 'planning to eat at 5pm').",
            ),
            AdversarialTrait(
                id="no_food_mentioned",
                label="No Food Mentioned",
                description="User sends ONLY quantity or time with no food item mentioned.",
            ),
            AdversarialTrait(
                id="multi_ingredient_dish",
                label="Multi-Ingredient Dish",
                description="User describes a composite dish with multiple ingredients as one item (e.g. 'porridge with almonds and honey').",
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
                goal_ids=["meal_logged"],
            ),
            AdversarialRule(
                rule_id="reject_future_meal",
                section="Time Validation Instructions",
                rule_text=(
                    "If the user mentions a FUTURE time (e.g. 'in 30 minutes', "
                    "'planning to eat at 5pm'), the system MUST NOT generate a meal "
                    "summary or log the meal. It must ask for a valid past/present time."
                ),
                goal_ids=["meal_logged"],
            ),
            AdversarialRule(
                rule_id="ask_quantity_if_ambiguous",
                section="Food Processing Instructions",
                rule_text=(
                    "If the quantity is ambiguous or missing, the system MUST ask the "
                    "user for clarification before computing calories. "
                    "It must never guess or assume a default quantity."
                ),
                goal_ids=["meal_logged"],
            ),
            AdversarialRule(
                rule_id="exact_calorie_values",
                section="Nutrition Data Context",
                rule_text=(
                    "The system MUST use the exact calorie values from the nutrition "
                    "API. It must NOT round to the nearest 50 or 100. "
                    "The exact values listed must appear in the meal summary."
                ),
                goal_ids=["meal_logged"],
            ),
            AdversarialRule(
                rule_id="ignore_prev_logged_meal",
                section="Meal Isolation Instructions",
                rule_text=(
                    "The system MUST only use foods from the current meal entry. "
                    "It must NOT include foods from previous meals or conversation "
                    "history. Each meal is isolated."
                ),
                goal_ids=["meal_logged"],
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
                goal_ids=["meal_logged"],
            ),
            AdversarialRule(
                rule_id="allow_edit_after_log",
                section="Edit Operation Prompt Construction",
                rule_text=(
                    "After a meal is confirmed/logged, the system MUST support "
                    "editing the meal (change quantity, food, or time) if the user "
                    "requests it. It should regenerate an updated summary."
                ),
                goal_ids=["meal_logged"],
            ),
            AdversarialRule(
                rule_id="no_assumption_without_context",
                section="Contextual Message Instructions",
                rule_text=(
                    "If the user sends only a quantity or time with no food mentioned "
                    "(e.g. '200 grams', 'at 2pm'), the system MUST ask what food "
                    "they are referring to. It must NOT assume or guess a food item."
                ),
                goal_ids=["meal_logged"],
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
                goal_ids=["meal_logged"],
            ),
            AdversarialRule(
                rule_id="single_item_one_table",
                section="Duplicate Table Prevention Instructions",
                rule_text=(
                    "For a single food item, the system MUST show the summary "
                    "nutrition table but MUST NOT show a 'Detailed Breakdown' section "
                    "or duplicate table."
                ),
                goal_ids=["meal_logged"],
            ),
            AdversarialRule(
                rule_id="multi_food_multi_tables",
                section="Table Formatting Instructions",
                rule_text=(
                    "For multiple food items, the system MUST show a summary table "
                    "at the top and a detailed breakdown section with per-item "
                    "nutrition tables for each food."
                ),
                goal_ids=["meal_logged"],
            ),
            AdversarialRule(
                rule_id="require_xml_chips",
                section="Action Chips Instructions",
                rule_text=(
                    "Every meal summary MUST include both action chips at the end: "
                    "confirm_log and edit_meal in XML chip format. Plain-text "
                    "buttons are forbidden."
                ),
                goal_ids=["meal_logged"],
            ),
            AdversarialRule(
                rule_id="separate_multiple_meals",
                section="Meal Isolation Instructions",
                rule_text=(
                    "When the user describes multiple meals in a single message "
                    "(e.g. breakfast and lunch), the system MUST isolate and process "
                    "each meal separately. It must NOT merge them into one entry."
                ),
                goal_ids=["meal_logged"],
            ),
        ],
    )


# ─── v2 → v3 Migration ───────────────────────────────────────────


def _migrate_v2_to_v3(raw: dict) -> dict:
    """Migrate raw v2 config dict to v3 structure before Pydantic validation.

    - categories → traits (drop weight, drop goal_ids)
    - rule.categories → rule.goal_ids (derived via category→goal_ids lookup)
    - Inject default goals if missing
    """
    default = get_default_config()

    # Build category→goal_ids lookup from v2 categories
    cat_goal_map: dict[str, list[str]] = {}
    for cat in raw.get("categories", []):
        cat_goal_map[cat.get("id", "")] = cat.get("goal_ids", ["meal_logged"])

    # Convert categories → traits
    traits = []
    for cat in raw.get("categories", []):
        traits.append({
            "id": cat.get("id", ""),
            "label": cat.get("label", ""),
            "description": cat.get("description", ""),
            "enabled": cat.get("enabled", True),
        })

    # Convert rule.categories → rule.goal_ids
    rules = []
    all_enabled_goal_ids = [g.id for g in default.goals if g.enabled]
    for rule in raw.get("rules", []):
        old_cats = rule.get("categories", [])
        # Derive goal_ids: union of goal_ids from all referenced categories
        derived_goal_ids: set[str] = set()
        for cat_id in old_cats:
            derived_goal_ids.update(cat_goal_map.get(cat_id, []))
        # If empty, default to all enabled goals (universal rule)
        if not derived_goal_ids:
            derived_goal_ids = set(all_enabled_goal_ids)
        rules.append({
            "rule_id": rule.get("rule_id", ""),
            "section": rule.get("section", ""),
            "rule_text": rule.get("rule_text", ""),
            "goal_ids": sorted(derived_goal_ids),
        })

    # Preserve goals from v2, or use defaults
    goals_raw = raw.get("goals", [])
    if not goals_raw:
        goals_raw = [g.model_dump() for g in default.goals]

    return {
        "version": 3,
        "goals": goals_raw,
        "traits": traits,
        "rules": rules,
    }


# ─── DB Load / Save ──────────────────────────────────────────────


async def load_config_from_db() -> AdversarialConfig:
    """Load adversarial config from settings table, auto-migrating v1/v2→v3."""
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
                raw = setting.value
                version = raw.get("version", 1) if isinstance(raw, dict) else 1
                if version < 3:
                    logger.info(f"Migrating adversarial config v{version} → v3")
                    raw = _migrate_v2_to_v3(raw)
                config = AdversarialConfig.model_validate(raw)
                if version < 3:
                    await save_config_to_db(config)  # persist migration
                return config
    except Exception as e:
        logger.warning(
            f"Failed to load adversarial config from DB, using defaults: {e}"
        )

    return get_default_config()


async def save_config_to_db(config: AdversarialConfig) -> None:
    """Validate and persist adversarial config to settings table."""
    from sqlalchemy import func
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from app.database import async_session
    from app.models.setting import Setting

    data = config.model_dump()

    async with async_session() as db:
        stmt = (
            pg_insert(Setting)
            .values(
                app_id=SETTINGS_APP_ID,
                key=SETTINGS_KEY,
                value=data,
                user_id="default",
            )
            .on_conflict_do_update(
                constraint="uq_setting",
                set_={"value": data, "updated_at": func.now()},
            )
        )
        await db.execute(stmt)
        await db.commit()
