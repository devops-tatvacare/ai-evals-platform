"""Unit tests for the chat_engine package."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.chat_engine.types import ToolCall


def test_tool_call_fields():
    tc = ToolCall(id="call_1", name="list_section_types", arguments={"foo": "bar"})
    assert tc.id == "call_1"
    assert tc.name == "list_section_types"
    assert tc.arguments == {"foo": "bar"}


def test_tool_call_empty_arguments():
    tc = ToolCall(id="call_2", name="get_detail", arguments={})
    assert tc.arguments == {}


from app.services.chat_engine.openai_adapter import OpenAIAdapter
from app.services.chat_engine.types import ChatAdapter


def test_openai_adapter_implements_protocol():
    adapter = OpenAIAdapter.__new__(OpenAIAdapter)
    assert isinstance(adapter, ChatAdapter)


def test_openai_build_user_message():
    adapter = OpenAIAdapter.__new__(OpenAIAdapter)
    msg = adapter.build_user_message("hello")
    assert msg == {"role": "user", "content": "hello"}


def test_openai_build_tool_result():
    adapter = OpenAIAdapter.__new__(OpenAIAdapter)
    tc = ToolCall(id="call_1", name="list_section_types", arguments={})
    msg = adapter.build_tool_result(tc, '{"sections": []}')
    assert msg == {"role": "tool", "tool_call_id": "call_1", "content": '{"sections": []}'}


def test_openai_extract_tool_calls_from_dict():
    adapter = OpenAIAdapter.__new__(OpenAIAdapter)
    response_msg = {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {"id": "call_abc", "type": "function", "function": {"name": "my_tool", "arguments": '{"x": 1}'}},
        ],
    }
    tcs = adapter._parse_tool_calls_from_message(response_msg)
    assert len(tcs) == 1
    assert tcs[0].id == "call_abc"
    assert tcs[0].name == "my_tool"
    assert tcs[0].arguments == {"x": 1}


def test_openai_serialize_deserialize_roundtrip():
    adapter = OpenAIAdapter.__new__(OpenAIAdapter)
    messages = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi there"},
        {"role": "assistant", "content": None, "tool_calls": [
            {"id": "call_1", "type": "function", "function": {"name": "foo", "arguments": "{}"}},
        ]},
        {"role": "tool", "tool_call_id": "call_1", "content": '{"ok": true}'},
    ]
    serialized = adapter.serialize(messages)
    deserialized = adapter.deserialize(serialized)
    assert deserialized == messages
