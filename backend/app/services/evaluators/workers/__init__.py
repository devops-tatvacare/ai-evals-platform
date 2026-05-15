"""Subject workers consumed by the evaluation runner shell.

A worker turns one EvaluableCall + the run's evaluators into a `WorkerOutput`
(transcript, per-evaluator outputs, signals). The shell handles persistence,
scoring aggregation, and lifecycle.

Workers are looked up by string key from App.config; the registry is the only
place that knows the mapping from key → callable.
"""

from __future__ import annotations

from typing import Awaitable, Callable

from app.services.evaluators.workers.audio_transcribe_evaluate import (
    audio_transcribe_evaluate,
)
from app.services.evaluators.workers.types import (
    EvaluatorSpec,
    WorkerContext,
    WorkerOutput,
)


# A worker takes (context, record) and returns the per-record output the
# shell will persist. EvaluableCall is the only record type today; future
# subjects (chat threads, web sessions) plug in by adding a new worker key
# and a new binding pair.
Worker = Callable[..., Awaitable[WorkerOutput]]


_REGISTRY: dict[str, Worker] = {
    "audio_transcribe_evaluate": audio_transcribe_evaluate,
}


class UnknownWorkerError(KeyError):
    """Raised when App.config references a worker key that isn't registered."""


def get_worker(key: str) -> Worker:
    try:
        return _REGISTRY[key]
    except KeyError as e:
        raise UnknownWorkerError(
            f"No worker registered for key '{key}'. Known keys: {sorted(_REGISTRY)}"
        ) from e


def register_worker(key: str, worker: Worker) -> None:
    if key in _REGISTRY and _REGISTRY[key] is not worker:
        raise ValueError(
            f"Worker key '{key}' already registered to a different callable"
        )
    _REGISTRY[key] = worker


__all__ = [
    "EvaluatorSpec",
    "UnknownWorkerError",
    "Worker",
    "WorkerContext",
    "WorkerOutput",
    "get_worker",
    "register_worker",
]
