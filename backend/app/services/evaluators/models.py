"""Data models for the evaluation system.

Ported from kaira-evals/src/data/models.py — adapted for the backend.
These are in-memory dataclasses used during evaluation runs.
Final results get persisted to PostgreSQL via SQLAlchemy models.
"""
from dataclasses import dataclass, field, fields
from datetime import datetime
from typing import Optional, List, Dict, Literal, Any
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
            intent_query_type="" if pd.isna(row["intent_query_type"]) else row["intent_query_type"],
            final_response_message=row["final_response_message"],
            has_image=bool(int(row["has_image"])),
            error_message=None if pd.isna(row["error_message"]) or not row["error_message"] else row["error_message"],
        )

    @property
    def is_meal_summary(self) -> bool:
        indicators = ["total calories", "kcal", "meal summary", "consumed at"]
        resp = self.final_response_message.lower()
        return any(ind in resp for ind in indicators)

    @property
    def is_confirmation(self) -> bool:
        return "yes, log this meal" in self.query_text.lower() or "confirm" in self.query_text.lower()


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
    def is_successful(self) -> bool:
        if self.has_errors or not self.messages:
            return False
        last = self.messages[-1]
        return "successfully" in last.final_response_message.lower() or "logged" in last.final_response_message.lower()

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
    is_correct_query_type: bool
    reasoning: str
    all_predictions: dict


@_register
@dataclass
class RuleCompliance(SerializableMixin):
    rule_id: str
    section: str
    followed: bool
    evidence: str = ""


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
    verdict: Literal["EFFICIENT", "ACCEPTABLE", "FRICTION", "BROKEN"]
    task_completed: bool
    friction_turns: List[Dict] = field(default_factory=list)
    recovery_quality: Literal["GOOD", "PARTIAL", "FAILED", "NOT NEEDED"] = "NOT NEEDED"
    abandonment_reason: str = ""
    reasoning: str = ""
    rule_compliance: List[RuleCompliance] = field(default_factory=list)


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


@_register
@dataclass
class ConversationTranscript(SerializableMixin):
    turns: List[ConversationTurn] = field(default_factory=list)
    goal_achieved: bool = False
    goal_type: str = ""
    total_turns: int = 0
    abandonment_reason: str = ""

    def add_turn(self, turn: ConversationTurn):
        self.turns.append(turn)
        self.total_turns = len(self.turns)

    def to_text(self) -> str:
        lines = []
        for turn in self.turns:
            lines.append(f"Turn {turn.turn_number}:")
            lines.append(f"  User: {turn.user_message}")
            lines.append(f"  Bot: {turn.bot_response}")
            if turn.detected_intent:
                lines.append(f"  Intent: {turn.detected_intent}")
        return "\n".join(lines)


@_register
@dataclass
class AdversarialTestCase(SerializableMixin):
    category: str  # Dynamic — validated against config categories, not hardcoded
    synthetic_input: str
    expected_behavior: str
    difficulty: Literal["EASY", "MEDIUM", "HARD"]
    goal_type: str = "meal_logged"


@_register
@dataclass
class AdversarialEvaluation(SerializableMixin):
    test_case: AdversarialTestCase
    transcript: ConversationTranscript
    verdict: Literal["PASS", "SOFT FAIL", "HARD FAIL", "CRITICAL"]
    failure_modes: List[str] = field(default_factory=list)
    reasoning: str = ""
    goal_achieved: bool = False
    rule_compliance: List[RuleCompliance] = field(default_factory=list)


# ─── Composite Thread Evaluation ──────────────────────────────────

@_register
@dataclass
class ThreadEvaluation(SerializableMixin):
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
    identifiers from ANY SSE chunk type the server returns.
    NOT registered in _DATACLASS_REGISTRY — operational state only.
    """
    user_id: str = ""
    thread_id: Optional[str] = None
    session_id: Optional[str] = None
    response_id: Optional[str] = None
    is_first_message: bool = True

    def build_request_payload(self, query: str) -> Dict[str, Any]:
        """Build the correct API request payload for first vs subsequent messages."""
        payload: Dict[str, Any] = {
            "query": query,
            "user_id": self.user_id,
            "context": {"additionalProp1": {}},
            "stream": False,
        }
        if self.is_first_message:
            payload["session_id"] = self.user_id
            payload["end_session"] = True
        else:
            if not self.session_id or not self.thread_id:
                raise ValueError("session_id and thread_id required for subsequent messages")
            payload["session_id"] = self.session_id
            payload["thread_id"] = self.thread_id
            payload["end_session"] = False
        return payload

    def apply_chunk(self, chunk: Dict[str, Any]) -> None:
        """Sync session identifiers from ANY chunk type.

        Called on every parsed SSE chunk during streaming.
        Updates thread_id, session_id, and response_id from whichever
        chunk type carries them (stream_start, session_context,
        session_start, agent_response, session_end).
        """
        chunk_type = chunk.get("type")

        if chunk_type == "stream_start":
            if chunk.get("thread_id"):
                self.thread_id = chunk["thread_id"]

        elif chunk_type == "session_context":
            self.thread_id = chunk.get("thread_id") or self.thread_id
            self.session_id = chunk.get("session_id") or self.session_id
            self.response_id = chunk.get("response_id") or self.response_id
            if self.is_first_message:
                self.is_first_message = False

        elif chunk_type == "session_start":
            if chunk.get("thread_id"):
                self.thread_id = chunk["thread_id"]

        elif chunk_type == "agent_response":
            if chunk.get("thread_id"):
                self.thread_id = chunk["thread_id"]
            if chunk.get("response_id"):
                self.response_id = chunk["response_id"]

        elif chunk_type == "session_end":
            if chunk.get("thread_id"):
                self.thread_id = chunk["thread_id"]
