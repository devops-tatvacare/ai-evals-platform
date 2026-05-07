import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/orchestrationConnections', () => ({
  getAgentVariables: vi.fn(),
}));

import { getAgentVariables } from '@/services/api/orchestrationConnections';
import { VariableMappingField } from '@/features/orchestration/components/VariableMappingField';

describe('VariableMappingField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAgentVariables as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: 'bolna',
      variables: ['user_name', 'preferred_time'],
      error: null,
    });
  });

  it('adds a new mapping row with the default payload-source shape', () => {
    const onChange = vi.fn();
    render(<VariableMappingField value={[]} onChange={onChange} />);

    expect(
      screen.getByText('No variable mappings — click Add to bind an agent variable.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }));
    expect(onChange).toHaveBeenCalledWith([
      { agent_variable: '', source_kind: 'payload', payload_field: '' },
    ]);
  });

  it('removes a mapping row by index', () => {
    const onChange = vi.fn();
    render(
      <VariableMappingField
        value={[
          { agent_variable: 'first_name', source_kind: 'payload', payload_field: 'first_name' },
          { agent_variable: 'plan_name', source_kind: 'static', static_value: 'Pro' },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove mapping 1' }));
    expect(onChange).toHaveBeenCalledWith([
      { agent_variable: 'plan_name', source_kind: 'static', static_value: 'Pro' },
    ]);
  });

  it('fetches agent variables when a connectionId is supplied', async () => {
    render(
      <VariableMappingField
        value={[{ agent_variable: '', source_kind: 'payload', payload_field: '' }]}
        onChange={vi.fn()}
        connectionId="conn-1"
        agentId="agent-7"
      />,
    );

    await waitFor(() =>
      expect(getAgentVariables).toHaveBeenCalledWith('conn-1', {
        agentId: 'agent-7',
        templateName: undefined,
      }),
    );
  });

  it('uses selected template parameters directly without refetching', async () => {
    render(
      <VariableMappingField
        value={[{ agent_variable: '', source_kind: 'payload', payload_field: '' }]}
        onChange={vi.fn()}
        connectionId="conn-1"
        templateName="concierge_qualify_v1"
        templateParameters={['first_name', 'city']}
      />,
    );

    await waitFor(() => {
      expect(getAgentVariables).not.toHaveBeenCalled();
    });
  });

  it('clears stale source-specific fields when switching source kind', async () => {
    const onChange = vi.fn();
    render(
      <VariableMappingField
        value={[
          {
            agent_variable: 'user_name',
            source_kind: 'payload',
            payload_field: 'first_name',
            static_value: 'stale',
          },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Recipient field/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Static value$/i }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([
        {
          agent_variable: 'user_name',
          source_kind: 'static',
          static_value: 'stale',
        },
      ]);
    });
  });
});
