// @vitest-environment jsdom

import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const { getConfigMock, comboboxSpy } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  comboboxSpy: vi.fn(),
}));

vi.mock('@/services/api/adversarialConfigApi', () => ({
  adversarialConfigApi: {
    get: getConfigMock,
  },
}));

vi.mock('@/services/notifications', () => ({
  notificationService: {
    error: vi.fn(),
  },
}));

vi.mock('@/components/ui', () => ({
  Combobox: (props: { onChange: (values: string[]) => void; value: string[] }) => {
    comboboxSpy(props);
    return (
      <button type="button" data-testid="clear-contract-rules" onClick={() => props.onChange([])}>
        clear contract rules
      </button>
    );
  },
}));

import { ContractRuleSelectionPanel } from './ContractRuleSelectionPanel';

function Harness() {
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[] | null>(null);
  return (
    <ContractRuleSelectionPanel
      scopes={['adversarial']}
      selectedRuleIds={selectedRuleIds}
      onChange={setSelectedRuleIds}
    />
  );
}

beforeEach(() => {
  getConfigMock.mockReset();
  comboboxSpy.mockReset();
  getConfigMock.mockResolvedValue({
    version: 1,
    goals: [],
    traits: [],
    rules: [
      {
        ruleId: 'rule-a',
        section: 'Section A',
        ruleText: 'Rule A',
        goalIds: ['goal-a'],
        evaluationScopes: ['adversarial'],
        enabled: true,
      },
      {
        ruleId: 'rule-b',
        section: 'Section B',
        ruleText: 'Rule B',
        goalIds: ['goal-b'],
        evaluationScopes: ['adversarial'],
        enabled: true,
      },
    ],
  });
});

test('initializes to all rules and preserves an explicit empty selection', async () => {
  const user = userEvent.setup();

  render(<Harness />);

  await waitFor(() => {
    expect(comboboxSpy.mock.lastCall?.[0].value).toEqual(['rule-a', 'rule-b']);
  });

  await user.click(screen.getByTestId('clear-contract-rules'));

  await waitFor(() => {
    expect(comboboxSpy.mock.lastCall?.[0].value).toEqual([]);
  });
});
