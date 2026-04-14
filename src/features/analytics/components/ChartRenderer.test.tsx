// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { ChartRenderer } from './ChartRenderer';

// Mock resolveColor since CSS variables aren't available in jsdom
vi.mock('@/utils/statusColors', () => ({
  resolveColor: (v: string) => v.replace(/var\(|\)/g, ''),
}));

describe('ChartRenderer', () => {
  test('renders "No data" when data is empty', () => {
    render(
      <ChartRenderer type="bar" data={[]} xKey="x" yKey="y" />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  test('renders "No data" for all chart types with empty data', () => {
    const types = ['bar', 'line', 'pie', 'donut', 'radar', 'funnel', 'treemap', 'scatter', 'radial_bar', 'composed', 'area', 'stacked_bar', 'horizontal_bar'];
    for (const type of types) {
      const { unmount } = render(
        <ChartRenderer type={type} data={[]} xKey="x" yKey="y" />,
      );
      expect(screen.getByText('No data')).toBeInTheDocument();
      unmount();
    }
  });

  test('falls back to bar for unknown chart type', () => {
    // Should not throw — falls back to bar
    const { container } = render(
      <ChartRenderer
        type="nonexistent"
        data={[{ x: 'a', y: 1 }]}
        xKey="x"
        yKey="y"
      />,
    );
    // Should render something (not crash)
    expect(container.firstChild).toBeTruthy();
  });

  test('scatter shows message when no y key', () => {
    render(
      <ChartRenderer
        type="scatter"
        data={[{ x: 1 }]}
        xKey="x"
      />,
    );
    expect(screen.getByText('Scatter needs two numeric columns')).toBeInTheDocument();
  });

  test('accepts series prop without crashing', () => {
    const { container } = render(
      <ChartRenderer
        type="composed"
        data={[{ month: '2026-01', rev: 100, cost: 50 }]}
        xKey="month"
        series={[
          { dataKey: 'rev', type: 'bar' },
          { dataKey: 'cost', type: 'line' },
        ]}
      />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  test('accepts legendPosition prop', () => {
    const { container } = render(
      <ChartRenderer
        type="bar"
        data={[{ x: 'a', y: 1 }]}
        xKey="x"
        yKey="y"
        legendPosition="right"
      />,
    );
    expect(container.firstChild).toBeTruthy();
  });
});
