"""Boot validator must reject a missing/invalid LLM_CREDENTIAL_KEY."""
import pytest
from cryptography.fernet import Fernet


def _base_env(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "JWT_SECRET", "x", raising=False)
    monkeypatch.setattr(settings, "ORCHESTRATION_CONNECTION_KEY",
                        Fernet.generate_key().decode(), raising=False)
    return settings


def test_boot_rejects_missing_llm_credential_key(monkeypatch):
    settings = _base_env(monkeypatch)
    monkeypatch.setattr(settings, "LLM_CREDENTIAL_KEY", "", raising=False)
    from app.main import _validate_startup_config
    with pytest.raises(RuntimeError, match="LLM_CREDENTIAL_KEY"):
        _validate_startup_config()


def test_boot_rejects_invalid_llm_credential_key(monkeypatch):
    settings = _base_env(monkeypatch)
    monkeypatch.setattr(settings, "LLM_CREDENTIAL_KEY", "not-base64", raising=False)
    from app.main import _validate_startup_config
    with pytest.raises(RuntimeError, match="LLM_CREDENTIAL_KEY is invalid"):
        _validate_startup_config()
