/**
 * NewInsideSalesEvalOverlay — 6-step wizard for inside-sales call evaluation.
 * Follows the same pattern as NewBatchEvalOverlay.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { WizardOverlay, type WizardStep } from '@/features/evalRuns/components/WizardOverlay';
import { RunInfoStep } from '@/features/evalRuns/components/RunInfoStep';
import { LLMConfigStep, type LLMConfig } from '@/features/evalRuns/components/LLMConfigStep';
import { ParallelConfigSection } from '@/features/evalRuns/components/ParallelConfigSection';
import { ReviewStep, type ReviewSummary, type ReviewSection } from '@/features/evalRuns/components/ReviewStep';
import { SelectCallsStep, type CallSelectionConfig } from './SelectCallsStep';
import { TranscriptionConfigStep, type TranscriptionConfig } from './TranscriptionConfigStep';
import { evaluatorsRepository } from '@/services/api/evaluatorsApi';
import { useSubmitAndRedirect } from '@/hooks/useSubmitAndRedirect';
import { routes } from '@/config/routes';
import { cn } from '@/utils';
import { useInsideSalesStore } from '@/stores';
import type { CallRecord } from '@/stores/insideSalesStore';
import type { EvaluatorDefinition } from '@/types';

const STEPS: WizardStep[] = [
  { key: 'info', label: 'Run Info' },
  { key: 'calls', label: 'Select Calls' },
  { key: 'transcription', label: 'Transcription' },
  { key: 'evaluators', label: 'Evaluators' },
  { key: 'llm', label: 'LLM Config' },
  { key: 'review', label: 'Review' },
];

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

interface NewInsideSalesEvalOverlayProps {
  onClose: () => void;
  preSelectedCallIds?: string[];
}

export function NewInsideSalesEvalOverlay({ onClose, preSelectedCallIds }: NewInsideSalesEvalOverlayProps) {
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1: Run Info
  const [runName, setRunName] = useState('');
  const [runDescription, setRunDescription] = useState('');

  // Step 2: Select Calls — read store once at mount via getState() (not a selector,
  // avoids re-render loop from creating new array refs)
  const [callConfig, setCallConfig] = useState<CallSelectionConfig>(() => {
    const ids = preSelectedCallIds?.length
      ? preSelectedCallIds
      : [...useInsideSalesStore.getState().selectedCallIds];
    return {
      dateFrom: todayStr() + ' 00:00:00',
      dateTo: todayStr() + ' 23:59:59',
      agents: [],
      direction: '',
      status: '',
      durationMin: '',
      durationMax: '',
      hasRecording: false,
      selectionMode: ids.length ? 'specific' : 'all',
      sampleSize: 20,
      selectedCallIds: ids,
      skipEvaluated: true,
      minDuration: true,
    };
  });
  const [previewCalls, setPreviewCalls] = useState<CallRecord[]>([]);
  const [matchingCount, setMatchingCount] = useState(0);

  // Step 3: Transcription
  const [transcriptionConfig, setTranscriptionConfig] = useState<TranscriptionConfig>({
    language: 'auto',
    script: 'auto',
    model: 'gemini',
    forceRetranscribe: false,
    preserveCodeSwitching: true,
    speakerDiarization: true,
  });

  // Step 4: Evaluators
  const [availableEvaluators, setAvailableEvaluators] = useState<EvaluatorDefinition[]>([]);
  const [selectedEvaluatorIds, setSelectedEvaluatorIds] = useState<string[]>([]);

  useEffect(() => {
    evaluatorsRepository.getByAppId('inside-sales').then((evals) => {
      setAvailableEvaluators(evals);
      // Auto-select the first one if none selected
      if (evals.length > 0 && selectedEvaluatorIds.length === 0) {
        setSelectedEvaluatorIds([evals[0].id]);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 5: LLM Config
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: '',
    model: '',
    temperature: 0.1,
    thinking: 'off',
  });
  const [parallelEnabled, setParallelEnabled] = useState(true);
  const [parallelWorkers, setParallelWorkers] = useState(3);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Submit
  const { submit: submitJob, isSubmitting } = useSubmitAndRedirect({
    appId: 'inside-sales',
    label: runName || 'Inside Sales Eval',
    successMessage: 'Evaluation job submitted!',
    fallbackRoute: routes.insideSales.runs,
    onClose,
  });

  const handlePreviewLoaded = useCallback((calls: CallRecord[], total: number) => {
    setPreviewCalls(calls);
    setMatchingCount(total);
  }, []);

  // Validation
  const canGoNext = useMemo(() => {
    switch (currentStep) {
      case 0: return runName.trim().length > 0;
      case 1: return matchingCount > 0 || callConfig.selectedCallIds.length > 0;
      case 2: return true; // transcription config always valid
      case 3: return selectedEvaluatorIds.length > 0;
      case 4: return !!llmConfig.model && !modelsLoading;
      case 5: return true;
      default: return false;
    }
  }, [currentStep, runName, matchingCount, callConfig.selectedCallIds, selectedEvaluatorIds, llmConfig.model, modelsLoading]);

  // Review data
  const callCount = callConfig.selectionMode === 'sample'
    ? Math.min(callConfig.sampleSize, matchingCount)
    : callConfig.selectionMode === 'specific'
      ? callConfig.selectedCallIds.length
      : matchingCount;

  const reviewSummary: ReviewSummary = useMemo(() => ({
    name: runName,
    description: runDescription,
    badges: [
      { label: 'Model', value: llmConfig.model || '—' },
      { label: 'Calls', value: String(callCount) },
      { label: 'Evaluators', value: String(selectedEvaluatorIds.length) },
      { label: 'Workers', value: parallelEnabled ? String(parallelWorkers) : '1' },
    ],
  }), [runName, runDescription, llmConfig.model, callCount, selectedEvaluatorIds.length, parallelEnabled, parallelWorkers]);

  const reviewSections: ReviewSection[] = useMemo(() => [
    {
      label: 'Call Selection',
      items: [
        { key: 'Date range', value: `${callConfig.dateFrom.split(' ')[0]} → ${callConfig.dateTo.split(' ')[0]}` },
        { key: 'Mode', value: callConfig.selectionMode },
        { key: 'Calls', value: String(callCount) },
        ...(callConfig.agents.length ? [{ key: 'Agents', value: callConfig.agents.join(', ') }] : []),
        ...(callConfig.direction ? [{ key: 'Direction', value: callConfig.direction }] : []),
        ...(callConfig.status ? [{ key: 'Status', value: callConfig.status === 'notanswered' ? 'Missed' : 'Answered' }] : []),
        ...((callConfig.durationMin || callConfig.durationMax) ? [{ key: 'Duration', value: `${callConfig.durationMin || '0'}s – ${callConfig.durationMax ? callConfig.durationMax + 's' : '∞'}` }] : []),
        ...(callConfig.hasRecording ? [{ key: 'Recording', value: 'Required' }] : []),
      ],
    },
    {
      label: 'Transcription',
      items: [
        { key: 'Language', value: transcriptionConfig.language },
        { key: 'Script', value: transcriptionConfig.script },
        { key: 'Model', value: transcriptionConfig.model },
        { key: 'Diarization', value: transcriptionConfig.speakerDiarization ? 'Yes' : 'No' },
      ],
    },
    {
      label: 'Evaluators',
      items: selectedEvaluatorIds.map((id) => {
        const ev = availableEvaluators.find((e) => e.id === id);
        return { key: ev?.name || id.slice(0, 8), value: 'Selected' };
      }),
    },
    {
      label: 'Execution',
      items: [
        { key: 'Provider', value: llmConfig.provider || 'Default' },
        { key: 'Model', value: llmConfig.model },
        { key: 'Temperature', value: String(llmConfig.temperature) },
        { key: 'Workers', value: parallelEnabled ? String(parallelWorkers) : '1 (sequential)' },
      ],
    },
  ], [callConfig, callCount, transcriptionConfig, selectedEvaluatorIds, availableEvaluators, llmConfig, parallelEnabled, parallelWorkers]);

  const handleSubmit = useCallback(async () => {
    await submitJob('evaluate-inside-sales', {
      run_name: runName,
      run_description: runDescription,
      call_selection: {
        date_from: callConfig.dateFrom,
        date_to: callConfig.dateTo,
        agents: callConfig.agents,
        direction: callConfig.direction,
        status: callConfig.status,
        duration_min: callConfig.durationMin,
        duration_max: callConfig.durationMax,
        has_recording: callConfig.hasRecording,
        selection_mode: callConfig.selectionMode,
        sample_size: callConfig.sampleSize,
        selected_call_ids: callConfig.selectedCallIds,
        skip_evaluated: callConfig.skipEvaluated,
        min_duration: callConfig.minDuration,
      },
      transcription_config: transcriptionConfig,
      evaluator_ids: selectedEvaluatorIds,
      llm_config: {
        provider: llmConfig.provider,
        model: llmConfig.model,
        temperature: llmConfig.temperature,
        thinking: llmConfig.thinking,
      },
      parallel_workers: parallelEnabled ? parallelWorkers : 1,
      preview_calls: previewCalls,
    });
  }, [runName, runDescription, callConfig, transcriptionConfig, selectedEvaluatorIds, llmConfig, parallelEnabled, parallelWorkers, previewCalls, submitJob]);

  // Step content
  const stepContent = (() => {
    switch (currentStep) {
      case 0:
        return (
          <RunInfoStep
            name={runName}
            description={runDescription}
            onNameChange={setRunName}
            onDescriptionChange={setRunDescription}
            namePlaceholder="e.g., Weekly sales call quality audit"
          />
        );
      case 1:
        return (
          <SelectCallsStep
            config={callConfig}
            onConfigChange={(updates) => setCallConfig((prev) => ({ ...prev, ...updates }))}
            previewCalls={previewCalls}
            matchingCount={matchingCount}
            onPreviewLoaded={handlePreviewLoaded}
          />
        );
      case 2:
        return (
          <TranscriptionConfigStep
            config={transcriptionConfig}
            onChange={(updates) => setTranscriptionConfig((prev) => ({ ...prev, ...updates }))}
            totalCalls={callCount}
          />
        );
      case 3:
        return (
          <EvaluatorPickerStep
            available={availableEvaluators}
            selectedIds={selectedEvaluatorIds}
            onSelectionChange={setSelectedEvaluatorIds}
          />
        );
      case 4:
        return (
          <div className="space-y-4">
            <LLMConfigStep
              config={llmConfig}
              onChange={setLlmConfig}
              onModelsLoading={setModelsLoading}
            />
            <ParallelConfigSection
              parallel={parallelEnabled}
              workers={parallelWorkers}
              onParallelChange={setParallelEnabled}
              onWorkersChange={setParallelWorkers}
              label="Parallel evaluation"
              description="Process multiple calls simultaneously"
            />
          </div>
        );
      case 5:
        return <ReviewStep summary={reviewSummary} sections={reviewSections} />;
      default:
        return null;
    }
  })();

  return (
    <WizardOverlay
      title="New Call Quality Evaluation"
      steps={STEPS}
      currentStep={currentStep}
      onClose={onClose}
      onBack={() => setCurrentStep((s) => Math.max(0, s - 1))}
      onNext={() => setCurrentStep((s) => Math.min(STEPS.length - 1, s + 1))}
      canGoNext={canGoNext}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      submitLabel="Start Evaluation"
      isDirty={Boolean(runName || runDescription || currentStep > 0)}
    >
      {stepContent}
    </WizardOverlay>
  );
}

/* ── Simple Evaluator Picker ─────────────────────────────── */

