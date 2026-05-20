import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ChatArtifactCard } from './ChatArtifactCard';

describe('ChatArtifactCard', () => {
  it('renders title, subtitle, warning, actions, and body', () => {
    render(
      <ChatArtifactCard
        kind="table"
        title="Failed threads"
        subtitle="Which threads failed?"
        warning="All values the same"
        actions={<button type="button">Copy</button>}
      >
        <span>body content</span>
      </ChatArtifactCard>,
    );
    expect(screen.getByText('Failed threads')).toBeInTheDocument();
    expect(screen.getByText('Which threads failed?')).toBeInTheDocument();
    expect(screen.getByText('All values the same')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByText('body content')).toBeInTheDocument();
  });

  it('hides the subtitle when it equals the title', () => {
    render(
      <ChatArtifactCard kind="kpi" title="Leads" subtitle="Leads">
        <span>x</span>
      </ChatArtifactCard>,
    );
    expect(screen.getAllByText('Leads')).toHaveLength(1);
  });

  it('renders body without a header when no title or actions are given', () => {
    render(
      <ChatArtifactCard kind="empty">
        <span>just a body</span>
      </ChatArtifactCard>,
    );
    expect(screen.getByText('just a body')).toBeInTheDocument();
  });

  it('exposes the kind for styling hooks', () => {
    const { container } = render(
      <ChatArtifactCard kind="chart" title="Pass rate">
        <span>chart</span>
      </ChatArtifactCard>,
    );
    expect(container.querySelector('[data-artifact-kind="chart"]')).not.toBeNull();
  });
});
