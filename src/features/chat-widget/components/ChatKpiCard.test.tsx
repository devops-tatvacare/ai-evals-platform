import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ChatKpiCard } from './ChatKpiCard';

// Body-only: title / warning / actions now live in ChatArtifactCard.
describe('ChatKpiCard', () => {
  it('renders integer count and label', () => {
    render(<ChatKpiCard kpi={{ value: 47, label: 'Total', format: 'integer' }} />);
    expect(screen.getByText('47')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('renders percent with one decimal', () => {
    render(<ChatKpiCard kpi={{ value: 87.3, label: 'Pass rate', format: 'percent' }} />);
    expect(screen.getByText('87.3%')).toBeInTheDocument();
  });

  it('renders currency as USD', () => {
    render(<ChatKpiCard kpi={{ value: 1234.5, label: 'Revenue', format: 'currency' }} />);
    expect(screen.getByText('$1,234.50')).toBeInTheDocument();
  });

  it('renders em-dash on null value', () => {
    render(<ChatKpiCard kpi={{ value: null, label: 'Score', format: 'decimal' }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
