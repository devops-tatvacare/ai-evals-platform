"""Pydantic schemas for DB-backed app configuration."""

from pydantic import Field

from app.models.mixins.shareable import Visibility
from app.schemas.app_analytics_config import AppAnalyticsConfig
from app.schemas.base import CamelModel


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
    llm_settings: Visibility = Visibility.PRIVATE


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
