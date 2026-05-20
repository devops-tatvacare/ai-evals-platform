import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Library,
  Loader2,
  Pin,
  PinOff,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';

import {
  Button,
  Input,
  Combobox,
  Select,
  type SelectOption,
  type ComboboxOption,
} from '@/components/ui';
import {
  adversarialConfigApi,
  type AdversarialGoal,
  type AdversarialTrait,
} from '@/services/api/adversarialConfigApi';
import {
  adversarialTestCasesApi,
  type AdversarialSavedCase,
} from '@/services/api/adversarialTestCasesApi';
import { SettingsSlideOver } from '@/features/settings/components/SettingsSlideOver';
import { notificationService } from '@/services/notifications';
import { humanize } from '@/utils/evalFormatters';
import { cn } from '@/utils';
import { ContractRuleSelectionPanel } from './ContractRuleSelectionPanel';
import { PersonaTacticsSelector } from './PersonaTacticsSelector';
import { PERSONA_CATALOG } from './personaCatalog';
import {
  WizardFieldRow,
  WizardMetric,
  WizardSection,
  WizardStepLayout,
} from './WizardStepLayout';

const WIZARD_TEXTAREA_CLASS =
  'w-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-y';

type FlowMode = 'single' | 'multi';
export type AdversarialCaseMode = 'generate' | 'saved' | 'hybrid';
export type ManualCaseDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type PersonaMixingMode = 'single' | 'mixed';

export interface AdversarialManualCaseInput {
  name?: string;
  description?: string;
  syntheticInput: string;
  difficulty: ManualCaseDifficulty;
  goalFlow: string[];
  activeTraits: string[];
  expectedChallenges: string[];
}

/** Map of persona id -> selected tactic ids. undefined/missing = all tactics. */
export type SelectedPersonaTactics = Record<string, string[] | undefined>;

interface TestConfigStepProps {
  caseMode: AdversarialCaseMode;
  testCount: number;
  selectedGoals: string[];
  selectedTraits: string[] | null;
  selectedRuleIds: string[] | null;
  selectedPersonas: string[];
  selectedPersonaTactics: SelectedPersonaTactics;
  personaMixingMode: PersonaMixingMode;
  flowMode: FlowMode;
  extraInstructions: string;
  selectedSavedCaseIds: string[];
  includePinnedCases: boolean;
  manualCases: AdversarialManualCaseInput[];
  onCaseModeChange: (mode: AdversarialCaseMode) => void;
  onTestCountChange: (count: number) => void;
  onGoalsChange: (goals: string[]) => void;
  onTraitsChange: (traits: string[]) => void;
  onSelectedRuleIdsChange: (ruleIds: string[]) => void;
  onPersonasChange: (personas: string[]) => void;
  onPersonaTacticsChange: (map: SelectedPersonaTactics) => void;
  onPersonaMixingModeChange: (mode: PersonaMixingMode) => void;
  onFlowModeChange: (mode: FlowMode) => void;
  onExtraInstructionsChange: (instructions: string) => void;
  onSavedCasesChange: (caseIds: string[]) => void;
  onIncludePinnedCasesChange: (enabled: boolean) => void;
  onManualCasesChange: (cases: AdversarialManualCaseInput[]) => void;
}

