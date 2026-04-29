"""App config contract tests — Phase 1 shape + Phase 2 seed configs."""

from pathlib import Path

from app.models.application import Application
from app.schemas.app_config import AppConfig


def test_app_model_includes_config_column():
    assert "config" in Application.__table__.columns


def test_app_config_schema_matches_phase_one_shape():
    payload = AppConfig(
        displayName="Kaira Bot",
        icon="kaira-bot",
        description="Health chat bot assistant",
        features={
            "hasRules": True,
            "hasAdversarial": True,
        },
        rules={
            "catalogSource": "settings",
            "catalogKey": "adversarial-config",
            "autoMatch": True,
        },
        evaluator={
            "defaultVisibility": "private",
            "defaultModel": "gemini-2.5-flash",
            "variables": [
                {
                    "key": "chat_transcript",
                    "displayName": "Chat Transcript",
                    "description": "Full conversation history",
                    "category": "Conversation",
                }
            ],
            "dynamicVariableSources": {
                "registry": True,
                "listingApiPaths": False,
            },
        },
        assetDefaults={
            "evaluator": "private",
            "prompt": "private",
            "schema": "private",
            "adversarialContract": "shared",
            "llmSettings": "private",
        },
        authorization={
            "assetPolicies": {
                "settings": {
                    "privateOnlyKeys": ["llm-settings"],
                },
            },
        },
        evalRun={"supportedTypes": ["custom", "batch_thread"]},
        analytics={
            "profile": "kaira_v1",
            "capabilities": {
                "singleRunReport": True,
                "crossRunAnalytics": True,
                "crossRunAiSummary": True,
                "pdfExport": True,
            },
            "singleRun": {
                "sections": [
                    {"id": "summary", "type": "summary_cards", "title": "Summary", "variant": "default"},
                ],
                "export": {"enabled": True, "format": "pdf", "documentVariant": "kaira-run-v1", "sectionIds": ["summary"]},
                "aiSummary": {"enabled": True, "sectionIds": ["summary"]},
            },
            "crossRun": {
                "sections": [],
                "export": {"enabled": False, "format": "pdf", "documentVariant": "kaira-cross-run-v1", "sectionIds": []},
                "aiSummary": {"enabled": True, "sectionIds": []},
            },
            "assets": {
                "promptReferencesKey": "report-prompt-references",
                "narrativeTemplateKey": "report-narrative-template",
                "glossaryKey": "report-glossary",
            },
            "semanticModel": {
                "dimensions": [
                    {
                        "name": "agent",
                        "table": "fact_evaluation",
                        "expression": "context->>'agent'",
                    },
                ],
            },
        },
        chat={
            "enabled": True,
            "capabilities": ["catalog", "discovery", "analytics", "evidence", "report_builder"],
            "promptTemplates": [
                {"label": "Discover data", "prompt": "Discover what data is available"},
            ],
            "dataSurfaces": [
                {
                    "key": "logs",
                    "description": "Raw logs",
                    "source": "evaluation_run_api_call_logs",
                    "entityFieldMap": {"thread_id": "thread_id"},
                    "fields": ["thread_id", "response"],
                    "defaultLimit": 10,
                },
            ],
            "entityResolvers": [
                {
                    "key": "thread-id",
                    "entityType": "thread_id",
                    "description": "Resolve thread ids",
                    "source": "evaluation_run_api_call_logs",
                    "field": "thread_id",
                    "match": "prefix",
                    "limit": 10,
                },
            ],
            "entityTypes": [
                {
                    "name": "thread_id",
                    "description": "Conversation thread identifier",
                    "examples": ["thread-123"],
                },
            ],
        },
    )

    dumped = payload.model_dump(by_alias=True)

    assert dumped["displayName"] == "Kaira Bot"
    assert dumped["features"]["hasRules"] is True
    assert dumped["rules"]["catalogKey"] == "adversarial-config"
    assert dumped["evaluator"]["dynamicVariableSources"]["registry"] is True
    assert dumped["assetDefaults"]["adversarialContract"] == "shared"
    assert dumped["authorization"]["assetPolicies"]["settings"]["privateOnlyKeys"] == ["llm-settings"]
    assert dumped["evalRun"]["supportedTypes"] == ["custom", "batch_thread"]
    assert dumped["analytics"]["profile"] == "kaira_v1"
    assert dumped["analytics"]["capabilities"]["pdfExport"] is True
    assert dumped["analytics"]["semanticModel"]["dimensions"][0]["name"] == "agent"
    assert dumped["chat"]["capabilities"] == ["catalog", "discovery", "analytics", "evidence", "report_builder"]
    assert dumped["chat"]["dataSurfaces"][0]["key"] == "logs"
    assert dumped["chat"]["entityResolvers"][0]["entityType"] == "thread_id"
    assert dumped["chat"]["entityTypes"][0]["name"] == "thread_id"


def test_app_config_validates_all_required_keys():
    """App config schema enforces all top-level keys for each app config."""
    required_keys = {"displayName", "icon", "description", "features", "rules", "evaluator", "assetDefaults", "authorization", "evalRun", "analytics", "chat"}

    # Validate that a minimal valid config contains all required keys
    config = AppConfig(
        displayName="Test",
        icon="test",
        description="test",
        features={},
        rules={},
        evaluator={
            "defaultVisibility": "private",
            "defaultModel": "",
            "variables": [],
            "dynamicVariableSources": {},
        },
        assetDefaults={},
        authorization={},
        evalRun={"supportedTypes": []},
        analytics={"profile": "voice_rx_v1"},
    )
    dumped = config.model_dump(by_alias=True)
    assert required_keys.issubset(dumped.keys())


def test_kaira_bot_style_config_enables_rules_and_adversarial():
    """Kaira Bot config shape: rules + adversarial enabled, rubric disabled."""
    from app.schemas.app_config import AppFeaturesConfig
    features = AppFeaturesConfig(hasRules=True, hasAdversarial=True, hasRubricMode=False)
    assert features.has_rules is True
    assert features.has_adversarial is True
    assert features.has_rubric_mode is False


def test_voice_rx_style_config_enables_transcription():
    """Voice Rx config shape: transcription enabled, rules disabled."""
    from app.schemas.app_config import AppFeaturesConfig
    features = AppFeaturesConfig(hasTranscription=True, hasRules=False)
    assert features.has_transcription is True
    assert features.has_rules is False


def test_inside_sales_style_config_enables_rubric_and_csv():
    """Inside Sales config shape: rubric mode + CSV import enabled."""
    from app.schemas.app_config import AppFeaturesConfig
    features = AppFeaturesConfig(hasRubricMode=True, hasCsvImport=True)
    assert features.has_rubric_mode is True
    assert features.has_csv_import is True


def test_seeded_apps_expose_explicit_analytics_contracts():
    seed_defaults = Path(__file__).resolve().parents[1] / "app" / "services" / "seed_defaults.py"
    text = seed_defaults.read_text()

    assert '"slug": "voice-rx"' in text
    assert '"authorization": default_app_authorization_config()' in text
    assert '"profile": "voice_rx_v1"' in text
    assert '"singleRunReport": True' in text

    assert '"slug": "kaira-bot"' in text
    assert '"profile": "kaira_v1"' in text
    assert '"promptReferencesKey": "report-prompt-references"' in text
    assert '"promptTemplates": [' in text
    assert 'COMMON_SHERLOCK_CAPABILITIES = ["analytics", "report_builder"]' in text

    assert '"slug": "inside-sales"' in text
    assert '"profile": "inside_sales_v1"' in text
    assert '"documentVariant": "inside-sales-run-v1"' in text
