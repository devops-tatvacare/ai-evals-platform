"""Shape contracts for the per-tenant LLM credential + deployment ORM models."""


def test_credential_table_shape():
    from app.models.tenant_llm_credential import TenantLlmCredential
    t = TenantLlmCredential.__table__
    assert t.name == "tenant_llm_credentials"
    assert t.schema == "platform"
    assert {
        "id", "tenant_id", "provider", "name", "is_enabled",
        "secret_blob_encrypted", "extra_config",
        "validation_status", "last_validated_at",
        "updated_by", "updated_at",
    }.issubset(set(t.columns.keys()))
    # api_key_encrypted / base_url / curated_models are gone.
    assert "api_key_encrypted" not in t.columns
    assert "base_url" not in t.columns
    assert "curated_models" not in t.columns
    uniques = [c for c in t.constraints if c.__class__.__name__ == "UniqueConstraint"]
    assert any(
        {"tenant_id", "provider", "name"} == {col.name for col in u.columns}
        for u in uniques
    )


def test_deployment_table_shape():
    from app.models.tenant_llm_deployment import TenantLlmDeployment
    t = TenantLlmDeployment.__table__
    assert t.name == "tenant_llm_deployments"
    assert t.schema == "platform"
    assert {
        "id", "credential_id", "deployment_name", "canonical_model_id",
        "api_version_override", "enabled", "needs_mapping",
        "created_at", "updated_at",
    }.issubset(set(t.columns.keys()))
    # canonical_model_id is nullable so backfill / unmapped deployments survive.
    assert t.columns["canonical_model_id"].nullable is True
    uniques = [c for c in t.constraints if c.__class__.__name__ == "UniqueConstraint"]
    assert any(
        {"credential_id", "deployment_name"} == {col.name for col in u.columns}
        for u in uniques
    )
