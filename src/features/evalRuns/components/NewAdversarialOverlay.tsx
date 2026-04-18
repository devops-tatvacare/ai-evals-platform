import { useState, useCallback, useMemo } from 'react';
import { WizardOverlay, type WizardStep } from './WizardOverlay';
import { RunInfoStep } from './RunInfoStep';
import { KairaApiConfigStep } from './KairaApiConfigStep';
import {
  TestConfigStep,
  type AdversarialCaseMode,
  type AdversarialManualCaseInput,
  type PersonaMixingMode,
  type SelectedPersonaTactics,
} from './TestConfigStep';
import { LLMConfigStep, type LLMConfig } from './LLMConfigStep';
import { ReviewStep, type ReviewSection, type ReviewSummary } from './ReviewStep';
import { useLLMSettingsStore, useAppSettingsStore, useGlobalSettingsStore, hasProviderCredentials, LLM_PROVIDERS } from '@/stores';
import type { LLMProvider } from '@/types';
import { useSubmitAndRedirect } from '@/hooks/useSubmitAndRedirect';
import { routes } from '@/config/routes';
import { kairaCredentialPoolConfig } from '@/features/credentialPool/kairaCredentialPoolConfig';
import type { CredentialPoolEntry } from '@/features/credentialPool/types';
import {
  buildCredentialPoolReviewSummary,
  createCredentialPoolEntry,
  getResolvedCredentialRows,
} from '@/features/credentialPool/utils';

const STEPS: WizardStep[] = [
  { key: 'info', label: 'Run Info' },
  { key: 'api', label: 'Kaira API' },
  { key: 'test', label: 'Test Config' },
  { key: 'llm', label: 'Execution Config' },
  { key: 'review', label: 'Review' },
];

interface NewAdversarialOverlayProps {
  onClose: () => void;
}

