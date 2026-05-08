"""Data models for the evaluation system.

Ported from kaira-evals/src/data/models.py — adapted for the backend.
These are in-memory dataclasses used during evaluation runs.
Final results get persisted to PostgreSQL via SQLAlchemy models.
"""

from dataclasses import dataclass, field, fields
from datetime import datetime
from typing import Optional, List, Dict, Literal, Any
import re
import uuid


# ─── Serialization Helpers ────────────────────────────────────────

_DATACLASS_REGISTRY: Dict[str, type] = {}


def _register(cls):
    _DATACLASS_REGISTRY[cls.__name__] = cls
    return cls


def serialize(obj: Any) -> Any:
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, datetime):
        return {"__type__": "datetime", "value": obj.isoformat()}
    if isinstance(obj, set):
        return list(obj)
    if isinstance(obj, list):
        return [serialize(item) for item in obj]
    if isinstance(obj, dict):
        return {k: serialize(v) for k, v in obj.items()}
    if hasattr(obj, "__dataclass_fields__"):
        data = {"__type__": type(obj).__name__}
        for f in fields(obj):
            data[f.name] = serialize(getattr(obj, f.name))
        return data
    return str(obj)


def deserialize(data: Any, target_type: type = None) -> Any:
    if data is None:
        return None
    if isinstance(data, (str, int, float, bool)):
        return data
    if isinstance(data, list):
        return [deserialize(item) for item in data]
    if isinstance(data, dict):
        type_name = data.get("__type__")
        if type_name == "datetime":
            return datetime.fromisoformat(data["value"])
        if type_name and type_name in _DATACLASS_REGISTRY:
            cls = _DATACLASS_REGISTRY[type_name]
            kwargs = {}
            for f in fields(cls):
                if f.name in data:
                    kwargs[f.name] = deserialize(data[f.name])
            return cls(**kwargs)
        return {k: deserialize(v) for k, v in data.items() if k != "__type__"}
    return data


