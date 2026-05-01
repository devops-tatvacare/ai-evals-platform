import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { AttemptPolicyEditor } from '@/features/orchestration/components/editors/AttemptPolicyEditor';
import { DEFAULT_ATTEMPT_POLICY } from '@/features/orchestration/types';

describe('AttemptPolicyEditor', () => {
  it('falls back to the default policy when value is undefined', () => {
    const onChange = vi.fn();
    render(<AttemptPolicyEditor value={undefined} onChange={onChange} />);
    const maxAttempts = screen.getByDisplayValue(
      String(DEFAULT_ATTEMPT_POLICY.max_attempts),
    );
    expect(maxAttempts).toBeInTheDocument();
  });

  it('hides the delay input when backoff_kind is immediate', () => {
    const onChange = vi.fn();
    render(<AttemptPolicyEditor value={undefined} onChange={onChange} />);
    expect(screen.queryByText('Delay (minutes)')).not.toBeInTheDocument();
  });

  it('parses comma-separated retry_on tokens', () => {
    const onChange = vi.fn();
    render(<AttemptPolicyEditor value={undefined} onChange={onChange} />);
    const retryInput = screen.getByPlaceholderText('timeout, http_5xx, transport');
    fireEvent.change(retryInput, { target: { value: 'timeout, http_5xx' } });
    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.retry_on).toEqual(['timeout', 'http_5xx']);
  });

  it('clamps max_attempts to a minimum of 1', () => {
    const onChange = vi.fn();
    render(<AttemptPolicyEditor value={undefined} onChange={onChange} />);
    const max = screen.getByDisplayValue(
      String(DEFAULT_ATTEMPT_POLICY.max_attempts),
    );
    fireEvent.change(max, { target: { value: '0' } });
    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.max_attempts).toBe(1);
  });
});
