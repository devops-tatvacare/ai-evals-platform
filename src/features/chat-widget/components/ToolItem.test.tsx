// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';

import { ToolItem } from './ToolItem';
import type { ToolCallPart } from '../types';

test('renders bouncer invalid results as a safe refusal with diagnostics', async () => {
  const part: ToolCallPart = {
    type: 'tool-call',
    toolCallId: 'call_1',
    toolName: 'data_specialist',
    state: 'completed',
    routing: {
      attemptedSql: 'SELECT 1',
      validationResult: 'bouncer_invalid: R3.declared_join_columns',
      executionStatus: 'bouncer_rejected_before',
      status: 'error',
      bouncer: {
        status: 'invalid',
        rule_id: 'R3.declared_join_columns',
        declared_grain: ['agent'],
        expected_row_bound: 'small',
        row_cap: 50,
        limit_applied: 51,
        diagnostic: {
          rule_id: 'R3.declared_join_columns',
          message: 'joined catalog tables must use declared relationship columns',
          hint: 'use the relationship columns declared in the workbench catalog',
        },
      },
    },
  };

  render(<ToolItem part={part} />);

  expect(screen.getByText('cannot answer safely')).toBeInTheDocument();
  expect(screen.getByText('bouncer: R3.declared_join_columns')).toBeInTheDocument();

  await userEvent.click(screen.getByText('cannot answer safely'));

  expect(screen.getByText('bouncer · R3.declared_join_columns')).toBeInTheDocument();
  expect(screen.getByText('joined catalog tables must use declared relationship columns')).toBeInTheDocument();
  expect(screen.getByText('use the relationship columns declared in the workbench catalog')).toBeInTheDocument();
});

test('does not expand completed specialist placeholders with empty detail', async () => {
  const part: ToolCallPart = {
    type: 'tool-call',
    toolCallId: 'call_1',
    toolName: 'data_specialist',
    state: 'completed',
    briefSummary: 'Checking the latest Kaira metrics',
    detail: {
      executionMs: 0,
      sqlUsed: null,
      rowCount: null,
      cacheHit: null,
      error: null,
    },
  };

  render(<ToolItem part={part} />);

  expect(screen.getByRole('button')).toBeDisabled();
  expect(screen.getByText('Checking the latest Kaira metrics')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button'));

  expect(screen.queryByText('execution')).not.toBeInTheDocument();
});
