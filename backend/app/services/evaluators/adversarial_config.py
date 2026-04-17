"""Adversarial evaluation config — canonical contract for goals, traits, rules, and defaults.

Stored in the settings table at (app_id='kaira-bot', key='adversarial-config').
Both FE and BE read from this single source of truth.

v1 → v2 migration: Goals added, categories gain goal_ids.
v2 → v3 migration: Categories renamed to Traits (drop weight, drop goal_ids).
                    Rules: categories replaced by goal_ids.
                    Traits are independent — no goal/rule mapping.
v3 → v4 migration: Rules gain explicit evaluation_scopes so batch built-ins and
                    adversarial flows can share the same contract source.
v4 → v5 migration: Rule coverage is backfilled for question answering and
                    cross-goal conversation-state checks.
v5 → v6 migration: Anti-mirroring rule is backfilled.
v6 → v7 migration: Remove persona-only labels such as crack from the trait catalog.
"""

import logging
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.evaluators.rule_catalog import (
    ALL_EVALUATION_SCOPES,
    RULES,
    default_evaluation_scopes_for_rule,
    PromptRule,
)
from app.services.settings_upsert import build_setting_upsert_stmt

logger = logging.getLogger(__name__)

SETTINGS_APP_ID = "kaira-bot"
SETTINGS_KEY = "adversarial-config"
CURRENT_VERSION = 7
PERSONA_ONLY_TRAIT_IDS = {"crack"}


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
    behavior_hint: Optional[str] = None
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
    evaluation_scopes: List[str] = Field(default_factory=list)
    enabled: bool = True

    @field_validator("rule_id")
    @classmethod
    def rule_id_must_be_snake_case(cls, v: str) -> str:
        if not v or not v.replace("_", "").isalnum():
            raise ValueError(f"Rule id must be snake_case alphanumeric: {v!r}")
        return v

    @field_validator("evaluation_scopes", mode="before")
    @classmethod
    def normalize_evaluation_scopes(cls, value: List[str] | None) -> List[str]:
        if not value:
            return []
        normalized: list[str] = []
        for item in value:
            scope = str(item).strip().lower()
            if scope and scope not in normalized:
                normalized.append(scope)
        return normalized


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
        reserved_trait_ids = sorted(set(trait_ids) & PERSONA_ONLY_TRAIT_IDS)
        if reserved_trait_ids:
            raise ValueError(
                "Trait IDs reserved for persona labels only: "
                + ", ".join(reserved_trait_ids)
            )

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
            if not rule.evaluation_scopes:
                rule.evaluation_scopes = default_evaluation_scopes_for_rule(rule.rule_id)
            invalid_scopes = set(rule.evaluation_scopes) - set(ALL_EVALUATION_SCOPES)
            if invalid_scopes:
                raise ValueError(
                    f"Rule {rule.rule_id!r} uses invalid evaluation scopes: {invalid_scopes}"
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

    @property
    def enabled_rules(self) -> List[AdversarialRule]:
        return [rule for rule in self.rules if rule.enabled]

    def rules_for_goals(
        self,
        goal_ids: List[str],
        selected_rule_ids: Optional[List[str]] = None,
    ) -> List[AdversarialRule]:
        """Return rules relevant to any of the given goal IDs (union)."""
        goal_set = set(goal_ids)
        selected_rule_id_set = None if selected_rule_ids is None else set(selected_rule_ids)
        return [
            rule
            for rule in self.enabled_rules
            if goal_set & set(rule.goal_ids)
            and (
                selected_rule_id_set is None
                or rule.rule_id in selected_rule_id_set
            )
        ]

    def prompt_rules_for_goals(
        self,
        goal_ids: List[str],
        selected_rule_ids: Optional[List[str]] = None,
    ) -> List[PromptRule]:
        return [
            PromptRule(
                rule_id=rule.rule_id,
                section=rule.section,
                rule_text=rule.rule_text,
                goal_ids=list(rule.goal_ids),
                evaluation_scopes=list(rule.evaluation_scopes),
            )
            for rule in self.rules_for_goals(goal_ids, selected_rule_ids)
        ]

    def prompt_rules_for_scope(
        self,
        scope: str,
        selected_rule_ids: Optional[List[str]] = None,
    ) -> List[PromptRule]:
        selected_rule_id_set = None if selected_rule_ids is None else set(selected_rule_ids)
        return [
            PromptRule(
                rule_id=rule.rule_id,
                section=rule.section,
                rule_text=rule.rule_text,
                goal_ids=list(rule.goal_ids),
                evaluation_scopes=list(rule.evaluation_scopes),
            )
            for rule in self.enabled_rules
            if scope in rule.evaluation_scopes
            and (
                selected_rule_id_set is None
                or rule.rule_id in selected_rule_id_set
            )
        ]

    def snapshot(self) -> dict:
        return {
            "version": self.version,
            "goals": [goal.model_dump() for goal in self.enabled_goals],
            "traits": [trait.model_dump() for trait in self.enabled_traits],
            "rules": [rule.model_dump() for rule in self.enabled_rules],
        }


# ─── Built-in Default ────────────────────────────────────────────


def get_default_config() -> AdversarialConfig:
    """Return the built-in adversarial contract registry."""
    return AdversarialConfig(
        version=CURRENT_VERSION,
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
                behavior_hint="Give ambiguous quantities ('some', 'a bit', 'a plate'). When bot asks, provide a specific amount.",
            ),
            AdversarialTrait(
                id="multiple_meals_one_message",
                label="Multiple Meals One Message",
                description="User describes multiple meals or meal times in a single message.",
                behavior_hint="Describe multiple meals in one message. Remind the bot if it misses one.",
            ),
            AdversarialTrait(
                id="user_corrects_bot",
                label="User Corrects Bot",
                description="User corrects the bot after it interprets something wrong (quantity, food item, or time).",
                behavior_hint="After the bot summarizes your input, correct one specific mistake such as quantity, food item, or time.",
            ),
            AdversarialTrait(
                id="edit_after_log",
                label="Edit After Log",
                description="User cooperates fully, confirms the meal, then requests an edit afterward.",
                behavior_hint="Cooperate fully through logging, then request an edit after the meal is confirmed.",
            ),
            AdversarialTrait(
                id="future_meal_rejection",
                label="Future Meal Rejection",
                description="User provides a future time for a meal (e.g. 'in 30 minutes', 'planning to eat at 5pm').",
                behavior_hint="Deliberately give a future meal time first. If the bot rejects it, then provide a valid past time.",
            ),
            AdversarialTrait(
                id="no_food_mentioned",
                label="No Food Mentioned",
                description="User sends ONLY quantity or time with no food item mentioned.",
                behavior_hint="Start with only time or quantity and no food. Provide the missing food only after the bot asks.",
            ),
            AdversarialTrait(
                id="multi_ingredient_dish",
                label="Multi-Ingredient Dish",
                description="User describes a composite dish with multiple ingredients as one item (e.g. 'porridge with almonds and honey').",
                behavior_hint="Describe a dish with ingredients together as a single item, not as separate foods.",
            ),
        ],
        rules=[
            AdversarialRule(
                rule_id=rule.rule_id,
                section=rule.section,
                rule_text=rule.rule_text,
                goal_ids=list(rule.goal_ids),
                evaluation_scopes=list(
                    rule.evaluation_scopes
                    or default_evaluation_scopes_for_rule(rule.rule_id)
                ),
            )
            for rule in RULES
        ],
    )


