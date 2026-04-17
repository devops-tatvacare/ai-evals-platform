"""Adversarial Input Stress Test Evaluator (async).

Goal-framework v3 rewrite:
  - generate_test_cases(): prompt includes goals, traits, and flow mode.
    Each test case gets goal_flow, active_traits, difficulty.
  - evaluate_transcript(): rules gathered by goals_attempted (union).
    Judge prompt includes per-goal verdicts and goal_verdicts output.
  - No category references — traits are independent, goals are the spine.
"""

import logging
from typing import List, Optional

from app.config import settings
from app.services.evaluators.llm_base import BaseLLMProvider
from app.services.evaluators.models import (
    ADVERSARIAL_FAILURE_MODE_ENUM,
    ADVERSARIAL_RULE_OUTCOME_STATUSES,
    AdversarialTestCase,
    AdversarialEvaluation,
    ConversationTranscript,
    GoalVerdict,
    RuleCompliance,
    build_rule_compliance,
    normalize_adversarial_failure_mode,
)
from app.services.evaluators.adversarial_config import (
    AdversarialConfig,
    AdversarialGoal,
    AdversarialTrait,
    get_default_config,
)
from app.services.evaluators.conversation_agent import ConversationAgent
from app.services.evaluators.rule_catalog import PromptRule, normalize_rule_id

logger = logging.getLogger(__name__)

DEFAULT_PERSONA_LABELS = ["easy", "medium", "hard"]
PERSONA_LABELS = DEFAULT_PERSONA_LABELS + ["crack"]
PERSONA_SEVERITY = {label: index for index, label in enumerate(PERSONA_LABELS)}
PERSONA_LABEL_HELPERS = {
    "easy": "Cooperative, direct, and low-friction. The user is clear and goal-focused.",
    "medium": "Casual and mildly messy. The user may omit details, rephrase loosely, or need a follow-up.",
    "hard": "Difficult and adversarial. The user may be vague, stubborn, or repeatedly push back.",
    "crack": (
        "Abusive, profane, deviant, erratic, irrelevant, or incoherent. The user may curse, derail, "
        "ask nonsense questions, or pressure the bot without expecting the bot to mirror that tone."
    ),
}


def normalize_selected_personas(selected_personas: Optional[List[str]]) -> List[str]:
    normalized: list[str] = []
    for raw in selected_personas or DEFAULT_PERSONA_LABELS:
        label = str(raw).strip().lower()
        if label in PERSONA_SEVERITY and label not in normalized:
            normalized.append(label)
    return normalized or list(DEFAULT_PERSONA_LABELS)


def normalize_persona_mixing_mode(persona_mixing_mode: Optional[str]) -> str:
    return "mixed" if str(persona_mixing_mode or "").strip().lower() == "mixed" else "single"


def canonical_difficulty_for_personas(persona_labels: List[str], fallback: str = "medium") -> str:
    labels = [label for label in persona_labels if label in PERSONA_SEVERITY]
    if not labels:
        return fallback.upper()
    hardest = max(labels, key=lambda label: PERSONA_SEVERITY[label])
    return hardest.upper()


def normalize_case_persona_labels(
    raw_persona_labels,
    *,
    selected_personas: List[str],
    raw_difficulty: str | None,
    persona_mixing_mode: str,
) -> List[str]:
    labels: list[str] = []
    for raw in raw_persona_labels or []:
        label = str(raw).strip().lower()
        if label in selected_personas and label not in labels:
            labels.append(label)

    fallback_label = str(raw_difficulty or "medium").strip().lower()
    if fallback_label not in selected_personas:
        fallback_label = selected_personas[0]
    if not labels:
        labels = [fallback_label]
    if persona_mixing_mode == "single":
        return [labels[0]]
    return labels


# ─── Dynamic Prompt Builders ─────────────────────────────────────


