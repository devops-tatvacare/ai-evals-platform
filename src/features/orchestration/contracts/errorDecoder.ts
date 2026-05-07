/**
 * Phase 14 — structured API error contract.
 *
 * The orchestration backend returns 422 publish errors as
 * `detail: [{ node_id, field, message }, ...]` and 400 / generic errors as
 * `detail: "<string>"`. The pre-Phase-14 client did `String(detail)` which
 * collapsed arrays to `[object Object],[object Object]` and stripped every
 * actionable hint. This decoder replaces that with a discriminated union so
 * the UI can branch on shape, not on guessing.
 *
 * Symmetric mapping for Zod errors lives at the bottom (`fieldErrorsFromZod`)
 * so frontend-detected schema violations can render through the same panel
 * once Phase D's hand-written Zod schemas land.
 */
import { ApiError } from '@/services/api/client';

/** One field error item — matches the backend dispatch / publish shape. */
export interface FieldErrorItem {
  /** Workflow node the error applies to. Optional because some errors are
   *  workflow-global (e.g. duplicate edge ids). */
  nodeId?: string | null;
  /** Dotted path to the offending field, e.g. `config.template_name` or
   *  `branches[2].label`. Optional for the same reason. */
  field?: string | null;
  /** Human-readable message. Always present. */
  message: string;
}

export type ApiErrorBody =
  | { kind: 'fieldErrors'; items: FieldErrorItem[] }
  | { kind: 'message'; message: string }
  | { kind: 'unknown'; raw: unknown };

/** Coerce a single item from the backend `detail` array into a `FieldErrorItem`.
 *  Tolerates both snake_case (backend dispatch shape) and camelCase. */
function coerceFieldItem(raw: unknown): FieldErrorItem | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const message =
    typeof r.message === 'string'
      ? r.message
      : typeof r.msg === 'string'
        ? r.msg
        : null;
  if (!message) return null;
  const nodeId =
    typeof r.node_id === 'string'
      ? r.node_id
      : typeof r.nodeId === 'string'
        ? r.nodeId
        : null;
  let field: string | null = null;
  if (typeof r.field === 'string') {
    field = r.field;
  } else if (Array.isArray(r.loc)) {
    // FastAPI / Pydantic native validation error shape: { loc: [...], msg, type }.
    field = r.loc.filter((p) => typeof p === 'string' || typeof p === 'number').join('.');
    if (!field) field = null;
  }
  return { nodeId, field, message };
}

export function decodeApiErrorBody(raw: unknown): ApiErrorBody {
  if (raw == null) return { kind: 'unknown', raw };
  if (typeof raw === 'string') return { kind: 'message', message: raw };
  if (typeof raw !== 'object') return { kind: 'unknown', raw };

  const detail = (raw as Record<string, unknown>).detail;

  if (Array.isArray(detail)) {
    const items = detail
      .map(coerceFieldItem)
      .filter((it): it is FieldErrorItem => it !== null);
    if (items.length > 0) return { kind: 'fieldErrors', items };
    return { kind: 'unknown', raw };
  }
  if (typeof detail === 'string') {
    return { kind: 'message', message: detail };
  }
  if (detail && typeof detail === 'object') {
    // Single-item object detail (rare but possible). Try to coerce.
    const item = coerceFieldItem(detail);
    if (item) return { kind: 'fieldErrors', items: [item] };
  }
  // Last-ditch: a top-level `message` field (some non-FastAPI errors).
  if (typeof (raw as Record<string, unknown>).message === 'string') {
    return { kind: 'message', message: (raw as Record<string, string>).message };
  }
  return { kind: 'unknown', raw };
}

/** Convenience: pull the structured body off an `ApiError` (or any thrown
 *  value). Non-`ApiError` throwables fall through to `kind: 'message'` with
 *  `Error.message` if present, else `kind: 'unknown'`. */
export function decodeApiError(err: unknown): ApiErrorBody {
  if (err instanceof ApiError) {
    const decoded = decodeApiErrorBody(err.data);
    if (decoded.kind !== 'unknown') return decoded;
    // Fall back to the ApiError's own message — `data` may have been a plain
    // text body or a shape we don't recognise.
    return { kind: 'message', message: err.message };
  }
  if (err instanceof Error) return { kind: 'message', message: err.message };
  return { kind: 'unknown', raw: err };
}

/** Render a single human-readable summary line. UI surfaces that don't have
 *  room for a full panel (toasts, inline status text) use this. */
export function summarizeApiErrorBody(body: ApiErrorBody, fallback: string): string {
  if (body.kind === 'message') return body.message;
  if (body.kind === 'fieldErrors') {
    if (body.items.length === 1) {
      const it = body.items[0];
      const prefix = [it.nodeId, it.field].filter(Boolean).join(' · ');
      return prefix ? `${prefix}: ${it.message}` : it.message;
    }
    return `${body.items.length} validation issues`;
  }
  return fallback;
}

/** Phase D symmetry shim: convert a `ZodError`-shaped object to field errors.
 *  Kept opt-in (caller passes the issues array) so we don't import zod here
 *  in Phase A. Wired up properly when Phase D introduces the schemas. */
export function fieldErrorsFromZodIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
  nodeId?: string | null,
): FieldErrorItem[] {
  return issues.map((iss) => ({
    nodeId: nodeId ?? null,
    field: iss.path.length ? iss.path.map(String).join('.') : null,
    message: iss.message,
  }));
}
