import type { VegaLiteEncoding, VegaLiteSpec } from '@/features/chat-widget/types';

// Translator output targets the *current* ChartRenderer contract:
//   type: one of the 6 canonical marks
//   xKey / yKey / seriesKeys: keys present in the returned data rows
//   xLabel / yLabel: pre-formatted axis titles (backend sends these)
//
// For grouped / stacked / fold specs the translator produces wide rows plus
// numeric ``seriesKeys`` so ChartRenderer can render without re-inference.
// ``seriesKeys`` must never be the color field itself — the renderer expects
// every entry in ``seriesKeys`` to index a numeric column in every row.
export type RechartsChartType =
  | 'bar' | 'grouped_bar' | 'stacked_bar' | 'line' | 'area' | 'pie';

export interface RechartsPropsFromSpec {
  type: RechartsChartType;
  data: Array<Record<string, unknown>>;
  xKey: string;
  yKey?: string;
  seriesKeys?: string[];
  xLabel?: string;
  yLabel?: string;
}

export class VegaLiteTranslationError extends Error {}

function channel(enc: VegaLiteEncoding | undefined, name: keyof VegaLiteEncoding) {
  return enc?.[name];
}

function fieldOf(enc: VegaLiteEncoding | undefined, name: keyof VegaLiteEncoding): string | undefined {
  const ch = channel(enc, name);
  return typeof ch?.field === 'string' ? ch.field : undefined;
}

function titleOf(enc: VegaLiteEncoding | undefined, name: keyof VegaLiteEncoding): string | undefined {
  const ch = channel(enc, name);
  return typeof ch?.axis?.title === 'string' ? ch.axis.title : undefined;
}

function foldMeasures(spec: VegaLiteSpec): string[] | null {
  const ts = spec.transform;
  if (!Array.isArray(ts)) return null;
  for (const t of ts) {
    if (t && typeof t === 'object' && Array.isArray((t as { fold?: unknown[] }).fold)) {
      return ((t as { fold: unknown[] }).fold).map(String);
    }
  }
  return null;
}

/**
 * Pivot a long-form bar (x-field repeats per color) into wide rows so the
 * existing ChartRenderer can render grouped / stacked bars by passing
 * ``seriesKeys`` (the numeric measures) rather than the color field.
 */
function pivotLongFormBarToWide(
  mode: 'grouped_bar' | 'stacked_bar',
  data: Array<Record<string, unknown>>,
  xField: string,
  yField: string,
  colorField: string,
  xLabel: string | undefined,
  yLabel: string | undefined,
): RechartsPropsFromSpec {
  const bucketed = new Map<string, Record<string, unknown>>();
  const seriesOrder: string[] = [];
  const seriesSeen = new Set<string>();

  for (const row of data) {
    const xVal = row[xField];
    const colorVal = row[colorField];
    const yVal = row[yField];
    if (xVal === null || xVal === undefined || colorVal === null || colorVal === undefined) continue;
    const bucketKey = typeof xVal === 'object' ? JSON.stringify(xVal) : String(xVal);
    const series = String(colorVal);
    let bucket = bucketed.get(bucketKey);
    if (!bucket) {
      bucket = { [xField]: xVal };
      bucketed.set(bucketKey, bucket);
    }
    bucket[series] = yVal;
    if (!seriesSeen.has(series)) {
      seriesSeen.add(series);
      seriesOrder.push(series);
    }
  }

  return {
    type: mode,
    data: Array.from(bucketed.values()),
    xKey: xField,
    seriesKeys: seriesOrder,
    xLabel,
    yLabel,
  };
}

/**
 * Pivot a long-form line (x-field repeats per color) into wide rows so the
 * existing ChartRenderer can render multiple lines by indexing the numeric
 * series columns instead of a color field.
 */
function pivotLongFormLineToWide(
  data: Array<Record<string, unknown>>,
  xField: string,
  yField: string,
  colorField: string,
  xLabel: string | undefined,
  yLabel: string | undefined,
): RechartsPropsFromSpec {
  return {
    ...pivotLongFormBarToWide('grouped_bar', data, xField, yField, colorField, xLabel, yLabel),
    type: 'line',
  };
}

export function vegaLiteToRecharts(
  spec: VegaLiteSpec,
  data: Array<Record<string, unknown>>,
): RechartsPropsFromSpec {
  const mark = spec.mark;
  const encoding = spec.encoding;

  const xField = fieldOf(encoding, 'x');
  const yField = fieldOf(encoding, 'y');
  const thetaField = fieldOf(encoding, 'theta');
  const colorField = fieldOf(encoding, 'color');
  const xOffsetField = fieldOf(encoding, 'xOffset');
  const stack = channel(encoding, 'y')?.stack;

  const xLabel = titleOf(encoding, 'x') ?? xField;
  const yLabel = titleOf(encoding, 'y') ?? yField;

  // Fold transform → multi-measure, pivot to wide series by numeric measure name.
  const fold = foldMeasures(spec);
  if (fold && xField) {
    // data rows are already wide (one row per x-value with measure columns).
    const type: RechartsChartType = mark === 'bar' ? 'grouped_bar' : 'line';
    return { type, data, xKey: xField, seriesKeys: fold, xLabel, yLabel };
  }

  // Pie (mark: arc)
  if (mark === 'arc' && thetaField && colorField) {
    return { type: 'pie', data, xKey: colorField, yKey: thetaField };
  }

  if (!xField || !yField) {
    throw new VegaLiteTranslationError('Vega-Lite spec missing x/y fields');
  }

  if (mark === 'bar') {
    if (stack === 'zero' && colorField) {
      return pivotLongFormBarToWide('stacked_bar', data, xField, yField, colorField, xLabel, yLabel);
    }
    if (xOffsetField && colorField) {
      return pivotLongFormBarToWide('grouped_bar', data, xField, yField, colorField, xLabel, yLabel);
    }
    return { type: 'bar', data, xKey: xField, yKey: yField, xLabel, yLabel };
  }

  if (mark === 'line') {
    if (colorField) {
      return pivotLongFormLineToWide(data, xField, yField, colorField, xLabel, yLabel);
    }
    return { type: 'line', data, xKey: xField, yKey: yField, xLabel, yLabel };
  }

  if (mark === 'area') {
    return { type: 'area', data, xKey: xField, yKey: yField, xLabel, yLabel };
  }

  throw new VegaLiteTranslationError(`Unsupported mark: ${String(mark)}`);
}
