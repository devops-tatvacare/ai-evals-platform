import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Download,
  FileJson,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';

import { PermissionGate } from '@/components/auth/PermissionGate';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Combobox,
  type ComboboxOption,
  Tabs,
} from '@/components/ui';
import {
  EVALUATION_SCOPE_OPTIONS,
  getEvaluationScopeLabel,
} from '@/features/evals/utils/contractRules';
import { notificationService } from '@/services/notifications';
import { OwnershipBanner } from '@/features/settings/components/OwnershipBanner';
import { useAuthStore } from '@/stores/authStore';
import {
  adversarialConfigApi,
  type AdversarialConfig,
  type AdversarialGoal,
  type AdversarialRule,
  type AdversarialTrait,
} from '@/services/api/adversarialConfigApi';
import { humanize } from '@/utils/evalFormatters';
import { SettingsSlideOver } from '@/features/settings/components/SettingsSlideOver';
import { CollapsibleSection } from '@/features/settings/components/CollapsibleSection';

type EditorState =
  | { kind: 'goal'; mode: 'create' | 'edit'; index: number | null; draft: AdversarialGoal; initialDraft: AdversarialGoal }
  | { kind: 'trait'; mode: 'create' | 'edit'; index: number | null; draft: AdversarialTrait; initialDraft: AdversarialTrait }
  | { kind: 'rule'; mode: 'create' | 'edit'; index: number | null; draft: AdversarialRule; initialDraft: AdversarialRule };

type DeleteTarget =
  | { kind: 'goal'; index: number; label: string }
  | { kind: 'trait'; index: number; label: string }
  | { kind: 'rule'; index: number; label: string };

const TEXTAREA_CLASSNAME =
  'w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50';

function splitLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
}

function joinLines(values: string[]): string {
  return values.join('\n');
}

function isSnakeCaseId(value: string): boolean {
  return /^[a-zA-Z0-9_]+$/.test(value);
}

function buildEmptyGoal(): AdversarialGoal {
  return {
    id: '',
    label: '',
    description: '',
    completionCriteria: [],
    notCompletion: [],
    agentBehavior: '',
    signalPatterns: [],
    enabled: true,
  };
}

function buildEmptyTrait(): AdversarialTrait {
  return {
    id: '',
    label: '',
    description: '',
    behaviorHint: '',
    enabled: true,
  };
}

function buildEmptyRule(goalIds: string[]): AdversarialRule {
  return {
    ruleId: '',
    section: '',
    ruleText: '',
    goalIds,
    evaluationScopes: ['adversarial'],
    enabled: true,
  };
}

function buildCopiedId(value: string): string {
  return value ? `${value}_copy` : '';
}

// ─── Reusable presentational components ─────────────────────────

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card hoverable={false} className="space-y-1">
      <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
        {label}
      </p>
      <p className="text-[22px] font-semibold text-[var(--text-primary)]">
        {value}
      </p>
      <p className="text-[12px] text-[var(--text-secondary)]">
        {detail}
      </p>
    </Card>
  );
}

function SectionCard({
  title,
  subtitle,
  countLabel,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  subtitle: string;
  countLabel: string;
  addLabel: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <Card hoverable={false} className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
              {title}
            </h3>
            <Badge variant="neutral" size="sm">
              {countLabel}
            </Badge>
          </div>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
            {subtitle}
          </p>
        </div>
        <PermissionGate action="configuration:edit">
          <Button variant="secondary" size="sm" icon={Plus} onClick={onAdd}>
            {addLabel}
          </Button>
        </PermissionGate>
      </div>

      <div className="space-y-2">
        {children}
      </div>
    </Card>
  );
}

function EmptyContractsState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[6px] border border-dashed border-[var(--border-default)] px-4 py-6">
      <EmptyState icon={FileJson} title={title} description={description} compact className="border-none py-0" />
    </div>
  );
}

// ─── Sub-tab content components ─────────────────────────────────