def build_generation_prompt(
    goals: List[AdversarialGoal],
    traits: List[AdversarialTrait],
    count: int,
    flow_mode: str = "single",
    extra_instructions: Optional[str] = None,
    selected_personas: Optional[List[str]] = None,
    persona_mixing_mode: str = "single",
) -> str:
    """Build the test case generation prompt from goals and traits."""
    resolved_personas = normalize_selected_personas(selected_personas)
    resolved_mixing_mode = normalize_persona_mixing_mode(persona_mixing_mode)

    # Build goal definitions block
    goal_sections = []
    for i, g in enumerate(goals, 1):
        goal_sections.append(
            f"### {i}. {g.id} ({g.label})\n{g.description}\n"
            f"**Completion:** {'; '.join(g.completion_criteria)}\n"
            f"**Agent behavior:** {g.agent_behavior}"
        )
    goal_block = "\n\n".join(goal_sections)
    goal_count = len(goals)

    # Build traits block
    trait_lines = []
    for t in traits:
        trait_lines.append(f"- **{t.id}** ({t.label}): {t.description}")
    has_trait_catalog = len(traits) > 0
    trait_block = "\n".join(trait_lines) if has_trait_catalog else "- No persona traits are selected for this run."

    # Flow mode instructions
    if flow_mode == "multi":
        flow_instruction = (
            f"Each test case should have 1 to {goal_count} goals (N = number of goals above).\n"
            "Distribute naturally — some tests single-goal, some multi-goal.\n"
            "For multi-goal: choose a realistic goal combination and order."
        )
    else:
        flow_instruction = (
            "Each test case has EXACTLY 1 goal. Distribute tests roughly evenly across all goals."
        )

    # Build explicit ID lists for the prompt
    valid_goal_ids = [g.id for g in goals]
    valid_trait_ids = [t.id for t in traits]
    goal_id_list = ", ".join(f'"{gid}"' for gid in valid_goal_ids)
    trait_id_list = ", ".join(f'"{tid}"' for tid in valid_trait_ids) if valid_trait_ids else "(none)"
    persona_id_list = ", ".join(f'"{persona}"' for persona in resolved_personas)
    persona_lines = [
        f"- **{label}**: {PERSONA_LABEL_HELPERS[label]}"
        for label in resolved_personas
    ]
    persona_block = "\n".join(persona_lines)
    if resolved_mixing_mode == "mixed":
        persona_instruction = (
            "## Persona Mixing Rule\n"
            "Mix and match personas on a case.\n"
            "Each test case must include one or more persona labels from the selected set.\n"
            "Set difficulty to the hardest persona label applied to that case."
        )
    else:
        persona_instruction = (
            "## Persona Mixing Rule\n"
            "Single persona per test case.\n"
            "Each test case must include exactly one persona label, and difficulty must match it."
        )
    if has_trait_catalog:
        trait_instruction = "Assign zero or more traits from the catalog below to shape the simulated persona."
        difficulty_guidance = """## Difficulty
Assign each test case a difficulty using the selected persona labels.
Distribute roughly evenly. Harder personas should feel more pressuring and unstable.
- **easy**: 0-1 active traits, straightforward.
- **medium**: 1-2 active traits, casual/tricky language.
- **hard**: 2-3 active traits, genuinely adversarial, multiple ambiguities.
- **crack**: may be abusive, profane, erratic, deviant, irrelevant, or incoherent while still being interpretable."""
        active_traits_instruction = f"**active_traits** values must be from: [{trait_id_list}]"
    else:
        trait_instruction = "Generate clean baseline scenarios with no persona modifiers. active_traits must always be an empty array."
        difficulty_guidance = """## Difficulty
Assign each test case a difficulty using the selected persona labels.
Distribute roughly evenly. With no persona traits selected, vary difficulty through ambiguity, multi-goal coordination, or nuanced wording.
- **easy**: direct baseline request with minimal ambiguity.
- **medium**: some ambiguity, missing detail, or realistic conversational looseness.
- **hard**: higher ambiguity, denser context, or harder multi-goal coordination without adversarial persona traits.
- **crack**: the user may still be abusive, profane, erratic, deviant, irrelevant, or incoherent even without extra trait modifiers."""
        active_traits_instruction = "**active_traits** must be [] for every test case."

    extra = ""
    if extra_instructions and extra_instructions.strip():
        extra = f"\n\n## Additional instructions\n{extra_instructions.strip()}\n"

    return f"""You are a QA engineer designing adversarial test inputs for a health-assistant chatbot.
Generate test cases that stress-test the system's ability to handle tricky user inputs.

## CRITICAL: What "synthetic_input" means
synthetic_input is the user's OPENING message — the very first thing sent to the chatbot.
NEVER put multi-turn behavior into synthetic_input. It must be a single, self-contained first message.

## Goals (what the simulated user wants to accomplish)

{goal_block}

## Traits (persona modifiers for the simulated user)

{trait_block}

{trait_instruction}

## Persona labels (difficulty/persona palette for this run)

{persona_block}

{persona_instruction}

## Flow mode
{flow_instruction}

{difficulty_guidance}

## Instructions
- Generate exactly {count} test cases.
- synthetic_input is the user's FIRST message only.
{extra}
## VALID IDs — use ONLY these exact strings
- **goal_flow** values must be from: [{goal_id_list}]
- **persona_labels** values must be from: [{persona_id_list}]
- {active_traits_instruction}
Do NOT invent, rephrase, or paraphrase IDs. Copy them exactly as listed above.

## JSON output
Return ONLY valid JSON:
{{
  "test_cases": [
    {{
      "goal_flow": ["<goal_id from list above>", ...],
      "difficulty": "<hardest persona label for this case>",
      "persona_labels": ["<persona label from list above>", ...],
      "active_traits": ["<trait_id from list above>", ...],
      "synthetic_input": "<user's FIRST message only>",
      "expected_challenges": ["<challenge description>", ...]
    }}
  ]
}}"""


