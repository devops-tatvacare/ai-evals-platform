import type { BouncerTelemetry, SpecialistRoutingTelemetry } from './types';

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function stringValue(raw: Record<string, unknown>, camel: string, snake: string): string | undefined {
  const value = raw[camel] ?? raw[snake];
  return typeof value === 'string' ? value : undefined;
}

function numberValue(raw: Record<string, unknown>, camel: string, snake: string): number | undefined {
  const value = raw[camel] ?? raw[snake];
  return typeof value === 'number' ? value : undefined;
}

function booleanValue(raw: Record<string, unknown>, camel: string, snake: string): boolean | undefined {
  const value = raw[camel] ?? raw[snake];
  return typeof value === 'boolean' ? value : undefined;
}

export function parseBouncerTelemetry(value: unknown): BouncerTelemetry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const diagnosticRaw = raw.diagnostic;
  let diagnostic: BouncerTelemetry['diagnostic'];
  if (diagnosticRaw && typeof diagnosticRaw === 'object') {
    const d = diagnosticRaw as Record<string, unknown>;
    if (typeof d.rule_id === 'string' && typeof d.message === 'string') {
      diagnostic = {
        rule_id: d.rule_id,
        message: d.message,
        hint: typeof d.hint === 'string' ? d.hint : undefined,
        offending_tables: stringArray(d.offending_tables),
        offending_columns: stringArray(d.offending_columns),
      };
    }
  }
  return {
    status: raw.status === 'ok' || raw.status === 'invalid' ? raw.status : undefined,
    rule_id: typeof raw.rule_id === 'string' ? raw.rule_id : undefined,
    diagnostic,
    declared_grain: stringArray(raw.declared_grain ?? raw.declaredGrain),
    expected_row_bound: stringValue(raw, 'expectedRowBound', 'expected_row_bound'),
    row_cap: numberValue(raw, 'rowCap', 'row_cap'),
    limit_applied: numberValue(raw, 'limitApplied', 'limit_applied'),
    more_rows_exist: booleanValue(raw, 'moreRowsExist', 'more_rows_exist'),
    displayed_row_count: numberValue(raw, 'displayedRowCount', 'displayed_row_count'),
  };
}

export function normalizeSpecialistRoutingTelemetry(value: unknown): SpecialistRoutingTelemetry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const groundingRaw = raw.grounding && typeof raw.grounding === 'object'
    ? raw.grounding as Record<string, unknown>
    : undefined;
  const chartPayloadKind = raw.chartPayloadKind ?? raw.chart_payload_kind;
  return {
    intentClass: stringValue(groundingRaw ?? raw, 'intentClass', 'intent_class'),
    allowedLayers: stringArray((groundingRaw ?? raw).allowedLayers ?? (groundingRaw ?? raw).allowed_layers),
    projectedTables: stringArray((groundingRaw ?? raw).projectedTables ?? (groundingRaw ?? raw).projected_tables),
    attemptedSql: stringValue(raw, 'attemptedSql', 'attempted_sql'),
    validationResult: stringValue(raw, 'validationResult', 'validation_result'),
    executionStatus: stringValue(raw, 'executionStatus', 'execution_status'),
    chartPayloadKind: typeof chartPayloadKind === 'string' ? chartPayloadKind : null,
    status: stringValue(raw, 'status', 'status'),
    latencyMs: numberValue(raw, 'latencyMs', 'latency_ms'),
    bouncer: parseBouncerTelemetry(raw.bouncer),
  };
}