# ─── Legacy Migrations ───────────────────────────────────────────


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


def _migrate_v3_to_v4(raw: dict) -> dict:
    """Migrate v3 config dict to v4 by backfilling rule evaluation scopes."""
    migrated_rules = []
    for rule in raw.get("rules", []):
        migrated_rules.append({
            **rule,
            "evaluation_scopes": rule.get("evaluation_scopes")
            or default_evaluation_scopes_for_rule(rule.get("rule_id", "")),
        })

    return {
        "version": 4,
        "goals": raw.get("goals", []),
        "traits": raw.get("traits", []),
        "rules": migrated_rules,
    }


def _migrate_v4_to_v5(raw: dict) -> dict:
    """Migrate v4 config dict to v5 by backfilling required adversarial rules."""
    default = get_default_config()
    existing_rules = {rule.get("rule_id"): rule for rule in raw.get("rules", [])}
    merged_rules = list(raw.get("rules", []))
    for rule in default.rules:
        if rule.rule_id in existing_rules:
            continue
        merged_rules.append(rule.model_dump())

    return {
        "version": 5,
        "goals": raw.get("goals", []),
        "traits": raw.get("traits", []),
        "rules": merged_rules,
    }


def _migrate_v5_to_v6(raw: dict) -> dict:
    """Migrate v5 config dict to v6 by backfilling the anti-mirroring rule."""
    default = get_default_config()
    existing_rules = {rule.get("rule_id"): rule for rule in raw.get("rules", [])}
    merged_rules = list(raw.get("rules", []))
    for rule in default.rules:
        if rule.rule_id in existing_rules:
            continue
        merged_rules.append(rule.model_dump())

    return {
        "version": 6,
        "goals": raw.get("goals", []),
        "traits": raw.get("traits", []),
        "rules": merged_rules,
    }


def _strip_persona_only_traits(traits: list[dict]) -> list[dict]:
    return [
        trait
        for trait in traits
        if str(trait.get("id", "")).strip().lower() not in PERSONA_ONLY_TRAIT_IDS
    ]


