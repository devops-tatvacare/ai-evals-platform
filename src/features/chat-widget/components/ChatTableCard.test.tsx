import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { truncateIdHash } from '../chartFormat';
import { ChatTableCard } from './ChatTableCard';

const COLS = [
  { name: 'thread_id', label: 'Thread ID', role: 'identifier', semantic_type: 'id_hash' },
  { name: 'is_failed', label: 'Is Failed', role: 'measure', semantic_type: 'count' },
];

// Body-only: title / warning live in ChatArtifactCard.
describe('ChatTableCard', () => {
  it('renders headers and cells', () => {
    render(
      <ChatTableCard
        columns={COLS}
        data={[
          { thread_id: 'thrd-1234abcd5678', is_failed: 1 },
          { thread_id: 'thrd-5678efgh9012', is_failed: 1 },
        ]}
      />,
    );
    expect(screen.getByText('Thread ID')).toBeInTheDocument();
    expect(screen.getByText('Is Failed')).toBeInTheDocument();
    // Two "1" cells from is_failed column.
    expect(screen.getAllByText('1')).toHaveLength(2);
  });

  it('truncates long id_hash values and keeps full value in title', () => {
    const long = 'thrd-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    render(<ChatTableCard columns={COLS} data={[{ thread_id: long, is_failed: 1 }]} />);
    const cell = screen.getByTitle(long);
    expect(cell).toBeInTheDocument();
    // Shown text is truncated — shorter than the raw value.
    expect(cell.textContent && cell.textContent.length).toBeLessThan(long.length);
  });

  it('renders em-dash for null cells', () => {
    render(<ChatTableCard columns={COLS} data={[{ thread_id: null, is_failed: 0 }]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('truncateIdHash keeps short strings intact', () => {
    expect(truncateIdHash('short')).toBe('short');
    const long = 'a'.repeat(50);
    const truncated = truncateIdHash(long);
    expect(truncated.length).toBeLessThan(long.length);
    expect(truncated).toContain('…');
  });
});
