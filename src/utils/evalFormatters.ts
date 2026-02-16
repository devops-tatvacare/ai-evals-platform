/** Format an ISO timestamp to relative time (e.g., "2h ago", "3d ago") */
export function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Format seconds to human-readable duration (e.g., "4m 32s") */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/** Format a number as percentage (e.g., 0.85 -> "85.0%") */
export function pct(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Format ISO timestamp to local date+time string */
export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Compact timestamp for chat bubbles (e.g., "Feb 14, 2:30 PM") */
export function formatChatTimestamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Truncate string with ellipsis */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "\u2026";
}

/** Make a snake_case or slug string presentable */
export function humanize(str: string): string {
  return str
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Normalize a label to canonical format: UPPERCASE WITH SPACES.
 *
 * Handles all legacy formats:
 *   "SOFT_FAIL" → "SOFT FAIL"
 *   "soft_fail" → "SOFT FAIL"
 *   "Not Applicable" → "NOT APPLICABLE"
 *   "PASS" → "PASS" (idempotent)
 *
 * Does NOT apply to adversarial categories (snake_case identifiers).
 */
export function normalizeLabel(raw: string): string {
  return raw.replace(/_/g, " ").toUpperCase().trim();
}
