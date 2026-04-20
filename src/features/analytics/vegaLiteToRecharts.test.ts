import { describe, expect, it } from 'vitest';

import type { VegaLiteSpec } from '@/features/chat-widget/types';

import { VegaLiteTranslationError, vegaLiteToRecharts } from './vegaLiteToRecharts';

describe('vegaLiteToRecharts', () => {
  it('translates a simple bar spec', () => {
    const spec: VegaLiteSpec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'bar',
      encoding: {
        x: { field: 'evaluator', type: 'nominal', axis: { title: 'Evaluator' } },
        y: { field: 'pass_rate', type: 'quantitative', axis: { title: 'Pass Rate (%)' } },
      },
    };
    const data = [{ evaluator: 'E1', pass_rate: 80 }];
    const out = vegaLiteToRecharts(spec, data);
    expect(out.type).toBe('bar');
    expect(out.xKey).toBe('evaluator');
    expect(out.yKey).toBe('pass_rate');
    expect(out.xLabel).toBe('Evaluator');
    expect(out.yLabel).toBe('Pass Rate (%)');
    expect(out.data).toBe(data);
  });

  it('translates a line spec with temporal x', () => {
    const spec: VegaLiteSpec = {
      mark: 'line',
      encoding: {
        x: { field: 'day', type: 'temporal' },
        y: { field: 'count', type: 'quantitative' },
      },
    };
    const out = vegaLiteToRecharts(spec, []);
    expect(out.type).toBe('line');
    expect(out.xKey).toBe('day');
    expect(out.yKey).toBe('count');
  });

  it('translates an area spec', () => {
    const spec: VegaLiteSpec = {
      mark: 'area',
      encoding: {
        x: { field: 'day', type: 'temporal' },
        y: { field: 'cumulative', type: 'quantitative' },
      },
    };
    const out = vegaLiteToRecharts(spec, []);
    expect(out.type).toBe('area');
  });

  it('pivots grouped_bar (xOffset + color) into wide rows with numeric seriesKeys', () => {
    const spec: VegaLiteSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'day', type: 'nominal' },
        y: { field: 'count', type: 'quantitative' },
        xOffset: { field: 'status' },
        color: { field: 'status', type: 'nominal' },
      },
    };
    const data = [
      { day: 'Mon', status: 'PASS', count: 2 },
      { day: 'Mon', status: 'FAIL', count: 1 },
      { day: 'Tue', status: 'PASS', count: 3 },
    ];
    const out = vegaLiteToRecharts(spec, data);
    expect(out.type).toBe('grouped_bar');
    expect(out.xKey).toBe('day');
    // seriesKeys are the distinct color-field values, now numeric columns in each wide row.
    expect(out.seriesKeys).toEqual(['PASS', 'FAIL']);
    expect(out.data).toHaveLength(2);
    expect(out.data[0]).toMatchObject({ day: 'Mon', PASS: 2, FAIL: 1 });
  });

  it('pivots stacked_bar (y.stack=zero + color) into wide rows', () => {
    const spec: VegaLiteSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'day', type: 'nominal' },
        y: { field: 'pct', type: 'quantitative', stack: 'zero' },
        color: { field: 'status', type: 'nominal' },
      },
    };
    const data = [
      { day: 'Mon', status: 'pass', pct: 70 },
      { day: 'Mon', status: 'fail', pct: 30 },
    ];
    const out = vegaLiteToRecharts(spec, data);
    expect(out.type).toBe('stacked_bar');
    expect(out.seriesKeys).toEqual(['pass', 'fail']);
    expect(out.data[0]).toMatchObject({ day: 'Mon', pass: 70, fail: 30 });
  });

  it('translates pie (mark: arc) using theta and color', () => {
    const spec: VegaLiteSpec = {
      mark: 'arc',
      encoding: {
        theta: { field: 'pct', type: 'quantitative' },
        color: { field: 'status', type: 'nominal' },
      },
    };
    const out = vegaLiteToRecharts(spec, []);
    expect(out.type).toBe('pie');
    expect(out.xKey).toBe('status');
    expect(out.yKey).toBe('pct');
  });

  it('passes fold transform measures through as numeric seriesKeys', () => {
    const spec: VegaLiteSpec = {
      transform: [{ fold: ['pass_rate', 'fail_rate'], as: ['measure', 'value'] }],
      mark: 'line',
      encoding: {
        x: { field: 'day', type: 'temporal' },
        y: { field: 'value', type: 'quantitative' },
        color: { field: 'measure', type: 'nominal' },
      },
    };
    const data = [
      { day: '2025-01-01', pass_rate: 80, fail_rate: 20 },
      { day: '2025-01-02', pass_rate: 70, fail_rate: 30 },
    ];
    const out = vegaLiteToRecharts(spec, data);
    expect(out.type).toBe('line');
    expect(out.seriesKeys).toEqual(['pass_rate', 'fail_rate']);
    expect(out.data).toBe(data);
  });

  it('raises on missing x/y for non-pie marks', () => {
    const spec: VegaLiteSpec = { mark: 'bar', encoding: {} };
    expect(() => vegaLiteToRecharts(spec, [])).toThrow(VegaLiteTranslationError);
  });

  it('raises on unsupported marks', () => {
    const spec = { mark: 'radar' as unknown as 'bar', encoding: {
      x: { field: 'x' }, y: { field: 'y' },
    } } as VegaLiteSpec;
    expect(() => vegaLiteToRecharts(spec, [])).toThrow(VegaLiteTranslationError);
  });
});