function GoalsSubTab({
  config,
  onAdd,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  config: AdversarialConfig;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDuplicate: (goal: AdversarialGoal) => void;
  onDelete: (index: number, label: string) => void;
}) {
  const activeCount = config.goals.filter((g) => g.enabled).length;
  return (
    <SectionCard
      title="Goals"
      subtitle="Define the user outcome the simulated conversation is trying to achieve."
      countLabel={`${activeCount}/${config.goals.length} enabled`}
      addLabel="Add Goal"
      onAdd={onAdd}
    >
      {config.goals.length === 0 ? (
        <EmptyContractsState
          title="No goals configured"
          description="Add a goal contract to define how an evaluation should know the conversation succeeded."
        />
      ) : (
        config.goals.map((goal, index) => (
          <div
            key={goal.id}
            className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 px-4 py-3"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {goal.label || humanize(goal.id)}
                  </p>
                  <Badge variant="neutral">{goal.id}</Badge>
                  <Badge variant={goal.enabled ? 'success' : 'warning'}>
                    {goal.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  {goal.description}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="neutral">{goal.completionCriteria.length} completion checks</Badge>
                  <Badge variant="neutral">{goal.notCompletion.length} stop conditions</Badge>
                  <Badge variant="neutral">{goal.signalPatterns.length} signal patterns</Badge>
                </div>
              </div>
              <PermissionGate action="configuration:edit">
                <div className="flex items-center gap-1 shrink-0">
                  <IconButton icon={Pencil} label="Edit goal" onClick={() => onEdit(index)} />
                  <IconButton icon={Copy} label="Duplicate goal" onClick={() => onDuplicate(goal)} />
                  <IconButton
                    icon={Trash2}
                    label="Delete goal"
                    variant="danger"
                    onClick={() => onDelete(index, goal.label || goal.id)}
                  />
                </div>
              </PermissionGate>
            </div>
          </div>
        ))
      )}
    </SectionCard>
  );
}

function TraitsSubTab({
  config,
  onAdd,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  config: AdversarialConfig;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDuplicate: (trait: AdversarialTrait) => void;
  onDelete: (index: number, label: string) => void;
}) {
  const activeCount = config.traits.filter((t) => t.enabled).length;
  return (
    <SectionCard
      title="Traits"
      subtitle="Describe how the simulated user behaves while pursuing a goal."
      countLabel={`${activeCount}/${config.traits.length} enabled`}
      addLabel="Add Trait"
      onAdd={onAdd}
    >
      {config.traits.length === 0 ? (
        <EmptyContractsState
          title="No traits configured"
          description="Add traits to shape user behavior, ambiguity, stubbornness, or corrections."
        />
      ) : (
        config.traits.map((trait, index) => (
          <div
            key={trait.id}
            className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 px-4 py-3"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {trait.label || humanize(trait.id)}
                  </p>
                  <Badge variant="neutral">{trait.id}</Badge>
                  <Badge variant={trait.enabled ? 'success' : 'warning'}>
                    {trait.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  {trait.description}
                </p>
                {trait.behaviorHint && (
                  <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
                    Behavior hint: {trait.behaviorHint}
                  </p>
                )}
              </div>
              <PermissionGate action="configuration:edit">
                <div className="flex items-center gap-1 shrink-0">
                  <IconButton icon={Pencil} label="Edit trait" onClick={() => onEdit(index)} />
                  <IconButton icon={Copy} label="Duplicate trait" onClick={() => onDuplicate(trait)} />
                  <IconButton
                    icon={Trash2}
                    label="Delete trait"
                    variant="danger"
                    onClick={() => onDelete(index, trait.label || trait.id)}
                  />
                </div>
              </PermissionGate>
            </div>
          </div>
        ))
      )}
    </SectionCard>
  );
}

/** Groups rules by their `section` field and renders each group as a collapsible block. */
function RulesSubTab({
  config,
  onAdd,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  config: AdversarialConfig;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDuplicate: (rule: AdversarialRule) => void;
  onDelete: (index: number, label: string) => void;
}) {
  const activeCount = config.rules.filter((rule) => rule.enabled).length;
  const groupedRules = useMemo(() => {
    const groups: { section: string; rules: { rule: AdversarialRule; globalIndex: number }[] }[] = [];
    const sectionMap = new Map<string, number>();

    config.rules.forEach((rule, globalIndex) => {
      const section = rule.section || 'Uncategorized';
      let groupIdx = sectionMap.get(section);
      if (groupIdx === undefined) {
        groupIdx = groups.length;
        sectionMap.set(section, groupIdx);
        groups.push({ section, rules: [] });
      }
      groups[groupIdx].rules.push({ rule, globalIndex });
    });

    return groups;
  }, [config.rules]);

  return (
    <div className="space-y-4">
      <Card hoverable={false} className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">Rules</h3>
              <Badge variant="neutral" size="sm">{activeCount}/{config.rules.length} enabled</Badge>
              <Badge variant="neutral" size="sm">{groupedRules.length} sections</Badge>
            </div>
            <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
              Track the prompt or product rules that the evaluator must explicitly verify.
            </p>
          </div>
          <PermissionGate action="configuration:edit">
            <Button variant="secondary" size="sm" icon={Plus} onClick={onAdd}>
              Add Rule
            </Button>
          </PermissionGate>
        </div>
      </Card>

      {config.rules.length === 0 ? (
        <EmptyContractsState
          title="No rules configured"
          description="Add rules to define what behavior the evaluation judge must confirm or flag."
        />
      ) : (
        groupedRules.map(({ section, rules }) => (
          <CollapsibleSection
            key={section}
            title={section}
            subtitle={`${rules.length} rule${rules.length === 1 ? '' : 's'}`}
            defaultOpen={false}
          >
            <div className="space-y-2">
              {rules.map(({ rule, globalIndex }) => (
                <div
                  key={rule.ruleId}
                  className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                          {rule.ruleId}
                        </p>
                        <Badge variant={rule.enabled ? 'success' : 'warning'}>
                          {rule.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                        {rule.ruleText}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {rule.goalIds.map((goalId) => (
                          <Badge key={goalId} variant="primary">
                            {goalId}
                          </Badge>
                        ))}
                        {rule.evaluationScopes.map((scope) => (
                          <Badge key={`${rule.ruleId}-${scope}`} variant="neutral">
                            {getEvaluationScopeLabel(scope)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <PermissionGate action="configuration:edit">
                      <div className="flex items-center gap-1 shrink-0">
                        <IconButton icon={Pencil} label="Edit rule" onClick={() => onEdit(globalIndex)} />
                        <IconButton icon={Copy} label="Duplicate rule" onClick={() => onDuplicate(rule)} />
                        <IconButton
                          icon={Trash2}
                          label="Delete rule"
                          variant="danger"
                          onClick={() => onDelete(globalIndex, rule.ruleId)}
                        />
                      </div>
                    </PermissionGate>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        ))
      )}
    </div>
  );
}

function AdvancedToolsSubTab({
  config,
  rawJson,
  saving,
  importInputRef,
  onImportFile,
  onExport,
  onReset,
}: {
  config: AdversarialConfig;
  rawJson: string;
  saving: boolean;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onImportFile: (file: File) => void;
  onExport: () => void;
  onReset: () => void;
}) {
  return (
    <Card hoverable={false} className="space-y-4">
      <div>
        <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
          Advanced Tools
        </h3>
        <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
          Import, export, inspect, or reset the full contract payload.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PermissionGate action="configuration:edit">
          <Button variant="secondary" icon={Upload} onClick={() => importInputRef.current?.click()} disabled={saving}>
            Import
          </Button>
        </PermissionGate>
        <Button variant="secondary" icon={Download} onClick={onExport}>
          Export
        </Button>
        <PermissionGate action="configuration:edit">
          <Button variant="warning" icon={RotateCcw} onClick={onReset} disabled={saving}>
            Reset To Defaults
          </Button>
        </PermissionGate>
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onImportFile(file);
            }
          }}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12px] font-medium text-[var(--text-primary)]">
            Current payload
          </p>
          <Badge variant="neutral" size="sm">v{config.version}</Badge>
        </div>
        <textarea
          value={rawJson}
          readOnly
          rows={16}
          className={`${TEXTAREA_CLASSNAME} bg-[var(--bg-secondary)] text-[var(--text-secondary)]`}
          spellCheck={false}
        />
      </div>
    </Card>
  );
}

// ─── Main component ─────────────────────────────────────────────

export function EvaluationContractsTab() {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [config, setConfig] = useState<AdversarialConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const user = useAuthStore((s) => s.user);
  const hasSettingsEdit = user?.isOwner || user?.permissions.includes('configuration:edit') || false;

  const editorIsDirty = useMemo(() => {
    if (!editorState) return false;
    return JSON.stringify(editorState.draft) !== JSON.stringify(editorState.initialDraft);
  }, [editorState]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const nextConfig = await adversarialConfigApi.get();
      setConfig(nextConfig);
    } catch (error: unknown) {
      notificationService.error(
        error instanceof Error ? error.message : 'Failed to load evaluation contracts.',
        'Load failed',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const goalOptions = useMemo<ComboboxOption[]>(
    () =>
      (config?.goals ?? []).map((goal) => ({
        value: goal.id,
        label: goal.label || humanize(goal.id),
      })),
    [config?.goals],
  );

  const persistConfig = useCallback(
    async (nextConfig: AdversarialConfig, successMessage: string) => {
      setSaving(true);
      try {
        const savedConfig = await adversarialConfigApi.save(nextConfig);
        setConfig(savedConfig);
        setEditorState(null);
        setEditorError('');
        notificationService.success(successMessage);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to save evaluation contracts.';
        setEditorError(message);
        notificationService.error(message, 'Save failed');
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  // ─── Editor open helpers ────────────────────────────────────

  const openGoalEditor = useCallback((mode: 'create' | 'edit', index?: number) => {
    if (!config) return;
    const draft =
      mode === 'edit' && index != null
        ? { ...config.goals[index] }
        : buildEmptyGoal();
    setEditorError('');
    setEditorState({
      kind: 'goal',
      mode,
      index: mode === 'edit' ? index ?? null : null,
      draft,
      initialDraft: draft,
    });
  }, [config]);

  const openTraitEditor = useCallback((mode: 'create' | 'edit', index?: number) => {
    if (!config) return;
    const draft =
      mode === 'edit' && index != null
        ? { ...config.traits[index] }
        : buildEmptyTrait();
    setEditorError('');
    setEditorState({
      kind: 'trait',
      mode,
      index: mode === 'edit' ? index ?? null : null,
      draft,
      initialDraft: draft,
    });
  }, [config]);

  const openRuleEditor = useCallback((mode: 'create' | 'edit', index?: number) => {
    if (!config) return;
    const defaultGoalIds = config.goals[0]?.id ? [config.goals[0].id] : [];
    const draft =
      mode === 'edit' && index != null
        ? {
          ...config.rules[index],
          goalIds: [...config.rules[index].goalIds],
          evaluationScopes: [...config.rules[index].evaluationScopes],
        }
        : buildEmptyRule(defaultGoalIds);
    setEditorError('');
    setEditorState({
      kind: 'rule',
      mode,
      index: mode === 'edit' ? index ?? null : null,
      draft,
      initialDraft: draft,
    });
  }, [config]);

  // ─── Duplicate helpers ──────────────────────────────────────

  const handleDuplicateGoal = useCallback((goal: AdversarialGoal) => {
    setEditorError('');
    setEditorState({
      kind: 'goal',
      mode: 'create',
      index: null,
      draft: {
        ...goal,
        id: buildCopiedId(goal.id),
        label: goal.label ? `${goal.label} Copy` : '',
      },
      initialDraft: {
        ...goal,
        id: buildCopiedId(goal.id),
        label: goal.label ? `${goal.label} Copy` : '',
      },
    });
  }, []);

  const handleDuplicateTrait = useCallback((trait: AdversarialTrait) => {
    setEditorError('');
    setEditorState({
      kind: 'trait',
      mode: 'create',
      index: null,
      draft: {
        ...trait,
        id: buildCopiedId(trait.id),
        label: trait.label ? `${trait.label} Copy` : '',
      },
      initialDraft: {
        ...trait,
        id: buildCopiedId(trait.id),
        label: trait.label ? `${trait.label} Copy` : '',
      },
    });
  }, []);

  const handleDuplicateRule = useCallback((rule: AdversarialRule) => {
    setEditorError('');
    setEditorState({
      kind: 'rule',
      mode: 'create',
      index: null,
      draft: {
        ...rule,
        ruleId: buildCopiedId(rule.ruleId),
      },
      initialDraft: {
        ...rule,
        ruleId: buildCopiedId(rule.ruleId),
      },
    });
  }, []);

  // ─── Draft updaters ─────────────────────────────────────────

  const updateGoalDraft = useCallback((updates: Partial<AdversarialGoal>) => {
    setEditorState((current) => {
      if (!current || current.kind !== 'goal') return current;
      return { ...current, draft: { ...current.draft, ...updates } };
    });
    setEditorError('');
  }, []);

  const updateTraitDraft = useCallback((updates: Partial<AdversarialTrait>) => {
    setEditorState((current) => {
      if (!current || current.kind !== 'trait') return current;
      return { ...current, draft: { ...current.draft, ...updates } };
    });
    setEditorError('');
  }, []);

  const updateRuleDraft = useCallback((updates: Partial<AdversarialRule>) => {
    setEditorState((current) => {
      if (!current || current.kind !== 'rule') return current;
      return { ...current, draft: { ...current.draft, ...updates } };
    });
    setEditorError('');
  }, []);

  // ─── Save / delete / reset / import / export ───────────────

  const handleSaveEditor = useCallback(async () => {
    if (!config || !editorState) return;

    if (editorState.kind === 'goal') {
      const normalizedGoal: AdversarialGoal = {
        ...editorState.draft,
        id: editorState.draft.id.trim(),
        label: editorState.draft.label.trim(),
        description: editorState.draft.description.trim(),
        completionCriteria: splitLines(joinLines(editorState.draft.completionCriteria)),
        notCompletion: splitLines(joinLines(editorState.draft.notCompletion)),
        agentBehavior: editorState.draft.agentBehavior.trim(),
        signalPatterns: splitLines(joinLines(editorState.draft.signalPatterns)),
      };

      if (!normalizedGoal.id || !isSnakeCaseId(normalizedGoal.id)) {
        setEditorError('Goal ID must be snake_case using letters, numbers, and underscores only.');
        return;
      }
      if (!normalizedGoal.label || !normalizedGoal.description) {
        setEditorError('Goal label and description are required.');
        return;
      }
      const duplicateIndex = config.goals.findIndex((goal) => goal.id === normalizedGoal.id);
      if (duplicateIndex !== -1 && duplicateIndex !== editorState.index) {
        setEditorError(`Goal ID "${normalizedGoal.id}" already exists.`);
        return;
      }

      const nextGoals = [...config.goals];
      if (editorState.mode === 'edit' && editorState.index != null) {
        nextGoals[editorState.index] = normalizedGoal;
      } else {
        nextGoals.push(normalizedGoal);
      }
      await persistConfig(
        { ...config, goals: nextGoals },
        editorState.mode === 'edit' ? 'Goal updated.' : 'Goal added.',
      );
      return;
    }

    if (editorState.kind === 'trait') {
      const normalizedTrait: AdversarialTrait = {
        ...editorState.draft,
        id: editorState.draft.id.trim(),
        label: editorState.draft.label.trim(),
        description: editorState.draft.description.trim(),
        behaviorHint: editorState.draft.behaviorHint?.trim() || '',
      };

      if (!normalizedTrait.id || !isSnakeCaseId(normalizedTrait.id)) {
        setEditorError('Trait ID must be snake_case using letters, numbers, and underscores only.');
        return;
      }
      if (!normalizedTrait.label || !normalizedTrait.description) {
        setEditorError('Trait label and description are required.');
        return;
      }
      const duplicateIndex = config.traits.findIndex((trait) => trait.id === normalizedTrait.id);
      if (duplicateIndex !== -1 && duplicateIndex !== editorState.index) {
        setEditorError(`Trait ID "${normalizedTrait.id}" already exists.`);
        return;
      }

      const nextTraits = [...config.traits];
      if (editorState.mode === 'edit' && editorState.index != null) {
        nextTraits[editorState.index] = normalizedTrait;
      } else {
        nextTraits.push(normalizedTrait);
      }
      await persistConfig(
        { ...config, traits: nextTraits },
        editorState.mode === 'edit' ? 'Trait updated.' : 'Trait added.',
      );
      return;
    }

    const normalizedRule: AdversarialRule = {
      ...editorState.draft,
      ruleId: editorState.draft.ruleId.trim(),
      section: editorState.draft.section.trim(),
      ruleText: editorState.draft.ruleText.trim(),
      goalIds: editorState.draft.goalIds,
      evaluationScopes: Array.from(new Set(editorState.draft.evaluationScopes)),
      enabled: editorState.draft.enabled,
    };

    if (!normalizedRule.ruleId || !isSnakeCaseId(normalizedRule.ruleId)) {
      setEditorError('Rule ID must be snake_case using letters, numbers, and underscores only.');
      return;
    }
    if (!normalizedRule.section || !normalizedRule.ruleText) {
      setEditorError('Rule section and rule text are required.');
      return;
    }
    if (normalizedRule.goalIds.length === 0) {
      setEditorError('Bind each rule to at least one goal.');
      return;
    }
    if (normalizedRule.evaluationScopes.length === 0) {
      setEditorError('Assign each rule to at least one evaluation surface.');
      return;
    }
    const duplicateIndex = config.rules.findIndex((rule) => rule.ruleId === normalizedRule.ruleId);
    if (duplicateIndex !== -1 && duplicateIndex !== editorState.index) {
      setEditorError(`Rule ID "${normalizedRule.ruleId}" already exists.`);
      return;
    }

    const nextRules = [...config.rules];
    if (editorState.mode === 'edit' && editorState.index != null) {
      nextRules[editorState.index] = normalizedRule;
    } else {
      nextRules.push(normalizedRule);
    }
    await persistConfig(
      { ...config, rules: nextRules },
      editorState.mode === 'edit' ? 'Rule updated.' : 'Rule added.',
    );
  }, [config, editorState, persistConfig]);

  const handleDeleteConfirmed = useCallback(async () => {
    if (!config || !deleteTarget) return;

    const nextConfig: AdversarialConfig = {
      ...config,
      goals: [...config.goals],
      traits: [...config.traits],
      rules: [...config.rules],
    };

    if (deleteTarget.kind === 'goal') {
      const goalId = nextConfig.goals[deleteTarget.index]?.id;
      nextConfig.goals.splice(deleteTarget.index, 1);
      nextConfig.rules = nextConfig.rules.map((rule) => ({
        ...rule,
        goalIds: rule.goalIds.filter((boundGoalId) => boundGoalId !== goalId),
      }));
    } else if (deleteTarget.kind === 'trait') {
      nextConfig.traits.splice(deleteTarget.index, 1);
    } else {
      nextConfig.rules.splice(deleteTarget.index, 1);
    }

    setDeleteTarget(null);
    await persistConfig(nextConfig, `${humanize(deleteTarget.kind)} removed.`);
  }, [config, deleteTarget, persistConfig]);

  const handleReset = useCallback(async () => {
    setSaving(true);
    try {
      const resetConfig = await adversarialConfigApi.reset();
      setConfig(resetConfig);
      setShowResetConfirm(false);
      setEditorState(null);
      setEditorError('');
      notificationService.success('Contracts reset to the built-in defaults.');
    } catch (error: unknown) {
      notificationService.error(
        error instanceof Error ? error.message : 'Failed to reset evaluation contracts.',
        'Reset failed',
      );
    } finally {
      setSaving(false);
    }
  }, []);

  const handleExport = useCallback(() => {
    if (!config) return;
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'kaira-evaluation-contracts.json';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }, [config]);

  const handleImportFile = useCallback(async (file: File) => {
    setSaving(true);
    try {
      const parsed = JSON.parse(await file.text()) as AdversarialConfig;
      const saved = await adversarialConfigApi.importConfig(parsed);
      setConfig(saved);
      setEditorState(null);
      setEditorError('');
      notificationService.success('Contracts imported.');
    } catch (error: unknown) {
      notificationService.error(
        error instanceof Error ? error.message : 'Failed to import evaluation contracts.',
        'Import failed',
      );
    } finally {
      setSaving(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }, []);

  // ─── Derived values ─────────────────────────────────────────

  const activeGoalCount = config?.goals.filter((goal) => goal.enabled).length ?? 0;
  const activeTraitCount = config?.traits.filter((trait) => trait.enabled).length ?? 0;
  const rawJson = useMemo(
    () => (config ? JSON.stringify(config, null, 2) : ''),
    [config],
  );

  // ─── Sub-tab registry (data-driven) ─────────────────────────

  const subTabs = useMemo(() => {
    if (!config) return [];
    return [
      {
        id: 'goals',
        label: `Goals (${config.goals.length})`,
        content: (
          <GoalsSubTab
            config={config}
            onAdd={() => openGoalEditor('create')}
            onEdit={(index) => openGoalEditor('edit', index)}
            onDuplicate={handleDuplicateGoal}
            onDelete={(index, label) => setDeleteTarget({ kind: 'goal', index, label })}
          />
        ),
      },
      {
        id: 'traits',
        label: `Traits (${config.traits.length})`,
        content: (
          <TraitsSubTab
            config={config}
            onAdd={() => openTraitEditor('create')}
            onEdit={(index) => openTraitEditor('edit', index)}
            onDuplicate={handleDuplicateTrait}
            onDelete={(index, label) => setDeleteTarget({ kind: 'trait', index, label })}
          />
        ),
      },
      {
        id: 'rules',
        label: `Rules (${config.rules.length})`,
        content: (
          <RulesSubTab
            config={config}
            onAdd={() => openRuleEditor('create')}
            onEdit={(index) => openRuleEditor('edit', index)}
            onDuplicate={handleDuplicateRule}
            onDelete={(index, label) => setDeleteTarget({ kind: 'rule', index, label })}
          />
        ),
      },
      {
        id: 'advanced',
        label: 'Advanced Tools',
        content: (
          <AdvancedToolsSubTab
            config={config}
            rawJson={rawJson}
            saving={saving}
            importInputRef={importInputRef}
            onImportFile={(file) => { void handleImportFile(file); }}
            onExport={handleExport}
            onReset={() => setShowResetConfirm(true)}
          />
        ),
      },
    ];
  }, [
    config, rawJson, saving,
    openGoalEditor, openTraitEditor, openRuleEditor,
    handleDuplicateGoal, handleDuplicateTrait, handleDuplicateRule,
    handleExport, handleImportFile,
  ]);

  // ─── Loading / error states ─────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="rounded-[6px] border border-[var(--border-subtle)] px-4 py-6 text-[13px] text-[var(--text-secondary)]">
        Evaluation contracts are unavailable right now.
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-4">
        {/* Shared contract ownership banner */}
        <OwnershipBanner
          title="Adversarial Evaluation Contract"
          visibility="shared"
          ownerLabel="Shared with all workspace members who can access this app"
          mode={hasSettingsEdit ? 'editable' : 'read-only'}
          helperText={hasSettingsEdit
            ? 'You can edit this shared contract. Changes apply to all workspace members who can access this app.'
            : 'This is a shared contract. You can view it but only editors can make changes.'}
        />

        {/* Persistent summary header */}
        <Card hoverable={false} className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                Evaluation Contracts
              </h3>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                Manage the contract definitions that drive Kaira evaluation behavior. Goals and traits
                currently power adversarial case generation, while rules are structured for reuse across
                evaluation flows as batch consumers move off hardcoded logic.
              </p>
            </div>
            <Badge variant="primary" size="md" icon={FileJson}>
              v{config.version}
            </Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard
              label="Goals"
              value={`${config.goals.length}`}
              detail={`${activeGoalCount} enabled for case generation`}
            />
            <SummaryCard
              label="Traits"
              value={`${config.traits.length}`}
              detail={`${activeTraitCount} enabled personas`}
            />
            <SummaryCard
              label="Rules"
              value={`${config.rules.length}`}
              detail="Bound to goals and consumed by the judge"
            />
          </div>
        </Card>

        {/* Data-driven sub-tabs */}
        <Tabs tabs={subTabs} defaultTab="goals" />
      </div>

      {/* Slide-over editor (shared across all sub-tabs) */}
      <SettingsSlideOver
        widthClassName="w-[860px] max-w-full"
        isOpen={editorState != null}
        onClose={() => {
          setEditorState(null);
          setEditorError('');
        }}
        title={
          editorState
            ? `${editorState.mode === 'edit' ? 'Edit' : 'Add'} ${humanize(editorState.kind)}`
            : ''
        }
        description={
          editorState?.kind === 'goal'
            ? 'Define how an evaluation recognizes success, non-success, and conversational progress for this goal.'
            : editorState?.kind === 'trait'
              ? 'Describe the simulated user behavior that should influence conversation generation.'
              : editorState?.kind === 'rule'
                ? 'Capture the rule text and bind it to the goals that should exercise it.'
                : undefined
        }
        onSubmit={() => {
          void handleSaveEditor();
        }}
        submitLabel={editorState?.mode === 'edit' ? 'Save Changes' : 'Add Contract'}
        canSubmit={!saving}
        isSubmitting={saving}
        isDirty={editorIsDirty}
        footerContent={
          editorError ? (
            <div className="text-[12px] text-[var(--color-error)]">
              {editorError}
            </div>
          ) : editorState?.kind === 'rule' ? (
            <div className="text-[12px] text-[var(--text-muted)]">
              Rules can be rebound across goals without changing evaluator code.
            </div>
          ) : (
            <div className="text-[12px] text-[var(--text-muted)]">
              Changes save directly into the settings-backed contract registry for this user.
            </div>
          )
        }
      >
        {editorState?.kind === 'goal' && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                  Goal ID
                </label>
                <Input
                  value={editorState.draft.id}
                  onChange={(event) => updateGoalDraft({ id: event.target.value })}
                  placeholder="meal_logged"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                  Label
                </label>
                <Input
                  value={editorState.draft.label}
                  onChange={(event) => updateGoalDraft({ label: event.target.value })}
                  placeholder="Meal Logging"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={editorState.draft.enabled}
                onChange={(event) => updateGoalDraft({ enabled: event.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-default)] text-[var(--interactive-primary)] focus:ring-[var(--color-brand-accent)]"
              />
              Enabled for case generation
            </label>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                Description
              </label>
              <textarea
                value={editorState.draft.description}
                onChange={(event) => updateGoalDraft({ description: event.target.value })}
                rows={3}
                className={TEXTAREA_CLASSNAME}
                placeholder="Describe the end-to-end outcome this goal tests."
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                Completion Criteria
              </label>
              <textarea
                value={joinLines(editorState.draft.completionCriteria)}
                onChange={(event) => updateGoalDraft({ completionCriteria: splitLines(event.target.value) })}
                rows={4}
                className={TEXTAREA_CLASSNAME}
                placeholder="One line per signal that indicates the goal was achieved."
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                Not Completion Signals
              </label>
              <textarea
                value={joinLines(editorState.draft.notCompletion)}
                onChange={(event) => updateGoalDraft({ notCompletion: splitLines(event.target.value) })}
                rows={4}
                className={TEXTAREA_CLASSNAME}
                placeholder="One line per condition that should NOT count as success."
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                Agent Behavior
              </label>
              <textarea
                value={editorState.draft.agentBehavior}
                onChange={(event) => updateGoalDraft({ agentBehavior: event.target.value })}
                rows={5}
                className={TEXTAREA_CLASSNAME}
                placeholder="Tell the conversation agent how to behave while pursuing this goal."
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                Signal Patterns
              </label>
              <textarea
                value={joinLines(editorState.draft.signalPatterns)}
                onChange={(event) => updateGoalDraft({ signalPatterns: splitLines(event.target.value) })}
                rows={4}
                className={TEXTAREA_CLASSNAME}
                placeholder="One line per lightweight phrase or pattern used for annotation."
              />
            </div>
          </div>
        )}

        {editorState?.kind === 'trait' && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                  Trait ID
                </label>
                <Input
                  value={editorState.draft.id}
                  onChange={(event) => updateTraitDraft({ id: event.target.value })}
                  placeholder="ambiguous_quantity"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                  Label
                </label>
                <Input
                  value={editorState.draft.label}
                  onChange={(event) => updateTraitDraft({ label: event.target.value })}
                  placeholder="Ambiguous Quantity"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={editorState.draft.enabled}
                onChange={(event) => updateTraitDraft({ enabled: event.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-default)] text-[var(--interactive-primary)] focus:ring-[var(--color-brand-accent)]"
              />
              Enabled for case generation
            </label>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                Description
              </label>
              <textarea
                value={editorState.draft.description}
                onChange={(event) => updateTraitDraft({ description: event.target.value })}
                rows={3}
                className={TEXTAREA_CLASSNAME}
                placeholder="Describe the behavior this trait introduces into a conversation."
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                Behavior Hint
              </label>
              <textarea
                value={editorState.draft.behaviorHint || ''}
                onChange={(event) => updateTraitDraft({ behaviorHint: event.target.value })}
                rows={4}
                className={TEXTAREA_CLASSNAME}
                placeholder="Optional instruction block that tells the conversation agent how this trait should manifest."
              />
            </div>
          </div>
        )}

        {editorState?.kind === 'rule' && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                  Rule ID
                </label>
                <Input
                  value={editorState.draft.ruleId}
                  onChange={(event) => updateRuleDraft({ ruleId: event.target.value })}
                  placeholder="ask_time_if_missing"
                />
                <label className="mt-3 flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={editorState.draft.enabled}
                    onChange={(event) => updateRuleDraft({ enabled: event.target.checked })}
                    className="h-4 w-4 rounded border-[var(--border-default)] text-[var(--interactive-primary)] focus:ring-[var(--color-brand-accent)]"
                  />
                  Enabled for rule evaluation
                </label>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                  Section
                </label>
                <Input
                  value={editorState.draft.section}
                  onChange={(event) => updateRuleDraft({ section: event.target.value })}
                  placeholder="Time Validation Instructions"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                Rule Text
              </label>
              <textarea
                value={editorState.draft.ruleText}
                onChange={(event) => updateRuleDraft({ ruleText: event.target.value })}
                rows={6}
                className={TEXTAREA_CLASSNAME}
                placeholder="Describe the rule exactly as the evaluation judge should check it."
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                Bound Goals
              </label>
              <Combobox
                multi
                value={editorState.draft.goalIds}
                onChange={(goalIds) => updateRuleDraft({ goalIds })}
                options={goalOptions}
                placeholder="Select goals this rule applies to"
              />
            </div>

            <CollapsibleSection
              title="Evaluation Surfaces"
              subtitle="Choose which run types should consume this rule."
              defaultOpen
            >
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
                  Shared Usage
                </label>
                <Combobox
                  multi
                  value={editorState.draft.evaluationScopes}
                  onChange={(evaluationScopes) => updateRuleDraft({ evaluationScopes })}
                  options={EVALUATION_SCOPE_OPTIONS}
                  placeholder="Select evaluation surfaces"
                />
                <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                  Adversarial uses goal bindings plus these surfaces. Batch built-ins now read
                  correctness and efficiency rules from this same contract source.
                </p>
              </div>
            </CollapsibleSection>
          </div>
        )}
      </SettingsSlideOver>

      <ConfirmDialog
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={() => {
          void handleReset();
        }}
        title="Reset Contracts"
        description="Reset goals, traits, and rules to the built-in defaults? This will overwrite your saved contract setup."
        confirmLabel="Reset"
        variant="warning"
        isLoading={saving}
      />

      <ConfirmDialog
        isOpen={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          void handleDeleteConfirmed();
        }}
        title={`Delete ${deleteTarget ? humanize(deleteTarget.kind) : 'contract'}`}
        description={
          deleteTarget
            ? `Delete "${deleteTarget.label}" from the contract registry?`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        isLoading={saving}
      />
    </>
  );
}

export const AdversarialCatalogTab = EvaluationContractsTab;
