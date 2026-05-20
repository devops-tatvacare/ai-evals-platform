"""Tenant-policy helpers shared across routes and background services."""
from app.services.tenant_policy.email_domains import (
    is_email_domain_allowed,
    load_tenant_allowed_domains,
)

__all__ = ["is_email_domain_allowed", "load_tenant_allowed_domains"]
