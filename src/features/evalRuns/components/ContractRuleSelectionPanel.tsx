import { useEffect, useMemo, useRef, useState } from 'react';

import { Combobox, type ComboboxOption } from '@/components/ui';
import {
  getContractRuleOptions,
  getEvaluationScopeSummary,
  type EvaluationScope,
} from '@/features/evals/utils/contractRules';
import { adversarialConfigApi } from '@/services/api/adversarialConfigApi';
import { notificationService } from '@/services/notifications';

interface ContractRuleSelectionPanelProps {
  scopes: EvaluationScope[];
  selectedRuleIds: string[] | null;
  onChange: (ruleIds: string[]) => void;
  title?: string;
  description?: string;
  placeholder?: string;
}

function areArraysEqual(left: string[] | null, right: string[]): boolean {
  if (left == null) {
    return right.length === 0;
  }
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function ContractRuleSelectionPanel({
  scopes,
  selectedRuleIds,
  onChange,
  title = 'Contract Rules',
  description,
  placeholder = 'Select contract rules',
}: ContractRuleSelectionPanelProps) {
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);
  const scopeKey = useMemo(() => scopes.join('|'), [scopes]);
  const scopeValues = useMemo(
    () => (scopeKey ? scopeKey.split('|') as EvaluationScope[] : []),
    [scopeKey],
  );

  useEffect(() => {
    let cancelled = false;

    adversarialConfigApi.get()
      .then((config) => {
        if (cancelled) {
          return;
        }
        setOptions(getContractRuleOptions(config, scopeValues));
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        notificationService.error(
          error instanceof Error ? error.message : 'Failed to load contract rules.',
        );
        setOptions([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [scopeValues]);

  const resolvedDescription = description
    ?? `Select which enabled contract rules from ${getEvaluationScopeSummary(scopeValues)} should apply to this run.`;

  const availableRuleIds = useMemo(
    () => options.map((option) => option.value),
    [options],
  );

  useEffect(() => {
    if (loading) {
      return;
    }

    const nextSelectedRuleIds = selectedRuleIds == null
      ? availableRuleIds
      : availableRuleIds.filter((ruleId) => selectedRuleIds.includes(ruleId));

    if (!initializedRef.current || !areArraysEqual(selectedRuleIds, nextSelectedRuleIds)) {
      initializedRef.current = true;
      onChange(nextSelectedRuleIds);
    }
  }, [availableRuleIds, loading, onChange, selectedRuleIds]);

  const resolvedSelectedRuleIds = selectedRuleIds ?? availableRuleIds;
  const resolvedPlaceholder = loading
    ? 'Loading contract rules...'
    : availableRuleIds.length > 0
      ? placeholder
      : 'No enabled contract rules';

  const helperText = availableRuleIds.length > 0
    ? resolvedDescription
    : `No enabled contract rules are currently bound to ${getEvaluationScopeSummary(scopeValues)}.`;

  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
        {title}
      </label>
      <Combobox
        multi
        value={resolvedSelectedRuleIds}
        onChange={onChange}
        options={options}
        placeholder={resolvedPlaceholder}
        disabled={loading || availableRuleIds.length === 0}
      />
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
        {helperText}
      </p>
    </div>
  );
}
