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


from app.services.chat_engine.gemini_adapter import GeminiAdapter


def test_gemini_adapter_implements_protocol():
    adapter = GeminiAdapter.__new__(GeminiAdapter)
    assert isinstance(adapter, ChatAdapter)


def test_gemini_build_user_message():
    from google.genai import types as genai_types

    adapter = GeminiAdapter.__new__(GeminiAdapter)
    msg = adapter.build_user_message("hello")
    assert isinstance(msg, genai_types.Content)
    assert msg.role == "user"
    assert msg.parts[0].text == "hello"


def test_gemini_build_tool_result():
    from google.genai import types as genai_types

    adapter = GeminiAdapter.__new__(GeminiAdapter)
    tc = ToolCall(id="call_1", name="list_section_types", arguments={})
    msg = adapter.build_tool_result(tc, '{"sections": []}')
    assert isinstance(msg, genai_types.Content)
    assert msg.role == "user"
    part = msg.parts[0]
    assert part.function_response.id == "call_1"
    assert part.function_response.name == "list_section_types"


def test_gemini_build_tool_results_batches_parallel_responses():
    from google.genai import types as genai_types

    adapter = GeminiAdapter.__new__(GeminiAdapter)
    tool_calls = [
        ToolCall(id="call_1", name="get_current_temperature", arguments={"location": "Paris"}),
        ToolCall(id="call_2", name="get_current_temperature", arguments={"location": "London"}),
    ]

    messages = adapter.build_tool_results(
        tool_calls,
        ['{"temp": "15C"}', '{"temp": "12C"}'],
    )

    assert len(messages) == 1
    msg = messages[0]
    assert isinstance(msg, genai_types.Content)
    assert msg.role == "user"
    assert len(msg.parts) == 2
    assert [part.function_response.id for part in msg.parts] == ["call_1", "call_2"]
    assert [part.function_response.name for part in msg.parts] == [
        "get_current_temperature",
        "get_current_temperature",
    ]


def test_gemini_serialize_deserialize_roundtrip():
    from google.genai import types as genai_types

    adapter = GeminiAdapter.__new__(GeminiAdapter)

    messages = [
        genai_types.Content(role="user", parts=[genai_types.Part.from_text(text="hello")]),
        genai_types.Content(role="model", parts=[genai_types.Part.from_text(text="hi there")]),
    ]

    serialized = adapter.serialize(messages)
    assert isinstance(serialized, list)
    assert isinstance(serialized[0], dict)

    deserialized = adapter.deserialize(serialized)
    assert len(deserialized) == 2
    assert deserialized[0].role == "user"
    assert deserialized[0].parts[0].text == "hello"
    assert deserialized[1].role == "model"
    assert deserialized[1].parts[0].text == "hi there"


import pytest
from unittest.mock import AsyncMock
from app.services.chat_engine.runner import run_tool_loop


class FakeAdapter:
    """Minimal adapter for testing the runner loop."""

    def __init__(self, responses: list):
        self._responses = list(responses)
        self._call_count = 0

    async def send(self, messages, tools, system, temperature):
        resp = self._responses[self._call_count]
        self._call_count += 1
        return resp

    def build_user_message(self, text):
        return {"role": "user", "content": text}

    def build_tool_result(self, tool_call, result):
        return {"role": "tool", "tool_call_id": tool_call.id, "content": result}

    def build_tool_results(self, tool_calls, results):
        return [
            self.build_tool_result(tool_call, result)
            for tool_call, result in zip(tool_calls, results, strict=True)
        ]

    def extract_response_message(self, response):
        return response["message"]

    def extract_tool_calls(self, response):
        return response.get("tool_calls", [])

    def extract_text(self, response):
        return response["message"].get("content", "")

    def serialize(self, messages):
        return messages

    def deserialize(self, data):
        return data

    async def send_stream(self, messages, tools, system, temperature):
        response = await self.send(messages, tools, system, temperature)
        if response["message"].get("content"):
            yield {"type": "text_delta", "delta": response["message"]["content"]}
        yield {"type": "response", "response": response}


@pytest.mark.asyncio
async def test_runner_no_tools():
    """When the LLM responds with text only, the loop returns immediately."""
    adapter = FakeAdapter([
        {"message": {"role": "assistant", "content": "Hello!"}, "tool_calls": []},
    ])
    dispatch = AsyncMock()

    messages = [{"role": "user", "content": "hi"}]
    text, out_messages = await run_tool_loop(
        adapter=adapter, messages=messages,
        tools=[], system="sys", temperature=0.3,
        dispatch_fn=dispatch,
    )
    assert text == "Hello!"
    assert len(out_messages) == 2  # user + assistant
    dispatch.assert_not_called()


