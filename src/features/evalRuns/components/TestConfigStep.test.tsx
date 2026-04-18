// @vitest-environment jsdom

import { useState, type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const { getConfigMock, listCasesMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  listCasesMock: vi.fn(),
}));

function comboboxTestId(placeholder: string): string {
  return `combobox-${placeholder.replaceAll(/\s+/g, '-').toLowerCase()}`;
}

vi.mock('@/services/api/adversarialConfigApi', () => ({
  adversarialConfigApi: {
    get: getConfigMock,
  },
}));

vi.mock('@/services/api/adversarialTestCasesApi', () => ({
  adversarialTestCasesApi: {
    list: listCasesMock,
  },
}));

vi.mock('@/services/notifications', () => ({
  notificationService: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/features/settings/components/SettingsSlideOver', () => ({
  SettingsSlideOver: () => null,
}));

vi.mock('./ContractRuleSelectionPanel', () => ({
  ContractRuleSelectionPanel: () => <div data-testid="contract-rule-panel" />,
}));

vi.mock('@/components/ui', () => ({
  Button: ({ children, onClick, ...props }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick} {...props}>{children}</button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Combobox: (props: {
    placeholder?: string;
    onChange: (values: string[]) => void;
  }) => {
    const testId = comboboxTestId(props.placeholder ?? 'unknown');
    return (
      <button type="button" data-testid={testId} onClick={() => props.onChange([])}>
        {props.placeholder}
      </button>
    );
  },
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select data-testid="select" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

import { TestConfigStep, type AdversarialManualCaseInput } from './TestConfigStep';

function Harness({
  onGoalsSpy,
  onTraitsSpy,
  onPersonasSpy,
}: {
  onGoalsSpy: (values: string[]) => void;
  onTraitsSpy: (values: string[]) => void;
  onPersonasSpy: (values: string[]) => void;
}) {
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [selectedTraits, setSelectedTraits] = useState<string[] | null>(null);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[] | null>(null);
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([]);

  const manualCases: AdversarialManualCaseInput[] = [];

  return (
    <TestConfigStep
      caseMode="generate"
      testCount={15}
      selectedGoals={selectedGoals}
      selectedTraits={selectedTraits}
      selectedRuleIds={selectedRuleIds}
      selectedPersonas={selectedPersonas}
      selectedPersonaTactics={{}}
      personaMixingMode="single"
      flowMode="single"
      extraInstructions=""
      selectedSavedCaseIds={[]}
      includePinnedCases={false}
      manualCases={manualCases}
      onCaseModeChange={vi.fn()}
      onTestCountChange={vi.fn()}
      onPersonaTacticsChange={vi.fn()}
      onGoalsChange={(values) => {
        onGoalsSpy(values);
        setSelectedGoals(values);
      }}
      onTraitsChange={(values) => {
        onTraitsSpy(values);
        setSelectedTraits(values);
      }}
      onSelectedRuleIdsChange={setSelectedRuleIds}
      onPersonasChange={(values) => {
        onPersonasSpy(values);
        setSelectedPersonas(values);
      }}
      onPersonaMixingModeChange={vi.fn()}
      onFlowModeChange={vi.fn()}
      onExtraInstructionsChange={vi.fn()}
      onSavedCasesChange={vi.fn()}
      onIncludePinnedCasesChange={vi.fn()}
      onManualCasesChange={vi.fn()}
    />
  );
}

beforeEach(() => {
  getConfigMock.mockReset();
  listCasesMock.mockReset();
  getConfigMock.mockResolvedValue({
    version: 1,
    goals: [
      {
        id: 'goal-a',
        label: 'Goal A',
        description: 'Goal A',
        completionCriteria: [],
        notCompletion: [],
        agentBehavior: '',
        signalPatterns: [],
        enabled: true,
      },
      {
        id: 'goal-b',
        label: 'Goal B',
        description: 'Goal B',
        completionCriteria: [],
        notCompletion: [],
        agentBehavior: '',
        signalPatterns: [],
        enabled: true,
      },
    ],
    traits: [
      {
        id: 'trait-a',
        label: 'Trait A',
        description: 'Trait A',
        behaviorHint: '',
        enabled: true,
      },
    ],
    rules: [],
  });
  listCasesMock.mockResolvedValue([]);
});

test('initializes defaults once and allows users to clear goals and personas', async () => {
  const user = userEvent.setup();
  const onGoalsSpy = vi.fn();
  const onTraitsSpy = vi.fn();
  const onPersonasSpy = vi.fn();

  render(
    <Harness
      onGoalsSpy={onGoalsSpy}
      onTraitsSpy={onTraitsSpy}
      onPersonasSpy={onPersonasSpy}
    />,
  );

  await waitFor(() => {
    expect(onGoalsSpy).toHaveBeenCalledWith(['goal-a', 'goal-b']);
    expect(onTraitsSpy).toHaveBeenCalledWith(['trait-a']);
    expect(onPersonasSpy).toHaveBeenCalledWith(['easy', 'medium', 'hard']);
  });

  onGoalsSpy.mockClear();
  onPersonasSpy.mockClear();

  await user.click(screen.getByTestId(comboboxTestId('Select goals')));
  await user.click(screen.getByTestId(comboboxTestId('Select persona bands')));

  await waitFor(() => {
    expect(onGoalsSpy).toHaveBeenCalledTimes(1);
    expect(onGoalsSpy).toHaveBeenLastCalledWith([]);
    expect(onPersonasSpy).toHaveBeenCalledTimes(1);
    expect(onPersonasSpy).toHaveBeenLastCalledWith([]);
  });
});
