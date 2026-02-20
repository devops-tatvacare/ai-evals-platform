import { useState, useCallback, useMemo } from 'react';
import { WizardOverlay, type WizardStep } from './WizardOverlay';
import { RunInfoStep } from './RunInfoStep';
import { KairaApiConfigStep } from './KairaApiConfigStep';
import { TestConfigStep } from './TestConfigStep';
import { LLMConfigStep, type LLMConfig } from './LLMConfigStep';
import { ReviewStep, type ReviewSection } from './ReviewStep';
import { ParallelConfigSection } from './ParallelConfigSection';
import { useLLMSettingsStore, useAppSettingsStore, useGlobalSettingsStore, hasLLMCredentials } from '@/stores';
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
  const [testCount, setTestCount] = useState(15);
  const [turnDelay, setTurnDelay] = useState(1.5);
  const [caseDelay, setCaseDelay] = useState(3.0);
  const [parallelCases, setParallelCases] = useState(false);
  const [caseWorkers, setCaseWorkers] = useState(3);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: useLLMSettingsStore.getState().provider || 'gemini',
    model: useLLMSettingsStore.getState().selectedModel || '',
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
      case 3: return Boolean(llmConfig.model) && !modelsLoading && hasLLMCredentials(useLLMSettingsStore.getState());
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

  // Build review sections
  const reviewSections = useMemo((): ReviewSection[] => {
    return [
      {
        label: 'Run Info',
        items: [
          { key: 'Name', value: runName },
          ...(runDescription ? [{ key: 'Description', value: runDescription }] : []),
        ],
      },
      {
        label: 'Kaira API',
        items: [
          { key: 'User ID', value: userId },
          { key: 'API URL', value: kairaApiUrl },
          { key: 'Auth Token', value: kairaAuthToken ? '(configured)' : '(none)' },
        ],
      },
      {
        label: 'Test Configuration',
        items: [
          { key: 'Test Cases', value: String(testCount) },
          { key: 'Turn Delay', value: `${turnDelay.toFixed(1)}s` },
          { key: 'Case Delay', value: `${caseDelay.toFixed(1)}s` },
        ],
      },
      {
        label: 'LLM Configuration',
        items: [
          { key: 'Model', value: llmConfig.model },
          { key: 'Temperature', value: llmConfig.temperature.toFixed(1) },
          ...(llmConfig.provider === 'gemini' ? [{ key: 'Thinking', value: llmConfig.thinking.charAt(0).toUpperCase() + llmConfig.thinking.slice(1) }] : []),
        ],
      },
      {
        label: 'Parallelism',
        items: [
          { key: 'Case Parallelism', value: parallelCases ? `Yes (${caseWorkers} workers)` : 'Sequential' },
        ],
      },
    ];
  }, [runName, runDescription, userId, kairaApiUrl, kairaAuthToken, testCount, turnDelay, caseDelay, llmConfig, parallelCases, caseWorkers]);

  const handleSubmit = useCallback(async () => {
    const { timeouts } = useGlobalSettingsStore.getState();

    await submitJob('evaluate-adversarial', {
      name: runName.trim(),
      description: runDescription.trim() || null,
      user_id: userId,
      kaira_api_url: kairaApiUrl.trim(),
      kaira_auth_token: kairaAuthToken || null,
      test_count: testCount,
      turn_delay: turnDelay,
      case_delay: caseDelay,
      llm_provider: llmConfig.provider,
      llm_model: llmConfig.model,
      temperature: llmConfig.temperature,
      thinking: llmConfig.thinking,
      parallel_cases: parallelCases || undefined,
      case_workers: parallelCases ? caseWorkers : undefined,
      timeouts: {
        text_only: timeouts.textOnly,
        with_schema: timeouts.withSchema,
        with_audio: timeouts.withAudio,
        with_audio_and_schema: timeouts.withAudioAndSchema,
      },
    });
  }, [runName, runDescription, userId, kairaApiUrl, kairaAuthToken, testCount, turnDelay, caseDelay, llmConfig, parallelCases, caseWorkers, submitJob]);

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
            onUserIdChange={setUserId}
            onApiUrlChange={setKairaApiUrl}
            onAuthTokenChange={setKairaAuthToken}
          />
        );
      case 2:
        return (
          <TestConfigStep
            testCount={testCount}
            turnDelay={turnDelay}
            caseDelay={caseDelay}
            onTestCountChange={setTestCount}
            onTurnDelayChange={setTurnDelay}
            onCaseDelayChange={setCaseDelay}
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
        return <ReviewStep sections={reviewSections} />;
      default:
        return null;
    }
  }, [currentStep, runName, runDescription, userId, kairaApiUrl, kairaAuthToken, testCount, turnDelay, caseDelay, llmConfig, parallelCases, caseWorkers, reviewSections]);

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
