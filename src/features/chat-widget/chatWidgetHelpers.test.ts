import { test, expect } from 'vitest';

import {
  appendTextPart,
  buildComposedReportOutline,
  getToolPartIndex,
  normalizeLegacyChartPayload,
  partsFromStoredMessage,
  shouldApplyRuntimeSeq,
  upsertToolPart,
} from './chatWidgetHelpers';

test('upsertToolPart appends a new tool part', () => {
  const result = upsertToolPart([], {
    type: 'tool-call',
    toolCallId: 'tc_1',
    toolName: 'data_query',
    state: 'executing',
  });

  expect(result).toEqual([{
    type: 'tool-call',
    toolCallId: 'tc_1',
    toolName: 'data_query',
    state: 'executing',
  }]);
});

test('upsertToolPart updates an existing tool part by toolCallId', () => {
  const result = upsertToolPart(
    [{
      type: 'tool-call',
      toolCallId: 'tc_1',
      toolName: 'data_query',
      state: 'executing',
    }],
    {
      type: 'tool-call',
      toolCallId: 'tc_1',
      toolName: 'data_query',
      state: 'completed',
      summary: '7 rows',
      durationMs: 120,
    },
  );

  expect(result).toEqual([{
    type: 'tool-call',
    toolCallId: 'tc_1',
    toolName: 'data_query',
    state: 'completed',
    summary: '7 rows',
    durationMs: 120,
  }]);
});

test('upsertToolPart keeps repeated tool names separate when toolCallId differs', () => {
  const result = upsertToolPart(
    [{
      type: 'tool-call',
      toolCallId: 'tc_1',
      toolName: 'data_query',
      state: 'completed',
      summary: '7 rows',
    }],
    {
      type: 'tool-call',
      toolCallId: 'tc_2',
      toolName: 'data_query',
      state: 'executing',
    },
  );

  expect(result).toEqual([
    {
      type: 'tool-call',
      toolCallId: 'tc_1',
      toolName: 'data_query',
      state: 'completed',
      summary: '7 rows',
    },
    {
      type: 'tool-call',
      toolCallId: 'tc_2',
      toolName: 'data_query',
      state: 'executing',
    },
  ]);
});

test('getToolPartIndex only matches by toolCallId', () => {
  expect(
    getToolPartIndex(
      [
        { type: 'tool-call', toolCallId: 'tc_1', toolName: 'data_query', state: 'completed' },
        { type: 'tool-call', toolCallId: 'tc_2', toolName: 'data_query', state: 'executing' },
      ],
      'tc_2',
    ),
  ).toBe(1);
});

test('appendTextPart merges consecutive text parts', () => {
  expect(
    appendTextPart(
      [{ type: 'text', content: 'Hello' }],
      ' world',
    ),
  ).toEqual([{ type: 'text', content: 'Hello world' }]);
});

test('shouldApplyRuntimeSeq rejects duplicate or out-of-order events', () => {
  expect(shouldApplyRuntimeSeq(4, 4)).toBe(false);
  expect(shouldApplyRuntimeSeq(4, 3)).toBe(false);
  expect(shouldApplyRuntimeSeq(4, 5)).toBe(true);
});

test('buildComposedReportOutline formats a readable section list', () => {
  expect(
    buildComposedReportOutline({
      reportName: 'Weekly Review',
      sections: [
        { id: 'summary', type: 'summary_cards', title: 'Summary Cards' },
        { id: 'compliance', type: 'compliance_table', title: 'Compliance Table' },
      ],
    }),
  ).toBe('Weekly Review\n- Summary Cards (summary_cards)\n- Compliance Table (compliance_table)');
});

test('partsFromStoredMessage ignores legacy tool calls without toolCallId', () => {
  expect(
    partsFromStoredMessage('Done', {
      toolCalls: [
        {
          name: 'data_query',
          summary: '7 rows',
          detail: { executionMs: 12, rowCount: 7 },
        },
      ],
    }),
  ).toEqual([{ type: 'text', content: 'Done' }]);
});

// ── Phase 4.1 — legacy chart payload normalizer ─────────────────────

test('normalizeLegacyChartPayload passes new-shape payloads through', () => {
  const payload = {
    kind: 'chart',
    spec: { mark: 'bar', encoding: { x: { field: 'x' }, y: { field: 'y' } } },
    data: [{ x: 'a', y: 1 }],
  };
  const out = normalizeLegacyChartPayload(payload);
  expect(out).toBe(payload);
});

test('normalizeLegacyChartPayload wraps legacy bar into Vega-Lite subset', () => {
  const legacy = {
    spec: {
      type: 'bar',
      title: 'Pass rate',
      xKey: 'evaluator',
      yKey: 'pass_rate',
      seriesKeys: [],
      xLabel: 'Evaluator',
      yLabel: 'Pass Rate',
    },
    data: [{ evaluator: 'E1', pass_rate: 80 }],
    sqlQuery: 'SELECT ...',
    sourceQuestion: 'show pass rate',
  };
  const out = normalizeLegacyChartPayload(legacy);
  expect(out).not.toBeNull();
  if (out?.kind !== 'chart') throw new Error('expected chart kind');
  expect(out.spec.mark).toBe('bar');
  expect(out.spec.encoding?.x?.field).toBe('evaluator');
  expect(out.spec.encoding?.y?.field).toBe('pass_rate');
  expect(out.title).toBe('Pass rate');
  expect(out.sql_query).toBe('SELECT ...');
  expect(out.source_question).toBe('show pass rate');
});

test('normalizeLegacyChartPayload folds legacy multi-series into Vega-Lite fold', () => {
  const legacy = {
    spec: {
      type: 'line',
      title: 'Volume',
      xKey: 'day',
      seriesKeys: ['pass', 'fail'],
      xLabel: 'Day',
      yLabel: 'Count',
    },
    data: [{ day: 'Mon', pass: 10, fail: 2 }],
    sqlQuery: 'SELECT ...',
    sourceQuestion: 'show volume',
  };
  const out = normalizeLegacyChartPayload(legacy);
  if (out?.kind !== 'chart') throw new Error('expected chart kind');
  expect(out.spec.transform).toEqual([
    { fold: ['pass', 'fail'], as: ['measure', 'value'] },
  ]);
  expect(out.spec.encoding?.color?.field).toBe('measure');
});

test('normalizeLegacyChartPayload returns null for empty or invalid input', () => {
  expect(normalizeLegacyChartPayload(null)).toBeNull();
  expect(normalizeLegacyChartPayload({})).toBeNull();
  expect(normalizeLegacyChartPayload({ spec: {} })).toBeNull();
});
