/**
 * Unit tests for the generic PersonaTacticsSelector.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PersonaTacticsSelector } from './PersonaTacticsSelector';
import { MORIARTY_PERSONA, PERSONA_CATALOG } from './personaCatalog';

describe('personaCatalog', () => {
  it('ships Moriarty with 9 tactics', () => {
    expect(MORIARTY_PERSONA.tactics).toHaveLength(9);
  });

  it('includes Moriarty in the public catalog', () => {
    expect(PERSONA_CATALOG.map((p) => p.id)).toContain('moriarty');
  });

  it('Moriarty tactics cover all four groups', () => {
    const groups = new Set(MORIARTY_PERSONA.tactics.map((t) => t.group));
    expect(groups).toEqual(
      new Set(['prompt_injection', 'social_engineering', 'payload_injection', 'data_exfil']),
    );
  });

  it('Moriarty tactics cover all four tiers', () => {
    const tiers = new Set(MORIARTY_PERSONA.tactics.map((t) => t.riskTier));
    expect(tiers).toEqual(new Set(['low', 'medium', 'high', 'destructive']));
  });
});

describe('PersonaTacticsSelector', () => {
  it('renders all Moriarty tactics when value is undefined (all selected)', () => {
    render(
      <PersonaTacticsSelector
        persona={MORIARTY_PERSONA}
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/prompt override/i)).toBeInTheDocument();
    expect(screen.getByText(/sql delete\/drop-style payload/i)).toBeInTheDocument();
    // "Destructive" tier badge appears — exact-match in the uppercase label.
    expect(screen.getAllByText(/destructive/i).length).toBeGreaterThan(0);
  });

  it('shows validation message when zero tactics are selected', () => {
    render(
      <PersonaTacticsSelector
        persona={MORIARTY_PERSONA}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/at least one tactic must be selected/i)).toBeInTheDocument();
  });

  it('toggling a checkbox emits a subset in config order', () => {
    const onChange = vi.fn();
    render(
      <PersonaTacticsSelector
        persona={MORIARTY_PERSONA}
        // Start with all tactics EXCEPT prompt_override
        value={MORIARTY_PERSONA.tactics.filter((t) => t.id !== 'prompt_override').map((t) => t.id)}
        onChange={onChange}
      />,
    );
    const promptOverrideCheckbox = screen.getAllByRole('checkbox').find(
      (el) => el.closest('label')?.textContent?.includes('Prompt override'),
    );
    expect(promptOverrideCheckbox).toBeDefined();
    act(() => {
      fireEvent.click(promptOverrideCheckbox!);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as string[];
    // Now all 9 tactics are selected, preserved in config order
    expect(emitted).toEqual(MORIARTY_PERSONA.tactics.map((t) => t.id));
  });

  it('select all button emits the full ordered tactic list', () => {
    const onChange = vi.fn();
    render(
      <PersonaTacticsSelector
        persona={MORIARTY_PERSONA}
        value={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText(/select all/i));
    expect(onChange).toHaveBeenCalledWith(MORIARTY_PERSONA.tactics.map((t) => t.id));
  });

  it('clear button emits empty array', () => {
    const onChange = vi.fn();
    render(
      <PersonaTacticsSelector
        persona={MORIARTY_PERSONA}
        value={undefined}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText(/clear/i));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('renders nothing when persona has no tactics', () => {
    const { container } = render(
      <PersonaTacticsSelector
        persona={{
          id: 'stub',
          label: 'Stub',
          description: '',
          tactics: [],
        }}
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
