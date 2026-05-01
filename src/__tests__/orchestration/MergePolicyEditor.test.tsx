import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MergePolicyEditor } from '@/features/orchestration/components/editors/MergePolicyEditor';

describe('MergePolicyEditor', () => {
  it('renders both merge_policy and payload_policy fields with help text', () => {
    const onChange = vi.fn();
    render(<MergePolicyEditor value={{}} onChange={onChange} />);
    expect(screen.getByText('Recipient merge policy')).toBeInTheDocument();
    expect(screen.getByText('Payload merge policy')).toBeInTheDocument();
    // Default policy help copy is shown.
    expect(
      screen.getByText(/Latest payload overrides earlier ones/),
    ).toBeInTheDocument();
  });

  it('shows help copy that matches the explicit selection', () => {
    const onChange = vi.fn();
    render(
      <MergePolicyEditor
        value={{ merge_policy: 'dedupe', payload_policy: 'union' }}
        onChange={onChange}
      />,
    );
    expect(
      screen.getByText(/Same recipient arriving from multiple branches/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Merge keys; conflicts resolved deterministically/),
    ).toBeInTheDocument();
  });
});
