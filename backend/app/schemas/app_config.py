"""Pydantic schemas for DB-backed app configuration."""

from typing import Literal

from pydantic import Field

from app.models.mixins.shareable import Visibility
from app.schemas.app_analytics_config import AppAnalyticsConfig
from app.schemas.base import CamelModel
from app.schemas.eval_run import EvalType


class AppVariableConfig(CamelModel):
    key: str
    display_name: str
    description: str
    category: str


class AppDynamicVariableSources(CamelModel):
    registry: bool = False
    listing_api_paths: bool = False


class AppFeaturesConfig(CamelModel):
    has_rules: bool = False
    has_rubric_mode: bool = False
    has_csv_import: bool = False
    has_adversarial: bool = False
    has_transcription: bool = False
    has_batch_eval: bool = False
    has_human_review: bool = False
    has_reviews: bool = False
    has_orchestration: bool = False


class AppReviewsConfig(CamelModel):
    enabled: bool = False
    adapter: str = ""
    item_types: list[str] = Field(default_factory=list)
    default_entry_point: str = "run_detail"


class AppRulesConfig(CamelModel):
    catalog_source: str = "settings"
    catalog_key: str = "rule-catalog"
    auto_match: bool = False


class AppEvaluatorConfig(CamelModel):
    default_visibility: Visibility = Visibility.PRIVATE
    default_model: str = ""
    variables: list[AppVariableConfig] = Field(default_factory=list)
    dynamic_variable_sources: AppDynamicVariableSources = Field(
        default_factory=AppDynamicVariableSources
    )


class AppAssetDefaults(CamelModel):
    evaluator: Visibility = Visibility.PRIVATE
    prompt: Visibility = Visibility.PRIVATE
    schema_: Visibility = Field(default=Visibility.PRIVATE, alias="schema")
    adversarial_contract: Visibility = Visibility.PRIVATE


class AppAssetPolicyConfig(CamelModel):
    shareable: bool = True
    sharing_enabled: bool = True
    latest_version_only: bool = False
    forking_enabled: bool = True
    private_only_keys: list[str] = Field(default_factory=list)


class AppAuthorizationAssetPolicies(CamelModel):
    evaluator: AppAssetPolicyConfig = Field(default_factory=AppAssetPolicyConfig)
    prompt: AppAssetPolicyConfig = Field(default_factory=AppAssetPolicyConfig)
    schema_: AppAssetPolicyConfig = Field(default_factory=AppAssetPolicyConfig, alias="schema")
    settings: AppAssetPolicyConfig = Field(default_factory=AppAssetPolicyConfig)


class AppAuthorizationConfig(CamelModel):
    asset_policies: AppAuthorizationAssetPolicies = Field(default_factory=AppAuthorizationAssetPolicies)


class AppEvalRunConfig(CamelModel):
    supported_types: list[str] = Field(default_factory=list)


class AppNavigationConfig(CamelModel):
    home_path: str = "/"
    owned_path_prefixes: list[str] = Field(default_factory=list)
    settings_path: str | None = None
    logs_path: str | None = None
    runs_path: str | None = None
    run_detail_path: str | None = None
    thread_detail_path: str | None = None
    evaluator_detail_path: str | None = None
    adversarial_detail_path: str | None = None


class AppChatPromptTemplate(CamelModel):
    label: str
    prompt: str
    category: str | None = None


class AppChatDataSurfaceConfig(CamelModel):
    key: str
    description: str
    source: str
    entity_field_map: dict[str, str] = Field(default_factory=dict)
    fields: list[str] = Field(default_factory=list)
    default_limit: int = 10


class AppChatEntityResolverConfig(CamelModel):
    key: str
    entity_type: str
    description: str = ''
    source: str
    field: str | None = None
    dimension: str | None = None
    match: Literal['exact', 'prefix', 'contains'] = 'contains'
    limit: int = 10


class AppChatEntityTypeConfig(CamelModel):
    name: str
    description: str = ''
    examples: list[str] = Field(default_factory=list)


class AppChatConfig(CamelModel):
    enabled: bool = True
    prompt_templates: list[AppChatPromptTemplate] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    data_surfaces: list[AppChatDataSurfaceConfig] = Field(default_factory=list)
    entity_resolvers: list[AppChatEntityResolverConfig] = Field(default_factory=list)
    entity_types: list[AppChatEntityTypeConfig] = Field(default_factory=list)


PageType = Literal[
    "runs",
    "runDetail",
    "threadDetail",
    "adversarialDetail",
    "evaluators",
    "evaluatorDetail",
    "logs",
    "dashboard",
    "analytics",
    "analyticsChart",
    "analyticsDashboard",
    "settings",
    "tags",
    "listing",
    "listingDetail",
    "callDetail",
    "leadDetail",
    "cost",
    "scheduledJobs",
    "adminUsers",
]


class PageActionSpec(CamelModel):
    id: str
    kind: str
    config: dict[str, object] = Field(default_factory=dict)
    requires: str | None = None


