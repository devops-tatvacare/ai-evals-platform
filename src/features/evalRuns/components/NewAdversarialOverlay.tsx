import { useState, useCallback, useMemo } from 'react';
import { WizardOverlay, type WizardStep } from './WizardOverlay';
import { RunInfoStep } from './RunInfoStep';
import { KairaApiConfigStep } from './KairaApiConfigStep';
import { TestConfigStep } from './TestConfigStep';
import { LLMConfigStep, type LLMConfig } from './LLMConfigStep';
import { ReviewStep, type ReviewSection, type ReviewSummary } from './ReviewStep';
import { ParallelConfigSection } from './ParallelConfigSection';
import { useLLMSettingsStore, useAppSettingsStore, useGlobalSettingsStore, hasProviderCredentials, LLM_PROVIDERS } from '@/stores';
import type { LLMProvider } from '@/types';
import { useSubmitAndRedirect } from '@/hooks/useSubmitAndRedirect';
import { routes } from '@/config/routes';

const STEPS: WizardStep[] = [
  { key: 'info', label: 'Run Info' },
  { key: 'api', label: 'Kaira API' },
  { key: 'test', label: 'Test Config' },
  { key: 'llm', label: 'LLM Config' },
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
  const [userId, setUserId] = useState(kairaSettings.kairaChatUserId);
  const [kairaApiUrl, setKairaApiUrl] = useState(kairaSettings.kairaApiUrl);
  const [kairaAuthToken, setKairaAuthToken] = useState(kairaSettings.kairaAuthToken);
  const [kairaTimeout, setKairaTimeout] = useState(120);
  const [testCount, setTestCount] = useState(15);
  const [turnDelay, setTurnDelay] = useState(1.5);
  const [caseDelay, setCaseDelay] = useState(3.0);
  const [parallelCases, setParallelCases] = useState(false);
  const [caseWorkers, setCaseWorkers] = useState(3);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [flowMode, setFlowMode] = useState<'single' | 'multi'>('single');
  const [extraInstructions, setExtraInstructions] = useState('');
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: LLM_PROVIDERS[0].value,
    model: '',
    temperature: 0.1,
    thinking: 'low',
  });

  const isDirty = Boolean(runName || runDescription || kairaApiUrl);

  // Validation per step
  const canGoNext = useMemo(() => {
    switch (currentStep) {
      case 0: return runName.trim().length > 0;
      case 1: return kairaApiUrl.trim().length > 0;
      case 2: return testCount >= 5 && testCount <= 50;
      case 3: return Boolean(llmConfig.model) && !modelsLoading && hasProviderCredentials(llmConfig.provider as LLMProvider, useLLMSettingsStore.getState());
      case 4: return true;
      default: return false;
    }
  }, [currentStep, runName, kairaApiUrl, testCount, llmConfig, modelsLoading]);

  const handleBack = useCallback(() => {
    setCurrentStep((s) => Math.max(0, s - 1));
  }, []);

  const handleNext = useCallback(() => {
    setCurrentStep((s) => Math.min(STEPS.length - 1, s + 1));
  }, []);

  // Build review summary (banner zone)
  const reviewSummary = useMemo((): ReviewSummary => {
    return {
      name: runName,
      description: runDescription || undefined,
      badges: [
        { label: 'Model', value: llmConfig.model },
        { label: 'Tests', value: String(testCount) },
        { label: 'Parallel', value: parallelCases ? `${caseWorkers} workers` : 'Off' },
        { label: 'Timeout', value: `${kairaTimeout}s` },
      ],
    };
  }, [runName, runDescription, llmConfig.model, testCount, parallelCases, caseWorkers, kairaTimeout]);

  // Build review sections (details zone)
  const reviewSections = useMemo((): ReviewSection[] => {
    return [
      {
        label: 'Kaira API',
        items: [
          { key: 'User ID', value: userId },
          { key: 'API URL', value: kairaApiUrl },
          { key: 'Auth Token', value: kairaAuthToken ? '(configured)' : '(none)' },
          { key: 'Request Timeout', value: `${kairaTimeout}s` },
        ],
      },
      {
        label: 'Test Configuration',
        items: [
          { key: 'Test Cases', value: String(testCount) },
          { key: 'Goals', value: `${selectedGoals.length} selected` },
          { key: 'Flow Mode', value: flowMode === 'single' ? 'Single Goal' : 'Multi-Goal' },
          { key: 'Turn Delay', value: `${turnDelay.toFixed(1)}s` },
          { key: 'Case Delay', value: `${caseDelay.toFixed(1)}s` },
          ...(extraInstructions.trim() ? [{ key: 'Extra Instructions', value: extraInstructions.trim().slice(0, 80) + (extraInstructions.trim().length > 80 ? '...' : '') }] : []),
        ],
      },
      {
        label: 'Execution',
        items: [
          { key: 'Model', value: llmConfig.model },
          { key: 'Temperature', value: llmConfig.temperature.toFixed(1) },
          ...(llmConfig.provider === 'gemini' ? [{ key: 'Thinking', value: llmConfig.thinking.charAt(0).toUpperCase() + llmConfig.thinking.slice(1) }] : []),
          { key: 'Case Parallelism', value: parallelCases ? `Yes (${caseWorkers} workers)` : 'Sequential' },
        ],
      },
    ];
  }, [userId, kairaApiUrl, kairaAuthToken, kairaTimeout, testCount, turnDelay, caseDelay, llmConfig, parallelCases, caseWorkers, selectedGoals, flowMode, extraInstructions]);

  const handleSubmit = useCallback(async () => {
    const { timeouts } = useGlobalSettingsStore.getState();

    await submitJob('evaluate-adversarial', {
      name: runName.trim(),
      description: runDescription.trim() || null,
      user_id: userId,
      kaira_api_url: kairaApiUrl.trim(),
      kaira_auth_token: kairaAuthToken || null,
      kaira_timeout: kairaTimeout,
      test_count: testCount,
      turn_delay: turnDelay,
      case_delay: caseDelay,
      llm_provider: llmConfig.provider,
      llm_model: llmConfig.model,
      temperature: llmConfig.temperature,
      thinking: llmConfig.thinking,
      parallel_cases: parallelCases || undefined,
      case_workers: parallelCases ? caseWorkers : undefined,
      selected_goals: selectedGoals.length > 0 ? selectedGoals : undefined,
      flow_mode: flowMode,
      extra_instructions: extraInstructions.trim() || undefined,
      timeouts: {
        text_only: timeouts.textOnly,
        with_schema: timeouts.withSchema,
        with_audio: timeouts.withAudio,
        with_audio_and_schema: timeouts.withAudioAndSchema,
      },
    });
  }, [runName, runDescription, userId, kairaApiUrl, kairaAuthToken, kairaTimeout, testCount, turnDelay, caseDelay, llmConfig, parallelCases, caseWorkers, selectedGoals, flowMode, extraInstructions, submitJob]);


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
          />
        );
      case 1:
        return (
          <KairaApiConfigStep
            userId={userId}
            kairaApiUrl={kairaApiUrl}
            kairaAuthToken={kairaAuthToken}
            kairaTimeout={kairaTimeout}
            onUserIdChange={setUserId}
            onApiUrlChange={setKairaApiUrl}
            onAuthTokenChange={setKairaAuthToken}
            onTimeoutChange={setKairaTimeout}
          />
        );
      case 2:
        return (
          <TestConfigStep
            testCount={testCount}
            turnDelay={turnDelay}
            caseDelay={caseDelay}
            selectedGoals={selectedGoals}
            flowMode={flowMode}
            extraInstructions={extraInstructions}
            onTestCountChange={setTestCount}
            onTurnDelayChange={setTurnDelay}
            onCaseDelayChange={setCaseDelay}
            onGoalsChange={setSelectedGoals}
            onFlowModeChange={setFlowMode}
            onExtraInstructionsChange={setExtraInstructions}
          />
        );
      case 3:
        return (
          <div className="space-y-5">
            <LLMConfigStep config={llmConfig} onChange={setLlmConfig} onModelsLoading={setModelsLoading} />
            <ParallelConfigSection
              parallel={parallelCases}
              workers={caseWorkers}
              onParallelChange={setParallelCases}
              onWorkersChange={setCaseWorkers}
              label="Test Case Parallelism"
              description="Run multiple test cases concurrently. Case delay still applies between starts."
            />
          </div>
        );
      case 4:
        return <ReviewStep summary={reviewSummary} sections={reviewSections} />;
      default:
        return null;
    }
  }, [currentStep, runName, runDescription, userId, kairaApiUrl, kairaAuthToken, kairaTimeout, testCount, turnDelay, caseDelay, llmConfig, parallelCases, caseWorkers, selectedGoals, flowMode, extraInstructions, reviewSummary, reviewSections]);

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