class SerializableMixin:
    def to_dict(self) -> Dict[str, Any]:
        return serialize(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SerializableMixin":
        if "__type__" not in data:
            data = {**data, "__type__": cls.__name__}
        return deserialize(data)


RULE_OUTCOME_STATUSES = (
    "FOLLOWED",
    "VIOLATED",
    "NOT_APPLICABLE",
    "NOT_EVALUATED",
)

ADVERSARIAL_RULE_OUTCOME_STATUSES = RULE_OUTCOME_STATUSES

ADVERSARIAL_FAILURE_MODE_ENUM = {
    "ASSUMED_DETAILS",
    "REPETITIVE_LOOP",
    "CONTEXT_LOSS",
    "CONFUSED_STATE",
    "HALLUCINATED_SYSTEM_STATE",
    "USER_VISIBLE_INTERNAL_ERROR",
    "DID_NOT_ANSWER_QUESTION",
    "BROKEN_SUMMARY_FLOW",
    "MISSING_CONFIRMATION_OPTIONS",
    "INCORRECT_INFORMATION",
    "BOT_CRASHED",
    "EMPTY_RESPONSE",
    "TECHNICAL_ERROR",
    "POOR_EDIT_HANDLING",
}

_FAILURE_MODE_ALIASES = {
    "ASSUMED_DETAIL": "ASSUMED_DETAILS",
    "ASSUMED_INFORMATION": "ASSUMED_DETAILS",
    "DETAILS_ASSUMED": "ASSUMED_DETAILS",
    "REPETITIVE": "REPETITIVE_LOOP",
    "LOOPING": "REPETITIVE_LOOP",
    "LOOP": "REPETITIVE_LOOP",
    "STATE_CONFUSION": "CONFUSED_STATE",
    "CONFUSION": "CONFUSED_STATE",
    "SYSTEM_STATE_HALLUCINATION": "HALLUCINATED_SYSTEM_STATE",
    "HALLUCINATED_STATE": "HALLUCINATED_SYSTEM_STATE",
    "INTERNAL_ERROR_LEAK": "USER_VISIBLE_INTERNAL_ERROR",
    "USER_VISIBLE_ERROR": "USER_VISIBLE_INTERNAL_ERROR",
    "USER_VISIBLE_INTERNAL_ERRORS": "USER_VISIBLE_INTERNAL_ERROR",
    "FAILED_TO_ANSWER_QUESTION": "DID_NOT_ANSWER_QUESTION",
    "DIDNT_ANSWER_QUESTION": "DID_NOT_ANSWER_QUESTION",
    "NO_ANSWER": "DID_NOT_ANSWER_QUESTION",
    "QUESTION_NOT_ANSWERED": "DID_NOT_ANSWER_QUESTION",
    "BROKEN_SUMMARY": "BROKEN_SUMMARY_FLOW",
    "SUMMARY_FLOW_BROKEN": "BROKEN_SUMMARY_FLOW",
    "MISSING_CONFIRMATION_OPTION": "MISSING_CONFIRMATION_OPTIONS",
    "MISSING_CONFIRM_OPTIONS": "MISSING_CONFIRMATION_OPTIONS",
    "INCORRECT_INFO": "INCORRECT_INFORMATION",
    "WRONG_INFORMATION": "INCORRECT_INFORMATION",
    "BOT_CRASH": "BOT_CRASHED",
    "BOT_CRASHES": "BOT_CRASHED",
    "EMPTY_ASSISTANT_MESSAGE": "EMPTY_RESPONSE",
    "NO_RESPONSE": "EMPTY_RESPONSE",
    "TECH_ERROR": "TECHNICAL_ERROR",
    "TECHNICAL_ISSUE": "TECHNICAL_ERROR",
    "POOR_EDITS": "POOR_EDIT_HANDLING",
    "BAD_EDIT_HANDLING": "POOR_EDIT_HANDLING",
}


def normalize_rule_outcome_status(
    raw_status: str | None,
    followed: Optional[bool] = None,
) -> str:
    if raw_status:
        normalized = re.sub(r"[^A-Za-z0-9]+", "_", str(raw_status)).strip("_").upper()
        if normalized in RULE_OUTCOME_STATUSES:
            return normalized
    if followed is True:
        return "FOLLOWED"
    if followed is False:
        return "VIOLATED"
    return "NOT_EVALUATED"


def normalize_rule_outcome(
    raw_status: str | None,
    followed: Optional[bool] = None,
) -> tuple[str, Optional[bool]]:
    status = normalize_rule_outcome_status(raw_status, followed)
    if status == "FOLLOWED":
        return status, True
    if status == "VIOLATED":
        return status, False
    return status, None


def normalize_adversarial_failure_mode(raw_mode: str | None) -> str | None:
    if not raw_mode:
        return None
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", str(raw_mode)).strip("_").upper()
    normalized = _FAILURE_MODE_ALIASES.get(normalized, normalized)
    if normalized in ADVERSARIAL_FAILURE_MODE_ENUM:
        return normalized
    return None


# ─── Timestamp Parsing ─────────────────────────────────────────────


def _parse_timestamp(raw: str) -> datetime:
    """Parse a timestamp string, supporting ISO 8601 and common CSV formats.

    Tries fromisoformat first (handles YYYY-MM-DD, ISO 8601 with T/Z),
    then falls back to pandas.to_datetime with dayfirst=True for formats
    like DD/MM/YY H:MM.
    """
    try:
        return datetime.fromisoformat(raw)
    except (ValueError, TypeError):
        import pandas as pd

        return pd.to_datetime(raw, dayfirst=True).to_pydatetime()


# ─── Raw Data Models ───────────────────────────────────────────────


@_register
@dataclass
class ChatMessage(SerializableMixin):
    """Represents a single chat interaction."""

    timestamp: datetime
    user_id: str
    session_id: str
    thread_id: str
    response_id: str
    query_text: str
    intent_detected: str
    intent_query_type: str
    final_response_message: str
    has_image: bool
    error_message: Optional[str]

    @classmethod
    def from_csv_row(cls, row: dict) -> "ChatMessage":
        import pandas as pd

        return cls(
            timestamp=_parse_timestamp(row["timestamp"]),
            user_id=row["user_id"],
            session_id=row["session_id"],
            thread_id=row["thread_id"],
            response_id="" if pd.isna(row["response_id"]) else row["response_id"],
            query_text=row["query_text"],
            intent_detected=row["intent_detected"],
            intent_query_type=""
            if pd.isna(row["intent_query_type"])
            else row["intent_query_type"],
            final_response_message=row["final_response_message"],
            has_image=bool(int(row["has_image"])),
            error_message=None
            if pd.isna(row["error_message"]) or not row["error_message"]
            else row["error_message"],
        )

    @property
    def is_meal_summary(self) -> bool:
        """Keyword-based pre-filter to skip correctness evaluation on non-meal turns.

        This is a heuristic (not exhaustive). It intentionally errs on the side of
        inclusion — false positives are cheap (the LLM will return NOT_APPLICABLE)
        while false negatives would skip legitimate meal summaries.
        """
        indicators = [
            "total calories",
            "kcal",
            "meal summary",
            "consumed at",
            # Broader indicators to reduce false negatives (F4)
            "calories",
            "cal ",
            "protein",
            "carbs",
            "carbohydrate",
            "fat",
            "nutrition",
            "macros",
            "logged your meal",
            "meal logged",
            "food logged",
        ]
        resp = self.final_response_message.lower()
        return any(ind in resp for ind in indicators)


@_register
@dataclass
class ConversationThread(SerializableMixin):
    """Represents a complete conversation thread."""

    thread_id: str
    user_id: str
    messages: List[ChatMessage]
    start_time: datetime
    end_time: datetime
    duration_seconds: float
    message_count: int
    has_errors: bool

    @property
    def intents(self) -> List[str]:
        return [msg.intent_detected for msg in self.messages]

    @property
    def meal_summary_messages(self) -> List[ChatMessage]:
        return [m for m in self.messages if m.is_meal_summary]


# ─── Evaluation Result Models ──────────────────────────────────────


@_register
@dataclass
class IntentEvaluation(SerializableMixin):
    message: ChatMessage
    predicted_intent: str
    predicted_query_type: str
    confidence: float
    is_correct_intent: bool
    is_correct_query_type: Optional[bool]  # None when ground truth unavailable
    reasoning: str
    all_predictions: dict


@_register
@dataclass
class RuleCompliance(SerializableMixin):
    rule_id: str
    section: str
    followed: Optional[bool]
    evidence: str = ""
    status: Optional[str] = None

    def __post_init__(self) -> None:
        self.status, self.followed = normalize_rule_outcome(self.status, self.followed)


def build_rule_compliance(
    *,
    rule_id: str,
    section: str,
    evidence: str = "",
    status: str | None = None,
    followed: Optional[bool] = None,
) -> RuleCompliance:
    return RuleCompliance(
        rule_id=rule_id,
        section=section,
        evidence=evidence,
        status=status,
        followed=followed,
    )


@_register
@dataclass
class CorrectnessEvaluation(SerializableMixin):
    message: ChatMessage
    verdict: Literal["PASS", "SOFT FAIL", "HARD FAIL", "CRITICAL", "NOT APPLICABLE"]
    calorie_sanity: Dict = field(default_factory=dict)
    arithmetic_consistency: Dict = field(default_factory=dict)
    quantity_coherence: Dict = field(default_factory=dict)
    reasoning: str = ""
    has_image_context: bool = False
    rule_compliance: List[RuleCompliance] = field(default_factory=list)


@_register
@dataclass
class EfficiencyEvaluation(SerializableMixin):
    thread: ConversationThread
    verdict: Literal["EFFICIENT", "ACCEPTABLE", "INCOMPLETE", "FRICTION", "BROKEN", "NOT APPLICABLE"]
    task_completed: bool
    friction_turns: List[Dict] = field(default_factory=list)
    recovery_quality: Literal["GOOD", "PARTIAL", "FAILED", "NOT NEEDED"] = "NOT NEEDED"
    failure_reason: str = ""
    reasoning: str = ""
    rule_compliance: List[RuleCompliance] = field(default_factory=list)
    thread_type: str = "meal_logging"
    incomplete_reason: str = ""


# ─── Adversarial Stress Test ───────────────────────────────────────


@_register
@dataclass
class ConversationTurn(SerializableMixin):
    turn_number: int
    user_message: str
    bot_response: str
    detected_intent: Optional[str] = None
    thread_id: Optional[str] = None
    session_id: Optional[str] = None
    response_id: Optional[str] = None
    goal_signals: Optional[Dict] = None  # turn-level annotation from signal detection
    # Structured assistant widget rendered by Kaira on this turn (food/bp/vitals/unknown).
    # Shape: {"kind": str, "data": dict, "is_known": bool}. None when no widget was emitted.
    assistant_widget: Optional[Dict[str, Any]] = None
    # User-side action descriptor when this turn was an auto-confirm button press.
    # Shape: {"kind": str, "label": str, "wire": str, "verbs": list[str]?, "payload": dict}.
    # None when the user message was free-form text.
    user_action: Optional[Dict[str, Any]] = None


@_register
@dataclass
class GoalTransition(SerializableMixin):
    goal_id: str
    event: str  # "started", "completed", "abandoned"
    at_turn: int


@_register
@dataclass
class GoalVerdict(SerializableMixin):
    goal_id: str
    achieved: bool
    reasoning: str = ""


@_register
@dataclass
class TransportFacts(SerializableMixin):
    had_http_error: bool = False
    had_stream_error: bool = False
    had_timeout: bool = False
    had_empty_final_assistant_message: bool = False
    had_partial_response: bool = False
    http_errors: List[str] = field(default_factory=list)
    stream_errors: List[str] = field(default_factory=list)
    # Forward-compat: widget kinds Kaira emitted that this platform version did
    # not recognize. Graders should down-weight or exclude cases that hit this.
    unsupported_widget_kinds: List[str] = field(default_factory=list)


@_register
@dataclass
class SimulatorState(SerializableMixin):
    goal_achieved: bool = False
    goal_abandoned: bool = False
    goals_attempted: List[str] = field(default_factory=list)
    goals_completed: List[str] = field(default_factory=list)
    goals_abandoned: List[str] = field(default_factory=list)
    goal_transitions: List[GoalTransition] = field(default_factory=list)
    stop_reason: str = ""
    failure_reason: str = ""


@_register
@dataclass
class ConversationTranscript(SerializableMixin):
    turns: List[ConversationTurn] = field(default_factory=list)
    goal_achieved: bool = False  # legacy mirror of simulator.goal_achieved
    goal_abandoned: bool = False  # legacy mirror of simulator.goal_abandoned
    total_turns: int = 0
    failure_reason: str = ""  # legacy mirror of simulator.failure_reason
    stop_reason: str = ""  # legacy mirror of simulator.stop_reason
    goals_attempted: List[str] = field(default_factory=list)  # legacy mirror
    goals_completed: List[str] = field(default_factory=list)  # legacy mirror
    goals_abandoned: List[str] = field(default_factory=list)  # legacy mirror
    goal_transitions: List[GoalTransition] = field(default_factory=list)  # legacy mirror
    transport: TransportFacts = field(default_factory=TransportFacts)
    simulator: SimulatorState = field(default_factory=SimulatorState)

    def __post_init__(self) -> None:
        if not self.simulator.goals_attempted and self.goals_attempted:
            self.simulator.goals_attempted = list(self.goals_attempted)
        if not self.simulator.goals_completed and self.goals_completed:
            self.simulator.goals_completed = list(self.goals_completed)
        if not self.simulator.goals_abandoned and self.goals_abandoned:
            self.simulator.goals_abandoned = list(self.goals_abandoned)
        if not self.simulator.goal_transitions and self.goal_transitions:
            self.simulator.goal_transitions = list(self.goal_transitions)
        if not self.simulator.stop_reason and self.stop_reason:
            self.simulator.stop_reason = self.stop_reason
        if not self.simulator.failure_reason and self.failure_reason:
            self.simulator.failure_reason = self.failure_reason
        if not self.simulator.goal_achieved and self.goal_achieved:
            self.simulator.goal_achieved = self.goal_achieved
        if not self.simulator.goal_abandoned and self.goal_abandoned:
            self.simulator.goal_abandoned = self.goal_abandoned
        self.sync_legacy_fields()

    def add_turn(self, turn: ConversationTurn):
        self.turns.append(turn)
        self.total_turns = len(self.turns)

    def sync_legacy_fields(self) -> None:
        self.goal_achieved = self.simulator.goal_achieved
        self.goal_abandoned = self.simulator.goal_abandoned
        self.failure_reason = self.simulator.failure_reason
        self.stop_reason = self.simulator.stop_reason
        self.goals_attempted = list(self.simulator.goals_attempted)
        self.goals_completed = list(self.simulator.goals_completed)
        self.goals_abandoned = list(self.simulator.goals_abandoned)
        self.goal_transitions = list(self.simulator.goal_transitions)

    def record_transport_response(self, response: Any) -> None:
        stream_errors = list(getattr(response, "stream_errors", []) or [])
        if stream_errors:
            self.transport.had_stream_error = True
        for error in stream_errors:
            if error not in self.transport.stream_errors:
                self.transport.stream_errors.append(error)
        if getattr(response, "had_partial_response", False):
            self.transport.had_partial_response = True
        if getattr(response, "had_empty_final_assistant_message", False):
            self.transport.had_empty_final_assistant_message = True
        for kind in getattr(response, "unsupported_widget_kinds", []) or []:
            if kind not in self.transport.unsupported_widget_kinds:
                self.transport.unsupported_widget_kinds.append(kind)

    def record_transport_error(self, error: Any) -> None:
        kind = getattr(error, "kind", "")
        message = str(error)
        if kind == "timeout":
            self.transport.had_timeout = True
        else:
            self.transport.had_http_error = True
        if message and message not in self.transport.http_errors:
            self.transport.http_errors.append(message)

    def to_text(self, include_goal_transitions: bool = True) -> str:
        lines = []
        transitions_at: Dict[int, List[GoalTransition]] = {}
        if include_goal_transitions:
            for gt in self.simulator.goal_transitions:
                transitions_at.setdefault(gt.at_turn, []).append(gt)

        for turn in self.turns:
            lines.append(f"Turn {turn.turn_number}:")
            user_prefix = "User"
            if turn.user_action:
                # Mark this as a button press so the judge LLM sees the same
                # grounding the human reviewer does (matches the chip-style UI).
                user_prefix = (
                    f"User [ACTION: {turn.user_action.get('label', 'confirm')} "
                    f"(kind={turn.user_action.get('kind', 'unknown')})]"
                )
            lines.append(f"  {user_prefix}: {turn.user_message}")
            lines.append(f"  Bot: {turn.bot_response}")
            if turn.assistant_widget:
                kind = turn.assistant_widget.get("kind", "unknown")
                is_known = turn.assistant_widget.get("is_known", True)
                marker = f"[WIDGET: {kind}]" if is_known else f"[WIDGET: {kind} — UNSUPPORTED]"
                lines.append(f"  {marker}")
            if turn.detected_intent:
                lines.append(f"  Intent: {turn.detected_intent}")
            for gt in transitions_at.get(turn.turn_number, []):
                lines.append(f"  ── {gt.event.upper()}: {gt.goal_id} (turn {gt.at_turn}) ──")
        return "\n".join(lines)


@_register
@dataclass
class AdversarialTestCase(SerializableMixin):
    synthetic_input: str
    expected_behavior: str
    difficulty: Literal["EASY", "MEDIUM", "HARD", "CRACK", "MORIARTY"]
    persona_labels: List[str] = field(default_factory=list)
    goal_flow: List[str] = field(default_factory=lambda: ["meal_logged"])
    active_traits: List[str] = field(default_factory=list)
    expected_challenges: List[str] = field(default_factory=list)


@_register
@dataclass
class EvaluationRunAdversarialResult(SerializableMixin):
    test_case: AdversarialTestCase
    transcript: ConversationTranscript
    verdict: Literal["PASS", "SOFT FAIL", "HARD FAIL", "CRITICAL"]
    failure_modes: List[str] = field(default_factory=list)
    reasoning: str = ""
    goal_achieved: bool = False  # rollup: ALL goals completed
    goal_verdicts: List[GoalVerdict] = field(default_factory=list)
    rule_compliance: List[RuleCompliance] = field(default_factory=list)
    raw_judge_output: Dict[str, Any] = field(default_factory=dict)


# ─── Composite Thread Evaluation ──────────────────────────────────


@_register
@dataclass
class EvaluationRunThreadResult(SerializableMixin):
    thread: ConversationThread
    intent_evaluations: List[IntentEvaluation] = field(default_factory=list)
    correctness_evaluations: List[CorrectnessEvaluation] = field(default_factory=list)
    efficiency_evaluation: Optional[EfficiencyEvaluation] = None
    flow_pattern: str = "not_analyzed"
    success_status: bool = False

    @property
    def intent_accuracy(self) -> float:
        if not self.intent_evaluations:
            return 0.0
        correct = sum(1 for e in self.intent_evaluations if e.is_correct_intent)
        return correct / len(self.intent_evaluations)

    @property
    def worst_correctness_verdict(self) -> str:
        severity = ["NOT APPLICABLE", "PASS", "SOFT FAIL", "HARD FAIL", "CRITICAL"]
        worst = "NOT APPLICABLE"
        for e in self.correctness_evaluations:
            if severity.index(e.verdict) > severity.index(worst):
                worst = e.verdict
        return worst


# ─── Run Metadata ─────────────────────────────────────────────────


@_register
@dataclass
class RunMetadata(SerializableMixin):
    run_id: str = ""
    command: str = ""
    timestamp: str = ""
    llm_provider: str = ""
    llm_model: str = ""
    eval_temperature: float = 0.0
    data_path: str = ""
    data_file_hash: str = ""
    flags: Dict[str, Any] = field(default_factory=dict)
    duration_seconds: float = 0.0
    status: Literal["RUNNING", "COMPLETED", "FAILED"] = "RUNNING"
    error_message: Optional[str] = None
    summary: Dict[str, Any] = field(default_factory=dict)
    total_items: int = 0

    @staticmethod
    def new_run_id() -> str:
        return str(uuid.uuid4())


# ─── Kaira Session Protocol ──────────────────────────────────────


@dataclass
class KairaSessionState:
    """Tracks Kaira API session identifiers across turns.

    Shared protocol for building request payloads and syncing session
    identifiers from SSE chunk events.
    NOT registered in _DATACLASS_REGISTRY — operational state only.
    """

    user_id: str = ""
    session_id: Optional[str] = None
    new_session: bool = True       # True on first turn; set False after classification chunk
    timezone: str = "Asia/Kolkata"

    def build_request_payload(self, query: str) -> Dict[str, Any]:
        """Build the correct API request payload for first vs subsequent messages."""
        payload: Dict[str, Any] = {
            "user_id": self.user_id,
            "message": query,
            "new_session": self.new_session,
            "timezone": self.timezone,
        }
        if not self.new_session:
            if not self.session_id:
                raise ValueError("session_id required for subsequent messages")
            payload["session_id"] = self.session_id
        return payload

    def apply_chunk(self, chunk: Dict[str, Any]) -> None:
        """Sync session_id from the classification chunk.

        The classification chunk is always first and is the only chunk
        that carries session_id in the new API.
        """
        if chunk.get("type") == "classification":
            if chunk.get("session_id"):
                self.session_id = chunk["session_id"]
            self.new_session = False
