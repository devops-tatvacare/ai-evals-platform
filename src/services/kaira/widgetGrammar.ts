/**
 * Kaira widget grammar — FE mirror of backend/app/services/evaluators/kaira_widget_grammar.py.
 *
 * MUST stay in sync with the backend registry. Adding a new widget = one entry
 * here + one entry on the BE + one renderer in
 * src/features/evalRuns/components/widgets/index.ts.
 *
 * Wire-format rows are the upstream-accepted strings, verified against
 * kaira-ai/api/routes.py @ uat 2026-05-08.
 */

// ─── Types ───────────────────────────────────────────────────────────────

export type WidgetKind = 'food_card' | 'food_card_batch' | 'bp_card' | 'vitals_card';

export interface KairaWidget {
  kind: string;            // registered kind, or unknown forward-compat kind
  data: Record<string, unknown>;
  raw_chunk_type: string;
  is_known: boolean;
}

export interface ActionDescriptor {
  kind: string;
  label: string;
  wire: string;
  verbs?: string[];
  payload?: unknown;
}

interface WidgetSpec {
  kind: WidgetKind;
  chunk_types: readonly string[];
  sentinel_open: string | null;
  sentinel_close: string | null;
  buildWire: (data: Record<string, unknown>) => string;
  confirm_label: string;
  confirm_verbs?: readonly string[];
  is_batch_of?: WidgetKind;
}

// ─── Wire builders ───────────────────────────────────────────────────────

const mealSingleWire = (data: Record<string, unknown>): string =>
  `update_meal & log_meal - ${JSON.stringify([data])}`;

const mealBatchWire = (data: Record<string, unknown>): string => {
  const sessions = (data['sessions'] as unknown[]) ?? [];
  if (!Array.isArray(sessions)) {
    throw new Error(`food_card_batch.data.sessions must be array, got ${typeof sessions}`);
  }
  return `update_meal & log_meal - ${JSON.stringify(sessions)}`;
};

const bpWire = (_data: Record<string, unknown>): string => 'yes log this bp reading';

const vitalsWire = (_data: Record<string, unknown>): string => 'yes, save these';

// ─── Registry ────────────────────────────────────────────────────────────

export const WIDGET_REGISTRY: Record<WidgetKind, WidgetSpec> = {
  food_card: {
    kind: 'food_card',
    chunk_types: ['food_card'],
    sentinel_open: '___FOOD_CARD___',
    sentinel_close: '___END___',
    buildWire: mealSingleWire,
    confirm_label: 'Yes log this meal',
    confirm_verbs: ['update_meal', 'log_meal'],
  },
  food_card_batch: {
    kind: 'food_card_batch',
    chunk_types: [],
    sentinel_open: '___MULTI_FOOD_CARD___',
    sentinel_close: '___END___',
    buildWire: mealBatchWire,
    confirm_label: 'Yes log all meals',
    confirm_verbs: ['update_meal', 'log_meal'],
    is_batch_of: 'food_card',
  },
  bp_card: {
    kind: 'bp_card',
    chunk_types: ['bp_card'],
    sentinel_open: '___BP_CARD___',
    sentinel_close: '___END___',
    buildWire: bpWire,
    confirm_label: 'Yes log this BP reading',
  },
  vitals_card: {
    kind: 'vitals_card',
    chunk_types: ['vitals_card'],
    sentinel_open: '___VITALS_CARD___',
    sentinel_close: '___END___',
    buildWire: vitalsWire,
    confirm_label: 'Yes, save these',
  },
};

// Strip-only token-stream markers — removed from prose, no widget produced
export const STRIP_ONLY_SENTINELS: ReadonlyArray<{ open: string; close: string }> = [
  { open: '___SESSION_STATE___', close: '___END_SS___' },
];

// ─── Lookups ─────────────────────────────────────────────────────────────

export interface SentinelMarker {
  kind: WidgetKind | '__strip_only__';
  open: string;
  close: string;
  is_widget: boolean;
}

export function allSentinelMarkers(): SentinelMarker[] {
  const out: SentinelMarker[] = [];
  (Object.values(WIDGET_REGISTRY) as WidgetSpec[]).forEach((spec) => {
    if (spec.sentinel_open && spec.sentinel_close) {
      out.push({
        kind: spec.kind,
        open: spec.sentinel_open,
        close: spec.sentinel_close,
        is_widget: true,
      });
    }
  });
  STRIP_ONLY_SENTINELS.forEach(({ open, close }) => {
    out.push({ kind: '__strip_only__', open, close, is_widget: false });
  });
  return out;
}

export function widgetFromChunk(chunk: { type?: string; data?: unknown; [k: string]: unknown }): KairaWidget | null {
  const chunkType = chunk.type;
  if (!chunkType || ['classification', 'token', 'done', 'error'].includes(chunkType)) {
    return null;
  }
  const data = (chunk.data ?? {}) as Record<string, unknown>;
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  // Known kinds
  for (const spec of Object.values(WIDGET_REGISTRY) as WidgetSpec[]) {
    if (spec.chunk_types.includes(chunkType)) {
      // food_card → food_card_batch promotion
      if (spec.kind === 'food_card' && data['isBatch'] === true) {
        return {
          kind: 'food_card_batch',
          data,
          raw_chunk_type: chunkType,
          is_known: true,
        };
      }
      return {
        kind: spec.kind,
        data,
        raw_chunk_type: chunkType,
        is_known: true,
      };
    }
  }
  // Forward-compat
  return {
    kind: chunkType,
    data,
    raw_chunk_type: chunkType,
    is_known: false,
  };
}

export function confirmMessageFor(widget: KairaWidget): { wire: string; descriptor: ActionDescriptor } {
  const spec = (WIDGET_REGISTRY as Record<string, WidgetSpec>)[widget.kind];
  if (!spec) {
    throw new Error(
      `Cannot build confirm message for unknown widget kind=${widget.kind}; register a WidgetSpec first.`,
    );
  }
  const wire = spec.buildWire(widget.data);
  const descriptor: ActionDescriptor = {
    kind: widget.kind,
    label: spec.confirm_label,
    wire,
    payload: widget.data,
  };
  if (spec.confirm_verbs) {
    descriptor.verbs = [...spec.confirm_verbs];
  }
  return { wire, descriptor };
}

export function isKnownKind(kind: string): kind is WidgetKind {
  return kind in WIDGET_REGISTRY;
}