const DIFFICULTY_LEVELS: Array<{ value: ManualCaseDifficulty; label: string }> = [
  { value: 'EASY', label: 'Easy' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HARD', label: 'Hard' },
];

const GENERATED_PERSONA_OPTIONS: ComboboxOption[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
  { value: 'crack', label: 'Crack' },
  ...PERSONA_CATALOG.map((persona) => ({
    value: persona.id,
    label: persona.label,
  })),
];

const PERSONA_MIXING_OPTIONS: SelectOption[] = [
  { value: 'single', label: 'Single persona per test case' },
  { value: 'mixed', label: 'Mix and match personas on a case' },
];

const DEFAULT_GENERATED_PERSONAS = ['easy', 'medium', 'hard'];

const CASE_MODE_OPTIONS: Array<{
  value: AdversarialCaseMode;
  label: string;
  description: string;
}> = [
  {
    value: 'generate',
    label: 'Generate Fresh',
    description: 'Create new exploratory cases from the goal and trait catalog.',
  },
  {
    value: 'saved',
    label: 'Use Saved Cases',
    description: 'Run selected regression cases and pinned cases without generation.',
  },
  {
    value: 'hybrid',
    label: 'Hybrid',
    description: 'Mix generated exploration with saved and pinned cases.',
  },
];

const EMPTY_DRAFT: AdversarialManualCaseInput = {
  name: '',
  description: '',
  syntheticInput: '',
  difficulty: 'MEDIUM',
  goalFlow: [],
  activeTraits: [],
  expectedChallenges: [],
};

function splitChallenges(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function manualCaseKey(testCase: AdversarialManualCaseInput): string {
  return [
    testCase.syntheticInput.trim().toLowerCase(),
    testCase.difficulty,
    [...testCase.goalFlow].sort().join(','),
    [...testCase.activeTraits].sort().join(','),
  ].join('|');
}

export function TestConfigStep({
  caseMode,
  testCount,
  selectedGoals,
  selectedTraits,
  selectedRuleIds,
  selectedPersonas,
  selectedPersonaTactics,
  personaMixingMode,
  flowMode,
  extraInstructions,
  selectedSavedCaseIds,
  includePinnedCases,
  manualCases,
  onCaseModeChange,
  onTestCountChange,
  onGoalsChange,
  onTraitsChange,
  onSelectedRuleIdsChange,
  onPersonasChange,
  onPersonaTacticsChange,
  onPersonaMixingModeChange,
  onFlowModeChange,
  onExtraInstructionsChange,
  onSavedCasesChange,
  onIncludePinnedCasesChange,
  onManualCasesChange,
}: TestConfigStepProps) {
  const [goals, setGoals] = useState<AdversarialGoal[]>([]);
  const [traits, setTraits] = useState<AdversarialTrait[]>([]);
  const [savedCases, setSavedCases] = useState<AdversarialSavedCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [testCountLocal, setTestCountLocal] = useState<string | null>(null);
  const [testCountError, setTestCountError] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [onlyPinnedLibrary, setOnlyPinnedLibrary] = useState(false);
  const [libraryBusyId, setLibraryBusyId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draft, setDraft] = useState<AdversarialManualCaseInput>(EMPTY_DRAFT);
  const [draftChallengesText, setDraftChallengesText] = useState('');
  const [saveDraftPinned, setSaveDraftPinned] = useState(false);
  const [libraryOverlayOpen, setLibraryOverlayOpen] = useState(false);
  const [manualCaseOverlayOpen, setManualCaseOverlayOpen] = useState(false);
  const goalsInitializedRef = useRef(false);
  const traitsInitializedRef = useRef(false);
  const personasInitializedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      adversarialConfigApi.get(),
      adversarialTestCasesApi.list(),
    ])
      .then(([config, cases]) => {
        if (cancelled) return;
        const enabledGoals = config.goals.filter((goal) => goal.enabled);
        const enabledTraits = config.traits.filter((trait) => trait.enabled);
        setGoals(enabledGoals);
        setTraits(enabledTraits);
        setSavedCases(cases);
      })
      .catch((err) => {
        if (cancelled) return;
        notificationService.error(
          err instanceof Error ? err.message : 'Failed to load adversarial test configuration.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading || goalsInitializedRef.current) {
      return;
    }
    if (selectedGoals.length > 0) {
      goalsInitializedRef.current = true;
      return;
    }
    if (goals.length === 0) {
      return;
    }
    goalsInitializedRef.current = true;
    onGoalsChange(goals.map((goal) => goal.id));
  }, [goals, loading, onGoalsChange, selectedGoals]);

  useEffect(() => {
    if (loading || traitsInitializedRef.current) {
      return;
    }
    if (selectedTraits !== null) {
      traitsInitializedRef.current = true;
      return;
    }
    traitsInitializedRef.current = true;
    onTraitsChange(traits.map((trait) => trait.id));
  }, [loading, onTraitsChange, selectedTraits, traits]);

  useEffect(() => {
    if (loading || personasInitializedRef.current) {
      return;
    }
    if (selectedPersonas.length > 0) {
      personasInitializedRef.current = true;
      return;
    }
    personasInitializedRef.current = true;
    onPersonasChange(DEFAULT_GENERATED_PERSONAS);
  }, [loading, onPersonasChange, selectedPersonas]);

  const goalOptions = useMemo<ComboboxOption[]>(
    () => goals.map((goal) => ({ value: goal.id, label: goal.label || humanize(goal.id) })),
    [goals],
  );
  const traitOptions = useMemo<ComboboxOption[]>(
    () => traits.map((trait) => ({ value: trait.id, label: trait.label || humanize(trait.id) })),
    [traits],
  );

  const filteredLibraryCases = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    return savedCases.filter((testCase) => {
      if (onlyPinnedLibrary && !testCase.isPinned) return false;
      if (!q) return true;
      const haystack = [
        testCase.name,
        testCase.syntheticInput,
        testCase.goalFlow.join(' '),
        testCase.activeTraits.join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [librarySearch, onlyPinnedLibrary, savedCases]);

  const selectedSavedCases = useMemo(
    () => savedCases.filter((testCase) => selectedSavedCaseIds.includes(testCase.id)),
    [savedCases, selectedSavedCaseIds],
  );

  const selectedSavedCount = selectedSavedCaseIds.length;
  const pinnedAvailableCount = savedCases.filter((testCase) => testCase.isPinned).length;

  const canAddDraftToRun =
    draft.syntheticInput.trim().length > 0 && draft.goalFlow.length > 0;
  const manualDraftIsDirty =
    JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT)
    || draftChallengesText.trim().length > 0
    || saveDraftPinned;

  const generateEnabled = caseMode !== 'saved';
  const libraryEnabled = caseMode !== 'generate';

  const removeManualCase = (index: number) => {
    onManualCasesChange(manualCases.filter((_, currentIndex) => currentIndex !== index));
  };

  const addDraftToRun = () => {
    if (!canAddDraftToRun) return;
    const nextDraft: AdversarialManualCaseInput = {
      ...draft,
      name: draft.name?.trim() || '',
      description: draft.description?.trim() || '',
      syntheticInput: draft.syntheticInput.trim(),
      goalFlow: [...draft.goalFlow],
      activeTraits: [...draft.activeTraits],
      expectedChallenges: splitChallenges(draftChallengesText),
    };
    const nextKey = manualCaseKey(nextDraft);
    if (manualCases.some((testCase) => manualCaseKey(testCase) === nextKey)) {
      notificationService.info('That run-only case is already included.');
      return;
    }
    onManualCasesChange([...manualCases, nextDraft]);
    setDraft(EMPTY_DRAFT);
    setDraftChallengesText('');
    setSaveDraftPinned(false);
    setManualCaseOverlayOpen(false);
  };

  const saveDraftToLibrary = async () => {
    if (!canAddDraftToRun) return;
    setSavingDraft(true);
    try {
      const created = await adversarialTestCasesApi.create({
        name: draft.name?.trim() || undefined,
        description: draft.description?.trim() || undefined,
        syntheticInput: draft.syntheticInput.trim(),
        difficulty: draft.difficulty,
        goalFlow: draft.goalFlow,
        activeTraits: draft.activeTraits,
        expectedChallenges: splitChallenges(draftChallengesText),
        isPinned: saveDraftPinned,
        sourceKind: 'manual',
      });
      setSavedCases((current) => [created, ...current]);
      if (!selectedSavedCaseIds.includes(created.id)) {
        onSavedCasesChange([...selectedSavedCaseIds, created.id]);
      }
      notificationService.success('Saved adversarial test case.');
      setDraft(EMPTY_DRAFT);
      setDraftChallengesText('');
      setSaveDraftPinned(false);
      setManualCaseOverlayOpen(false);
    } catch (err) {
      notificationService.error(
        err instanceof Error ? err.message : 'Failed to save adversarial test case.',
      );
    } finally {
      setSavingDraft(false);
    }
  };

  const toggleSavedCaseSelection = (caseId: string) => {
    if (selectedSavedCaseIds.includes(caseId)) {
      onSavedCasesChange(selectedSavedCaseIds.filter((currentId) => currentId !== caseId));
      return;
    }
    onSavedCasesChange([...selectedSavedCaseIds, caseId]);
  };

  const toggleCasePinned = async (testCase: AdversarialSavedCase) => {
    setLibraryBusyId(testCase.id);
    try {
      const updated = await adversarialTestCasesApi.update(testCase.id, {
        isPinned: !testCase.isPinned,
      });
      setSavedCases((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      notificationService.error(
        err instanceof Error ? err.message : 'Failed to update saved case.',
      );
    } finally {
      setLibraryBusyId(null);
    }
  };

  const deleteSavedCase = async (testCase: AdversarialSavedCase) => {
    setLibraryBusyId(testCase.id);
    try {
      await adversarialTestCasesApi.delete(testCase.id);
      setSavedCases((current) => current.filter((item) => item.id !== testCase.id));
      if (selectedSavedCaseIds.includes(testCase.id)) {
        onSavedCasesChange(selectedSavedCaseIds.filter((currentId) => currentId !== testCase.id));
      }
    } catch (err) {
      notificationService.error(
        err instanceof Error ? err.message : 'Failed to delete saved case.',
      );
    } finally {
      setLibraryBusyId(null);
    }
  };

  return (
    <WizardStepLayout
      eyebrow="Test Design"
      title="Shape the adversarial coverage"
      description="Keep the structure you already like, but tighten the hierarchy so decisions feel lighter, cleaner, and easier to scan."
    >
      <WizardSection
        title="Case Source"
        description="Choose whether this run explores fresh cases, replays saved regressions, or mixes both."
      >
        <div className="grid gap-3 md:grid-cols-3">
          {CASE_MODE_OPTIONS.map((option) => {
            const active = caseMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onCaseModeChange(option.value)}
                className={cn(
                  'rounded-[10px] border px-3.5 py-3 text-left transition-all',
                  active
                    ? 'border-[var(--border-brand)] bg-[var(--color-brand-accent)]/10'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-primary)]/70 hover:border-[var(--border-default)] hover:bg-[var(--bg-primary)]',
                )}
              >
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {option.label}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
                  {option.description}
                </p>
              </button>
            );
          })}
        </div>
      </WizardSection>

      {generateEnabled && (
        <WizardSection
          title="Generated Cases"
          description="Use the goal and persona catalog to steer new cases without over-boxing the entire step."
        >
          <WizardFieldRow
            title="Number of Generated Cases"
            description="Generated cases stay capped at 50 for now. Saved and pinned cases can extend coverage beyond that."
            control={(
              <Input
                type="number"
                min={5}
                max={50}
                value={testCountLocal ?? String(testCount)}
                error={testCountError}
                onFocus={() => setTestCountLocal(String(testCount))}
                onChange={(e) => {
                  const raw = e.target.value;
                  setTestCountLocal(raw);
                  const parsed = parseInt(raw, 10);
                  if (raw === '' || Number.isNaN(parsed)) {
                    setTestCountError('');
                  } else if (parsed < 5) {
                    setTestCountError('Minimum is 5');
                  } else if (parsed > 50) {
                    setTestCountError('Maximum is 50');
                  } else {
                    setTestCountError('');
                    onTestCountChange(parsed);
                  }
                }}
                onBlur={() => {
                  const parsed = parseInt(testCountLocal ?? '', 10);
                  if (Number.isNaN(parsed) || parsed < 5) {
                    setTestCountLocal(null);
                    setTestCountError('');
                    return;
                  }
                  onTestCountChange(Math.min(parsed, 50));
                  setTestCountLocal(null);
                  setTestCountError('');
                }}
              />
            )}
          />

          <WizardFieldRow
            title="Goals"
            description="Generated cases will target these goals. At least one goal must stay selected."
            control={loading ? (
              <LoadingRow label="Loading goals..." />
            ) : (
              <Combobox
                multi
                value={selectedGoals}
                onChange={onGoalsChange}
                options={goalOptions}
                placeholder="Select goals"
              />
            )}
          />

          <WizardFieldRow
            title="Traits"
            description="Generated cases can use only these persona traits. Clear all traits to generate baseline scenarios."
            control={loading ? (
              <LoadingRow label="Loading traits..." />
            ) : (
              <Combobox
                multi
                value={selectedTraits ?? []}
                onChange={onTraitsChange}
                options={traitOptions}
                placeholder="Select traits"
              />
            )}
          />

          <WizardFieldRow
            title="Flow Mode"
            description={
              flowMode === 'single'
                ? 'Each generated case focuses on one goal.'
                : 'Generated conversations can chain multiple goals in one session.'
            }
            control={(
              <div className="flex flex-wrap gap-2">
                {(['single', 'multi'] as const).map((mode) => (
                  <ChoiceButton
                    key={mode}
                    active={flowMode === mode}
                    onClick={() => onFlowModeChange(mode)}
                    label={mode === 'single' ? 'Single Goal' : 'Multi-Goal'}
                  />
                ))}
              </div>
            )}
            controlClassName="md:max-w-[360px]"
          />

          <WizardFieldRow
            title="Persona Distribution"
            description="Choose which persona bands generation can use. `Crack` adds abusive, profane, erratic pressure without expecting Kaira to mirror it. `Moriarty` runs security-focused adversarial attacks — select tactics below."
            control={(
              <Combobox
                multi
                value={selectedPersonas}
                onChange={onPersonasChange}
                options={GENERATED_PERSONA_OPTIONS}
                placeholder="Select persona bands"
              />
            )}
          />

          {PERSONA_CATALOG
            .filter((persona) => selectedPersonas.includes(persona.id))
            .map((persona) => (
              <div key={persona.id} className="pl-0 md:pl-[200px]">
                <PersonaTacticsSelector
                  persona={persona}
                  value={selectedPersonaTactics[persona.id]}
                  onChange={(tacticIds) => {
                    const next = { ...selectedPersonaTactics };
                    if (tacticIds.length === persona.tactics.length) {
                      // All selected — represent as undefined so submission sends "all tactics".
                      delete next[persona.id];
                    } else {
                      next[persona.id] = tacticIds;
                    }
                    onPersonaTacticsChange(next);
                  }}
                />
              </div>
            ))}

          <WizardFieldRow
            title="Persona Mixing Rule"
            description="Choose whether each generated case gets one persona label or a blended set where `difficulty` reflects the hardest selected persona."
            control={(
              <Select
                value={personaMixingMode}
                onChange={(value) => onPersonaMixingModeChange(value as PersonaMixingMode)}
                options={PERSONA_MIXING_OPTIONS}
              />
            )}
            controlClassName="md:max-w-[360px]"
          />

          <div className="pt-1">
            <label className="block text-[13px] font-medium text-[var(--text-primary)]">
              Additional Instructions <span className="font-normal text-[var(--text-muted)]">(optional)</span>
            </label>
            <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
              These instructions are appended to the generation prompt for this run only.
            </p>
            <textarea
              value={extraInstructions}
              onChange={(e) => onExtraInstructionsChange(e.target.value)}
              placeholder="e.g. Focus on Hindi food items, exercise correction flows, or stubborn users."
              rows={4}
              className={cn(
                WIZARD_TEXTAREA_CLASS,
                'mt-2.5 rounded-[var(--radius-default)] py-2.5',
              )}
            />
          </div>
        </WizardSection>
      )}

      <WizardSection
        title="Rule Evaluation"
        description="Choose which adversarial contract rules are judged for this run. Applicable rules left unselected stay visible downstream as Not Evaluated."
      >
        <ContractRuleSelectionPanel
          scopes={['adversarial']}
          selectedRuleIds={selectedRuleIds}
          onChange={onSelectedRuleIdsChange}
          title="Contract Rules"
          description="These rules affect judge-time evaluation and reporting only. Generation and conversation behavior stay unchanged."
          placeholder="Select adversarial rules"
        />
      </WizardSection>

      {libraryEnabled && (
        <WizardSection
          title="Saved Coverage"
          description="Select known regression cases, include pinned coverage automatically, or curate the library as you build the run."
          aside={(
            <Button
              variant="secondary"
              icon={Library}
              onClick={() => setLibraryOverlayOpen(true)}
            >
              Manage Saved Cases
            </Button>
          )}
        >
          <div className="grid gap-2 md:grid-cols-3">
            <WizardMetric label="Selected Cases" value={selectedSavedCount} />
            <WizardMetric label="Pinned Auto-Include" value={includePinnedCases ? 'On' : 'Off'} />
            <WizardMetric label="Library Total" value={savedCases.length} />
          </div>

          {(selectedSavedCases.length > 0 || includePinnedCases) && (
            <div className="mt-4 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-primary)]/70 p-3">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--text-brand)]" />
                <p className="text-[12px] font-semibold text-[var(--text-primary)]">
                  This Run Includes
                </p>
              </div>
              <div className="space-y-2">
                {selectedSavedCases.map((testCase) => (
                  <div
                    key={testCase.id}
                    className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/55 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                        {testCase.name || truncateText(testCase.syntheticInput, 72)}
                      </p>
                      <p className="truncate text-[11px] text-[var(--text-muted)]">
                        {(testCase.goalFlow || []).map(humanize).join(' → ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleSavedCaseSelection(testCase.id)}
                      className="text-[11px] text-[var(--text-brand)] hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {includePinnedCases && pinnedAvailableCount > 0 && (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    All pinned cases will also be added automatically.
                  </p>
                )}
              </div>
            </div>
          )}
        </WizardSection>
      )}

      {libraryEnabled && (
        <WizardSection
          title="Manual Case Builder"
          description="Write a regression case once, then either include it only for this run or save it to the library for reuse."
          aside={(
            <Button
              variant="secondary"
              icon={Plus}
              onClick={() => setManualCaseOverlayOpen(true)}
            >
              Create Manual Case
            </Button>
          )}
        >
          <div className="grid gap-2 md:grid-cols-2">
            <WizardMetric label="Run-Only Cases" value={manualCases.length} />
            <WizardMetric label="Draft Status" value={manualDraftIsDirty ? 'In Progress' : 'Empty'} />
          </div>

          {manualCases.length > 0 && (
            <div className="mt-4 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-primary)]/70 p-3 space-y-2">
              <p className="text-[12px] font-semibold text-[var(--text-primary)]">
                Run-Only Manual Cases
              </p>
              {manualCases.map((testCase, index) => (
                <div
                  key={`${manualCaseKey(testCase)}-${index}`}
                  className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/55 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                      {testCase.name || truncateText(testCase.syntheticInput, 72)}
                    </p>
                    <p className="truncate text-[11px] text-[var(--text-muted)]">
                      {(testCase.goalFlow || []).map(humanize).join(' → ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeManualCase(index)}
                    className="text-[11px] text-[var(--text-brand)] hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </WizardSection>
      )}

      <SettingsSlideOver
        isOpen={libraryOverlayOpen}
        onClose={() => setLibraryOverlayOpen(false)}
        title="Saved Case Library"
        description="Search, filter, pin, and select reusable regression cases for this run."
        widthClassName="w-[860px] max-w-full"
        footerContent={(
          <div className="text-[12px] text-[var(--text-muted)]">
            Changes save automatically. Close when done.
          </div>
        )}
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <WizardMetric label="Selected Cases" value={selectedSavedCount} />
            <WizardMetric label="Pinned Auto-Include" value={includePinnedCases ? 'On' : 'Off'} />
            <WizardMetric label="Visible Results" value={filteredLibraryCases.length} />
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                Search Saved Cases
              </label>
              <Input
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Search by title, opening message, goal, or trait..."
              />
            </div>
            <label className="inline-flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={onlyPinnedLibrary}
                onChange={(e) => setOnlyPinnedLibrary(e.target.checked)}
              />
              Show only pinned
            </label>
            <label className="inline-flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={includePinnedCases}
                onChange={(e) => onIncludePinnedCasesChange(e.target.checked)}
              />
              Include all pinned cases in this run
            </label>
          </div>

          <div className="rounded-[6px] border border-[var(--border-subtle)] overflow-hidden">
            <div className="max-h-[480px] overflow-y-auto divide-y divide-[var(--border-subtle)] bg-[var(--bg-secondary)]">
              {loading ? (
                <div className="p-3">
                  <LoadingRow label="Loading saved cases..." />
                </div>
              ) : filteredLibraryCases.length === 0 ? (
                <div className="p-4 text-[12px] text-[var(--text-muted)]">
                  No saved cases match the current filters.
                </div>
              ) : (
                filteredLibraryCases.map((testCase) => {
                  const selected = selectedSavedCaseIds.includes(testCase.id);
                  return (
                    <div
                      key={testCase.id}
                      className={`flex items-start gap-3 px-3 py-3 ${selected ? 'bg-[var(--bg-primary)]' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSavedCaseSelection(testCase.id)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[12px] font-semibold text-[var(--text-primary)] truncate">
                            {testCase.name || truncateText(testCase.syntheticInput, 72)}
                          </p>
                          {testCase.isPinned && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-brand)]">
                              <Pin className="h-3 w-3" />
                              Pinned
                            </span>
                          )}
                          <span className="inline-flex rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
                            {testCase.difficulty}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                          {truncateText(testCase.syntheticInput, 140)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {testCase.goalFlow.map((goalId) => (
                            <span
                              key={`${testCase.id}-goal-${goalId}`}
                              className="rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]"
                            >
                              {humanize(goalId)}
                            </span>
                          ))}
                          {testCase.activeTraits.map((traitId) => (
                            <span
                              key={`${testCase.id}-trait-${traitId}`}
                              className="rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]"
                            >
                              {humanize(traitId)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleCasePinned(testCase)}
                          disabled={libraryBusyId === testCase.id}
                          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
                          title={testCase.isPinned ? 'Unpin case' : 'Pin case'}
                        >
                          {testCase.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSavedCase(testCase)}
                          disabled={libraryBusyId === testCase.id}
                          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--color-error)]"
                          title="Delete saved case"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </SettingsSlideOver>

      <SettingsSlideOver
        isOpen={manualCaseOverlayOpen}
        onClose={() => setManualCaseOverlayOpen(false)}
        title="Create Manual Case"
        description="Add a run-only regression case or save it into the reusable library."
        widthClassName="w-[860px] max-w-full"
        isDirty={manualDraftIsDirty}
        footerContent={(
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={saveDraftPinned}
                onChange={(e) => setSaveDraftPinned(e.target.checked)}
              />
              Pin when saving to library
            </label>
            <Button
              variant="secondary"
              icon={Save}
              onClick={() => {
                void saveDraftToLibrary();
              }}
              disabled={!canAddDraftToRun || savingDraft}
              isLoading={savingDraft}
            >
              Save To Library
            </Button>
          </div>
        )}
        onSubmit={addDraftToRun}
        submitLabel="Add To Run"
        canSubmit={canAddDraftToRun && !savingDraft}
      >
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                Case Name <span className="text-[var(--text-muted)] font-normal">(optional)</span>
              </label>
              <Input
                value={draft.name || ''}
                onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
                placeholder="e.g. Future meal should be rejected"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                Difficulty
              </label>
              <div className="flex gap-2">
                {DIFFICULTY_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, difficulty: level.value }))}
                    className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                      draft.difficulty === level.value
                        ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)] ring-1 ring-[var(--color-brand-accent)]/40'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
              Opening Message
            </label>
            <textarea
              value={draft.syntheticInput}
              onChange={(e) => setDraft((current) => ({ ...current, syntheticInput: e.target.value }))}
              placeholder="The first message the simulated user sends to Kaira."
              rows={3}
              className={cn(WIZARD_TEXTAREA_CLASS, 'rounded-[6px]')}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                Goal Flow
              </label>
              {loading ? (
                <LoadingRow label="Loading goals..." />
              ) : (
                <Combobox
                  multi
                  value={draft.goalFlow}
                  onChange={(values) => setDraft((current) => ({ ...current, goalFlow: values }))}
                  options={goalOptions}
                  placeholder="Select goals"
                />
              )}
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                Active Traits
              </label>
              {loading ? (
                <LoadingRow label="Loading traits..." />
              ) : (
                <Combobox
                  multi
                  value={draft.activeTraits}
                  onChange={(values) => setDraft((current) => ({ ...current, activeTraits: values }))}
                  options={traitOptions}
                  placeholder="Select traits"
                />
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                Description <span className="text-[var(--text-muted)] font-normal">(optional)</span>
              </label>
              <textarea
                value={draft.description || ''}
                onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))}
                placeholder="Explain what regression or edge case this protects."
                rows={3}
                className={cn(WIZARD_TEXTAREA_CLASS, 'rounded-[6px]')}
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                Expected Challenges <span className="text-[var(--text-muted)] font-normal">(one per line)</span>
              </label>
              <textarea
                value={draftChallengesText}
                onChange={(e) => setDraftChallengesText(e.target.value)}
                placeholder={'Bot should reject future time\nBot should ask a follow-up instead of guessing'}
                rows={3}
                className={cn(WIZARD_TEXTAREA_CLASS, 'rounded-[6px]')}
              />
            </div>
          </div>
        </div>
      </SettingsSlideOver>
    </WizardStepLayout>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-primary)]/70 px-3 py-2">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" />
      <span className="text-[12px] text-[var(--text-muted)]">{label}</span>
    </div>
  );
}

function ChoiceButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-[10px] border px-3 py-2 text-[12px] font-medium transition-colors',
        active
          ? 'border-[var(--border-brand)] bg-[var(--color-brand-accent)]/12 text-[var(--text-primary)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-muted)] hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]',
      )}
    >
      {label}
    </button>
  );
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
