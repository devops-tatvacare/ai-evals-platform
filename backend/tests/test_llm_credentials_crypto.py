"""Round-trip + tamper tests for LLM credential Fernet crypto.

Covers both the legacy string helpers (used only by migration 0050) and the
new JSON helpers (runtime path).
"""
import pytest
from cryptography.fernet import Fernet


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "LLM_CREDENTIAL_KEY", Fernet.generate_key().decode())


def test_encrypt_secret_round_trip():
    from app.services.llm_credentials import crypto
    token = crypto.encrypt_secret("sk-test-abc123")
    assert token != "sk-test-abc123"
    assert crypto.decrypt_secret(token) == "sk-test-abc123"


def test_decrypt_secret_rejects_tampered_token():
    from app.services.llm_credentials import crypto
    with pytest.raises(crypto.LlmCredentialCryptoError):
        crypto.decrypt_secret("not-a-real-token")


def test_encrypt_json_round_trip():
    from app.services.llm_credentials import crypto
    payload = {"api_key": "sk-x", "extra": {"nested": True}}
    blob = crypto.encrypt_json(payload)
    assert isinstance(blob, bytes)
    assert b"sk-x" not in blob
    assert crypto.decrypt_json(blob) == payload


def test_encrypt_json_sort_keys_is_stable():
    """Same payload encrypted twice with re-ordered keys decrypts identically."""
    from app.services.llm_credentials import crypto
    a = crypto.decrypt_json(crypto.encrypt_json({"a": "1", "b": "2"}))
    b = crypto.decrypt_json(crypto.encrypt_json({"b": "2", "a": "1"}))
    assert a == b


def test_decrypt_json_rejects_tampered_blob():
    from app.services.llm_credentials import crypto
    with pytest.raises(crypto.LlmCredentialCryptoError):
        crypto.decrypt_json(b"garbage-not-a-token")


def test_decrypt_json_rejects_non_json_payload():
    """A blob encrypted with the right key but containing non-JSON bytes raises typed error."""
    from app.services.llm_credentials import crypto
    bad_blob = crypto._fernet().encrypt(b"not-json-{")
    with pytest.raises(crypto.LlmCredentialCryptoError):
        crypto.decrypt_json(bad_blob)


def test_decrypt_json_rejects_non_dict_payload():
    """A valid-JSON blob whose root isn't an object must raise — the secret
    contract is provider→keyed dict; lists/strings would silently pass an
    invalid shape to the resolver/factory otherwise."""
    from app.services.llm_credentials import crypto
    list_blob = crypto._fernet().encrypt(b'[1,2,3]')
    with pytest.raises(crypto.LlmCredentialCryptoError):
        crypto.decrypt_json(list_blob)
    string_blob = crypto._fernet().encrypt(b'"just-a-string"')
    with pytest.raises(crypto.LlmCredentialCryptoError):
        crypto.decrypt_json(string_blob)


def test_missing_key_raises(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "LLM_CREDENTIAL_KEY", "")
    from app.services.llm_credentials import crypto
    with pytest.raises(crypto.LlmCredentialCryptoError):
        crypto.encrypt_json({"api_key": "anything"})


def test_assert_key_valid_round_trips():
    from app.services.llm_credentials import crypto
    crypto.assert_key_valid()  # must not raise