def _migrate_v6_to_v7(raw: dict) -> dict:
    """Migrate v6 config dict to v7 by removing persona-only labels from traits."""
    return {
        "version": 7,
        "goals": raw.get("goals", []),
        "traits": _strip_persona_only_traits(raw.get("traits", [])),
        "rules": raw.get("rules", []),
    }


def _upgrade_raw_config(raw: dict) -> tuple[dict, int]:
    version = raw.get("version", 1) if isinstance(raw, dict) else 1
    original_version = version
    if version < 3:
        logger.info(f"Migrating adversarial config v{version} → v3")
        raw = _migrate_v2_to_v3(raw)
        version = 3
    if version < 4:
        logger.info(f"Migrating adversarial config v{version} → v4")
        raw = _migrate_v3_to_v4(raw)
        version = 4
    if version < 5:
        logger.info(f"Migrating adversarial config v{version} → v5")
        raw = _migrate_v4_to_v5(raw)
        version = 5
    if version < 6:
        logger.info(f"Migrating adversarial config v{version} → v6")
        raw = _migrate_v5_to_v6(raw)
        version = 6
    if version < 7:
        logger.info(f"Migrating adversarial config v{version} → v7")
        raw = _migrate_v6_to_v7(raw)
    return raw, original_version


# ─── DB Load / Save ──────────────────────────────────────────────


async def load_config_from_db(
    tenant_id,
    user_id,
) -> AdversarialConfig:
    """Load adversarial config from settings table, auto-upgrading legacy versions.

    Resolution chain:
      1. Shared setting (tenant, app, key, visibility=shared)
      2. System default (SYSTEM_TENANT_ID, app, key, visibility=shared)
      3. Built-in default
    """
    from sqlalchemy import select
    from app.database import async_session
    from app.models.setting import Setting
    from app.constants import SYSTEM_TENANT_ID
    from app.models.mixins.shareable import Visibility
    from app.services.access_control import shared_visibility_clause

    try:
        async with async_session() as db:
            # Step 1: Shared in current tenant
            result = await db.execute(
                select(Setting).where(
                    Setting.tenant_id == tenant_id,
                    Setting.app_id == SETTINGS_APP_ID,
                    Setting.key == SETTINGS_KEY,
                    shared_visibility_clause(Setting.visibility),
                )
            )
            setting = result.scalar_one_or_none()

            # Step 2: System default
            if not setting:
                result = await db.execute(
                    select(Setting).where(
                        Setting.tenant_id == SYSTEM_TENANT_ID,
                        Setting.app_id == SETTINGS_APP_ID,
                        Setting.key == SETTINGS_KEY,
                        shared_visibility_clause(Setting.visibility),
                    )
                )
                setting = result.scalar_one_or_none()

            if setting and setting.value:
                raw = setting.value
                raw, original_version = _upgrade_raw_config(raw)
                config = AdversarialConfig.model_validate(raw)
                if original_version < CURRENT_VERSION:
                    await save_config_to_db(config, tenant_id=tenant_id, user_id=user_id)
                return config
    except Exception as e:
        logger.warning(
            f"Failed to load adversarial config from DB, using defaults: {e}"
        )

    return get_default_config()


async def load_system_default_config() -> AdversarialConfig:
    """Load the system-shared adversarial contract, falling back to built-in defaults."""
    from sqlalchemy import select
    from app.database import async_session
    from app.models.setting import Setting
    from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
    from app.services.access_control import shared_visibility_clause

    try:
        async with async_session() as db:
            result = await db.execute(
                select(Setting).where(
                    Setting.tenant_id == SYSTEM_TENANT_ID,
                    Setting.user_id == SYSTEM_USER_ID,
                    Setting.app_id == SETTINGS_APP_ID,
                    Setting.key == SETTINGS_KEY,
                    shared_visibility_clause(Setting.visibility),
                )
            )
            setting = result.scalar_one_or_none()
            if setting and setting.value:
                raw, _ = _upgrade_raw_config(setting.value)
                return AdversarialConfig.model_validate(raw)
    except Exception as e:
        logger.warning("Failed to load system adversarial config from DB, using defaults: %s", e)

    return get_default_config()


async def save_config_to_db(
    config: AdversarialConfig,
    tenant_id,
    user_id,
) -> None:
    """Validate and persist adversarial config to settings table.

    Scopes the upsert to the given tenant/user.
    """
    from app.database import async_session

    data = config.model_dump()
    from app.models.mixins.shareable import Visibility

    async with async_session() as db:
        stmt = build_setting_upsert_stmt(
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=SETTINGS_APP_ID,
            key=SETTINGS_KEY,
            value=data,
            visibility=Visibility.SHARED,
            updated_by=user_id,
            forked_from=None,
            shared_by=user_id,
        )
        await db.execute(stmt)
        await db.commit()
