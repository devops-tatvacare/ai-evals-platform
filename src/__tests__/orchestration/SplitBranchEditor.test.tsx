import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { SplitBranchEditor } from '@/features/orchestration/components/editors/SplitBranchEditor';
import { normalizeSplitConfigForMode } from '@/features/orchestration/components/editors/splitBranchUtils';

describe('SplitBranchEditor', () => {
  it('adds branches with stable ids the operator never sees', () => {
    const onChange = vi.fn();
    render(
      <SplitBranchEditor
        value={{ mode: 'by_field', field: 'mql_score' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('Add branch'));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next.branches).toHaveLength(1);
    expect(next.branches[0]).toMatchObject({
      label: 'Branch 1',
      match: '',
    });
    expect(typeof next.branches[0].id).toBe('string');
    // Id is not surfaced in the UI — only the label.
    expect(screen.queryByText(next.branches[0].id)).not.toBeInTheDocument();
  });

  it('renders predicate sub-editor for by_rules mode', () => {
    const onChange = vi.fn();
    render(
      <SplitBranchEditor
        value={{
          mode: 'by_rules',
          branches: [
            {
              id: 'b1',
              label: 'High',
              predicate: { field: 'mql_score', op: 'gte', value: '4' },
            },
          ],
        }}
        onChange={onChange}
      />,
    );
    // PredicateBuilder renders the kind switcher inside the branch row.
    expect(screen.getAllByText('Leaf').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AND').length).toBeGreaterThan(0);
  });

  it('clears default_branch_id when its branch is removed', () => {
    const onChange = vi.fn();
    render(
      <SplitBranchEditor
        value={{
          mode: 'by_field',
          branches: [
            { id: 'b1', label: 'A', match: 'a' },
            { id: 'b2', label: 'B', match: 'b' },
          ],
          default_branch_id: 'b1',
        }}
        onChange={onChange}
      />,
    );
    const removeButtons = screen.getAllByRole('button', { name: /Remove branch/i });
    fireEvent.click(removeButtons[0]);
    const next = onChange.mock.calls[0][0];
    expect(next.branches).toHaveLength(1);
    expect(next.default_branch_id).toBeUndefined();
  });

  it('drops mode-specific stale fields when normalizing split config for a new mode', () => {
    expect(
      normalizeSplitConfigForMode(
        {
          mode: 'by_field',
          field: 'tier',
          branches: [{ id: 'b1', label: 'High', match: 'high', weight: 7 }],
        },
        'by_rules',
      ),
    ).toEqual({
      mode: 'by_rules',
      branches: [
        {
          id: 'b1',
          label: 'High',
          predicate: { field: '', op: 'eq', value: '' },
        },
      ],
      default_branch_id: undefined,
    });
  });
});
