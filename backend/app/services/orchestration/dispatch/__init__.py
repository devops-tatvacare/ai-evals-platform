"""Phase 13 / Phase E — provider-agnostic dispatch reconciliation.

Two ingress paths converge here:

  1. Provider webhooks (``orchestration_webhooks`` route) deliver
     real-time terminal events.
  2. Pollers (``poll-bolna-executions`` job) sweep open dispatch
     actions and reconcile any that the webhook missed (or that
     never had a webhook configured at the provider end).

Both paths call the same ``apply_terminal_event`` so persistence is
identical regardless of how we found out the call ended. Idempotency
is enforced by ``action.completed_at`` — once set, every subsequent
event drops on the floor.
"""
