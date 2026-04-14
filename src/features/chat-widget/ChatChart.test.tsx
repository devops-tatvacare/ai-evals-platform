// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { ChatChart } from './ChatChart';
import type { ChartData } from './types';

// Mock the analytics library API to prevent real API calls
vi.mock('@/services/api/analyticsLibraryApi', () => ({
  analyticsLibraryApi: {
    saveChart: vi.fn().mockResolvedValue({}),
  },
}));

// Mock ChartRenderer since Recharts doesn't render in jsdom
vi.mock('@/features/analytics/components/ChartRenderer', () => ({
  ChartRenderer: ({ type, xKey, yKey }: { type: string; xKey: string; yKey?: string }) => (
    <div data-testid="chart-renderer" data-type={type} data-xkey={xKey} data-ykey={yKey} />
  ),
}));

const baseChart: ChartData = {
  spec: {
    type: 'bar',
    title: 'Revenue by Agent',
    xKey: 'agent',
    yKey: 'revenue',
    seriesKeys: [],
    xLabel: 'Agent',
    yLabel: 'Revenue',
  },
  data: [
    { agent: 'Alice', revenue: 100 },
    { agent: 'Bob', revenue: 200 },
  ],
  sqlQuery: 'SELECT agent, revenue FROM facts',
  sourceQuestion: 'Show revenue by agent',
};

describe('ChatChart', () => {
  test('renders chart title', () => {
    render(<ChatChart chart={baseChart} appId="test-app" />);
    expect(screen.getByText('Revenue by Agent')).toBeInTheDocument();
  });

  test('renders ChartRenderer with correct props', () => {
    render(<ChatChart chart={baseChart} appId="test-app" />);
    const renderer = screen.getByTestId('chart-renderer');
    expect(renderer).toHaveAttribute('data-type', 'bar');
    expect(renderer).toHaveAttribute('data-xkey', 'agent');
    expect(renderer).toHaveAttribute('data-ykey', 'revenue');
  });

  test('renders Add to library button', () => {
    render(<ChatChart chart={baseChart} appId="test-app" />);
    expect(screen.getByText('Add to library')).toBeInTheDocument();
  });

  test('does not render suggestion pills when no alternatives', () => {
    render(<ChatChart chart={baseChart} appId="test-app" />);
    expect(screen.queryByText('Try as:')).not.toBeInTheDocument();
  });

  test('renders suggestion pills when alternatives present', () => {
    const chartWithAlts: ChartData = {
      ...baseChart,
      spec: {
        ...baseChart.spec,
        alternatives: ['pie', 'horizontal_bar'],
      },
    };
    render(<ChatChart chart={chartWithAlts} appId="test-app" />);
    expect(screen.getByText('Try as:')).toBeInTheDocument();
    expect(screen.getByText('Pie')).toBeInTheDocument();
    expect(screen.getByText('H. Bar')).toBeInTheDocument();
  });

  test('clicking alternative pill switches chart type', () => {
    const chartWithAlts: ChartData = {
      ...baseChart,
      spec: {
        ...baseChart.spec,
        alternatives: ['pie'],
      },
    };
    render(<ChatChart chart={chartWithAlts} appId="test-app" />);

    // Initially bar
    expect(screen.getByTestId('chart-renderer')).toHaveAttribute('data-type', 'bar');

    // Click pie pill
    fireEvent.click(screen.getByText('Pie'));

    // Now pie
    expect(screen.getByTestId('chart-renderer')).toHaveAttribute('data-type', 'pie');
  });

  test('shows original type button after switching', () => {
    const chartWithAlts: ChartData = {
      ...baseChart,
      spec: {
        ...baseChart.spec,
        alternatives: ['pie'],
      },
    };
    render(<ChatChart chart={chartWithAlts} appId="test-app" />);

    // Click pie to switch away from bar
    fireEvent.click(screen.getByText('Pie'));

    // Original type "Bar" should now appear as a button to switch back
    expect(screen.getByText('Bar')).toBeInTheDocument();
  });
});
