import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WizardOverlay, type WizardStep } from './WizardOverlay';
import { RunInfoStep } from './RunInfoStep';
import { KairaApiConfigStep } from './KairaApiConfigStep';
import { TestConfigStep } from './TestConfigStep';
import { LLMConfigStep, type LLMConfig } from './LLMConfigStep';
import { ReviewStep, type ReviewSection } from './ReviewStep';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { useSettingsStore, useAppSettingsStore } from '@/stores';

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
  const navigate = useNavigate();

  // Wizard step state
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: useSettingsStore.getState().llm.provider || 'gemini',
    model: useSettingsStore.getState().llm.selectedModel || 'gemini-2.0-flash',
    temperature: 0.1,
  });

  const isDirty = Boolean(runName || runDescription || kairaApiUrl);

  // Validation per step
  const canGoNext = useMemo(() => {
    switch (currentStep) {
      case 0: return runName.trim().length > 0;
      case 1: return kairaApiUrl.trim().length > 0;
      case 2: return testCount >= 5 && testCount <= 50;
      case 3: return Boolean(llmConfig.model) && Boolean(useSettingsStore.getState().llm.apiKey);
      case 4: return true;
      default: return false;
    }
  }, [currentStep, runName, kairaApiUrl, testCount, llmConfig]);

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
        ],
      },
    ];
  }, [runName, runDescription, userId, kairaApiUrl, kairaAuthToken, testCount, turnDelay, caseDelay, llmConfig]);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const job = await jobsApi.submit('evaluate-adversarial', {
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
      });

      notificationService.success('Adversarial stress test submitted. It will appear in the runs list shortly.');

      // Poll briefly for run_id in progress
      let redirected = false;
      const timeout = Date.now() + 10000;
      while (Date.now() < timeout) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const updated = await jobsApi.get(job.id);
          const runId = (updated.progress as Record<string, unknown>)?.run_id as string | undefined;
          if (runId) {
            navigate(`/kaira/runs/${runId}`);
            redirected = true;
            break;
          }
          if (['completed', 'failed', 'cancelled'].includes(updated.status)) break;
        } catch {
          break;
        }
      }

      if (!redirected) {
        navigate('/kaira/runs');
      }

      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit stress test.';
      notificationService.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [runName, runDescription, userId, kairaApiUrl, kairaAuthToken, testCount, turnDelay, caseDelay, llmConfig, navigate, onClose]);

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
        return <LLMConfigStep config={llmConfig} onChange={setLlmConfig} />;
      case 4:
        return <ReviewStep sections={reviewSections} />;
      default:
        return null;
    }
  }, [currentStep, runName, runDescription, userId, kairaApiUrl, kairaAuthToken, testCount, turnDelay, caseDelay, llmConfig, reviewSections]);

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
