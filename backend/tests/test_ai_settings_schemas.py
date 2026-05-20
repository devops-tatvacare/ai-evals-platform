"""Shape tests for the admin AI settings + LLM-assist schemas."""
from __future__ import annotations


def test_provider_response_redacts_key():
    from app.schemas.ai_settings import ProviderConfigResponse

    r = ProviderConfigResponse(
        provider="openai",
        is_enabled=True,
        has_api_key=True,
        base_url=None,
        extra_config={},
        curated_models=["gpt-5.4"],
        validation_status="ok",
        last_validated_at=None,
    )
    dumped = r.model_dump(by_alias=True)
    assert "apiKey" not in dumped
    assert "api_key" not in dumped
    assert "api_key_encrypted" not in dumped
    assert dumped["hasApiKey"] is True


def test_credential_create_accepts_camel_case_payload():
    from app.schemas.ai_settings import CredentialCreate

    body = CredentialCreate.model_validate(
        {
            "name": "eu-resource",
            "isEnabled": True,
            "secret": {"api_key": "sk-test"},
            "extraConfig": {"base_url": "https://x.openai.azure.com"},
        }
    )
    assert body.name == "eu-resource"
    assert body.is_enabled is True
    assert body.secret == {"api_key": "sk-test"}
    assert body.extra_config["base_url"] == "https://x.openai.azure.com"


def test_credential_update_treats_blank_secret_value_as_preserve():
    from app.schemas.ai_settings import CredentialUpdate

    body = CredentialUpdate.model_validate(
        {"isEnabled": False, "secret": {"api_key": ""}}
    )
    assert body.is_enabled is False
    assert body.secret == {"api_key": ""}


def test_supported_providers_constant_covers_all_six():
    from app.schemas.ai_settings import SUPPORTED_PROVIDERS

    assert set(SUPPORTED_PROVIDERS) == {
        "openai",
        "azure_openai",
        "anthropic",
        "gemini",
        "vertex",
        "bedrock",
    }


def test_validate_response_serialises_camel_case():
    from app.schemas.ai_settings import ValidateResponse

    r = ValidateResponse(validation_status="ok", detail=None)
    dumped = r.model_dump(by_alias=True)
    assert dumped["validationStatus"] == "ok"
    assert dumped["detail"] is None


def test_assist_generate_prompt_request_requires_provider_and_model():
    from app.schemas.llm_assist import GeneratePromptRequest

    body = GeneratePromptRequest.model_validate(
        {
            "provider": "openai",
            "model": "gpt-5.4",
            "promptType": "evaluation",
            "userIdea": "check tone",
        }
    )
    assert body.provider == "openai"
    assert body.model == "gpt-5.4"
    assert body.prompt_type == "evaluation"
    assert body.user_idea == "check tone"


def test_assist_extract_structured_request_supports_audio_and_transcript():
    from app.schemas.llm_assist import ExtractStructuredRequest

    body = ExtractStructuredRequest.model_validate(
        {
            "provider": "gemini",
            "model": "gemini-2.5-pro",
            "prompt": "Extract fields",
            "promptType": "schema",
            "inputSource": "both",
            "transcript": "hello",
            "audioBase64": "aGVsbG8=",
            "audioMimeType": "audio/wav",
        }
    )
    assert body.input_source == "both"
    assert body.audio_base64 == "aGVsbG8="


def test_assist_extract_structured_response_carries_status():
    from app.schemas.llm_assist import ExtractStructuredResponse

    r = ExtractStructuredResponse(result={"name": "x"}, status="completed", error=None)
    dumped = r.model_dump(by_alias=True)
    assert dumped["status"] == "completed"
    assert dumped["result"] == {"name": "x"}
