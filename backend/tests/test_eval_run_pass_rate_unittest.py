"""Adversarial pass-rate derivation exposed on the runs list contract."""
from app.routes.eval_runs import _adversarial_pass_rate


def test_pass_rate_excludes_infra_errored_tests():
    summary = {
        "total_tests": 10,
        "infra_error_count": 2,
        "verdict_distribution": {"PASS": 4, "HARD FAIL": 4},
    }
    # 4 PASS over 8 successful (10 - 2 infra) = 0.5
    assert _adversarial_pass_rate("batch_adversarial", summary) == 0.5


def test_pass_rate_full_pass_no_infra():
    summary = {
        "total_tests": 5,
        "infra_error_count": 0,
        "verdict_distribution": {"PASS": 5},
    }
    assert _adversarial_pass_rate("batch_adversarial", summary) == 1.0


def test_pass_rate_none_for_non_adversarial():
    summary = {"average_score": 0.9, "verdict_distribution": {"PASS": 3}, "total_tests": 3}
    assert _adversarial_pass_rate("batch_thread", summary) is None
    assert _adversarial_pass_rate("custom", summary) is None


def test_pass_rate_none_when_summary_missing_counts():
    assert _adversarial_pass_rate("batch_adversarial", None) is None
    assert _adversarial_pass_rate("batch_adversarial", {}) is None
    assert _adversarial_pass_rate("batch_adversarial", {"total_tests": 4}) is None


def test_pass_rate_none_when_all_tests_errored():
    summary = {
        "total_tests": 3,
        "infra_error_count": 3,
        "verdict_distribution": {},
    }
    assert _adversarial_pass_rate("batch_adversarial", summary) is None


def test_pass_rate_falls_back_to_errors_key_for_denominator():
    # Older summaries carry only ``errors`` (alias of infra_error_count).
    summary = {
        "total_tests": 4,
        "errors": 0,
        "verdict_distribution": {"PASS": 3, "SOFT FAIL": 1},
    }
    assert _adversarial_pass_rate("batch_adversarial", summary) == 0.75


def test_run_to_dict_carries_pass_rate_for_adversarial(monkeypatch):
    import app.routes.eval_runs as mod

    monkeypatch.setattr(mod, "_build_evaluator_descriptors", lambda r: [])

    class _Run:
        id = "00000000-0000-0000-0000-000000000001"
        status = "completed"
        config = {}
        result = None
        summary = {
            "total_tests": 4,
            "infra_error_count": 0,
            "verdict_distribution": {"PASS": 3, "HARD FAIL": 1},
        }
        app_id = "kaira-bot"
        eval_type = "batch_adversarial"
        listing_id = session_id = evaluator_id = job_id = None
        error_message = None
        started_at = completed_at = created_at = shared_at = None
        duration_ms = None
        llm_provider = llm_model = None
        batch_metadata = None
        visibility = "private"
        shared_by = None
        tenant_id = "00000000-0000-0000-0000-0000000000aa"
        user_id = "00000000-0000-0000-0000-0000000000bb"
        latest_review_id = None

    out = mod._run_to_dict(_Run())
    assert out["passRate"] == 0.75


def test_run_to_dict_pass_rate_null_for_thread(monkeypatch):
    import app.routes.eval_runs as mod

    monkeypatch.setattr(mod, "_build_evaluator_descriptors", lambda r: [])

    class _Run:
        id = "00000000-0000-0000-0000-000000000002"
        status = "completed"
        config = {}
        result = None
        summary = {"average_score": 0.8}
        app_id = "kaira-bot"
        eval_type = "batch_thread"
        listing_id = session_id = evaluator_id = job_id = None
        error_message = None
        started_at = completed_at = created_at = shared_at = None
        duration_ms = None
        llm_provider = llm_model = None
        batch_metadata = None
        visibility = "private"
        shared_by = None
        tenant_id = "00000000-0000-0000-0000-0000000000aa"
        user_id = "00000000-0000-0000-0000-0000000000bb"
        latest_review_id = None

    out = mod._run_to_dict(_Run())
    assert out["passRate"] is None
