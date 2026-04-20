import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ChatKpiCard } from './ChatKpiCard';

describe('ChatKpiCard', () => {
  it('renders integer count', () => {
    render(
      <ChatKpiCard
        kpi={{ value: 47, label: 'Total', format: 'integer' }}
        title="Total runs"
      />,
    );
    expect(screen.getByText('47')).toBeInTheDocument();
    expect(screen.getByText('Total runs')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('renders percent with one decimal', () => {
    render(
      <ChatKpiCard kpi={{ value: 87.3, label: 'Pass rate', format: 'percent' }} />,
    );
    expect(screen.getByText('87.3%')).toBeInTheDocument();
  });

  it('renders currency as USD', () => {
    render(
      <ChatKpiCard kpi={{ value: 1234.5, label: 'Revenue', format: 'currency' }} />,
    );
    expect(screen.getByText('$1,234.50')).toBeInTheDocument();
  });

  it('renders em-dash on null value', () => {
    render(
      <ChatKpiCard kpi={{ value: null, label: 'Score', format: 'decimal' }} />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows warning banner when provided', () => {
    render(
      <ChatKpiCard
        kpi={{ value: 1, label: 'Only row', format: 'integer' }}
        warning="Only one data point."
      />,
    );
    expect(screen.getByText('Only one data point.')).toBeInTheDocument();
  });
});
