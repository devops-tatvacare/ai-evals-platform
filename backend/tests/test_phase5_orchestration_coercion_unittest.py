"""Phase 5 acceptance-gate tests (plan §Phase-5 → *Acceptance gates*).

Gates pinned here map 1:1 to the plan:

1. ``grep`` — no references to ``force_first_tool_call``,
   ``forced_tool_name``, or ``tool_choice = 'required'`` survive in the
   backend (plan §722).
2. ``prompts/base.py`` line count drops ≥30% from its pre-phase
   baseline of 83 lines (plan §723).
3. ``build_sherlock_agent`` sets ``tool_choice='auto'`` — no coercion
   path remains (plan §691, §699).

Gates 3 and 4 from the plan (replay-style reproducers that require
live LLM turns) are checked in the integration suite, not here.
"""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import MagicMock


_BACKEND_DIR = Path(__file__).resolve().parent.parent
_BASE_PROMPT_PATH = (
    _BACKEND_DIR / 'app' / 'services' / 'chat_engine' / 'prompts' / 'base.py'
)


class NoForcedToolSurfaceGate(unittest.TestCase):
    """Gate 1 — every coercion trigger regex has zero matches under
    ``backend/app``. Test surfaces are allowed to mention the historical
    names in comments but must not re-introduce the wiring."""

    def test_no_forced_tool_call_or_required_tool_choice_in_app_source(self):
        # Use ``git grep`` pinned to tracked files so the suite is stable
        # across dev caches / .pyc / worktrees.
        app_root = _BACKEND_DIR / 'app'
        result = subprocess.run(
            [
                'git', 'grep', '-nE',
                "force_first_tool_call|forced_tool_name|tool_choice\\s*=\\s*'required'",
                '--', str(app_root),
            ],
            cwd=_BACKEND_DIR.parent,
            capture_output=True,
            text=True,
            check=False,
        )
        # git grep returns 1 on zero matches — that's the good case.
        self.assertEqual(
            result.returncode, 1,
            f'Phase 5 §722: expected zero matches under backend/app, got:\n{result.stdout}',
        )


class PromptBaseLineCountGate(unittest.TestCase):
    """Gate 2 — ``prompts/base.py`` line count is ≤70% of the pre-phase
    baseline (plan §723). Baseline before Phase 5 was 83 lines."""

    PRE_PHASE_5_LINE_COUNT = 83

    def test_prompt_base_is_at_least_30_percent_smaller(self):
        text = _BASE_PROMPT_PATH.read_text()
        current = len(text.splitlines())
        limit = int(self.PRE_PHASE_5_LINE_COUNT * 0.7)
        self.assertLessEqual(
            current, limit,
            f'prompts/base.py is {current} lines; Phase 5 acceptance '
            f'requires ≤{limit} (30% drop from {self.PRE_PHASE_5_LINE_COUNT}).',
        )


class DuplicatedRulesAreGone(unittest.TestCase):
    """Gate 2 companion — specific rules the plan called out as
    duplicating runtime truth must not reappear in ``base.py``
    (plan §704-708)."""

    def test_chart_type_requests_block_is_gone(self):
        text = _BASE_PROMPT_PATH.read_text()
        self.assertNotIn('CHART TYPE REQUESTS', text)

    def test_never_invent_chart_axes_is_gone(self):
        text = _BASE_PROMPT_PATH.read_text()
        self.assertNotIn('Never invent chart axes', text)

    def test_deterministic_warnings_rule_is_gone(self):
        text = _BASE_PROMPT_PATH.read_text()
        self.assertNotRegex(text, r'Treat\s+deterministic\s+warnings')

    def test_discover_first_rule_is_gone(self):
        text = _BASE_PROMPT_PATH.read_text()
        self.assertNotRegex(text, r"Discover first\.")
        self.assertNotRegex(text, r'Resolve partial IDs')


class ToolChoiceIsAutoGate(unittest.TestCase):
    """Gate 3 — ``build_sherlock_agent`` sets ``tool_choice='auto'``.
    The forced parameters no longer exist in the signature."""

    def test_build_sherlock_agent_has_no_force_kwargs(self):
        import inspect

        from app.services.chat_engine.openai_agents_adapter import (
            build_sherlock_agent,
            run_sherlock_sdk_turn,
        )

        agent_params = set(inspect.signature(build_sherlock_agent).parameters.keys())
        turn_params = set(inspect.signature(run_sherlock_sdk_turn).parameters.keys())
        self.assertNotIn('force_first_tool_call', agent_params)
        self.assertNotIn('forced_tool_name', agent_params)
        self.assertNotIn('force_first_tool_call', turn_params)
        self.assertNotIn('forced_tool_name', turn_params)

    def test_build_sherlock_agent_tool_choice_is_auto(self):
        from app.services.chat_engine.openai_agents_adapter import build_sherlock_agent

        agent = build_sherlock_agent(
            instructions='sys',
            tools=[],
            model='gpt-5',
            client=MagicMock(),
        )
        self.assertEqual(agent.model_settings.tool_choice, 'auto')


class ChooseForcedToolNameIsDeleted(unittest.TestCase):
    """Chat handler no longer owns a coercion policy function."""

    def test_choose_forced_tool_name_is_not_defined(self):
        from app.services.report_builder import chat_handler

        self.assertFalse(
            hasattr(chat_handler, '_choose_forced_tool_name'),
            '_choose_forced_tool_name should be deleted per Phase 5 §700',
        )


if __name__ == '__main__':  # pragma: no cover
    unittest.main()
