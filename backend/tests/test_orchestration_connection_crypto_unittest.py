"""Crypto round-trip + bad-key behaviour for orchestration provider connections.

Pure-unit. Uses a Fernet key set per-test via monkeypatch so other tests in
the suite don't see surprising state.
"""
from __future__ import annotations

import pytest
from cryptography.fernet import Fernet


@pytest.fixture
def fernet_key(monkeypatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setattr("app.config.settings.ORCHESTRATION_CONNECTION_KEY", key)
    return key


def test_round_trip(fernet_key):
    from app.services.orchestration.connections import crypto

    plain = {"api_key": "sekret", "base_url": "https://x", "from_phone": "+91"}
    token = crypto.encrypt(plain)
    assert isinstance(token, bytes)
    assert plain == crypto.decrypt(token)


def test_missing_key_raises(monkeypatch):
    from app.services.orchestration.connections import crypto

    monkeypatch.setattr("app.config.settings.ORCHESTRATION_CONNECTION_KEY", "")
    with pytest.raises(crypto.ConnectionCryptoError):
        crypto.encrypt({"x": "y"})


def test_invalid_key_format_raises(monkeypatch):
    from app.services.orchestration.connections import crypto

    monkeypatch.setattr(
        "app.config.settings.ORCHESTRATION_CONNECTION_KEY",
        "not-a-valid-fernet-key",
    )
    with pytest.raises(crypto.ConnectionCryptoError):
        crypto.assert_key_valid()


def test_decrypt_with_wrong_key_raises(monkeypatch):
    from app.services.orchestration.connections import crypto

    k1 = Fernet.generate_key().decode()
    monkeypatch.setattr("app.config.settings.ORCHESTRATION_CONNECTION_KEY", k1)
    token = crypto.encrypt({"api_key": "abc"})

    k2 = Fernet.generate_key().decode()
    monkeypatch.setattr("app.config.settings.ORCHESTRATION_CONNECTION_KEY", k2)
    with pytest.raises(crypto.ConnectionCryptoError):
        crypto.decrypt(token)


def test_assert_key_valid_round_trips(fernet_key):
    from app.services.orchestration.connections import crypto

    # Should not raise.
    crypto.assert_key_valid()