@pytest.mark.asyncio
async def test_runner_one_tool_round():
    """LLM calls a tool, gets result, then responds with text."""
    tool_call = ToolCall(id="call_1", name="my_tool", arguments={"x": 1})
    adapter = FakeAdapter([
        {"message": {"role": "assistant", "content": None, "tool_calls": [{"id": "call_1"}]}, "tool_calls": [tool_call]},
        {"message": {"role": "assistant", "content": "Done!"}, "tool_calls": []},
    ])
    dispatch = AsyncMock(return_value='{"ok": true}')

    messages = [{"role": "user", "content": "do it"}]
    text, out_messages = await run_tool_loop(
        adapter=adapter, messages=messages,
        tools=[], system="sys", temperature=0.3,
        dispatch_fn=dispatch,
    )
    assert text == "Done!"
    dispatch.assert_called_once_with("my_tool", {"x": 1})
    assert len(out_messages) == 4  # user + assistant(tool_call) + tool_result + assistant(text)


@pytest.mark.asyncio
async def test_runner_batches_parallel_tool_results_when_adapter_supports_it():
    tool_calls = [
        ToolCall(id="call_1", name="weather", arguments={"location": "Paris"}),
        ToolCall(id="call_2", name="weather", arguments={"location": "London"}),
    ]

    class BatchAdapter(FakeAdapter):
        def build_tool_result(self, tool_call, result):
            raise AssertionError("runner should use batched tool results")

        def build_tool_results(self, tool_calls, results):
            return [{"role": "user", "parts": list(zip(tool_calls, results, strict=True))}]

    adapter = BatchAdapter([
        {"message": {"role": "assistant", "content": None, "tool_calls": [{"id": "call_1"}, {"id": "call_2"}]}, "tool_calls": tool_calls},
        {"message": {"role": "assistant", "content": "Done!"}, "tool_calls": []},
    ])
    dispatch = AsyncMock(side_effect=['{"temp": "15C"}', '{"temp": "12C"}'])

    messages = [{"role": "user", "content": "check weather"}]
    text, out_messages = await run_tool_loop(
        adapter=adapter,
        messages=messages,
        tools=[],
        system="sys",
        temperature=0.3,
        dispatch_fn=dispatch,
    )

    assert text == "Done!"
    assert dispatch.await_count == 2
    assert len(out_messages) == 4
    assert out_messages[2]["role"] == "user"


@pytest.mark.asyncio
async def test_runner_max_rounds():
    """If the LLM keeps calling tools beyond max_rounds, returns None."""
    tool_call = ToolCall(id="call_1", name="looper", arguments={})
    response = {"message": {"role": "assistant", "tool_calls": [{"id": "call_1"}]}, "tool_calls": [tool_call]}
    adapter = FakeAdapter([response, response, response])
    dispatch = AsyncMock(return_value='{}')

    messages = [{"role": "user", "content": "loop"}]
    text, out_messages = await run_tool_loop(
        adapter=adapter, messages=messages,
        tools=[], system="sys", temperature=0.3,
        dispatch_fn=dispatch, max_rounds=3,
    )
    assert text is None  # max rounds exceeded


@pytest.mark.asyncio
async def test_runner_streams_text_deltas_before_final_response():
    adapter = FakeAdapter([
        {"message": {"role": "assistant", "content": "Hello!"}, "tool_calls": []},
    ])
    dispatch = AsyncMock()
    on_text_delta = AsyncMock()

    messages = [{"role": "user", "content": "hi"}]
    text, out_messages = await run_tool_loop(
        adapter=adapter,
        messages=messages,
        tools=[],
        system="sys",
        temperature=0.3,
        dispatch_fn=dispatch,
        on_text_delta=on_text_delta,
    )

    assert text == "Hello!"
    on_text_delta.assert_awaited_once_with("Hello!")
    assert len(out_messages) == 2


from app.services.chat_engine import get_adapter_class


def test_get_adapter_class_gemini():
    cls = get_adapter_class("gemini")
    assert cls is GeminiAdapter


def test_get_adapter_class_openai():
    cls = get_adapter_class("openai")
    assert cls is OpenAIAdapter


def test_get_adapter_class_azure():
    cls = get_adapter_class("azure_openai")
    assert cls is OpenAIAdapter


def test_get_adapter_class_unknown():
    with pytest.raises(ValueError, match="Unsupported provider"):
        get_adapter_class("bedrock")
