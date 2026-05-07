import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WaitConditionEditor } from '@/features/orchestration/components/editors/WaitConditionEditor';

describe('WaitConditionEditor', () => {
  it('renders only the duration input in duration mode', () => {
    const onChange = vi.fn();
    render(
      <WaitConditionEditor
        value={{ mode: 'duration', duration_hours: 4 }}
        onChange={onChange}
      />,
    );
    expect(screen.getByPlaceholderText('hours to wait')).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('hours before timeout fires'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('wati.message_replied'),
    ).not.toBeInTheDocument();
  });

  it('renders datetime input in until_datetime mode', () => {
    const onChange = vi.fn();
    render(
      <WaitConditionEditor
        value={{
          mode: 'until_datetime',
          until_datetime: '2026-05-01T00:00:00Z',
        }}
        onChange={onChange}
      />,
    );
    expect(screen.queryByPlaceholderText('hours to wait')).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('2026-05-01T00:00:00Z'),
    ).toBeInTheDocument();
  });

  it('renders event + timeout inputs in event_or_timeout mode', () => {
    const onChange = vi.fn();
    render(
      <WaitConditionEditor
        value={{
          mode: 'event_or_timeout',
          event_name: 'wati.replied',
          correlation: {},
          timeout_hours: 24,
        }}
        onChange={onChange}
      />,
    );
    expect(
      screen.getByPlaceholderText('wati.message_replied'),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('hours before timeout fires'),
    ).toBeInTheDocument();
    // No duration input.
    expect(screen.queryByPlaceholderText('hours to wait')).not.toBeInTheDocument();
  });
});
