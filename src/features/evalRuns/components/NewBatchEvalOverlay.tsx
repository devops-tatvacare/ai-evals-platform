import { useState, useCallback, useMemo, useRef } from 'react';
import { WizardOverlay, type WizardStep } from './WizardOverlay';
import { RunInfoStep } from './RunInfoStep';
import { CsvUploadStep } from './CsvUploadStep';
import { ThreadScopeStep, type ThreadScope } from './ThreadScopeStep';
import { EvaluatorToggleStep, type EvaluatorToggles } from './EvaluatorToggleStep';
import { LLMConfigStep, type LLMConfig } from './LLMConfigStep';
import { ReviewStep, type ReviewSection } from './ReviewStep';
import { ParallelConfigSection } from './ParallelConfigSection';
import { useLLMSettingsStore, hasLLMCredentials, useGlobalSettingsStore } from '@/stores';
import { useSubmitAndRedirect } from '@/hooks/useSubmitAndRedirect';
import { routes } from '@/config/routes';
import type { PreviewResponse } from '@/types';
import { remapCsvContent, type ColumnMapping } from '../utils/csvSchema';

const STEPS: WizardStep[] = [
  { key: 'info', label: 'Run Info' },
  { key: 'data', label: 'Data Source' },
  { key: 'scope', label: 'Thread Scope' },
  { key: 'evaluators', label: 'Evaluators' },
  { key: 'llm', label: 'LLM Config' },
  { key: 'review', label: 'Review' },
];

interface NewBatchEvalOverlayProps {
  onClose: () => void;
}

