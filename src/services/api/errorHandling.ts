/**
 * Shared API-error parsing utilities.
 *
 * Some callers go through `apiRequest`, others perform bespoke fetch flows
 * (multipart uploads, streaming endpoints, etc.). They should all derive the
 * same `ApiError.message` from the same backend payload shapes instead of
 * maintaining copy-pasted parsers that drift over time.
 */

export interface ParsedApiErrorResponse {
  errorData: unknown;
  detail: string | null;
}

export function summarizeApiErrorDetail(detail: unknown): string | null {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    if (detail.length === 0) return null;
    const parts: string[] = [];
    for (const item of detail) {
      if (typeof item === 'string') {
        parts.push(item);
        continue;
      }
      if (item && typeof item === 'object') {
        const r = item as Record<string, unknown>;
        const msg =
          typeof r.message === 'string'
            ? r.message
            : typeof r.msg === 'string'
              ? r.msg
              : null;
        if (msg) {
          const nodeId =
            typeof r.node_id === 'string'
              ? r.node_id
              : typeof r.nodeId === 'string'
                ? r.nodeId
                : null;
          const field =
            typeof r.field === 'string'
              ? r.field
              : Array.isArray(r.loc)
                ? r.loc
                    .filter((p) => typeof p === 'string' || typeof p === 'number')
                    .join('.')
                : null;
          const prefix = [nodeId, field].filter(Boolean).join(' · ');
          parts.push(prefix ? `${prefix}: ${msg}` : msg);
        }
      }
    }
    return parts.length ? parts.join('\n') : null;
  }
  if (detail && typeof detail === 'object') {
    const r = detail as Record<string, unknown>;
    if (typeof r.message === 'string') return r.message;
    if (typeof r.msg === 'string') return r.msg;
  }
  return null;
}

export function parseApiErrorResponse(text: string): ParsedApiErrorResponse {
  let errorData: unknown = text;
  try {
    errorData = JSON.parse(text);
  } catch {
    // keep as plain text
  }
  if (typeof errorData === 'object' && errorData !== null && 'detail' in errorData) {
    const detail = (errorData as Record<string, unknown>).detail;
    return { errorData, detail: summarizeApiErrorDetail(detail) };
  }
  return { errorData, detail: null };
}