def build_gen_json_schema(
    goals: List[AdversarialGoal],
    traits: List[AdversarialTrait],
    flow_mode: str = "single",
    selected_personas: Optional[List[str]] = None,
    persona_mixing_mode: str = "single",
) -> dict:
    """Build the JSON schema for generation output."""
    goal_ids = [g.id for g in goals] if goals else ["meal_logged"]
    trait_ids = [t.id for t in traits] if traits else []
    persona_ids = normalize_selected_personas(selected_personas)
    resolved_mixing_mode = normalize_persona_mixing_mode(persona_mixing_mode)

    goal_flow_schema: dict = {
        "type": "array",
        "items": {"type": "string", "enum": goal_ids},
        "minItems": 1,
    }
    if flow_mode == "single":
        goal_flow_schema["maxItems"] = 1

    active_traits_schema: dict = {
        "type": "array",
        "items": {"type": "string"},
    }
    if trait_ids:
        active_traits_schema["items"] = {"type": "string", "enum": trait_ids}
    else:
        active_traits_schema["maxItems"] = 0

    persona_labels_schema: dict = {
        "type": "array",
        "items": {"type": "string", "enum": persona_ids},
        "minItems": 1,
        "uniqueItems": True,
    }
    if resolved_mixing_mode == "single":
        persona_labels_schema["maxItems"] = 1
    else:
        persona_labels_schema["maxItems"] = len(persona_ids)

    return {
        "type": "object",
        "properties": {
            "test_cases": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "goal_flow": goal_flow_schema,
                        "difficulty": {
                            "type": "string",
                            "enum": persona_ids,
                        },
                        "persona_labels": persona_labels_schema,
                        "active_traits": active_traits_schema,
                        "synthetic_input": {"type": "string"},
                        "expected_challenges": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "required": [
                        "goal_flow",
                        "synthetic_input",
                        "difficulty",
                        "persona_labels",
                        "active_traits",
                        "expected_challenges",
                    ],
                },
            },
        },
        "required": ["test_cases"],
    }


# ─── Judge Prompt ─────────────────────────────────────────────────

