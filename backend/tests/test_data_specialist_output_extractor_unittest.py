"""Phase 1A follow-up — as_tool output extractor pulls submit_sql JSON.

Investigation (2026-05-10): when the supervisor calls ``data_specialist``
via ``Agent.as_tool``, the SDK's documented default is "last message
from the agent will be used" as the tool output. That swallows the
``SpecialistResult`` JSON that ``submit_sql`` produced, and the
supervisor sees only the LLM's prose. Downstream the wire event for
``specialist_finished`` carries empty evidence_refs / artifact_refs /
0ms duration, and ``artifact_emitted`` never fires for chart payloads.

This test pins the extractor that fixes the boundary loss:
``extract_data_specialist_output`` walks ``RunResult.new_items``
backward, finds the most recent ``submit_sql`` ToolCallOutputItem, and
returns its raw JSON string. Falls back to ``final_output`` text when
no submit_sql output exists.
"""
from __future__ import annotations

import json
import unittest
from dataclasses import dataclass, field
from typing import Any

from app.services.sherlock_v3.data_specialist import (
    extract_data_specialist_output,
)


# ── stubs that mimic the SDK shapes the extractor reads ────────────


@dataclass
class _RawToolOutput:
    name: str = 'submit_sql'
    type: str = 'function_call_output'


@dataclass
class _ToolOutputItem:
    output: Any
    raw_item: Any = field(default_factory=_RawToolOutput)
    type: str = 'tool_call_output_item'


@dataclass
class _MessageItem:
    type: str = 'message_output_item'


@dataclass
class _RunResultStub:
    new_items: list[Any]
    final_output: str = 'fallback message'


# ── tests ──────────────────────────────────────────────────────────


class ExtractorPullsLastSubmitSqlOutputTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_last_submit_sql_output_string(self) -> None:
        first_payload = json.dumps({
            'kind': 'data', 'status': 'error', 'summary': 'first try failed',
            'evidence': [], 'artifacts': [], 'state_delta': {}, 'meta': {},
        })
        second_payload = json.dumps({
            'kind': 'data', 'status': 'ok', 'summary': '16 rows',
            'evidence': [{'ref_id': 'ev1'}],
            'artifacts': [{'kind': 'chart', 'payload': {'kind': 'chart'}}],
            'state_delta': {}, 'meta': {'latency_ms': 56},
        })
        run = _RunResultStub(new_items=[
            _MessageItem(),
            _ToolOutputItem(output=first_payload),
            _MessageItem(),
            _ToolOutputItem(output=second_payload),
            _MessageItem(),  # data_specialist's final answer message
        ])

        result = await extract_data_specialist_output(run)

        self.assertEqual(result, second_payload)
        # Roundtrips to the SpecialistResult shape so the supervisor
        # boundary picks up evidence + artifacts.
        decoded = json.loads(result)
        self.assertEqual(decoded['status'], 'ok')
        self.assertEqual(decoded['evidence'][0]['ref_id'], 'ev1')
        self.assertEqual(decoded['meta']['latency_ms'], 56)


class ExtractorFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_tool_output_returns_final_output_text(self) -> None:
        # Clarifying-question turn: the LLM answered without calling
        # submit_sql. The extractor returns the final-answer text so
        # the SDK's default behaviour is preserved.
        run = _RunResultStub(
            new_items=[_MessageItem(), _MessageItem()],
            final_output='Could you clarify which app you mean?',
        )
        result = await extract_data_specialist_output(run)
        self.assertEqual(result, 'Could you clarify which app you mean?')

    async def test_dict_output_serialized_as_json(self) -> None:
        # Belt-and-braces: if a future SDK change hands us a dict
        # instead of a string, json-serialize it so ``json.loads``
        # downstream still works.
        payload_dict = {'kind': 'data', 'status': 'ok', 'summary': 'x'}
        run = _RunResultStub(new_items=[_ToolOutputItem(output=payload_dict)])
        result = await extract_data_specialist_output(run)
        self.assertEqual(json.loads(result), payload_dict)

    async def test_empty_new_items_returns_empty_string_or_final(self) -> None:
        run = _RunResultStub(new_items=[], final_output='')
        result = await extract_data_specialist_output(run)
        self.assertEqual(result, '')

    async def test_non_string_final_output_returns_empty(self) -> None:
        run = _RunResultStub(new_items=[], final_output=None)  # type: ignore[arg-type]
        result = await extract_data_specialist_output(run)
        self.assertEqual(result, '')


class ExtractorHandlesAlternateRawShapesTests(unittest.IsolatedAsyncioTestCase):
    async def test_dict_raw_item_with_matching_name(self) -> None:
        run = _RunResultStub(new_items=[
            _ToolOutputItem(
                output='{"kind":"data","status":"ok"}',
                raw_item={'type': 'function_call_output', 'name': 'submit_sql'},
            ),
        ])
        result = await extract_data_specialist_output(run)
        self.assertEqual(result, '{"kind":"data","status":"ok"}')

    async def test_raw_item_attribute_with_matching_name(self) -> None:
        @dataclass
        class _AltRaw:
            name: str = 'submit_sql'

        run = _RunResultStub(new_items=[
            _ToolOutputItem(
                output='{"kind":"data","status":"ok"}',
                raw_item=_AltRaw(),
            ),
        ])
        result = await extract_data_specialist_output(run)
        self.assertEqual(result, '{"kind":"data","status":"ok"}')


if __name__ == '__main__':
    unittest.main()
