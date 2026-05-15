"""Shape contract for TenantLlmProvider ORM model."""


def test_model_table_shape():
    from app.models.tenant_llm_provider import TenantLlmProvider
    t = TenantLlmProvider.__table__
    assert t.name == "tenant_llm_providers"
    assert t.schema == "platform"
    assert {
        "id", "tenant_id", "provider", "is_enabled", "api_key_encrypted",
        "base_url", "extra_config", "curated_models", "validation_status",
        "last_validated_at", "updated_by", "updated_at",
    }.issubset(set(t.columns.keys()))
    uniques = [c for c in t.constraints if c.__class__.__name__ == "UniqueConstraint"]
    assert any({"tenant_id", "provider"} == {col.name for col in u.columns} for u in uniques)
