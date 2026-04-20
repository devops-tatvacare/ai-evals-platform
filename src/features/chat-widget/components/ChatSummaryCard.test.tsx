import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ChatSummaryCard } from './ChatSummaryCard';

describe('ChatSummaryCard', () => {
  it('renders a labelled field list', () => {
    render(
      <ChatSummaryCard
        summary={{
          fields: [
            { name: 'run_id', label: 'Run ID', value: 'abc123', role: 'identifier' },
            {
              name: 'total',
              label: 'Total',
              value: 42,
              role: 'measure',
              semantic_type: 'count',
            },
          ],
        }}
        title="Run details"
      />,
    );
    expect(screen.getByText('Run details')).toBeInTheDocument();
    expect(screen.getByText('Run ID')).toBeInTheDocument();
    expect(screen.getByText('abc123')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('formats percent values with one decimal', () => {
    render(
      <ChatSummaryCard
        summary={{
          fields: [
            {
              name: 'pass_rate',
              label: 'Pass Rate',
              value: 87.3,
              role: 'measure',
              semantic_type: 'percent',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('87.3%')).toBeInTheDocument();
  });

  it('renders em-dash for nulls', () => {
    render(
      <ChatSummaryCard
        summary={{ fields: [{ name: 'x', label: 'X', value: null, role: 'measure' }] }}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
