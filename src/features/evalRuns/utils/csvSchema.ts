/**
 * CSV field schema and utilities for the batch evaluation data source step.
 *
 * The required fields mirror `ChatMessage.from_csv_row` in
 * backend/app/services/evaluators/models.py — keep in sync.
 */

// ── Field Schema Definition ─────────────────────────────────────

export interface CsvFieldDef {
  /** Exact column header expected by the backend */
  name: string;
  /** Human-readable description */
  description: string;
  /** Whether the field must be present (backend will 422 if missing) */
  required: boolean;
  /** Example value for guidance */
  example: string;
  /** Semantic group for display */
  group: 'identity' | 'content' | 'metadata';
}

export const CSV_FIELD_SCHEMA: CsvFieldDef[] = [
  // Identity group — how messages are grouped and attributed
  { name: 'thread_id',    description: 'Conversation thread identifier',    required: true,  example: 'thr_abc123',           group: 'identity' },
  { name: 'user_id',      description: 'User who sent the message',         required: true,  example: 'usr_xyz789',           group: 'identity' },
  { name: 'session_id',   description: 'Session identifier',                required: true,  example: 'sess_001',             group: 'identity' },
  { name: 'response_id',  description: 'Unique response identifier',        required: false, example: 'resp_456',             group: 'identity' },

  // Content group — the actual conversation data being evaluated
  { name: 'query_text',              description: 'User message / query',              required: true, example: 'Log 2 eggs for breakfast', group: 'content' },
  { name: 'final_response_message',  description: 'Bot response to the query',         required: true, example: 'Logged: 2 eggs (140 kcal)', group: 'content' },
  { name: 'intent_detected',         description: 'Detected intent classification',    required: true, example: 'log_meal',                  group: 'content' },
  { name: 'intent_query_type',       description: 'Sub-type of the detected intent',   required: false, example: 'food_logging',             group: 'content' },

  // Metadata group — timestamps and flags
  { name: 'timestamp',     description: 'ISO 8601 timestamp of the message', required: true,  example: '2025-01-15T10:30:00Z', group: 'metadata' },
  { name: 'has_image',     description: 'Whether message contains an image (0 or 1)', required: true, example: '0', group: 'metadata' },
  { name: 'error_message', description: 'Error message if the response failed', required: false, example: '',  group: 'metadata' },
];

export const REQUIRED_FIELDS = CSV_FIELD_SCHEMA.filter((f) => f.required).map((f) => f.name);
export const ALL_FIELD_NAMES = CSV_FIELD_SCHEMA.map((f) => f.name);

// ── CSV Parsing ─────────────────────────────────────────────────

/** Lightweight RFC 4180 CSV row parser (handles quoted fields with commas/newlines). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

export interface CsvPreviewResult {
  headers: string[];
  rows: string[][];
  totalRowCount: number;
}

/**
 * Parse CSV text and return the first `maxRows` data rows.
 * Uses a lightweight parser — sufficient for preview; full parsing is done server-side.
 */
export function parseCsvPreview(text: string, maxRows = 10): CsvPreviewResult {
  // Split into lines, handling both \r\n and \n
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], totalRowCount: 0 };

  const headers = parseCsvLine(lines[0]);
  const dataLines = lines.slice(1);
  const rows = dataLines.slice(0, maxRows).map((line) => {
    const cells = parseCsvLine(line);
    // Pad or truncate to match header count
    while (cells.length < headers.length) cells.push('');
    return cells.slice(0, headers.length);
  });

  return { headers, rows, totalRowCount: dataLines.length };
}

// ── Header Validation ───────────────────────────────────────────

export interface HeaderValidation {
  /** Required fields present in the CSV */
  matched: string[];
  /** Required fields missing from the CSV */
  missing: string[];
  /** CSV columns that don't match any schema field (potential mapping candidates) */
  extra: string[];
  /** True if all required fields are present */
  isValid: boolean;
}

/** Validate CSV headers against the required schema fields. */
export function validateCsvHeaders(headers: string[]): HeaderValidation {
  const headerSet = new Set(headers.map((h) => h.trim().toLowerCase()));

  const matched: string[] = [];
  const missing: string[] = [];

  for (const field of CSV_FIELD_SCHEMA) {
    if (headerSet.has(field.name.toLowerCase())) {
      matched.push(field.name);
    } else if (field.required) {
      missing.push(field.name);
    }
  }

  const schemaSet = new Set(ALL_FIELD_NAMES.map((n) => n.toLowerCase()));
  const extra = headers.filter((h) => !schemaSet.has(h.trim().toLowerCase()));

  return {
    matched,
    missing,
    extra,
    isValid: missing.length === 0,
  };
}

// ── Column Remapping ────────────────────────────────────────────

export type ColumnMapping = Map<string, string>; // target field name → source column name

/**
 * Remap CSV content by renaming columns according to the mapping.
 * Returns new CSV text with remapped headers.
 */
export function remapCsvContent(text: string, mapping: ColumnMapping): string {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return text;

  const headers = parseCsvLine(lines[0]);

  // Build reverse map: source column → target field
  const reverseMap = new Map<string, string>();
  for (const [target, source] of mapping) {
    reverseMap.set(source.toLowerCase(), target);
  }

  // Remap headers
  const remappedHeaders = headers.map((h) => {
    const mapped = reverseMap.get(h.trim().toLowerCase());
    return mapped ?? h;
  });

  // Rebuild first line with remapped headers
  const headerLine = remappedHeaders.map((h) => (h.includes(',') || h.includes('"') ? `"${h}"` : h)).join(',');
  return [headerLine, ...lines.slice(1)].join('\n');
}