export function NewBatchEvalOverlay({ onClose }: NewBatchEvalOverlayProps) {
  const { submit: submitJob, isSubmitting } = useSubmitAndRedirect({
    appId: 'kaira-bot',
    label: 'Batch Evaluation',
    successMessage: 'Batch evaluation submitted. It will appear in the runs list shortly.',
    fallbackRoute: routes.kaira.runs,
    onClose,
  });

  // Wizard step state
  const [currentStep, setCurrentStep] = useState(0);

  // Form state
  const [runName, setRunName] = useState('');
  const [runDescription, setRunDescription] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>(new Map());
  const [threadScope, setThreadScope] = useState<ThreadScope>('all');
  const [sampleSize, setSampleSize] = useState(10);
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [evaluators, setEvaluators] = useState<EvaluatorToggles>({
    intent: true,
    correctness: true,
    efficiency: true,
  });
  const [customEvaluatorIds, setCustomEvaluatorIds] = useState<string[]>([]);
  const [intentSystemPrompt, setIntentSystemPrompt] = useState('');
  const [parallelThreads, setParallelThreads] = useState(false);
  const [threadWorkers, setThreadWorkers] = useState(3);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: useLLMSettingsStore.getState().provider || 'gemini',
    model: useLLMSettingsStore.getState().selectedModel || '',
    temperature: 0.1,
    thinking: 'low',
  });

  // Track whether column mapping was applied (for submit-time remapping)
  const hasColumnMapping = columnMapping.size > 0;
  // Store ref to avoid re-reading file — CsvUploadStep already remaps and uploads
  const _columnMappingRef = useRef(columnMapping);
  _columnMappingRef.current = columnMapping;

  const isDirty = Boolean(runName || runDescription || uploadedFile);

  // Validation per step
  const canGoNext = useMemo(() => {
    switch (currentStep) {
      case 0: return runName.trim().length > 0;
      case 1: return uploadedFile !== null && previewData !== null;
      case 2: {
        if (threadScope === 'specific') return selectedThreadIds.length > 0;
        if (threadScope === 'sample') return sampleSize > 0;
        return true;
      }
      case 3: return Object.values(evaluators).some(Boolean) || customEvaluatorIds.length > 0;
      case 4: return Boolean(llmConfig.model) && !modelsLoading && hasLLMCredentials(useLLMSettingsStore.getState());
      case 5: return true;
      default: return false;
    }
  }, [currentStep, runName, uploadedFile, previewData, threadScope, selectedThreadIds, sampleSize, evaluators, llmConfig, modelsLoading]);

  const handleBack = useCallback(() => {
    setCurrentStep((s) => Math.max(0, s - 1));
  }, []);

  const handleNext = useCallback(() => {
    setCurrentStep((s) => Math.min(STEPS.length - 1, s + 1));
  }, []);

  // Build review sections
  const reviewSections = useMemo((): ReviewSection[] => {
    const threadInfo = threadScope === 'all'
      ? `All ${previewData?.totalThreads ?? 0} threads`
      : threadScope === 'sample'
        ? `Random sample of ${sampleSize} threads`
        : `${selectedThreadIds.length} specific threads`;

    const enabledEvaluators = [
      ...Object.entries(evaluators)
        .filter(([, v]) => v)
        .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1)),
      ...(customEvaluatorIds.length > 0 ? [`+${customEvaluatorIds.length} custom`] : []),
    ].join(', ');

    const mappingInfo = hasColumnMapping
      ? [..._columnMappingRef.current.entries()].map(([t, s]) => `${s} → ${t}`).join(', ')
      : undefined;

    return [
      {
        label: 'Run Info',
        items: [
          { key: 'Name', value: runName },
          ...(runDescription ? [{ key: 'Description', value: runDescription }] : []),
        ],
      },
      {
        label: 'Data Source',
        items: [
          { key: 'File', value: uploadedFile?.name ?? '' },
          { key: 'Threads', value: String(previewData?.totalThreads ?? 0) },
          { key: 'Messages', value: String(previewData?.totalMessages ?? 0) },
          ...(mappingInfo ? [{ key: 'Column Mapping', value: mappingInfo }] : []),
        ],
      },
      {
        label: 'Thread Scope',
        items: [{ key: 'Selection', value: threadInfo }],
      },
      {
        label: 'Evaluators',
        items: [{ key: 'Enabled', value: enabledEvaluators }],
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
          { key: 'Thread Parallelism', value: parallelThreads ? `Yes (${threadWorkers} workers)` : 'Sequential' },
        ],
      },
    ];
  }, [runName, runDescription, uploadedFile, previewData, threadScope, sampleSize, selectedThreadIds, evaluators, llmConfig, hasColumnMapping, parallelThreads, threadWorkers]);

  const handleSubmit = useCallback(async () => {
    // Build thread IDs based on scope
    let threadIds: string[] | undefined;
    if (threadScope === 'specific') {
      threadIds = selectedThreadIds;
    }

    // Read CSV file content — apply column remapping if user mapped columns
    let csvContent: string | null = null;
    if (uploadedFile) {
      let rawText = await uploadedFile.text();
      if (_columnMappingRef.current.size > 0) {
        rawText = remapCsvContent(rawText, _columnMappingRef.current);
      }
      csvContent = rawText;
    }

    // Pass user-configured timeout settings to backend
    const { timeouts } = useGlobalSettingsStore.getState();

    await submitJob('evaluate-batch', {
      name: runName.trim(),
      description: runDescription.trim() || null,
      csv_content: csvContent,
      thread_scope: threadScope,
      sample_size: threadScope === 'sample' ? sampleSize : undefined,
      thread_ids: threadIds,
      evaluate_intent: evaluators.intent,
      evaluate_correctness: evaluators.correctness,
      evaluate_efficiency: evaluators.efficiency,
      intent_system_prompt: intentSystemPrompt || null,
      llm_provider: llmConfig.provider,
      llm_model: llmConfig.model,
      temperature: llmConfig.temperature,
      thinking: llmConfig.thinking,
      custom_evaluator_ids: customEvaluatorIds.length > 0 ? customEvaluatorIds : undefined,
      parallel_threads: parallelThreads || undefined,
      thread_workers: parallelThreads ? threadWorkers : undefined,
      timeouts: {
        text_only: timeouts.textOnly,
        with_schema: timeouts.withSchema,
        with_audio: timeouts.withAudio,
        with_audio_and_schema: timeouts.withAudioAndSchema,
      },
    });
  }, [runName, runDescription, uploadedFile, threadScope, sampleSize, selectedThreadIds, evaluators, intentSystemPrompt, llmConfig, customEvaluatorIds, parallelThreads, threadWorkers, submitJob]);

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
          <CsvUploadStep
            file={uploadedFile}
            previewData={previewData}
            onFileChange={setUploadedFile}
            onPreviewData={setPreviewData}
            columnMapping={columnMapping}
            onColumnMappingChange={setColumnMapping}
          />
        );
      case 2:
        return (
          <ThreadScopeStep
            scope={threadScope}
            sampleSize={sampleSize}
            selectedThreadIds={selectedThreadIds}
            availableThreadIds={previewData?.threadIds ?? []}
            onScopeChange={setThreadScope}
            onSampleSizeChange={setSampleSize}
            onSelectedThreadsChange={setSelectedThreadIds}
          />
        );
      case 3:
        return (
          <EvaluatorToggleStep
            evaluators={evaluators}
            intentSystemPrompt={intentSystemPrompt}
            onEvaluatorsChange={setEvaluators}
            onIntentPromptChange={setIntentSystemPrompt}
            customEvaluatorIds={customEvaluatorIds}
            onCustomEvaluatorIdsChange={setCustomEvaluatorIds}
          />
        );
      case 4:
        return (
          <div className="space-y-5">
            <LLMConfigStep config={llmConfig} onChange={setLlmConfig} onModelsLoading={setModelsLoading} />
            <ParallelConfigSection
              parallel={parallelThreads}
              workers={threadWorkers}
              onParallelChange={setParallelThreads}
              onWorkersChange={setThreadWorkers}
              label="Thread Parallelism"
              description="Process multiple threads concurrently. Faster but may hit API rate limits."
            />
          </div>
        );
      case 5:
        return <ReviewStep sections={reviewSections} />;
      default:
        return null;
    }
  }, [currentStep, runName, runDescription, uploadedFile, previewData, columnMapping, threadScope, sampleSize, selectedThreadIds, evaluators, intentSystemPrompt, parallelThreads, threadWorkers, llmConfig, reviewSections]);

  return (
    <WizardOverlay
      title="New Batch Evaluation"
      steps={STEPS}
      currentStep={currentStep}
      onClose={onClose}
      onBack={handleBack}
      onNext={handleNext}
      canGoNext={canGoNext}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      submitLabel="Start Evaluation"
      isDirty={isDirty}
    >
      {stepContent}
    </WizardOverlay>
  );
}
