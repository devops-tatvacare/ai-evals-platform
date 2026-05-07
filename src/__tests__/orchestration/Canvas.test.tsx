import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@/features/orchestration/components/Canvas';

beforeAll(() => {
  // React Flow uses ResizeObserver and DOMRect APIs that jsdom does not implement.
  if (!('ResizeObserver' in globalThis)) {
    class MockResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
      MockResizeObserver;
  }
});

describe('Canvas', () => {
  it('renders without crashing', () => {
    const { container } = render(<Canvas />);
    expect(container.querySelector('.react-flow')).toBeTruthy();
  });
});
