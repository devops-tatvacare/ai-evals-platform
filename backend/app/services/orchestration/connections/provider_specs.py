"""Per-provider plaintext config schemas.

Pure Python data, JSON-Schema-emittable. Drives both:
- backend validation in the connections service (validate_config),
- frontend form rendering via DynamicConfigForm (commit 3 / phase 10 task 7).

Each spec lists fields with `secret: bool`. GET responses on the connections
API never echo secret values; PATCH preserves omitted secret keys instead of
forcing operators to re-enter every credential.

Per phase-10 §1.1, the canonical providers and their required keys are:

    bolna   — api_key, base_url (default https://api.bolna.ai), from_phone
    wati    — base_url, wati_tenant_id, api_token
    aisensy — api_key, base_url, campaign_partner_id, from_number
    lsq     — access_key, secret_key, region_host
    msg91   — auth_key, flow_id, sender_id
    webhook — optional base_url + reusable auth header pair for generic
              outbound webhook dispatch

Adding a provider here is sufficient for the schema route + the form. Wiring
the resolver service for the new provider is a separate step.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class FieldSpec:
    name: str
    type: str  # 'string'
    secret: bool = False
    required: bool = True
    default: Optional[str] = None
    description: str = ""


@dataclass(frozen=True)
class ProviderSpec:
    provider: str
    label: str
    fields: tuple[FieldSpec, ...]
    # Outbound-only providers (e.g. lsq, msg91 today) do not need a webhook
    # token. Inbound providers (bolna, wati, aisensy) get a per-connection
    # token at create time.
    supports_webhook: bool


PROVIDER_SPECS: dict[str, ProviderSpec] = {
    "bolna": ProviderSpec(
        provider="bolna",
        label="Bolna (AI Voice)",
        supports_webhook=True,
        fields=(
            FieldSpec("api_key", "string", secret=True, description="Bolna API key (Bearer token)."),
            FieldSpec("base_url", "string", default="https://api.bolna.ai",
                      description="API base URL. Override only for staging."),
            FieldSpec("from_phone", "string",
                      description="Default outbound caller-id for placed calls."),
        ),
    ),
    "wati": ProviderSpec(
        provider="wati",
        label="WATI (WhatsApp)",
        supports_webhook=True,
        fields=(
            FieldSpec("base_url", "string",
                      description="WATI region base URL (e.g. https://live-mt-server.wati.io)."),
            FieldSpec("wati_tenant_id", "string", description="Numeric WATI tenant id."),
            FieldSpec("api_token", "string", secret=True, description="Bearer token from WATI dashboard."),
        ),
    ),
    "aisensy": ProviderSpec(
        provider="aisensy",
        label="AiSensy (WhatsApp)",
        supports_webhook=True,
        fields=(
            FieldSpec("api_key", "string", secret=True, description="AiSensy API key."),
            FieldSpec("base_url", "string", description="AiSensy API base URL."),
            FieldSpec("campaign_partner_id", "string", description="Campaign partner id."),
            FieldSpec("from_number", "string", description="Sender phone number."),
        ),
    ),
    "lsq": ProviderSpec(
        provider="lsq",
        label="LeadSquared",
        supports_webhook=False,
        fields=(
            FieldSpec("access_key", "string", secret=True, description="LSQ access key."),
            FieldSpec("secret_key", "string", secret=True, description="LSQ secret key."),
            FieldSpec("region_host", "string",
                      description="Region host (e.g. https://api-in21.leadsquared.com)."),
        ),
    ),
    "msg91": ProviderSpec(
        provider="msg91",
        label="MSG91 (SMS)",
        supports_webhook=False,
        fields=(
            FieldSpec("auth_key", "string", secret=True, description="MSG91 auth key."),
            FieldSpec("flow_id", "string", description="Flow id for templated SMS."),
            FieldSpec("sender_id", "string", description="Approved sender id."),
        ),
    ),
    "webhook": ProviderSpec(
        provider="webhook",
        label="Generic Webhook",
        supports_webhook=False,
        fields=(
            FieldSpec(
                "base_url",
                "string",
                required=False,
                default="",
                description="Optional base URL. Relative webhook node URLs resolve against this.",
            ),
            FieldSpec(
                "auth_header_name",
                "string",
                required=False,
                default="",
                description="Optional reusable auth header name, e.g. Authorization or X-API-Key.",
            ),
            FieldSpec(
                "auth_header_value",
                "string",
                secret=True,
                required=False,
                default="",
                description="Optional reusable auth header value.",
            ),
        ),
    ),
}


def get_spec(provider: str) -> ProviderSpec:
    spec = PROVIDER_SPECS.get(provider)
    if spec is None:
        raise ValueError(f"unknown provider {provider!r}")
    return spec


def list_providers() -> list[ProviderSpec]:
    return list(PROVIDER_SPECS.values())


def secret_field_names(provider: str) -> set[str]:
    return {f.name for f in get_spec(provider).fields if f.secret}


def to_json_schema(provider: str) -> dict[str, Any]:
    """JSON-Schema-shaped dict the frontend can hand to DynamicConfigForm.

    Fields carry ``x-secret`` per phase-10 §1.1 so the renderer knows to
    render password inputs and treat blanks as "leave current value alone".
    The top-level ``x-provider`` lets the form detect provider context.
    """
    spec = get_spec(provider)
    properties: dict[str, Any] = {}
    required: list[str] = []
    for field in spec.fields:
        prop: dict[str, Any] = {"type": field.type}
        if field.description:
            prop["description"] = field.description
        if field.default is not None:
            prop["default"] = field.default
        if field.secret:
            prop["x-secret"] = True
        properties[field.name] = prop
        if field.required:
            required.append(field.name)
    return {
        "type": "object",
        "title": spec.label,
        "x-provider": spec.provider,
        "x-supports-webhook": spec.supports_webhook,
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


def validate_config(provider: str, config: dict[str, Any]) -> None:
    """Validate ``config`` against the provider's spec. Raises ``ValueError``.

    - Unknown keys → reject (additionalProperties: false).
    - Missing required keys → reject.
    - Empty-string values for required keys (any type) → reject; a blank
      string is the wire-format for "leave secret unchanged" on PATCH but
      MUST be normalized away by the route layer before reaching here.
    - Non-string types → reject (all v1 fields are strings).
    """
    spec = get_spec(provider)
    declared = {f.name for f in spec.fields}
    extras = set(config.keys()) - declared
    if extras:
        raise ValueError(f"unknown config keys for provider {provider!r}: {sorted(extras)}")
    for field in spec.fields:
        if field.name in config:
            value = config[field.name]
            if not isinstance(value, str):
                raise ValueError(f"{field.name!r}: must be a string")
            if field.required and value == "":
                raise ValueError(f"{field.name!r}: must not be blank")
        elif field.required and field.default is None:
            raise ValueError(f"{field.name!r}: required")
    if provider == "webhook":
        base_url = str(config.get("base_url", "")).strip()
        header_name = str(config.get("auth_header_name", "")).strip()
        header_value = str(config.get("auth_header_value", "")).strip()
        if bool(header_name) != bool(header_value):
            raise ValueError(
                "webhook auth_header_name and auth_header_value must be provided together"
            )
        if not base_url and not (header_name and header_value):
            raise ValueError(
                "webhook connection requires a base_url or a reusable auth header"
            )
