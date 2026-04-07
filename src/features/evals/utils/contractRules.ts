import type { ComboboxOption } from '@/components/ui';
import type { AdversarialConfig, AdversarialRule } from '@/services/api/adversarialConfigApi';
import type { RuleCatalogEntry } from '@/types';
import { humanize } from '@/utils/evalFormatters';

export type EvaluationScope = 'adversarial' | 'correctness' | 'efficiency';

const EVALUATION_SCOPE_ORDER: EvaluationScope[] = ['adversarial', 'correctness', 'efficiency'];

const EVALUATION_SCOPE_LABELS: Record<EvaluationScope, string> = {
  adversarial: 'Adversarial Runs',
  correctness: 'Batch Correctness',
  efficiency: 'Batch Efficiency',
};

export const EVALUATION_SCOPE_OPTIONS: ComboboxOption[] = EVALUATION_SCOPE_ORDER.map((scope) => ({
  value: scope,
  label: EVALUATION_SCOPE_LABELS[scope],
}));

export function getEvaluationScopeLabel(scope: string): string {
  return EVALUATION_SCOPE_LABELS[scope as EvaluationScope] ?? humanize(scope);
}

function getGoalLabelMap(config: AdversarialConfig): Map<string, string> {
  return new Map(
    config.goals.map((goal) => [goal.id, goal.label || humanize(goal.id)]),
  );
}

function toRuleCatalogEntry(
  rule: AdversarialRule,
  goalLabels: Map<string, string>,
): RuleCatalogEntry {
  const goalTags = rule.goalIds.map((goalId) => goalLabels.get(goalId) ?? humanize(goalId));
  const scopeTags = rule.evaluationScopes.map(getEvaluationScopeLabel);

  return {
    ruleId: rule.ruleId,
    ruleText: rule.ruleText,
    section: rule.section,
    tags: [...goalTags, ...scopeTags],
    goalIds: [...rule.goalIds],
    evaluationScopes: [...rule.evaluationScopes],
  };
}

export function getContractRuleCatalogEntries(
  config: AdversarialConfig,
  scopes: EvaluationScope[],
): RuleCatalogEntry[] {
  const scopeSet = new Set(scopes);
  const goalLabels = getGoalLabelMap(config);

  return config.rules
    .filter((rule) => rule.enabled)
    .filter((rule) => rule.evaluationScopes.some((scope) => scopeSet.has(scope as EvaluationScope)))
    .map((rule) => toRuleCatalogEntry(rule, goalLabels))
    .sort((left, right) => (
      left.section.localeCompare(right.section)
      || left.ruleId.localeCompare(right.ruleId)
    ));
}

export function getContractRuleOptions(
  config: AdversarialConfig,
  scopes: EvaluationScope[],
): ComboboxOption[] {
  return getContractRuleCatalogEntries(config, scopes).map((rule) => ({
    value: rule.ruleId,
    label: rule.ruleId,
  }));
}

export function getEvaluationScopeSummary(scopes: EvaluationScope[]): string {
  return scopes.map(getEvaluationScopeLabel).join(', ');
}
