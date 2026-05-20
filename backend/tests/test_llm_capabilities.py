"""Per-column → capability-tag mapping in compute_capabilities."""
from types import SimpleNamespace

import pytest


def _row(
    *,
    modalities_input=("text",),
    modalities_output=("text",),
    supports_reasoning=False,
    supports_tool_call=False,
    supports_attachment=False,
    supports_structured_output=False,
):
    """Minimal catalog-row stand-in. ``compute_capabilities`` reads attributes
    only, so a SimpleNamespace works in place of a real ORM row."""
    return SimpleNamespace(
        modalities_input=list(modalities_input),
        modalities_output=list(modalities_output),
        supports_reasoning=supports_reasoning,
        supports_tool_call=supports_tool_call,
        supports_attachment=supports_attachment,
        supports_structured_output=supports_structured_output,
    )


@pytest.mark.parametrize(
    "field,value,expected_tag",
    [
        ("modalities_input", ("image",), "image_input"),
        ("modalities_input", ("audio",), "audio_input"),
        ("modalities_input", ("video",), "video_input"),
        ("modalities_input", ("pdf",), "pdf_input"),
        ("modalities_output", ("audio",), "audio_output"),
        ("supports_reasoning", True, "reasoning"),
        ("supports_tool_call", True, "tool_call"),
        ("supports_attachment", True, "attachment"),
        ("supports_structured_output", True, "structured_output"),
    ],
)
def test_individual_field_maps_to_tag(field, value, expected_tag):
    from app.services.llm_credentials.capabilities import compute_capabilities
    row = _row(**{field: value})
    assert expected_tag in compute_capabilities(row)


def test_default_text_only_row_has_text_in_text_out_only():
    from app.services.llm_credentials.capabilities import compute_capabilities
    assert compute_capabilities(_row()) == frozenset({"text_input", "text_output"})


def test_tool_call_without_structured_output_anthropic_style():
    """Some Anthropic-family rows carry supports_tool_call=True but
    supports_structured_output=False — the helper must NOT infer structured
    output from tool-call support (catalog truth wins)."""
    from app.services.llm_credentials.capabilities import compute_capabilities
    row = _row(supports_tool_call=True, supports_structured_output=False)
    tags = compute_capabilities(row)
    assert "tool_call" in tags
    assert "structured_output" not in tags


def test_empty_modalities_lists_do_not_blow_up():
    from app.services.llm_credentials.capabilities import compute_capabilities
    row = _row(modalities_input=(), modalities_output=())
    assert compute_capabilities(row) == frozenset()


def test_full_multimodal_row_yields_all_relevant_tags():
    from app.services.llm_credentials.capabilities import compute_capabilities
    row = _row(
        modalities_input=("text", "image", "audio", "video", "pdf"),
        modalities_output=("text", "audio"),
        supports_reasoning=True,
        supports_tool_call=True,
        supports_attachment=True,
        supports_structured_output=True,
    )
    assert compute_capabilities(row) == frozenset({
        "text_input", "text_output",
        "image_input", "audio_input", "video_input", "pdf_input",
        "audio_output",
        "reasoning", "tool_call", "attachment", "structured_output",
    })


def test_returned_set_is_frozen():
    from app.services.llm_credentials.capabilities import compute_capabilities
    tags = compute_capabilities(_row())
    assert isinstance(tags, frozenset)
