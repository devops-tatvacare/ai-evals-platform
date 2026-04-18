/**
 * PersonaTacticsSelector — generic selector for persona-bound attack tactics.
 *
 * Renders tactics grouped by group with tier badges next to each. Reads its
 * data from a PersonaDefinition — no persona-specific branding inside the
 * component, so adding a new adversarial persona is a config-only change.
 *
 * Tiers (low / medium / high / destructive) are informational labels, not
 * access gates — the user can pick any tactic freely.
 */

import { useMemo } from 'react';
import { cn } from '@/utils';
import {
  GROUP_LABELS,
  TIER_LABELS,
  groupTactics,
  type PersonaDefinition,
  type PersonaTactic,
  type PersonaTacticTier,
} from './personaCatalog';

interface PersonaTacticsSelectorProps {
  persona: PersonaDefinition;
  /** undefined = all tactics active; [] = nothing selected (invalid submission). */
  value: string[] | undefined;
  onChange: (tacticIds: string[]) => void;
}

const TIER_TOKEN_CLASSES: Record<PersonaTacticTier, string> = {
  // Map tiers onto existing status tokens from src/styles/globals.css so
  // theming stays coherent with the rest of the app. No hex literals.
  low: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
  medium: 'bg-[var(--surface-info)] text-[var(--color-info-dark)] border-[var(--border-info)]',
  high: 'bg-[var(--surface-warning)] text-[var(--color-warning-dark)] border-[var(--border-warning)]',
  destructive:
    'bg-[var(--surface-error)] text-[var(--color-error-dark)] border-[var(--border-error)]',
};

function TierBadge({ tier }: { tier: PersonaTacticTier }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border',
        TIER_TOKEN_CLASSES[tier],
      )}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}

export function PersonaTacticsSelector({
  persona,
  value,
  onChange,
}: PersonaTacticsSelectorProps) {
  const allIds = useMemo(() => persona.tactics.map((t) => t.id), [persona.tactics]);
  // Treat `undefined` as "all selected" so a fresh overlay defaults to full coverage.
  const resolvedValue = value ?? allIds;
  const selectedSet = useMemo(() => new Set(resolvedValue), [resolvedValue]);
  const grouped = useMemo(() => groupTactics(persona.tactics), [persona.tactics]);

  const toggleTactic = (tacticId: string) => {
    const next = new Set(selectedSet);
    if (next.has(tacticId)) next.delete(tacticId);
    else next.add(tacticId);
    // Preserve config order; output list is a subset of allIds in original order.
    onChange(allIds.filter((id) => next.has(id)));
  };

  const toggleGroup = (groupTacticIds: string[]) => {
    const allInGroupSelected = groupTacticIds.every((id) => selectedSet.has(id));
    const next = new Set(selectedSet);
    if (allInGroupSelected) {
      groupTacticIds.forEach((id) => next.delete(id));
    } else {
      groupTacticIds.forEach((id) => next.add(id));
    }
    onChange(allIds.filter((id) => next.has(id)));
  };

  const selectAll = () => onChange(allIds);
  const selectNone = () => onChange([]);

  if (persona.tactics.length === 0) {
    return null;
  }

  const hasDestructive = persona.tactics.some((t) => t.riskTier === 'destructive');

  return (
    <div className="space-y-3 rounded border border-[var(--border-default)] p-3 bg-[var(--bg-primary)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium text-[var(--text-primary)]">
            {persona.label} tactics
          </div>
          <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
            {persona.description}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[12px] shrink-0">
          <button
            type="button"
            onClick={selectAll}
            className="text-[var(--interactive-primary)] hover:underline"
          >
            Select all
          </button>
          <span className="text-[var(--text-muted)]">/</span>
          <button
            type="button"
            onClick={selectNone}
            className="text-[var(--text-secondary)] hover:underline"
          >
            Clear
          </button>
        </div>
      </div>

      {hasDestructive && (
        <p className="text-[11px] text-[var(--text-secondary)]">
          Tiers are informational. <strong>Destructive</strong>-tier tactics simulate
          DELETE / DROP-style payloads using sentinel identifiers only (e.g.
          <code className="px-1 py-0.5 rounded bg-[var(--bg-secondary)]">MORIARTY_TEST_*</code>)
          so they never reference real tables.
        </p>
      )}

      <div className="space-y-3">
        {grouped.map(({ group, tactics }) => {
          const groupIds = tactics.map((t) => t.id);
          const allSelected = groupIds.every((id) => selectedSet.has(id));
          const someSelected = groupIds.some((id) => selectedSet.has(id));
          return (
            <GroupSection
              key={group}
              groupLabel={GROUP_LABELS[group]}
              tactics={tactics}
              selectedSet={selectedSet}
              onToggleTactic={toggleTactic}
              onToggleGroup={() => toggleGroup(groupIds)}
              headerCheckboxState={allSelected ? 'all' : someSelected ? 'some' : 'none'}
            />
          );
        })}
      </div>

      {resolvedValue.length === 0 && (
        <p className="text-[12px] text-[var(--color-error-dark)]">
          At least one tactic must be selected.
        </p>
      )}
    </div>
  );
}

interface GroupSectionProps {
  groupLabel: string;
  tactics: PersonaTactic[];
  selectedSet: Set<string>;
  onToggleTactic: (id: string) => void;
  onToggleGroup: () => void;
  headerCheckboxState: 'all' | 'some' | 'none';
}

function GroupSection({
  groupLabel,
  tactics,
  selectedSet,
  onToggleTactic,
  onToggleGroup,
  headerCheckboxState,
}: GroupSectionProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggleGroup}
        className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)] hover:text-[var(--interactive-primary)] transition-colors"
      >
        <span
          className={cn(
            'inline-flex items-center justify-center w-4 h-4 rounded border',
            headerCheckboxState === 'all'
              ? 'bg-[var(--interactive-primary)] border-[var(--interactive-primary)] text-[var(--text-inverse)]'
              : headerCheckboxState === 'some'
                ? 'bg-[var(--surface-brand-subtle)] border-[var(--interactive-primary)]'
                : 'border-[var(--border-default)]',
          )}
        >
          {headerCheckboxState === 'all' && (
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {headerCheckboxState === 'some' && (
            <span className="block w-2 h-0.5 bg-[var(--interactive-primary)]" />
          )}
        </span>
        {groupLabel} · {tactics.length}
      </button>
      <div className="mt-1.5 space-y-1 pl-6">
        {tactics.map((tactic) => (
          <TacticRow
            key={tactic.id}
            tactic={tactic}
            selected={selectedSet.has(tactic.id)}
            onToggle={() => onToggleTactic(tactic.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface TacticRowProps {
  tactic: PersonaTactic;
  selected: boolean;
  onToggle: () => void;
}

function TacticRow({ tactic, selected, onToggle }: TacticRowProps) {
  return (
    <label className="flex items-start gap-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="mt-0.5 w-4 h-4 rounded border-[var(--border-default)] accent-[var(--interactive-primary)]"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-medium text-[var(--text-primary)]">
            {tactic.label}
          </span>
          <TierBadge tier={tactic.riskTier} />
        </div>
        <div className="text-[11px] text-[var(--text-secondary)] leading-snug mt-0.5">
          {tactic.description}
        </div>
      </div>
    </label>
  );
}
