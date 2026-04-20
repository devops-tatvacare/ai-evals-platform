import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { ChartPart, ChartPayload } from '../types';
import { ChatChartCard } from './ChatChartCard';

function partFrom(payload: ChartPayload): ChartPart {
  return { type: 'chart', payload };
}

describe('ChatChartCard kind branching', () => {
  it('renders kpi kind as a big-number card', () => {
    const payload: ChartPayload = {
      kind: 'kpi',
      kpi: { value: 47, label: 'Runs', format: 'integer' },
      title: 'Total runs',
    };
    render(<ChatChartCard part={partFrom(payload)} appId="kaira-bot" sessionId={null} />);
    expect(screen.getByText('47')).toBeInTheDocument();
    expect(screen.getByText('Total runs')).toBeInTheDocument();
  });

  it('renders summary kind as a field list', () => {
    const payload: ChartPayload = {
      kind: 'summary',
      title: 'Run details',
      summary: {
        fields: [
          { name: 'run_id', label: 'Run ID', value: 'r1', role: 'identifier' },
          { name: 'total', label: 'Total', value: 10, role: 'measure', semantic_type: 'count' },
        ],
      },
    };
    render(<ChatChartCard part={partFrom(payload)} appId="kaira-bot" sessionId={null} />);
    expect(screen.getByText('Run ID')).toBeInTheDocument();
    expect(screen.getByText('r1')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders table kind with columns and a warning banner', () => {
    const payload: ChartPayload = {
      kind: 'table',
      title: 'Failed threads',
      warning: 'All values in "is_failed" are the same; showing as a list.',
      columns: [
        { name: 'thread_id', label: 'Thread ID', role: 'identifier', semantic_type: 'id_hash' },
        { name: 'is_failed', label: 'Is Failed', role: 'measure', semantic_type: 'count' },
      ],
      data: [
        { thread_id: 'thrd-1', is_failed: 1 },
        { thread_id: 'thrd-2', is_failed: 1 },
      ],
    };
    render(<ChatChartCard part={partFrom(payload)} appId="kaira-bot" sessionId={null} />);
    expect(screen.getByText('Failed threads')).toBeInTheDocument();
    expect(screen.getByText('Thread ID')).toBeInTheDocument();
    expect(screen.getByText(/All values in/)).toBeInTheDocument();
  });

  it('renders empty kind with a muted placeholder', () => {
    const payload: ChartPayload = {
      kind: 'empty',
      title: 'No results',
    };
    render(<ChatChartCard part={partFrom(payload)} appId="kaira-bot" sessionId={null} />);
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('renders chart kind title + action buttons', () => {
    const payload: ChartPayload = {
      kind: 'chart',
      title: 'Pass rate',
      spec: {
        mark: 'bar',
        encoding: {
          x: { field: 'evaluator', type: 'nominal' },
          y: { field: 'pass_rate', type: 'quantitative' },
        },
      },
      data: [
        { evaluator: 'E1', pass_rate: 80 },
        { evaluator: 'E2', pass_rate: 60 },
      ],
    };
    render(<ChatChartCard part={partFrom(payload)} appId="kaira-bot" sessionId={null} />);
    expect(screen.getByText('Pass rate')).toBeInTheDocument();
    // Save and Copy buttons visible on chart kind.
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });
});
