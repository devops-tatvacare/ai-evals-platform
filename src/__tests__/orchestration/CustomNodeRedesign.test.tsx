import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { CustomNode } from '@/features/orchestration/components/CustomNode';
import {
  NODE_CATEGORIES,
} from '@/features/orchestration/config/categories';

function renderWithCategory(category: string, label: string, description?: string) {
  const data = {
    label,
    nodeType: `cat.${category}`,
    category,
    description,
    outputEdges: ['default'],
  };
  return render(
    <ReactFlowProvider>
      <CustomNode
        // ReactFlow's `NodeProps` shape is fairly large; only the fields the
        // component reads matter for this test, so we cast a minimal stand-in.
        {...({ id: 'n1', selected: false, data, type: 'custom' } as unknown as Parameters<
          typeof CustomNode
        >[0])}
      />
    </ReactFlowProvider>,
  );
}

describe('CustomNode redesign', () => {
  it('renders the category bar with the label from NODE_CATEGORIES for each category', () => {
    for (const category of Object.keys(NODE_CATEGORIES)) {
      const def = NODE_CATEGORIES[category as keyof typeof NODE_CATEGORIES];
      const { unmount } = renderWithCategory(category, `Test ${category}`);
      // The category label is rendered with CSS ``text-transform:
      // uppercase`` — the underlying DOM keeps the source-case string,
      // so we assert against ``def.label`` directly. Title-case helpers
      // were the source of the prior assertion bug.
      expect(screen.getByText(def.label)).toBeInTheDocument();
      expect(screen.getByText(`Test ${category}`)).toBeInTheDocument();
      unmount();
    }
  });

  it('shows the description when one is supplied, falling back to the node type otherwise', () => {
    const { unmount } = renderWithCategory('source', 'Cohort Query', 'A short blurb.');
    expect(screen.getByText('A short blurb.')).toBeInTheDocument();
    unmount();

    renderWithCategory('source', 'No-desc Node');
    expect(screen.getByText('cat.source')).toBeInTheDocument();
  });
});
