/**
 * AdversarialPersonaPostureCard — generic breakdown card for adversarial
 * personas with tactics + expectation rules.
 *
 * Two panes:
 *   1. "By tactic"  — count of turns where each tactic was attempted.
 *   2. "By rule"    — compliance status of each persona.{id}.* rule from the
 *                     judge, with evidence tooltips.
 *
 * The card is parameterized by ``personaId`` and reads tactics from the
 * client-side persona catalog. Adding a new adversarial persona needs only
 * a config entry in personaCatalog.ts — no component changes.
 */

import { useMemo } from 'react';
import { cn } from '@/utils';
import type { AdversarialResult, PersonaTacticSummary } from '@/types';
import {
  GROUP_LABELS,
  TIER_LABELS,
  getPersonaById,
  groupTactics,
  type PersonaTacticTier,
} from './personaCatalog';

interface AdversarialPersonaPostureCardProps {
  personaId: string;
  result: AdversarialResult;
}

const TIER_CLASSES: Record<PersonaTacticTier, string> = {
  low: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
  medium: 'bg-[var(--surface-info)] text-[var(--color-info-dark)] border-[var(--border-info)]',
  high: 'bg-[var(--surface-warning)] text-[var(--color-warning-dark)] border-[var(--border-warning)]',
  destructive:
    'bg-[var(--surface-error)] text-[var(--color-error-dark)] border-[var(--border-error)]',
};

const RULE_STATUS_CLASSES: Record<string, string> = {
  FOLLOWED: 'text-[var(--color-success-dark)] border-[var(--border-success)] bg-[var(--surface-success)]',
  VIOLATED: 'text-[var(--color-error-dark)] border-[var(--border-error)] bg-[var(--surface-error)]',
  NOT_APPLICABLE: 'text-[var(--text-secondary)] border-[var(--border-subtle)] bg-[var(--bg-secondary)]',
  NOT_EVALUATED: 'text-[var(--text-muted)] border-[var(--border-subtle)] bg-[var(--bg-secondary)]',
};

export function AdversarialPersonaPostureCard({
  personaId,
  result,
}: AdversarialPersonaPostureCardProps) {
  const persona = getPersonaById(personaId);
  const summary: PersonaTacticSummary | undefined = result.persona_tactic_summary;

  const personaRuleCompliance = useMemo(
    () =>
      (result.rule_compliance ?? []).filter((rc) =>
        (rc.rule_id ?? '').startsWith(`persona.${personaId}.`),
      ),
    [result.rule_compliance, personaId],
  );

  if (!persona) return null;

  const tacticCounts = new Map<string, number>();
  for (const entry of summary?.turn_tactic_sequence ?? []) {
    tacticCounts.set(entry.persona_tactic, (tacticCounts.get(entry.persona_tactic) ?? 0) + 1);
  }

  const grouped = groupTactics(persona.tactics);

  const anyTacticSeen = tacticCounts.size > 0;
  const anyRuleEvaluated = personaRuleCompliance.length > 0;

  if (!anyTacticSeen && !anyRuleEvaluated) {
    return null;
  }

  return (
    <div className="rounded border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 space-y-4">
      <div>
        <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
          {persona.label} posture
        </h3>
        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
          Adversarial tactics attempted in this case and expectation rules the judge evaluated.
        </p>
      </div>

      {anyTacticSeen && (
        <section>
          <h4 className="text-[12px] font-medium text-[var(--text-primary)] uppercase tracking-wide mb-2">
            By tactic
          </h4>
          <div className="space-y-3">
            {grouped.map(({ group, tactics }) => {
              const groupTotal = tactics.reduce(
                (acc, t) => acc + (tacticCounts.get(t.id) ?? 0),
                0,
              );
              if (groupTotal === 0) return null;
              return (
                <div key={group}>
                  <div className="text-[11px] text-[var(--text-secondary)] mb-1">
                    {GROUP_LABELS[group]}
                  </div>
                  <ul className="space-y-1">
                    {tactics.map((tactic) => {
                      const count = tacticCounts.get(tactic.id) ?? 0;
                      if (count === 0) return null;
                      return (
                        <li
                          key={tactic.id}
                          className="flex items-center justify-between gap-2 text-[12px]"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[var(--text-primary)] truncate">
                              {tactic.label}
                            </span>
                            <span
                              className={cn(
                                'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border',
                                TIER_CLASSES[tactic.riskTier],
                              )}
                            >
                              {TIER_LABELS[tactic.riskTier]}
                            </span>
                          </div>
                          <span className="text-[var(--text-secondary)] shrink-0">
                            {count} turn{count === 1 ? '' : 's'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {anyRuleEvaluated && (
        <section>
          <h4 className="text-[12px] font-medium text-[var(--text-primary)] uppercase tracking-wide mb-2">
            By expectation rule
          </h4>
          <ul className="space-y-1">
            {personaRuleCompliance.map((rc) => {
              const ruleName = (rc.rule_id ?? '').slice(`persona.${personaId}.`.length);
              const status = rc.status ?? 'NOT_EVALUATED';
              const statusClass = RULE_STATUS_CLASSES[status] ?? RULE_STATUS_CLASSES.NOT_EVALUATED;
              return (
                <li
                  key={rc.rule_id}
                  className="flex items-start justify-between gap-3 text-[12px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[var(--text-primary)] font-medium">{ruleName}</div>
                    {rc.evidence && (
                      <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                        {rc.evidence}
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border shrink-0',
                      statusClass,
                    )}
                  >
                    {status === 'NOT_APPLICABLE' ? 'N/A' : status.toLowerCase()}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
