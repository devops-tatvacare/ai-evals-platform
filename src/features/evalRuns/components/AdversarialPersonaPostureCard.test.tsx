/** Unit tests for the generic AdversarialPersonaPostureCard. */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdversarialPersonaPostureCard } from './AdversarialPersonaPostureCard';
import type { AdversarialResult } from '@/types';

function buildResult(overrides: Partial<AdversarialResult>): AdversarialResult {
  return {
    test_case: {
      goal_flow: ['meal_logged'],
      active_traits: [],
      difficulty: 'MORIARTY',
      synthetic_input: '',
      expected_behavior: '',
      expected_challenges: [],
    },
    ...overrides,
  };
}

describe('AdversarialPersonaPostureCard', () => {
  it('renders nothing when no tactic or rule data for the persona', () => {
    const { container } = render(
      <AdversarialPersonaPostureCard
        personaId="moriarty"
        result={buildResult({})}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders tactic counts grouped by group', () => {
    const result = buildResult({
      persona_tactic_summary: {
        tactics_attempted: ['prompt_override', 'sandwich'],
        tactics_landed: [],
        turn_tactic_sequence: [
          { turn_number: 1, persona_tactic: 'prompt_override' },
          { turn_number: 2, persona_tactic: 'prompt_override' },
          { turn_number: 3, persona_tactic: 'sandwich' },
        ],
        persona_rule_compliance: [],
      },
    });
    render(<AdversarialPersonaPostureCard personaId="moriarty" result={result} />);
    expect(screen.getByText(/By tactic/i)).toBeInTheDocument();
    expect(screen.getByText(/Prompt override/i)).toBeInTheDocument();
    expect(screen.getByText(/2 turns/i)).toBeInTheDocument();
    expect(screen.getByText(/Sandwich payload/i)).toBeInTheDocument();
    expect(screen.getByText(/1 turn/i)).toBeInTheDocument();
  });

  it('renders persona expectation rules with status', () => {
    const result = buildResult({
      rule_compliance: [
        {
          rule_id: 'persona.moriarty.no_system_reveal',
          section: 'Security Invariants',
          followed: false,
          status: 'VIOLATED',
          evidence: 'Bot revealed its system prompt on turn 5.',
        },
        {
          rule_id: 'persona.moriarty.no_character_break',
          section: 'Security Invariants',
          followed: true,
          status: 'FOLLOWED',
          evidence: 'Bot stayed in role.',
        },
        {
          rule_id: 'ask_time_if_missing',
          section: 'Time',
          followed: true,
          status: 'FOLLOWED',
          evidence: 'prod rule, unrelated',
        },
      ],
      persona_tactic_summary: {
        tactics_attempted: ['prompt_override'],
        tactics_landed: ['prompt_override'],
        turn_tactic_sequence: [
          { turn_number: 1, persona_tactic: 'prompt_override' },
        ],
        persona_rule_compliance: [],
      },
    });
    render(<AdversarialPersonaPostureCard personaId="moriarty" result={result} />);
    expect(screen.getByText(/By expectation rule/i)).toBeInTheDocument();
    expect(screen.getByText(/no_system_reveal/)).toBeInTheDocument();
    expect(screen.getByText(/violated/i)).toBeInTheDocument();
    expect(screen.getByText(/no_character_break/)).toBeInTheDocument();
    // Prod rule should not appear
    expect(screen.queryByText(/ask_time_if_missing/)).toBeNull();
  });

  it('returns null when personaId is not in the catalog', () => {
    const { container } = render(
      <AdversarialPersonaPostureCard
        personaId="nonexistent"
        result={buildResult({
          persona_tactic_summary: {
            tactics_attempted: ['x'],
            tactics_landed: [],
            turn_tactic_sequence: [],
            persona_rule_compliance: [],
          },
        })}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
