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
import type { CallFilters, CallRecord } from '@/services/api/insideSales';
import type { EvaluatorDefinition } from '@/types';

/** Auto-name templates for prefilled flows. Returns empty string for vanilla open. */
function buildAutoRunName(prefill: PrefillContext | undefined, idCount: number): string {
  if (!prefill) return '';
  const today = new Date().toISOString().slice(0, 10);
  const labelFromName = prefill.leadName?.trim() || prefill.repName?.trim();
  if (prefill.kind === 'lead' || prefill.kind === 'call') {
    return labelFromName ? `Eval — ${labelFromName} — ${today}` : `Eval — ${today}`;
  }
  // listing
  return idCount > 0 ? `Eval — ${idCount} calls — ${today}` : `Eval — ${today}`;
}

export interface PrefillContext {
  kind: 'lead' | 'call' | 'listing';
  leadName?: string;
  repName?: string;
}

const STEPS: WizardStep[] = [
  { key: 'info', label: 'Run Info' },
  { key: 'calls', label: 'Select Calls' },
  { key: 'transcription', label: 'Transcription' },
  { key: 'evaluators', label: 'Evaluators' },
  { key: 'llm', label: 'LLM Config' },
  { key: 'review', label: 'Review' },
];

interface NewInsideSalesEvalOverlayProps {
  onClose: () => void;
  /** Pre-selected call IDs. When non-empty the overlay starts in 'specific' mode. */
  preSelectedCallIds?: string[];
  /** Records already loaded by the calling surface for the pre-selected IDs.
   *  Threaded into Step 2 so the picker skips the broad selection fetch and
   *  renders the user's picks immediately. */
  preSelectedCalls?: CallRecord[];
  /** Pre-applied filters carried from the calling surface (e.g. the listing's active filter set). */
  preSelectedFilters?: Partial<CallFilters>;
  /** When provided, the overlay treats this as a prefilled flow:
   *  Step 1 (Run Info) is auto-filled and the wizard lands on Step 2 (Select Calls). */
  prefillContext?: PrefillContext;
}