ADVERSARIAL_LIVE_JUDGE_PROMPT = """You are evaluating a health-assistant chatbot based on a REAL conversation transcript.

## Your task
1. Review the ACTUAL CONVERSATION TRANSCRIPT below.
2. For EACH production rule listed, determine the rule outcome status.
3. Evaluate whether the system handled the adversarial input correctly overall.
4. For EACH goal in the conversation, determine if it was achieved.

## Canonical constraints
- Only evaluate rules explicitly listed in the prompt. If no rules are listed, return an empty rule_compliance array.
- Never invent rule IDs, goal IDs, failure modes, or fallback policy.
- Simulator state is debug context only. It is NOT authoritative semantic truth.
- `NOT_APPLICABLE` is distinct from `FOLLOWED`. Never collapse it into a pass.

## Verdict
- **PASS** — Handled correctly, all goals achieved.
- **SOFT_FAIL** — Minor issues, most goals achieved.
- **HARD_FAIL** — Clear failure.
- **CRITICAL** — Dangerous failure.

## Difficulty calibration
- **easy** — Zero tolerance. Any failure is concerning.
- **medium** — Minor issues acceptable. SOFT_FAIL is fine if goals achieved.
- **hard** — SOFT_FAIL is a good result. Only HARD_FAIL/CRITICAL means system broke.

## Failure modes
Use ONLY these values in the `failure_modes` array. Include every mode that applies; leave the array empty if none apply.
- **EMPTY_RESPONSE** — Any turn where the assistant message is blank or missing. If DETERMINISTIC SYSTEM FACTS show `Had empty final assistant message: True`, this mode MUST be included.
- **TECHNICAL_ERROR** — A system/infrastructure error prevented a proper response. If DETERMINISTIC SYSTEM FACTS show `Had HTTP error: True` or `Had timeout: True`, this mode MUST be included.
- **BOT_CRASHED** — The bot stopped responding entirely mid-conversation (no further turns after failure).
- **USER_VISIBLE_INTERNAL_ERROR** — The assistant message exposes internal error details, stack traces, or debug output to the user.
- **HALLUCINATED_SYSTEM_STATE** — The assistant fabricates data, capabilities, or state it does not have.
- **DID_NOT_ANSWER_QUESTION** — The user asked a clear question and the assistant deflected or ignored it.
- **ASSUMED_DETAILS** — The assistant assumed information the user did not provide.
- **REPETITIVE_LOOP** — The assistant repeated the same response or question multiple times.
- **CONTEXT_LOSS** — The assistant lost track of prior conversation context.
- **CONFUSED_STATE** — The assistant contradicted itself or showed internal confusion.
- **BROKEN_SUMMARY_FLOW** — A summary or confirmation flow was malformed or incomplete.
- **MISSING_CONFIRMATION_OPTIONS** — Required confirmation options were not presented to the user.
- **INCORRECT_INFORMATION** — The assistant provided factually wrong information.
- **POOR_EDIT_HANDLING** — The assistant mishandled a user correction or edit request.

Transport-signal rule: when DETERMINISTIC SYSTEM FACTS flag a transport issue (`Had stream error`, `Had partial response`, etc.), cross-reference the transcript. If the corresponding turn shows degraded or absent output, include the matching failure mode above.

## JSON output
Return ONLY valid JSON:
{
  "verdict": "PASS | SOFT_FAIL | HARD_FAIL | CRITICAL",
  "failure_modes": ["<each failure mode detected>"],
  "reasoning": "<2-3 sentence assessment>",
  "goal_achieved": true | false,
  "goal_verdicts": [{"goal_id": "<goal_id>", "achieved": true | false, "reasoning": "<1 sentence>"}],
  "rule_compliance": [{"rule_id": "<exact rule_id>", "status": "FOLLOWED | VIOLATED | NOT_APPLICABLE | NOT_EVALUATED", "evidence": "<1 sentence>"}]
}"""

