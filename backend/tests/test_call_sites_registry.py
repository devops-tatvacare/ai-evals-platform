"""Shape contracts for the LLM call-site registry."""
import pytest


def test_registry_has_all_eleven_sites():
    from app.services.llm_credentials.call_sites import CALL_SITES
    assert set(CALL_SITES.keys()) == {
        "chat_text",
        "chat_vision",
        "chat_reasoning",
        "audio_transcription",
        "audio_synthesis",
        "evaluator_draft",
        "lead_signal_extraction",
        "report_generation",
        "analytics_supervisor",
        "analytics_specialist",
        "assist_prompt_or_schema",
    }


def test_every_spec_uses_known_capability_tags():
    """CallSiteSpec.__post_init__ raises on unknown tags; this confirms the
    in-file registry passes that validator."""
    from app.services.llm_credentials.call_sites import (
        CALL_SITES,
        CAPABILITY_VOCABULARY,
    )
    for spec in CALL_SITES.values():
        assert spec.required_capabilities <= CAPABILITY_VOCABULARY
        assert spec.optional_capabilities <= CAPABILITY_VOCABULARY


def test_spec_rejects_unknown_capability_tag():
    from app.services.llm_credentials.call_sites import CallSiteSpec
    with pytest.raises(ValueError):
        CallSiteSpec(
            id="bogus",
            required_capabilities=frozenset({"text_input", "nope"}),
            optional_capabilities=frozenset(),
            description="...",
            reference="...",
        )


def test_get_call_site_lookup_raises_on_unknown_id():
    from app.services.llm_credentials.call_sites import (
        UnknownCallSiteError,
        get_call_site,
    )
    with pytest.raises(UnknownCallSiteError) as excinfo:
        get_call_site("nonexistent")
    assert "nonexistent" in str(excinfo.value)


def test_list_call_sites_returns_stable_order():
    from app.services.llm_credentials.call_sites import list_call_sites
    a = [c.id for c in list_call_sites()]
    b = [c.id for c in list_call_sites()]
    assert a == b == sorted(a)


def test_call_site_ids_match_field_id():
    """The dict key equals the spec's .id field — protects against typos."""
    from app.services.llm_credentials.call_sites import CALL_SITES
    for key, spec in CALL_SITES.items():
        assert key == spec.id, f"dict key {key!r} mismatches spec.id {spec.id!r}"


def test_every_spec_has_nonempty_reference():
    """Each call site declares where the capability is consumed, for the
    LLM Defaults admin UI."""
    from app.services.llm_credentials.call_sites import CALL_SITES
    for spec in CALL_SITES.values():
        assert spec.reference.strip(), f"{spec.id} has an empty reference"


def test_no_app_names_in_descriptions_or_references():
    """Naming invariant: registry copy is capability-named, never app-named."""
    from app.services.llm_credentials.call_sites import CALL_SITES
    banned = ("voice-rx", "voice_rx", "kaira", "inside-sales", "inside_sales", "tatva")
    for spec in CALL_SITES.values():
        blob = f"{spec.description} {spec.reference}".lower()
        for token in banned:
            assert token not in blob, f"{spec.id} copy leaks app name {token!r}"


def test_required_capabilities_per_site_match_plan_table():
    """Snapshots the README's call-site → required-capability mapping."""
    from app.services.llm_credentials.call_sites import CALL_SITES
    expected = {
        "chat_text": {"text_input", "text_output"},
        "chat_vision": {"text_input", "text_output", "image_input"},
        "chat_reasoning": {"text_input", "text_output", "reasoning"},
        "audio_transcription": {"audio_input", "text_output"},
        "audio_synthesis": {"text_input", "audio_output"},
        "evaluator_draft": {"text_input", "text_output", "structured_output"},
        "lead_signal_extraction": {"text_input", "text_output", "structured_output"},
        "report_generation": {"text_input", "text_output"},
        "analytics_supervisor": {"text_input", "text_output", "tool_call"},
        "analytics_specialist": {"text_input", "text_output", "structured_output"},
        "assist_prompt_or_schema": {"text_input", "text_output", "structured_output"},
    }
    for site_id, req in expected.items():
        assert set(CALL_SITES[site_id].required_capabilities) == req, (
            f"{site_id} mismatch: have {CALL_SITES[site_id].required_capabilities}, "
            f"expected {req}"
        )