export function NewInsideSalesEvalOverlay({
  onClose,
  preSelectedCallIds,
  preSelectedCalls,
  preSelectedFilters,
  prefillContext,
}: NewInsideSalesEvalOverlayProps) {
  const isPrefilled = Boolean(prefillContext);
  const [currentStep, setCurrentStep] = useState(isPrefilled ? 1 : 0);

  // Step 1: Run Info — auto-name only when prefilled and field empty.
  const [runName, setRunName] = useState(() =>
    buildAutoRunName(prefillContext, preSelectedCallIds?.length ?? 0),
  );
  const [runDescription, setRunDescription] = useState('');

  // Step 2: Select Calls — initial state derived from explicit props only. No store fallback;
  // call sites pass preSelectedCallIds explicitly so the overlay never opens with hidden context.
  const [callConfig, setCallConfig] = useState<CallSelectionConfig>(() => {
    const ids = preSelectedCallIds ?? [];
    const f = preSelectedFilters ?? {};
    return {
      agents: f.agents ?? [],
      leadId: f.leadId ?? [],
      direction: f.direction ?? '',
      status: f.status ?? '',
      durationMin: f.durationMin ?? '',
      durationMax: f.durationMax ?? '',
      hasRecording: f.hasRecording ?? false,
      eventCodes: f.eventCodes ?? '',
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

  // Resolved count of calls that will actually be evaluated, given the current scope.
  // 'specific' → exactly the picked ids; 'sample' → min(sampleSize, matching); 'all' → matching.
  const resolvedCallCount = callConfig.selectionMode === 'specific'
    ? callConfig.selectedCallIds.length
    : callConfig.selectionMode === 'sample'
      ? Math.min(callConfig.sampleSize, matchingCount)
      : matchingCount;

  // Validation
  const canGoNext = useMemo(() => {
    switch (currentStep) {
      case 0: return runName.trim().length > 0;
      case 1: return resolvedCallCount > 0;
      case 2: return true; // transcription config always valid
      case 3: return selectedEvaluatorIds.length > 0;
      case 4: return !!llmConfig.model && !modelsLoading;
      case 5: return resolvedCallCount > 0; // final submit must still resolve to ≥1 call
      default: return false;
    }
  }, [currentStep, runName, resolvedCallCount, selectedEvaluatorIds, llmConfig.model, modelsLoading]);

  // Review data — alias for clarity in the existing review summary code below.
  const callCount = resolvedCallCount;

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
        { key: 'Mode', value: callConfig.selectionMode },
        { key: 'Calls', value: String(callCount) },
        ...(callConfig.agents.length ? [{ key: 'Agents', value: callConfig.agents.join(', ') }] : []),
        ...(callConfig.leadId.length ? [{ key: 'Leads', value: callConfig.leadId.length === 1 ? callConfig.leadId[0] : `${callConfig.leadId.length} selected` }] : []),
        ...(callConfig.direction ? [{ key: 'Direction', value: callConfig.direction }] : []),
        ...(callConfig.status ? [{ key: 'Status', value: callConfig.status === 'not answered' ? 'Missed' : 'Answered' }] : []),
        ...((callConfig.durationMin || callConfig.durationMax) ? [{ key: 'Duration', value: `${callConfig.durationMin || '0'}s – ${callConfig.durationMax ? callConfig.durationMax + 's' : '∞'}` }] : []),
        ...(callConfig.hasRecording ? [{ key: 'Recording', value: 'Required' }] : []),
        ...(callConfig.eventCodes ? [{ key: 'Event Codes', value: callConfig.eventCodes }] : []),
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
    // Build the EvaluationSelectionSpec the backend expects (Pydantic
    // extra='forbid' — no legacy keys). Empty strings → null; the wizard's
    // duration boxes are free-form text but the spec wants ints.
    const parseDuration = (v: string): number | null => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const eventCodesList = callConfig.eventCodes
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
    const hasRecordingMode: 'only' | 'any' = callConfig.hasRecording ? 'only' : 'any';
    // Floor toggle ⇒ effective duration_min_seconds = 10 unless the user
    // already set a higher explicit floor.
    const explicitMin = parseDuration(callConfig.durationMin);
    const effectiveDurationMin = callConfig.minDuration
      ? Math.max(10, explicitMin ?? 10)
      : explicitMin;

    const selection = {
      agents: callConfig.agents,
      lead_ids: callConfig.leadId,
      direction: (callConfig.direction || null) as 'inbound' | 'outbound' | null,
      status: callConfig.status || null,
      event_codes: eventCodesList,
      duration_min_seconds: effectiveDurationMin,
      duration_max_seconds: parseDuration(callConfig.durationMax),
      has_recording: hasRecordingMode,
      mode: callConfig.selectionMode,
      sample_size: callConfig.selectionMode === 'sample' ? callConfig.sampleSize : null,
      selected_ids: callConfig.selectionMode === 'specific' ? callConfig.selectedCallIds : [],
      skip_evaluated: callConfig.skipEvaluated,
      skip_evaluated_scope: 'self' as const,
    };

    await submitJob('evaluate-inside-sales', {
      app_id: 'inside-sales',
      dataset_id: 'calls',
      run_name: runName,
      run_description: runDescription,
      selection,
      evaluator_ids: selectedEvaluatorIds,
      llm_config: {
        provider: llmConfig.provider,
        model: llmConfig.model,
        temperature: llmConfig.temperature,
        thinking: llmConfig.thinking,
      },
      transcription_config: {
        language: transcriptionConfig.language,
        script: transcriptionConfig.script,
        model: transcriptionConfig.model,
        speaker_diarization: transcriptionConfig.speakerDiarization,
        preserve_code_switching: transcriptionConfig.preserveCodeSwitching,
        force_retranscribe: transcriptionConfig.forceRetranscribe,
      },
      parallel_workers: parallelEnabled ? parallelWorkers : 1,
      preview_records: previewCalls,
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
            preSelectedCalls={preSelectedCalls}
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
