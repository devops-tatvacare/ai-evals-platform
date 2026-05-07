import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PredicateBuilder } from '@/features/orchestration/components/editors/PredicateBuilder';
import type { LeafPredicate } from '@/features/orchestration/types';

describe('PredicateBuilder', () => {
  it('renders an empty leaf predicate by default', () => {
    const onChange = vi.fn();
    render(<PredicateBuilder value={undefined} onChange={onChange} />);
    expect(screen.getByText('Leaf')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('payload field')).toBeInTheDocument();
  });

  it('switches between leaf / AND / OR / NOT kinds', () => {
    const onChange = vi.fn();
    render(<PredicateBuilder value={undefined} onChange={onChange} />);

    fireEvent.click(screen.getByText('AND'));
    expect(onChange).toHaveBeenCalledWith({
      and: [{ field: '', op: 'eq', value: '' }],
    });

    onChange.mockClear();
    fireEvent.click(screen.getByText('OR'));
    expect(onChange).toHaveBeenCalledWith({
      or: [{ field: '', op: 'eq', value: '' }],
    });

    onChange.mockClear();
    fireEvent.click(screen.getByText('NOT'));
    expect(onChange).toHaveBeenCalledWith({
      not: { field: '', op: 'eq', value: '' },
    });
  });

  it('hides the value input for exists / missing ops', () => {
    const onChange = vi.fn();
    const value: LeafPredicate = { field: 'phone', op: 'exists' };
    render(<PredicateBuilder value={value} onChange={onChange} />);
    expect(screen.getByText('(no value needed)')).toBeInTheDocument();
  });

  it('parses comma-separated values for in / not_in ops', () => {
    const onChange = vi.fn();
    const value: LeafPredicate = { field: 'stage', op: 'in', value: [] };
    render(<PredicateBuilder value={value} onChange={onChange} />);
    const valueInput = screen.getByPlaceholderText('a, b, c');
    fireEvent.change(valueInput, { target: { value: 'lost, won' } });
    expect(onChange).toHaveBeenCalledWith({
      field: 'stage',
      op: 'in',
      value: ['lost', 'won'],
    });
  });

  it('preserves typed commas while editing list-valued operators', () => {
    const onChange = vi.fn();
    const value: LeafPredicate = { field: 'stage', op: 'in', value: [] };
    render(<PredicateBuilder value={value} onChange={onChange} />);

    const valueInput = screen.getByPlaceholderText('a, b, c') as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: 'lost,' } });

    expect(onChange).toHaveBeenCalledWith({
      field: 'stage',
      op: 'in',
      value: ['lost'],
    });
    expect(valueInput.value).toBe('lost,');
  });

  it('emits the new operator on switch — value normalisation runs at the parse boundary', async () => {
    // Phase 14 / Phase D: PredicateBuilder no longer calls
    // `normalizePredicateValueForOperator` at event-time. Switching the
    // operator just emits `{...value, op: newOp}` — the
    // `LeafPredicateSchema.transform()` (run on the next `parseNodeConfig`
    // inside the store) drops the value for valueless ops. This test
    // verifies the editor now writes the raw shape; the
    // `nodeConfig.test.ts` suite covers the transform itself.
    const onChange = vi.fn();
    const value: LeafPredicate = { field: 'phone', op: 'eq', value: '919999999999' };
    render(<PredicateBuilder value={value} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /= equals/i }));
    fireEvent.click(await screen.findByText('exists'));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        field: 'phone',
        op: 'exists',
        value: '919999999999',
      });
    });
  });
});
