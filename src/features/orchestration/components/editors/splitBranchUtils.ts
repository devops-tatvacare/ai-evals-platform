import type {
  PredicateAst,
  SplitBranch,
  SplitMode,
} from '@/features/orchestration/types';

interface SplitConfig {
  mode?: SplitMode;
  field?: string;
  branches?: SplitBranch[];
  default_branch_id?: string;
  drop_unmatched?: boolean;
}

function normalizeBranchForMode(branch: SplitBranch, mode: SplitMode): SplitBranch {
  const base: SplitBranch = {
    id: branch.id,
    label: branch.label,
  };
  if (mode === 'by_field') {
    return {
      ...base,
      match:
        typeof branch.match === 'string'
          ? branch.match
          : branch.match === undefined
            ? ''
            : String(branch.match),
    };
  }
  if (mode === 'by_rules') {
    return {
      ...base,
      predicate: branch.predicate ?? ({ field: '', op: 'eq', value: '' } as PredicateAst),
    };
  }
  return {
    ...base,
    weight: typeof branch.weight === 'number' ? branch.weight : 1,
  };
}

export function normalizeSplitConfigForMode(
  value: SplitConfig,
  nextMode: SplitMode,
): SplitConfig {
  const normalizedBranches = (value.branches ?? []).map((branch) =>
    normalizeBranchForMode(branch, nextMode),
  );
  const nextConfig: SplitConfig = {
    ...value,
    mode: nextMode,
    branches: normalizedBranches,
    default_branch_id: normalizedBranches.some(
      (branch) => branch.id === value.default_branch_id,
    )
      ? value.default_branch_id
      : undefined,
  };
  if (nextMode === 'by_field') {
    nextConfig.field = value.field ?? '';
  } else {
    delete nextConfig.field;
  }
  return nextConfig;
}