function EvaluatorPickerStep({
  available,
  selectedIds,
  onSelectionChange,
}: {
  available: EvaluatorDefinition[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}) {
  const toggleEvaluator = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((x) => x !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  if (available.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-xs text-[var(--text-muted)]">No evaluators found for Inside Sales.</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">Go to Evaluators page to create or seed evaluators first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-secondary)]">
        Select which evaluators to run against the selected calls.
      </p>
      {available.map((ev) => {
        const isSelected = selectedIds.includes(ev.id);
        const dimCount = ev.outputSchema.filter((f) => f.type === 'number' && !f.isMainMetric).length;
        return (
          <button
            key={ev.id}
            onClick={() => toggleEvaluator(ev.id)}
            className={cn(
              'w-full text-left rounded-lg border p-3 transition-colors',
              isSelected
                ? 'border-[var(--color-brand-accent)] bg-[var(--color-brand-accent)]/5'
                : 'border-[var(--border-default)] hover:border-[var(--border-brand)]'
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-[var(--text-primary)]">{ev.name}</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {dimCount} dimensions · {ev.outputSchema.filter((f) => f.type === 'boolean').length} compliance gates
                </div>
              </div>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleEvaluator(ev.id)}
                className="h-4 w-4 rounded accent-[var(--color-brand-accent)]"
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}
