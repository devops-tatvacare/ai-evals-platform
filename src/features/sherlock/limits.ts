/**
 * Runtime policy constants mirrored from backend/app/services/sherlock_v3/limits.py.
 *
 * The chat widget renders the retry cap in copy ("attempt N of MAX"), so the
 * value needs to be available frontend-side. Backend remains the enforcement
 * source of truth — this file only labels the same number for display.
 *
 * Drift gate: if backend changes the cap, update this constant in the same
 * PR. There is no auto-bridge for runtime policy constants today.
 */
export const MAX_SPECIALIST_ATTEMPTS = 3;
