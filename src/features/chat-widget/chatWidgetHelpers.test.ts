import { test, expect } from 'vitest';

import { buildComposedReportOutline, buildSaveTemplatePrompt, upsertToolCall } from './chatWidgetHelpers';

test('upsertToolCall appends a new tool call', () => {
  const result = upsertToolCall([], {
    name: 'analyze',
    status: 'running',
  });

  expect(result).toEqual([{ name: 'analyze', status: 'running' }]);
});

test('upsertToolCall updates an existing tool call by name', () => {
  const result = upsertToolCall(
    [{ name: 'analyze', status: 'running' }],
    {
      name: 'analyze',
      status: 'done',
      summary: '7 rows',
      detail: {
        executionMs: 120,
        sqlUsed: 'select 1',
        rowCount: 7,
        cacheHit: true,
        error: null,
      },
    },
  );

  expect(result).toEqual([{
    name: 'analyze',
    status: 'done',
    summary: '7 rows',
    detail: {
      executionMs: 120,
      sqlUsed: 'select 1',
      rowCount: 7,
      cacheHit: true,
      error: null,
    },
  }]);
});

test('buildSaveTemplatePrompt quotes the report name', () => {
  expect(
    buildSaveTemplatePrompt('Weekly Review'),
  ).toBe('Save this report as a template called "Weekly Review"');
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
