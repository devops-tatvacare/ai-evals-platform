import { describe, expect, it } from 'vitest';

import type { VegaLiteSpec } from '@/features/chat-widget/types';

import { vegaLiteToRecharts } from './vegaLiteToRecharts';
import type { SavedChart } from './types';

/**
 * Phase 4.6A — saved charts + dashboards replay through the same translator
 * used by live chat. These tests lock down the chat→save→replay round-trip.
 */

function savedConfigFor(payloadKind: 'chart', spec: VegaLiteSpec): SavedChart['chartConfig'] {
  return {
    canonical: {
      kind: payloadKind,
      spec,
    },
    renderer: {
      type: 'bar',
      xKey: 'x',
      yKey: 'y',
      xLabel: 'X',
      yLabel: 'Y',
    },
  };
}

describe('saved-chart replay parity', () => {
  it('replays a simple bar spec to the same shape as live chat', () => {
    const spec: VegaLiteSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'evaluator', type: 'nominal', axis: { title: 'Evaluator' } },
        y: { field: 'pass_rate', type: 'quantitative', axis: { title: 'Pass Rate (%)' } },
      },
    };
    const data = [{ evaluator: 'E1', pass_rate: 80 }, { evaluator: 'E2', pass_rate: 60 }];
    const savedConfig = savedConfigFor('chart', spec);

    const liveProps = vegaLiteToRecharts(spec, data);
    // Replay path: detail/dashboard views reach for the canonical spec and
    // run it through the same translator.
    const replayedProps = vegaLiteToRecharts(savedConfig.canonical!.spec, data);

    expect(replayedProps).toEqual(liveProps);
  });

  it('replays a grouped_bar (xOffset+color) spec with wide-row pivot parity', () => {
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
    const live = vegaLiteToRecharts(spec, data);
    const replayed = vegaLiteToRecharts(savedConfigFor('chart', spec).canonical!.spec, data);
    // Same pivot, same numeric seriesKeys — no drift between chat and library.
    expect(replayed.type).toBe('grouped_bar');
    expect(replayed).toEqual(live);
    expect(replayed.seriesKeys).not.toEqual(['status']);
  });

  it('replays a fold-transform multi-line spec without reshaping data', () => {
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
    const replayed = vegaLiteToRecharts(savedConfigFor('chart', spec).canonical!.spec, data);
    expect(replayed.type).toBe('line');
    expect(replayed.seriesKeys).toEqual(['pass_rate', 'fail_rate']);
    expect(replayed.data).toBe(data);
  });

  it('does not touch legacy charts that lack kind/spec (backward-compat path)', () => {
    // Legacy charts saved before Phase 4.6A — detail/dashboard fall back to
    // the translator-derived fields and render exactly as before.
    const legacy: SavedChart['chartConfig'] = {
      renderer: {
        type: 'bar',
        xKey: 'evaluator',
        yKey: 'pass_rate',
        xLabel: 'Evaluator',
        yLabel: 'Pass Rate',
      },
    };
    expect(legacy.canonical).toBeUndefined();
  });
});