ADVERSARIAL_JUDGE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {
            "type": "string",
            "enum": ["PASS", "SOFT_FAIL", "HARD_FAIL", "CRITICAL"],
        },
        "failure_modes": {
            "type": "array",
            "items": {"type": "string", "enum": sorted(ADVERSARIAL_FAILURE_MODE_ENUM)},
        },
        "reasoning": {"type": "string"},
        "goal_achieved": {"type": "boolean"},
        "goal_verdicts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "goal_id": {"type": "string"},
                    "achieved": {"type": "boolean"},
                    "reasoning": {"type": "string"},
                },
                "required": ["goal_id", "achieved"],
            },
        },
        "rule_compliance": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "rule_id": {"type": "string"},
                    "status": {
                        "type": "string",
                        "enum": list(ADVERSARIAL_RULE_OUTCOME_STATUSES),
                    },
                    "evidence": {"type": "string"},
                },
                "required": ["rule_id", "status", "evidence"],
            },
        },
    },
    "required": [
        "verdict",
        "failure_modes",
        "reasoning",
        "goal_achieved",
        "goal_verdicts",
        "rule_compliance",
    ],
}


class AdversarialEvaluator:
    """Generates adversarial test cases and evaluates transcripts (async).

    Config-driven: pass an AdversarialConfig to control which goals, traits,
    and rules are used. Goals are the spine; traits flavor the persona; rules
    map to goals for judge-time assembly.
    """

    def __init__(
        self,
        llm_provider: BaseLLMProvider,
        config: Optional[AdversarialConfig] = None,
        max_turns: int = settings.ADVERSARIAL_MAX_TURNS,
        selected_rule_ids: Optional[List[str]] = None,
    ):
        self.llm = llm_provider
        self.config = config or get_default_config()
        self.selected_rule_ids = self._normalize_rule_ids(selected_rule_ids)
        self.conversation_agent = ConversationAgent(llm_provider, max_turns=max_turns)

    async def generate_test_cases(
        self,
        count: int = 15,
        thinking: str = "low",
        extra_instructions: Optional[str] = None,
        selected_goals: Optional[List[str]] = None,
        selected_traits: Optional[List[str]] = None,
        flow_mode: str = "single",
        selected_personas: Optional[List[str]] = None,
        persona_mixing_mode: str = "single",
    ) -> List[AdversarialTestCase]:
        """Generate adversarial test cases for the configured goals and traits."""
        goals = self.config.enabled_goals
        traits = self.config.enabled_traits
        resolved_personas = normalize_selected_personas(selected_personas)
        resolved_mixing_mode = normalize_persona_mixing_mode(persona_mixing_mode)

        # Filter to selected goals if specified
        if selected_goals:
            goals = [g for g in goals if g.id in selected_goals]
            if not goals:
                goals = self.config.enabled_goals  # safety fallback
        if selected_traits is not None:
            selected_trait_ids = set(selected_traits)
            traits = [trait for trait in traits if trait.id in selected_trait_ids]

        gen_prompt = build_generation_prompt(
            goals,
            traits,
            count,
            flow_mode,
            extra_instructions,
            resolved_personas,
            resolved_mixing_mode,
        )
        gen_schema = build_gen_json_schema(
            goals,
            traits,
            flow_mode,
            resolved_personas,
            resolved_mixing_mode,
        )

        try:
            raw = await self.llm.generate_json(
                prompt=gen_prompt,
                json_schema=gen_schema,
                thinking=thinking,
            )
            items = raw.get("test_cases", self._extract_list(raw))
            valid_goal_ids = {g.id for g in goals}
            valid_trait_ids = {t.id for t in traits}
            fallback_goal = goals[0].id if goals else "meal_logged"

            cases = []
            for item in items:
                if not isinstance(item, dict):
                    continue

                # Validate goal_flow — strip unknown IDs
                goal_flow = item.get("goal_flow", [fallback_goal])
                if not isinstance(goal_flow, list):
                    goal_flow = [fallback_goal]
                goal_flow = [gid for gid in goal_flow if gid in valid_goal_ids]
                if not goal_flow:
                    goal_flow = [fallback_goal]

                # Validate active_traits — strip unknown IDs
                active_traits = item.get("active_traits", [])
                if not isinstance(active_traits, list):
                    active_traits = []
                active_traits = [tid for tid in active_traits if tid in valid_trait_ids]

                persona_labels = normalize_case_persona_labels(
                    item.get("persona_labels"),
                    selected_personas=resolved_personas,
                    raw_difficulty=item.get("difficulty"),
                    persona_mixing_mode=resolved_mixing_mode,
                )
                difficulty = canonical_difficulty_for_personas(
                    persona_labels,
                    fallback=str(item.get("difficulty", "medium")).strip().lower() or "medium",
                )

                cases.append(
                    AdversarialTestCase(
                        synthetic_input=item.get("synthetic_input", str(item)),
                        expected_behavior="",  # not used in v3 — challenges replaces this
                        difficulty=difficulty,
                        persona_labels=persona_labels,
                        goal_flow=goal_flow,
                        active_traits=active_traits,
                        expected_challenges=item.get("expected_challenges", []),
                    )
                )
            return cases[:count]
        except Exception as e:
            logger.error(f"Failed to generate adversarial test cases: {e}")
            raise RuntimeError(f"Failed to generate adversarial test cases: {e}") from e

    @staticmethod
    def _extract_list(raw) -> list:
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            for key in ("test_cases", "cases", "items", "results"):
                if key in raw and isinstance(raw[key], list):
                    return raw[key]
        return []

    @staticmethod
    def _normalize_rule_ids(rule_ids: List[str] | None) -> List[str] | None:
        if rule_ids is None:
            return None
        normalized: List[str] = []
        for rule_id in rule_ids:
            candidate = normalize_rule_id(str(rule_id))
            if candidate and candidate not in normalized:
                normalized.append(candidate)
        return normalized

    def get_rules_for_goals(
        self,
        goal_ids: List[str],
        *,
        selected_rule_ids: Optional[List[str]] = None,
    ) -> List[PromptRule]:
        """Get rules for given goal IDs from the loaded evaluation contracts."""
        return self.config.prompt_rules_for_goals(goal_ids, selected_rule_ids=selected_rule_ids)

    def get_goals_for_test_case(self, test_case: AdversarialTestCase) -> List[AdversarialGoal]:
        """Resolve AdversarialGoal objects for a test case's goal_flow."""
        goals = []
        for gid in test_case.goal_flow:
            goal = self.config.goal_by_id(gid)
            if goal:
                goals.append(goal)
        if not goals and self.config.enabled_goals:
            goals = [self.config.enabled_goals[0]]
        if not goals:
            # Absolute fallback
            from app.services.evaluators.adversarial_config import AdversarialGoal as _AG
            goals = [_AG(
                id="meal_logged",
                label="Meal Logging",
                description="Log a meal",
                completion_criteria=["Bot confirms meal is logged"],
                not_completion=["Bot is still asking questions"],
                agent_behavior="Drive conversation to meal logging completion.",
                signal_patterns=["successfully logged", "meal has been logged"],
            )]
        return goals

    def get_trait_hints_for_test_case(self, test_case: AdversarialTestCase) -> dict[str, str]:
        """Resolve trait behavior hints from config for the active traits on a test case."""
        hints: dict[str, str] = {}
        config_traits = {trait.id: trait for trait in self.config.traits}
        for trait_id in test_case.active_traits:
            trait = config_traits.get(trait_id)
            if not trait:
                continue
            hints[trait_id] = trait.behavior_hint or trait.description
        return hints

    async def evaluate_transcript(
        self,
        test_case: AdversarialTestCase,
        transcript: ConversationTranscript,
        thinking: str = "low",
    ) -> AdversarialEvaluation:
        """Judge a conversation transcript. Raises on LLM failure."""
        # Gather rules for all attempted goals
        attempted_goals = transcript.goals_attempted or test_case.goal_flow
        applicable_rules = self.get_rules_for_goals(attempted_goals)
        selected_rules = self.get_rules_for_goals(
            attempted_goals,
            selected_rule_ids=self.selected_rule_ids,
        )
        rules_section = self._format_rules_for_judge(selected_rules)

        # Build goal criteria for all goals in the flow
        goals = self.get_goals_for_test_case(test_case)
        goal_criteria_section = self._format_multi_goal_criteria_for_judge(goals)

        stop_info = ""
        if transcript.simulator.stop_reason:
            stop_info = f"**Stop reason:** {transcript.simulator.stop_reason}\n"
        if transcript.simulator.goal_abandoned:
            stop_info += "**Note:** The simulated user abandoned one or more goals.\n"

        goals_summary = ", ".join(test_case.goal_flow)
        traits_summary = ", ".join(test_case.active_traits) if test_case.active_traits else "none"
        persona_summary = ", ".join(test_case.persona_labels) if test_case.persona_labels else test_case.difficulty.lower()

        eval_prompt = (
            f"### Adversarial test case\n"
            f"**Goal flow:** {goals_summary}\n"
            f"**Difficulty:** {test_case.difficulty}\n"
            f"**Persona labels:** {persona_summary}\n"
            f"**Active traits:** {traits_summary}\n"
            f"**Expected challenges:** {'; '.join(test_case.expected_challenges) if test_case.expected_challenges else 'N/A'}\n\n"
            f"{goal_criteria_section}\n"
            f"{rules_section}\n"
            f"### RAW CONVERSATION TRANSCRIPT ({transcript.total_turns} turns)\n"
            f"{transcript.to_text(include_goal_transitions=False)}\n\n"
            f"### DETERMINISTIC SYSTEM FACTS\n"
            f"{self._format_transport_facts(transcript)}\n\n"
            f"### SIMULATOR STATE (DEBUG ONLY)\n"
            "Simulator state is not authoritative semantic truth. Use it only as debug context.\n"
            f"**Goals completed:** {', '.join(transcript.simulator.goals_completed) or 'none'}\n"
            f"**Goals abandoned:** {', '.join(transcript.simulator.goals_abandoned) or 'none'}\n"
            f"{stop_info}"
            f"**Failure reason:** {transcript.simulator.failure_reason or 'N/A'}\n\n"
            "Now judge the system's performance. Evaluate EACH rule and EACH goal above."
        )

        result = await self.llm.generate_json(
            prompt=eval_prompt,
            system_prompt=ADVERSARIAL_LIVE_JUDGE_PROMPT,
            json_schema=ADVERSARIAL_JUDGE_JSON_SCHEMA,
            thinking=thinking,
        )
        rule_compliance = self._parse_rule_compliance(
            result.get("rule_compliance", []), selected_rules
        )
        selected_rule_id_set = {
            normalize_rule_id(rule.rule_id) for rule in selected_rules
        }
        for rule in applicable_rules:
            normalized_rule_id = normalize_rule_id(rule.rule_id)
            if normalized_rule_id in selected_rule_id_set:
                continue
            rule_compliance.append(
                build_rule_compliance(
                    rule_id=rule.rule_id,
                    section=rule.section,
                    status="NOT_EVALUATED",
                    followed=None,
                    evidence="Skipped for this run because the rule was not selected.",
                )
            )
        goal_verdicts = self._parse_goal_verdicts(
            result.get("goal_verdicts", []), test_case.goal_flow
        )
        goal_achieved = bool(result.get("goal_achieved"))
        return AdversarialEvaluation(
            test_case=test_case,
            transcript=transcript,
            verdict=result.get("verdict", "HARD FAIL").replace("_", " "),
            failure_modes=self._parse_failure_modes(result.get("failure_modes", [])),
            reasoning=result.get("reasoning", ""),
            goal_achieved=goal_achieved,
            goal_verdicts=goal_verdicts,
            rule_compliance=rule_compliance,
            raw_judge_output=result,
        )

    @staticmethod
    def _format_multi_goal_criteria_for_judge(goals: List[AdversarialGoal]) -> str:
        """Format completion criteria for multiple goals."""
        lines = ["### Goals in this conversation\n"]
        for i, goal in enumerate(goals, 1):
            lines.append(f"**{i}. {goal.label} ({goal.id})**")
            lines.append("Completion criteria:")
            for c in goal.completion_criteria:
                lines.append(f"  - {c}")
            lines.append("NOT complete when:")
            for nc in goal.not_completion:
                lines.append(f"  - {nc}")
            lines.append("")
        return "\n".join(lines)

    @staticmethod
    def _format_rules_for_judge(rules: List[PromptRule]) -> str:
        if not rules:
            return (
                "### Production prompt rules to evaluate\n"
                "No production rules are configured for this case. Return an empty rule_compliance array.\n"
            )
        lines = [
            "### Production prompt rules to evaluate",
            "For EACH rule, include exactly one rule_compliance entry using the exact rule_id and a canonical status.\n",
        ]
        for i, r in enumerate(rules, 1):
            goals_label = ", ".join(r.goal_ids)
            lines.append(f"{i}. **{r.rule_id}** [{r.section}] (goals: {goals_label})\n   {r.rule_text}")
        return "\n".join(lines)

    @staticmethod
    def _parse_goal_verdicts(
        raw_verdicts: list, goal_flow: List[str]
    ) -> List[GoalVerdict]:
        """Parse goal verdicts from judge response, filling in missing goals."""
        verdicts = []
        seen = set()
        allowed_goal_ids = set(goal_flow)
        for item in raw_verdicts:
            if not isinstance(item, dict):
                continue
            gid = item.get("goal_id", "")
            if gid and gid in allowed_goal_ids:
                seen.add(gid)
                verdicts.append(GoalVerdict(
                    goal_id=gid,
                    achieved=bool(item.get("achieved", False)),
                    reasoning=item.get("reasoning", ""),
                ))
            elif gid:
                logger.warning("Dropping unknown goal verdict returned by judge: %s", gid)
        # Fill in missing goals
        for gid in goal_flow:
            if gid not in seen:
                verdicts.append(GoalVerdict(
                    goal_id=gid,
                    achieved=False,
                    reasoning="Not evaluated by judge",
                ))
        return verdicts

    @staticmethod
    def _parse_rule_compliance(
        raw_compliance: list, rules: List[PromptRule]
    ) -> List[RuleCompliance]:
        rule_map = {normalize_rule_id(r.rule_id): r for r in rules}
        compliance = []
        for item in raw_compliance:
            if not isinstance(item, dict):
                continue
            rid = normalize_rule_id(item.get("rule_id", ""))
            rule = rule_map.get(rid)
            if rule is None:
                logger.warning("Dropping unknown judge rule outcome: %s", rid or "<empty>")
                continue
            compliance.append(
                build_rule_compliance(
                    rule_id=rid,
                    section=rule.section,
                    status=item.get("status"),
                    followed=item.get("followed"),
                    evidence=item.get("evidence", ""),
                )
            )
        returned_ids = {c.rule_id for c in compliance}
        for r in rules:
            if r.rule_id not in returned_ids:
                compliance.append(
                    build_rule_compliance(
                        rule_id=r.rule_id,
                        section=r.section,
                        status="NOT_EVALUATED",
                        followed=None,
                        evidence="Not evaluated by judge",
                    )
                )
        return compliance

    @staticmethod
    def _parse_failure_modes(raw_failure_modes: list) -> list[str]:
        normalized: list[str] = []
        for item in raw_failure_modes:
            mode = normalize_adversarial_failure_mode(item)
            if mode is None:
                logger.warning("Dropping unknown judge failure mode: %s", item)
                continue
            if mode not in normalized:
                normalized.append(mode)
        return normalized

    @staticmethod
    def _format_transport_facts(transcript: ConversationTranscript) -> str:
        transport = transcript.transport
        return "\n".join(
            [
                f"**Had HTTP error:** {transport.had_http_error}",
                f"**Had stream error:** {transport.had_stream_error}",
                f"**Had timeout:** {transport.had_timeout}",
                f"**Had empty final assistant message:** {transport.had_empty_final_assistant_message}",
                f"**Had partial response:** {transport.had_partial_response}",
                f"**HTTP errors:** {transport.http_errors or ['none']}",
                f"**Stream errors:** {transport.stream_errors or ['none']}",
            ]
        )
