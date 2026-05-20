"""Call-site enum. Add a new value here, drop a matching template pair."""
from enum import StrEnum


class CallSite(StrEnum):
    SIGNUP_INVITE = "mail.signup_invite"
    # Forward-declared; templates ship with the event-pipeline producer.
    SCHEDULED_JOB_FAILED = "mail.scheduled_job_failed"
    SCHEDULED_JOB_COMPLETED = "mail.scheduled_job_completed"
    WORKFLOW_RUN_FAILED = "mail.workflow_run_failed"
    WORKFLOW_RUN_COMPLETED = "mail.workflow_run_completed"