export function NewAdversarialOverlay({ onClose }: NewAdversarialOverlayProps) {
  const { submit: submitJob, isSubmitting } = useSubmitAndRedirect({
    appId: 'kaira-bot',
    label: 'Adversarial Test',
    successMessage: 'Adversarial stress test submitted. It will appear in the runs list shortly.',
    fallbackRoute: routes.kaira.runs,
    onClose,
  });

  // Wizard step state
  const [currentStep, setCurrentStep] = useState(0);

  // Pre-fill from app settings
  const kairaSettings = useAppSettingsStore((s) => s.settings['kaira-bot']);

  // Form state
  const [runName, setRunName] = useState('');
  const [runDescription, setRunDescription] = useState('');
  const [kairaApiUrl, setKairaApiUrl] = useState(kairaSettings.kairaApiUrl);
  const [credentialEntries, setCredentialEntries] = useState<CredentialPoolEntry[]>(() => {
    const seededUserId = kairaSettings.kairaChatUserId.trim();
    const seededToken = kairaSettings.kairaAuthToken.trim();
    if (seededUserId || seededToken) {
      return [createCredentialPoolEntry({ userId: seededUserId, authToken: seededToken }, 'seed')];
    }
    return [createCredentialPoolEntry({ userId: '', authToken: '' }, 'manual')];
  });
  const [kairaTimeout, setKairaTimeout] = useState(120);
  const [testCount, setTestCount] = useState(15);
  const [turnDelay, setTurnDelay] = useState(1.5);
  const [caseDelay, setCaseDelay] = useState(3.0);
  const [maxTurns, setMaxTurns] = useState(10);
  const [caseMode, setCaseMode] = useState<AdversarialCaseMode>('generate');
  const [selectedSavedCaseIds, setSelectedSavedCaseIds] = useState<string[]>([]);
  const [includePinnedCases, setIncludePinnedCases] = useState(false);
  const [manualCases, setManualCases] = useState<AdversarialManualCaseInput[]>([]);
  const [parallelCases, setParallelCases] = useState(false);
  const [caseWorkers, setCaseWorkers] = useState(3);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [selectedTraits, setSelectedTraits] = useState<string[] | null>(null);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[] | null>(null);
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([]);
  const [selectedPersonaTactics, setSelectedPersonaTactics] =
    useState<SelectedPersonaTactics>({});
  const [personaMixingMode, setPersonaMixingMode] = useState<PersonaMixingMode>('single');
  const [flowMode, setFlowMode] = useState<'single' | 'multi'>('single');
  const [extraInstructions, setExtraInstructions] = useState('');
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: LLM_PROVIDERS[0].value,
    model: '',
    temperature: 0.1,
    thinking: 'low',
  });

  const resolvedCredentialRows = useMemo(
    () => getResolvedCredentialRows(credentialEntries, kairaCredentialPoolConfig.fields),
    [credentialEntries],
  );
  const credentialSummary = useMemo(
    () => buildCredentialPoolReviewSummary(credentialEntries, kairaCredentialPoolConfig),
    [credentialEntries],
  );

  const isDirty = Boolean(
    runName
      || runDescription
      || kairaApiUrl
      || credentialEntries.some((entry) => Object.values(entry.values).some(Boolean)),
  );

  // Validation per step
  const canGoNext = useMemo(() => {
    const generationConfigured =
      testCount >= 5
      && testCount <= 50
      && selectedGoals.length > 0
      && selectedTraits !== null
      && selectedPersonas.length > 0;
    const savedConfigured =
      selectedSavedCaseIds.length > 0 || includePinnedCases || manualCases.length > 0;
    const hasCredentialPool = resolvedCredentialRows.length > 0;
    switch (currentStep) {
      case 0: return runName.trim().length > 0;
      case 1: return kairaApiUrl.trim().length > 0 && hasCredentialPool;
      case 2:
        if (caseMode === 'generate') return generationConfigured;
        if (caseMode === 'saved') return savedConfigured;
        return generationConfigured || savedConfigured;
      case 3: return Boolean(llmConfig.model) && !modelsLoading && hasProviderCredentials(llmConfig.provider as LLMProvider, useLLMSettingsStore.getState());
      case 4: return true;
      default: return false;
    }
  }, [
    currentStep,
    runName,
    kairaApiUrl,
    resolvedCredentialRows.length,
    testCount,
    llmConfig,
    modelsLoading,
    caseMode,
    selectedGoals.length,
    selectedTraits,
    selectedPersonas.length,
    selectedSavedCaseIds.length,
    includePinnedCases,
    manualCases.length,
  ]);

  const handleBack = useCallback(() => {
    setCurrentStep((s) => Math.max(0, s - 1));
  }, []);

  const handleNext = useCallback(() => {
    setCurrentStep((s) => Math.min(STEPS.length - 1, s + 1));
  }, []);

  // Build review summary (banner zone)
  const reviewSummary = useMemo((): ReviewSummary => {
    const requestedCaseCount =
      (caseMode !== 'saved' ? testCount : 0) +
      selectedSavedCaseIds.length +
      manualCases.length;
    return {
      name: runName,
      description: runDescription || undefined,
      badges: [
        { label: 'Model', value: llmConfig.model },
        {
          label: 'Cases',
          value: `${requestedCaseCount}${includePinnedCases ? '+' : ''}`,
        },
        { label: 'Parallel', value: parallelCases ? `${caseWorkers} workers` : 'Off' },
        { label: 'Timeout', value: `${kairaTimeout}s` },
        { label: 'Users', value: String(credentialSummary.readyCount) },
      ],
    };
  }, [
    runName,
    runDescription,
    llmConfig.model,
    testCount,
    parallelCases,
    caseWorkers,
    kairaTimeout,
    credentialSummary.readyCount,
    caseMode,
    selectedSavedCaseIds.length,
    manualCases.length,
    includePinnedCases,
  ]);

  // Build review sections (details zone)
  const reviewSections = useMemo((): ReviewSection[] => {
    return [
      {
        label: 'Kaira API',
        items: [
          { key: 'API URL', value: kairaApiUrl },
          { key: 'Credential Rows', value: String(credentialSummary.readyCount) },
          {
            key: 'User IDs',
            value: credentialSummary.primaryValues.length > 5
              ? `${credentialSummary.primaryValues.slice(0, 5).join(', ')} +${credentialSummary.primaryValues.length - 5} more`
              : credentialSummary.primaryValues.join(', ') || '(none)',
          },
          { key: 'Request Timeout', value: `${kairaTimeout}s` },
        ],
      },
      {
        label: 'Test Configuration',
        items: [
          { key: 'Case Mode', value: caseMode === 'generate' ? 'Generate Fresh' : caseMode === 'saved' ? 'Saved Cases' : 'Hybrid' },
          ...(caseMode !== 'saved' ? [{ key: 'Generated Cases', value: String(testCount) }] : []),
          ...(caseMode !== 'saved' ? [{ key: 'Goals', value: `${selectedGoals.length} selected` }] : []),
          ...(caseMode !== 'saved' && selectedTraits != null ? [{ key: 'Traits', value: `${selectedTraits.length} selected` }] : []),
          ...(selectedRuleIds != null ? [{ key: 'Rules', value: `${selectedRuleIds.length} selected` }] : []),
          ...(caseMode !== 'saved' ? [{ key: 'Persona Distribution', value: selectedPersonas.map((label) => label.charAt(0).toUpperCase() + label.slice(1)).join(', ') || '(none)' }] : []),
          ...(caseMode !== 'saved'
            ? Object.entries(selectedPersonaTactics)
                .filter(([personaId, tactics]) => selectedPersonas.includes(personaId) && tactics !== undefined)
                .map(([personaId, tactics]) => ({
                  key: `${personaId.charAt(0).toUpperCase() + personaId.slice(1)} Tactics`,
                  value: `${tactics?.length ?? 0} selected`,
                }))
            : []),
          ...(caseMode !== 'saved' ? [{ key: 'Persona Mixing', value: personaMixingMode === 'single' ? 'Single persona per test case' : 'Mix and match personas on a case' }] : []),
          ...(caseMode !== 'saved' ? [{ key: 'Flow Mode', value: flowMode === 'single' ? 'Single Goal' : 'Multi-Goal' }] : []),
          ...(caseMode !== 'generate' ? [{ key: 'Saved Cases', value: `${selectedSavedCaseIds.length} selected` }] : []),
          ...(caseMode !== 'generate' && includePinnedCases ? [{ key: 'Pinned Cases', value: 'Included automatically' }] : []),
          ...(manualCases.length > 0 ? [{ key: 'Run-Only Cases', value: String(manualCases.length) }] : []),
          ...(extraInstructions.trim() ? [{ key: 'Extra Instructions', value: extraInstructions.trim().slice(0, 80) + (extraInstructions.trim().length > 80 ? '...' : '') }] : []),
        ],
      },
      {
        label: 'Execution',
        items: [
          { key: 'Model', value: llmConfig.model },
          { key: 'Temperature', value: llmConfig.temperature.toFixed(1) },
          { key: 'Max Turns', value: String(maxTurns) },
          ...(llmConfig.provider === 'gemini' ? [{ key: 'Thinking', value: llmConfig.thinking.charAt(0).toUpperCase() + llmConfig.thinking.slice(1) }] : []),
          { key: 'Turn Delay', value: `${turnDelay.toFixed(1)}s` },
          { key: 'Case Delay', value: `${caseDelay.toFixed(1)}s` },
          { key: 'Case Parallelism', value: parallelCases ? `Yes (${caseWorkers} workers)` : 'Sequential' },
        ],
      },
    ];
  }, [
    kairaApiUrl,
    kairaTimeout,
    credentialSummary.primaryValues,
    credentialSummary.readyCount,
    testCount,
    turnDelay,
    caseDelay,
    maxTurns,
    llmConfig,
    parallelCases,
    caseWorkers,
    selectedGoals,
    selectedTraits,
    selectedRuleIds,
    selectedPersonas,
    selectedPersonaTactics,
    personaMixingMode,
    flowMode,
    extraInstructions,
    caseMode,
    selectedSavedCaseIds.length,
    includePinnedCases,
    manualCases.length,
  ]);

  const handleSubmit = useCallback(async () => {
    const { timeouts } = useGlobalSettingsStore.getState();
    const primaryCredential = resolvedCredentialRows[0];

    await submitJob('evaluate-adversarial', {
      name: runName.trim(),
      description: runDescription.trim() || null,
      kaira_chat_user_id: primaryCredential?.userId ?? '',
      kaira_api_url: kairaApiUrl.trim(),
      kaira_auth_token: primaryCredential?.authToken || null,
      kaira_credential_pool: resolvedCredentialRows.map((row) => ({
        user_id: row.userId,
        auth_token: row.authToken,
      })),
      kaira_timeout: kairaTimeout,
      test_count: caseMode === 'saved' ? 0 : testCount,
      turn_delay: turnDelay,
      case_delay: caseDelay,
      max_turns: maxTurns,
      llm_provider: llmConfig.provider,
      llm_model: llmConfig.model,
      temperature: llmConfig.temperature,
      thinking: llmConfig.thinking,
      parallel_cases: parallelCases || undefined,
      case_workers: parallelCases ? caseWorkers : undefined,
      selected_goals: caseMode !== 'saved' && selectedGoals.length > 0 ? selectedGoals : undefined,
      selected_traits: caseMode !== 'saved' ? selectedTraits ?? undefined : undefined,
      selected_rule_ids: selectedRuleIds ?? undefined,
      selected_personas: caseMode !== 'saved' && selectedPersonas.length > 0 ? selectedPersonas : undefined,
      selected_persona_tactics: (() => {
        // Only send tactic narrowing for personas that are actually selected
        // AND whose user-picked subset differs from "all" (represented as
        // absent key in the state map). undefined means "all tactics" in
        // the backend contract.
        const filtered: Record<string, string[] | null> = {};
        for (const personaId of Object.keys(selectedPersonaTactics)) {
          if (!selectedPersonas.includes(personaId)) continue;
          const tactics = selectedPersonaTactics[personaId];
          if (tactics === undefined) continue;
          filtered[personaId] = tactics;
        }
        return Object.keys(filtered).length > 0 ? filtered : undefined;
      })(),
      persona_mixing_mode: caseMode !== 'saved' ? personaMixingMode : undefined,
      flow_mode: caseMode !== 'saved' ? flowMode : undefined,
      extra_instructions: caseMode !== 'saved' ? extraInstructions.trim() || undefined : undefined,
      case_mode: caseMode,
      saved_case_ids: caseMode !== 'generate' && selectedSavedCaseIds.length > 0 ? selectedSavedCaseIds : undefined,
      include_pinned_cases: caseMode !== 'generate' ? includePinnedCases || undefined : undefined,
      manual_cases: manualCases.length > 0 ? manualCases.map((testCase) => ({
        name: testCase.name?.trim() || undefined,
        description: testCase.description?.trim() || undefined,
        synthetic_input: testCase.syntheticInput,
        difficulty: testCase.difficulty,
        goal_flow: testCase.goalFlow,
        active_traits: testCase.activeTraits,
        expected_challenges: testCase.expectedChallenges,
      })) : undefined,
      timeouts: {
        text_only: timeouts.textOnly,
        with_schema: timeouts.withSchema,
        with_audio: timeouts.withAudio,
        with_audio_and_schema: timeouts.withAudioAndSchema,
      },
    });
  }, [
    runName,
    runDescription,
    kairaApiUrl,
    kairaTimeout,
    resolvedCredentialRows,
    testCount,
    turnDelay,
    caseDelay,
    maxTurns,
    llmConfig,
    parallelCases,
    caseWorkers,
    selectedGoals,
    selectedTraits,
    selectedRuleIds,
    selectedPersonas,
    selectedPersonaTactics,
    personaMixingMode,
    flowMode,
    extraInstructions,
    submitJob,
    caseMode,
    selectedSavedCaseIds,
    includePinnedCases,
    manualCases,
  ]);


  // Step content
  const stepContent = useMemo(() => {
    switch (currentStep) {
      case 0:
        return (
          <RunInfoStep
            name={runName}
            description={runDescription}
            onNameChange={setRunName}
            onDescriptionChange={setRunDescription}
            namePlaceholder="e.g., Meal logging stress test"
          />
        );
      case 1:
        return (
          <KairaApiConfigStep
            kairaApiUrl={kairaApiUrl}
            kairaTimeout={kairaTimeout}
            credentialEntries={credentialEntries}
            onApiUrlChange={setKairaApiUrl}
            onTimeoutChange={setKairaTimeout}
            onCredentialEntriesChange={setCredentialEntries}
          />
        );
      case 2:
        return (
          <TestConfigStep
            caseMode={caseMode}
            testCount={testCount}
            selectedGoals={selectedGoals}
            selectedTraits={selectedTraits}
            selectedRuleIds={selectedRuleIds}
            selectedPersonas={selectedPersonas}
            selectedPersonaTactics={selectedPersonaTactics}
            personaMixingMode={personaMixingMode}
            flowMode={flowMode}
            extraInstructions={extraInstructions}
            selectedSavedCaseIds={selectedSavedCaseIds}
            includePinnedCases={includePinnedCases}
            manualCases={manualCases}
            onCaseModeChange={setCaseMode}
            onTestCountChange={setTestCount}
            onGoalsChange={setSelectedGoals}
            onTraitsChange={setSelectedTraits}
            onSelectedRuleIdsChange={setSelectedRuleIds}
            onPersonasChange={setSelectedPersonas}
            onPersonaTacticsChange={setSelectedPersonaTactics}
            onPersonaMixingModeChange={setPersonaMixingMode}
            onFlowModeChange={setFlowMode}
            onExtraInstructionsChange={setExtraInstructions}
            onSavedCasesChange={setSelectedSavedCaseIds}
            onIncludePinnedCasesChange={setIncludePinnedCases}
            onManualCasesChange={setManualCases}
          />
        );
      case 3:
        return (
          <LLMConfigStep
            config={llmConfig}
            onChange={setLlmConfig}
            onModelsLoading={setModelsLoading}
            parallelCases={parallelCases}
            caseWorkers={caseWorkers}
            maxTurns={maxTurns}
            turnDelay={turnDelay}
            caseDelay={caseDelay}
            onParallelCasesChange={setParallelCases}
            onCaseWorkersChange={setCaseWorkers}
            onMaxTurnsChange={setMaxTurns}
            onTurnDelayChange={setTurnDelay}
            onCaseDelayChange={setCaseDelay}
          />
        );
      case 4:
        return <ReviewStep summary={reviewSummary} sections={reviewSections} />;
      default:
        return null;
    }
  }, [
    currentStep,
    runName,
    runDescription,
    kairaApiUrl,
    kairaTimeout,
    credentialEntries,
    testCount,
    turnDelay,
    caseDelay,
    maxTurns,
    llmConfig,
    parallelCases,
    caseWorkers,
    selectedGoals,
    selectedTraits,
    selectedRuleIds,
    selectedPersonas,
    selectedPersonaTactics,
    personaMixingMode,
    flowMode,
    extraInstructions,
    reviewSummary,
    reviewSections,
    caseMode,
    selectedSavedCaseIds,
    includePinnedCases,
    manualCases,
  ]);

  return (
    <WizardOverlay
      title="Adversarial Stress Test"
      steps={STEPS}
      currentStep={currentStep}
      onClose={onClose}
      onBack={handleBack}
      onNext={handleNext}
      canGoNext={canGoNext}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      submitLabel="Start Stress Test"
      isDirty={isDirty}
    >
      {stepContent}
    </WizardOverlay>
  );
}