class ActionRequirement(CamelModel):
    """Per-spec runtime gate (settings key must be present etc).

    Mirrors the FE `AppActionRequirementConfig`. ``source`` selects which
    in-memory store to read from (appSettings | globalSettings | tenantProviders),
    ``key`` is the field on that source; ``validation`` defaults to
    ``nonEmpty``. Empty list = no gate.
    """

    source: Literal["appSettings", "globalSettings", "tenantProviders"]
    key: str
    validation: Literal["nonEmpty", "truthy"] | None = None
    label: str | None = None


class QuickActionSpec(CamelModel):
    """Sidebar quick-action spec — fully data-driven.

    Three primitive ``kind`` values are recognised by the FE registry today:

    * ``openModal`` — config: ``{modalId: str}``
    * ``triggerImperative`` — config: ``{triggerKey: str}``
    * ``navigateTo`` — config: ``{path: str}``

    New actions for new tenants/apps are expressed by emitting a different
    ``kind``/``config`` pair from the app config row — no FE code change.
    """

    id: str
    kind: Literal["openModal", "triggerImperative", "navigateTo"]
    label: str
    description: str | None = None
    icon: str | None = None
    config: dict[str, object] = Field(default_factory=dict)
    requires: str | None = None
    requirements: list[ActionRequirement] = Field(default_factory=list)


EvaluatorDetailBandColor = Literal["emerald", "blue", "amber", "red"]


class EvaluatorDetailBand(CamelModel):
    color: EvaluatorDetailBandColor
    label: str
    range: str
    description: str


class EvaluatorDetailConfig(CamelModel):
    interpretation_bands: list[EvaluatorDetailBand] = Field(default_factory=list)


class CrmWorkspaceConfig(CamelModel):
    """Per-tenant CRM workspace display config (Phase 11E, invariant 18).

    A **closed key set** — ``extra='forbid'`` so tenants cannot add or
    remove keys; the schema validator is the gate. ``piiVisibility`` maps a
    pii-tagged attribute key (or column name) to the role names allowed to
    see its unmasked value; the CRM list/detail APIs mask everything else.
    """

    model_config = {"extra": "forbid"}

    display_name: str | None = None
    accent_color: str | None = None
    default_time_window: Literal["7d", "30d", "90d", "all"] = "30d"
    pii_visibility: dict[str, list[str]] = Field(default_factory=dict)


class AppRunDetailReportTabConfig(CamelModel):
    enabled: bool = True
    enabled_for_eval_types: list[EvalType] | None = None


class AppRunDetailDrilldownConfig(CamelModel):
    param_name: str
    route: str
    back_label: str


class AppRunDetailExtrasConfig(CamelModel):
    review: bool = False
    adversarial_axes: bool = False
    raw_payload: bool = False
    history_tab: bool = False
    drilldown: AppRunDetailDrilldownConfig | None = None


class AppRunDetailBehaviourConfig(CamelModel):
    hide_tabs_while_active: bool = False
    banner_only_on_failed: bool = False
    failure_headline_from_result: bool = False


class AppRunDetailConfig(CamelModel):
    eval_types: list[EvalType] = Field(default_factory=list)
    report_tab: AppRunDetailReportTabConfig = Field(default_factory=AppRunDetailReportTabConfig)
    extras: AppRunDetailExtrasConfig = Field(default_factory=AppRunDetailExtrasConfig)
    behaviour: AppRunDetailBehaviourConfig = Field(default_factory=AppRunDetailBehaviourConfig)


class AppConfig(CamelModel):
    display_name: str
    icon: str
    description: str
    features: AppFeaturesConfig = Field(default_factory=AppFeaturesConfig)
    reviews: AppReviewsConfig = Field(default_factory=AppReviewsConfig)
    rules: AppRulesConfig = Field(default_factory=AppRulesConfig)
    evaluator: AppEvaluatorConfig = Field(default_factory=AppEvaluatorConfig)
    asset_defaults: AppAssetDefaults = Field(default_factory=AppAssetDefaults)
    authorization: AppAuthorizationConfig = Field(default_factory=AppAuthorizationConfig)
    eval_run: AppEvalRunConfig = Field(default_factory=AppEvalRunConfig)
    navigation: AppNavigationConfig = Field(default_factory=AppNavigationConfig)
    analytics: AppAnalyticsConfig = Field(default_factory=AppAnalyticsConfig)
    crm_workspace: CrmWorkspaceConfig = Field(default_factory=CrmWorkspaceConfig)
    chat: AppChatConfig = Field(default_factory=AppChatConfig)
    page_icons: dict[PageType, str] = Field(default_factory=dict)
    page_titles: dict[PageType, str] = Field(default_factory=dict)
    page_actions: dict[PageType, list[PageActionSpec]] = Field(default_factory=dict)
    quick_actions: list[QuickActionSpec] = Field(default_factory=list)
    evaluator_detail: EvaluatorDetailConfig = Field(default_factory=EvaluatorDetailConfig)
    run_detail: AppRunDetailConfig = Field(default_factory=AppRunDetailConfig)
