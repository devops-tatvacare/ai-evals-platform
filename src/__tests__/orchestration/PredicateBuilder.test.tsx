import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
      all: [{ field: '', op: 'eq', value: '' }],
    });

    onChange.mockClear();
    fireEvent.click(screen.getByText('OR'));
    expect(onChange).toHaveBeenCalledWith({
      any: [{ field: '', op: 'eq', value: '' }],
    });

    onChange.mockClear();
    fireEvent.click(screen.getByText('NOT'));
    expect(onChange).toHaveBeenCalledWith({
      not: { field: '', op: 'eq', value: '' },
    });
  });

  it('hides the value input for is_null / is_not_null ops', () => {
    const onChange = vi.fn();
    const value: LeafPredicate = { field: 'phone', op: 'is_null' };
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
});
