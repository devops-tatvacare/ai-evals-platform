"""Per-provider plaintext config schemas.

Pure Python data, JSON-Schema-emittable. Drives both:
- backend validation in the connections service (validate_config),
- frontend form rendering via DynamicConfigForm (commit 3 / phase 10 task 7).

Each spec lists fields with `secret: bool`. GET responses on the connections
API never echo secret values; PATCH preserves omitted secret keys instead of
forcing operators to re-enter every credential.

Per phase-10 §1.1, the canonical providers and their required keys are:

    bolna   — api_key, base_url (default https://api.bolna.ai); from_phone optional
    wati    — base_url, wati_tenant_id, api_token; channel_numbers optional
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
from typing import Any


@dataclass(frozen=True)
class FieldSpec:
    name: str
    type: str  # 'string' | 'array'
    title: str = ""  # Professional UI label; populated for every field below.
    secret: bool = False
    required: bool = True
    default: Any = None
    description: str = ""
    # Used only when ``type == "array"`` — the JSON-Schema `items.type`. Today
    # all array fields are arrays of strings; loosened later if needed.
    items_type: str = "string"
    # Optional format hint applied to each array item (e.g. "e164" for phone
    # numbers). Surfaces to the frontend as ``items["x-format"]`` so the
    # PrimitiveItem renderer can show an inline validation error.
    items_format: str = ""


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
            FieldSpec(
                "api_key", "string",
                title="API Key", secret=True,
                description="Bearer token from your Bolna dashboard. Stored encrypted.",
            ),
            FieldSpec(
                "base_url", "string",
                title="API Base URL", default="https://api.bolna.ai",
                description="Override only for staging. Default: https://api.bolna.ai",
            ),
            FieldSpec(
                "from_phone", "string",
                title="Default Caller ID", required=False, default="",
                description="E.164 number used as caller-id when a node doesn't override it.",
            ),
        ),
    ),
    "wati": ProviderSpec(
        provider="wati",
        label="WATI (WhatsApp)",
        supports_webhook=True,
        fields=(
            FieldSpec(
                "base_url", "string",
                title="API Endpoint",
                description="Per-tenant WATI endpoint, e.g. https://live-mt-server.wati.io/{tenant_id}",
            ),
            FieldSpec(
                "wati_tenant_id", "string",
                title="WATI Tenant ID",
                description="Numeric tenant id from your WATI workspace settings.",
            ),
            FieldSpec(
                "api_token", "string",
                title="API Token", secret=True,
                description="Bearer token from WATI → API Tokens. Stored encrypted.",
            ),
            FieldSpec(
                "channel_numbers", "array",
                title="Channel Numbers", required=False, default=[],
                items_format="e164",
                description="WhatsApp sender numbers (E.164) configured in this workspace. Nodes pick one at send time.",
            ),
        ),
    ),
    "aisensy": ProviderSpec(
        provider="aisensy",
        label="AiSensy (WhatsApp)",
        supports_webhook=True,
        fields=(
            FieldSpec(
                "api_key", "string",
                title="API Key", secret=True,
                description="AiSensy project API key. Stored encrypted.",
            ),
            FieldSpec(
                "base_url", "string",
                title="API Base URL",
                description="AiSensy API base URL.",
            ),
            FieldSpec(
                "campaign_partner_id", "string",
                title="Campaign Partner ID",
                description="AiSensy campaign partner identifier.",
            ),
            FieldSpec(
                "from_number", "string",
                title="Sender Number",
                description="WhatsApp Business sender phone number (E.164).",
            ),
        ),
    ),
    "lsq": ProviderSpec(
        provider="lsq",
        label="LeadSquared",
        supports_webhook=False,
        fields=(
            FieldSpec(
                "access_key", "string",
                title="Access Key", secret=True,
                description="From LeadSquared → API Credentials.",
            ),
            FieldSpec(
                "secret_key", "string",
                title="Secret Key", secret=True,
                description="From LeadSquared → API Credentials. Stored encrypted.",
            ),
            FieldSpec(
                "region_host", "string",
                title="Region Host",
                description="e.g. https://api-in21.leadsquared.com",
            ),
        ),
    ),
    "msg91": ProviderSpec(
        provider="msg91",
        label="MSG91 (SMS)",
        supports_webhook=False,
        fields=(
            FieldSpec(
                "auth_key", "string",
                title="Auth Key", secret=True,
                description="Account-level auth key from MSG91 dashboard. Stored encrypted.",
            ),
            FieldSpec(
                "flow_id", "string",
                title="Flow ID",
                description="Approved templated SMS flow id.",
            ),
            FieldSpec(
                "sender_id", "string",
                title="Sender ID",
                description="DLT-approved 6-character sender id.",
            ),
        ),
    ),
    "webhook": ProviderSpec(
        provider="webhook",
        label="Generic Webhook",
        supports_webhook=False,
        fields=(
            FieldSpec(
                "base_url", "string",
                title="Base URL", required=False, default="",
                description="Optional base URL. Relative webhook node URLs resolve against this.",
            ),
            FieldSpec(
                "auth_header_name", "string",
                title="Auth Header Name", required=False, default="",
                description="Optional reusable header name (e.g., Authorization).",
            ),
            FieldSpec(
                "auth_header_value", "string",
                title="Auth Header Value", secret=True, required=False, default="",
                description="Optional reusable header value. Stored encrypted.",
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
        if field.title:
            prop["title"] = field.title
        if field.description:
            prop["description"] = field.description
        if field.default is not None:
            prop["default"] = field.default
        if field.secret:
            prop["x-secret"] = True
        if field.type == "array":
            items: dict[str, Any] = {"type": field.items_type}
            if field.items_format:
                items["x-format"] = field.items_format
            prop["items"] = items
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


_E164_RE = None


def _is_e164(value: str) -> bool:
    """Lightweight E.164 check: '+' followed by 8–15 digits."""
    global _E164_RE
    if _E164_RE is None:
        import re
        _E164_RE = re.compile(r"^\+\d{8,15}$")
    return bool(_E164_RE.match(value))


def validate_config(provider: str, config: dict[str, Any]) -> None:
    """Validate ``config`` against the provider's spec. Raises ``ValueError``.

    - Unknown keys → reject (additionalProperties: false).
    - Missing required keys → reject.
    - Empty-string values for required string keys → reject; a blank
      string is the wire-format for "leave secret unchanged" on PATCH but
      MUST be normalized away by the route layer before reaching here.
    - Non-string types where a string is declared → reject.
    - Array fields → must be a list of strings (today only ``channel_numbers``).
    """
    spec = get_spec(provider)
    declared = {f.name for f in spec.fields}
    extras = set(config.keys()) - declared
    if extras:
        raise ValueError(f"unknown config keys for provider {provider!r}: {sorted(extras)}")
    for field in spec.fields:
        if field.name in config:
            value = config[field.name]
            if field.type == "string":
                if not isinstance(value, str):
                    raise ValueError(f"{field.name!r}: must be a string")
                if field.required and value == "":
                    raise ValueError(f"{field.name!r}: must not be blank")
            elif field.type == "array":
                if not isinstance(value, list):
                    raise ValueError(f"{field.name!r}: must be an array")
                for item in value:
                    if not isinstance(item, str):
                        raise ValueError(f"{field.name!r}: every entry must be a string")
                if provider == "wati" and field.name == "channel_numbers":
                    for entry in value:
                        if entry and not _is_e164(entry):
                            raise ValueError(
                                f"channel_numbers: {entry!r} is not a valid E.164 number"
                            )
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
