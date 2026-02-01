import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { RotateCcw, Play, AlertCircle, Info } from 'lucide-react';
import { Modal, Button, Tooltip } from '@/components/ui';
import { VariableChips } from '@/features/settings/components/VariableChips';
import { SchemaSelector } from '@/features/settings/components/SchemaSelector';
import { SchemaGeneratorInline } from '@/features/settings/components/SchemaGeneratorInline';
import { useSettingsStore, useSchemasStore } from '@/stores';
import { useNetworkStatus } from '@/hooks';
import {
  validatePromptVariables,
  getAvailableDataKeys,
  type VariableContext,
} from '@/services/templates';
import type { Listing, TemplateVariableStatus, SchemaDefinition } from '@/types';
import type { EvaluationConfig } from '../hooks/useAIEvaluation';

// Tooltip content for steps
const STEP1_TOOLTIP = (
  <div className="space-y-2">
    <p className="font-medium">Call 1: AI Transcription</p>
    <p>The LLM listens to the audio and generates its own transcript using the exact time windows from your original transcript.</p>
    <p className="font-medium mt-2">Requirements:</p>
    <ul className="list-disc list-inside text-[11px] space-y-1">
      <li><code className="bg-[var(--bg-tertiary)] px-1 rounded">{'{{time_windows}}'}</code> — Required for time-aligned segments</li>
      <li><code className="bg-[var(--bg-tertiary)] px-1 rounded">{'{{segment_count}}'}</code> — Tells LLM how many segments to output</li>
      <li>Schema must have <code className="bg-[var(--bg-tertiary)] px-1 rounded">startTime</code> and <code className="bg-[var(--bg-tertiary)] px-1 rounded">endTime</code> as required fields</li>
    </ul>
  </div>
);

const STEP2_TOOLTIP = (
  <div className="space-y-2">
    <p className="font-medium">Call 2: LLM-as-Judge Evaluation</p>
    <p>The LLM compares the original transcript (system under test) with its own transcript from Call 1, using the audio to determine ground truth.</p>
    <p className="font-medium mt-2">Available Variables:</p>
    <ul className="list-disc list-inside text-[11px] space-y-1">
      <li><code className="bg-[var(--bg-tertiary)] px-1 rounded">{'{{transcript}}'}</code> — Original AI transcript</li>
      <li><code className="bg-[var(--bg-tertiary)] px-1 rounded">{'{{llm_transcript}}'}</code> — Judge transcript from Call 1</li>
      <li><code className="bg-[var(--bg-tertiary)] px-1 rounded">{'{{audio}}'}</code> — Audio file for verification</li>
    </ul>
    <p className="font-medium mt-2">Output:</p>
    <p className="text-[11px]">Per-segment critique with severity, likelyCorrect determination, and confidence scores.</p>
  </div>
);

interface EvaluationModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: Listing;
  onStartEvaluation: (config: EvaluationConfig) => void;
  hasAudioBlob: boolean;
}

export function EvaluationModal({
  isOpen,
  onClose,
  listing,
  onStartEvaluation,
  hasAudioBlob,
}: EvaluationModalProps) {
  const { llm } = useSettingsStore();
  const { schemas, loadSchemas, getSchemasByType } = useSchemasStore();
  const isOnline = useNetworkStatus();
  
  // Get prompts: use previously stored prompts if available, otherwise use settings defaults
  const getInitialTranscriptionPrompt = useCallback(() => {
    return listing.aiEval?.prompts?.transcription || llm.transcriptionPrompt || '';
  }, [listing.aiEval?.prompts?.transcription, llm.transcriptionPrompt]);

  const getInitialEvaluationPrompt = useCallback(() => {
    return listing.aiEval?.prompts?.evaluation || llm.evaluationPrompt || '';
  }, [listing.aiEval?.prompts?.evaluation, llm.evaluationPrompt]);

  const [transcriptionPrompt, setTranscriptionPrompt] = useState(getInitialTranscriptionPrompt);
  const [evaluationPrompt, setEvaluationPrompt] = useState(getInitialEvaluationPrompt);
  
  // Schema state
  const [transcriptionSchema, setTranscriptionSchema] = useState<SchemaDefinition | null>(null);
  const [evaluationSchema, setEvaluationSchema] = useState<SchemaDefinition | null>(null);
  const [showTranscriptionGenerator, setShowTranscriptionGenerator] = useState(false);
  const [showEvaluationGenerator, setShowEvaluationGenerator] = useState(false);
  
  const transcriptionRef = useRef<HTMLTextAreaElement>(null);
  const evaluationRef = useRef<HTMLTextAreaElement>(null);

  // Load schemas on mount
  useEffect(() => {
    loadSchemas();
  }, [loadSchemas]);

  // Reset prompts and load schemas when modal opens
  useEffect(() => {
    if (isOpen) {
      setTranscriptionPrompt(getInitialTranscriptionPrompt());
      setEvaluationPrompt(getInitialEvaluationPrompt());
      
      // Load schemas: prioritize listing's stored schemas, then settings defaults, then first default
      const transcriptionSchemas = getSchemasByType('transcription');
      const evaluationSchemas = getSchemasByType('evaluation');
      
      // Transcription schema
      const storedTranscriptionId = listing.aiEval?.schemas?.transcription?.id;
      const defaultTranscriptionId = llm.defaultSchemas?.transcription;
      const transcriptionId = storedTranscriptionId || defaultTranscriptionId;
      if (transcriptionId) {
        const schema = transcriptionSchemas.find(s => s.id === transcriptionId);
        setTranscriptionSchema(schema || transcriptionSchemas.find(s => s.isDefault) || transcriptionSchemas[0] || null);
      } else {
        setTranscriptionSchema(transcriptionSchemas.find(s => s.isDefault) || transcriptionSchemas[0] || null);
      }
      
      // Evaluation schema
      const storedEvaluationId = listing.aiEval?.schemas?.evaluation?.id;
      const defaultEvaluationId = llm.defaultSchemas?.evaluation;
      const evaluationId = storedEvaluationId || defaultEvaluationId;
      if (evaluationId) {
        const schema = evaluationSchemas.find(s => s.id === evaluationId);
        setEvaluationSchema(schema || evaluationSchemas.find(s => s.isDefault) || evaluationSchemas[0] || null);
      } else {
        setEvaluationSchema(evaluationSchemas.find(s => s.isDefault) || evaluationSchemas[0] || null);
      }
    }
  }, [isOpen, getInitialTranscriptionPrompt, getInitialEvaluationPrompt, listing.aiEval?.schemas, llm.defaultSchemas, getSchemasByType, schemas]);

  // Build variable context
  const variableContext: VariableContext = useMemo(() => ({
    listing,
    aiEval: listing.aiEval,
    audioBlob: hasAudioBlob ? new Blob() : undefined, // Just for availability check
  }), [listing, hasAudioBlob]);

  const availableDataKeys = useMemo(
    () => getAvailableDataKeys(variableContext),
    [variableContext]
  );

  // Validate transcription prompt
  const transcriptionValidation = useMemo(
    () => validatePromptVariables(transcriptionPrompt, 'transcription', availableDataKeys),
    [transcriptionPrompt, availableDataKeys]
  );

  // Validate evaluation prompt (note: {{llm_transcript}} will be available after Call 1)
  const evaluationValidation = useMemo(() => {
    // For evaluation prompt, {{llm_transcript}} will be computed during eval
    const evalDataKeys = new Set(availableDataKeys);
    evalDataKeys.add('{{llm_transcript}}'); // Will be available after Call 1
    return validatePromptVariables(evaluationPrompt, 'evaluation', evalDataKeys);
  }, [evaluationPrompt, availableDataKeys]);

  // Create variable status maps for chips
  const transcriptionVarStatuses = useMemo(() => {
    const map = new Map<string, TemplateVariableStatus>();
    const segments = listing.transcript?.segments;
    const segmentCount = segments?.length || 0;
    
    // Audio status
    map.set('{{audio}}', {
      key: '{{audio}}',
      available: hasAudioBlob,
      reason: hasAudioBlob ? 'Audio file loaded' : 'Audio file not loaded',
    });
    
    // Time windows - computed from original transcript
    map.set('{{time_windows}}', {
      key: '{{time_windows}}',
      available: segmentCount > 0,
      reason: segmentCount > 0
        ? `${segmentCount} time windows extracted`
        : 'Original transcript required',
    });
    
    // Segment count - computed from original transcript
    map.set('{{segment_count}}', {
      key: '{{segment_count}}',
      available: segmentCount > 0,
      reason: segmentCount > 0
        ? `${segmentCount} segments`
        : 'Original transcript required',
    });
    
    // Speaker list - computed from original transcript
    map.set('{{speaker_list}}', {
      key: '{{speaker_list}}',
      available: segmentCount > 0,
      reason: segmentCount > 0
        ? 'Speakers extracted from transcript'
        : 'Original transcript required',
    });
    
    // Script preference - from settings (always available with default)
    map.set('{{script_preference}}', {
      key: '{{script_preference}}',
      available: true,
      reason: 'From settings',
    });
    
    // Language hint - from settings (always available with default)
    map.set('{{language_hint}}', {
      key: '{{language_hint}}',
      available: true,
      reason: 'From settings',
    });
    
    // Preserve code switching - from settings
    map.set('{{preserve_code_switching}}', {
      key: '{{preserve_code_switching}}',
      available: true,
      reason: 'From settings',
    });
    
    return map;
  }, [hasAudioBlob, listing.transcript]);

  const evaluationVarStatuses = useMemo(() => {
    const map = new Map<string, TemplateVariableStatus>();
    const segments = listing.transcript?.segments;
    const segmentCount = segments?.length || 0;
    
    map.set('{{audio}}', {
      key: '{{audio}}',
      available: hasAudioBlob,
      reason: hasAudioBlob ? 'Audio file loaded' : 'Audio file not loaded',
    });
    
    map.set('{{transcript}}', {
      key: '{{transcript}}',
      available: segmentCount > 0,
      reason: segmentCount > 0
        ? `${segmentCount} segments`
        : 'Original transcript not available',
    });
    
    map.set('{{llm_transcript}}', {
      key: '{{llm_transcript}}',
      available: false,
      reason: 'Will be generated in Call 1',
    });
    
    // Computed variables available during evaluation
    map.set('{{segment_count}}', {
      key: '{{segment_count}}',
      available: segmentCount > 0,
      reason: segmentCount > 0
        ? `${segmentCount} segments`
        : 'Original transcript required',
    });
    
    map.set('{{original_script}}', {
      key: '{{original_script}}',
      available: segmentCount > 0,
      reason: segmentCount > 0 ? 'Detected from transcript' : 'Original transcript required',
    });
    
    return map;
  }, [hasAudioBlob, listing.transcript]);

  // Validate time_windows is in transcription prompt (mandatory for time-aligned mode)
  const timeWindowsValidation = useMemo(() => {
    const hasTimeWindows = transcriptionPrompt.includes('{{time_windows}}');
    const hasSegments = !!listing.transcript?.segments?.length;
    
    if (!hasTimeWindows) {
      return {
        valid: false,
        error: '{{time_windows}} variable is required in transcription prompt for time-aligned evaluation',
      };
    }
    if (!hasSegments) {
      return {
        valid: false,
        error: 'Original transcript with time segments is required',
      };
    }
    return { valid: true, error: null };
  }, [transcriptionPrompt, listing.transcript?.segments?.length]);

  // Validate transcription schema has required time fields
  const schemaValidation = useMemo(() => {
    if (!transcriptionSchema) {
      return { valid: true, error: null }; // No schema = use default (which is valid)
    }
    
    // Check if schema has startTime and endTime in segment items
    const schema = transcriptionSchema.schema as Record<string, unknown>;
    const properties = schema?.properties as Record<string, unknown> | undefined;
    const segments = properties?.segments as Record<string, unknown> | undefined;
    const items = segments?.items as Record<string, unknown> | undefined;
    const itemProps = items?.properties as Record<string, unknown> | undefined;
    const required = items?.required as string[] | undefined;
    
    const hasStartTime = !!itemProps?.startTime;
    const hasEndTime = !!itemProps?.endTime;
    const startTimeRequired = required?.includes('startTime');
    const endTimeRequired = required?.includes('endTime');
    
    if (!hasStartTime || !hasEndTime) {
      return {
        valid: false,
        error: 'Transcription schema must include startTime and endTime fields in segments',
      };
    }
    
    if (!startTimeRequired || !endTimeRequired) {
      return {
        valid: false,
        error: 'startTime and endTime must be required fields in transcription schema',
      };
    }
    
    return { valid: true, error: null };
  }, [transcriptionSchema]);

  // Check if we can run evaluation
  const canRun = useMemo(() => {
    return (
      isOnline &&
      llm.apiKey &&
      hasAudioBlob &&
      listing.transcript &&
      transcriptionValidation.unknownVariables.length === 0 &&
      evaluationValidation.unknownVariables.length === 0 &&
      timeWindowsValidation.valid &&
      schemaValidation.valid
    );
  }, [isOnline, llm.apiKey, hasAudioBlob, listing.transcript, transcriptionValidation, evaluationValidation, timeWindowsValidation, schemaValidation]);

  // Collect all validation errors for display
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!isOnline) errors.push('No network connection');
    if (!llm.apiKey) errors.push('API key not configured');
    if (!hasAudioBlob) errors.push('Audio file not loaded');
    if (!listing.transcript) errors.push('Original transcript required');
    if (transcriptionValidation.unknownVariables.length > 0) {
      errors.push(`Unknown variables in transcription prompt: ${transcriptionValidation.unknownVariables.join(', ')}`);
    }
    if (evaluationValidation.unknownVariables.length > 0) {
      errors.push(`Unknown variables in evaluation prompt: ${evaluationValidation.unknownVariables.join(', ')}`);
    }
    if (!timeWindowsValidation.valid && timeWindowsValidation.error) {
      errors.push(timeWindowsValidation.error);
    }
    if (!schemaValidation.valid && schemaValidation.error) {
      errors.push(schemaValidation.error);
    }
    return errors;
  }, [isOnline, llm.apiKey, hasAudioBlob, listing.transcript, transcriptionValidation, evaluationValidation, timeWindowsValidation, schemaValidation]);

  const handleInsertVariable = useCallback((variable: string, ref: React.RefObject<HTMLTextAreaElement | null>, setter: (v: string) => void) => {
    const textarea = ref.current;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentValue = textarea.value;
    const newValue = currentValue.substring(0, start) + variable + currentValue.substring(end);
    setter(newValue);
    
    // Restore cursor position after the inserted variable
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  }, []);

  const handleResetTranscription = useCallback(() => {
    // Reset to global settings default, not listing's stored prompt
    setTranscriptionPrompt(llm.transcriptionPrompt || '');
  }, [llm.transcriptionPrompt]);

  const handleResetEvaluation = useCallback(() => {
    // Reset to global settings default, not listing's stored prompt
    setEvaluationPrompt(llm.evaluationPrompt || '');
  }, [llm.evaluationPrompt]);

  const { saveSchema } = useSchemasStore();

  const handleTranscriptionSchemaGenerated = useCallback(async (schema: Record<string, unknown>, name: string) => {
    try {
      const newSchema = await saveSchema({
        name,
        promptType: 'transcription',
        schema,
        description: `AI-generated transcription schema`,
      });
      setTranscriptionSchema(newSchema);
      setShowTranscriptionGenerator(false);
    } catch (err) {
      console.error('Failed to save generated schema:', err);
    }
  }, [saveSchema]);

  const handleEvaluationSchemaGenerated = useCallback(async (schema: Record<string, unknown>, name: string) => {
    try {
      const newSchema = await saveSchema({
        name,
        promptType: 'evaluation',
        schema,
        description: `AI-generated evaluation schema`,
      });
      setEvaluationSchema(newSchema);
      setShowEvaluationGenerator(false);
    } catch (err) {
      console.error('Failed to save generated schema:', err);
    }
  }, [saveSchema]);

  const handleRun = useCallback(() => {
    onStartEvaluation({
      prompts: {
        transcription: transcriptionPrompt,
        evaluation: evaluationPrompt,
      },
      schemas: {
        transcription: transcriptionSchema || undefined,
        evaluation: evaluationSchema || undefined,
      },
    });
  }, [onStartEvaluation, transcriptionPrompt, evaluationPrompt, transcriptionSchema, evaluationSchema]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="AI Evaluation"
      className="max-w-5xl max-h-[85vh]"
    >
      <div className="flex flex-col min-h-0">
        {/* Scrollable content area */}
        <div className="min-h-0 overflow-y-auto space-y-4 pr-2 max-h-[calc(85vh-140px)]">
          {/* Warnings */}
          {!llm.apiKey && (
            <div className="flex items-center gap-2 rounded-[var(--radius-default)] bg-[var(--color-warning-light)] border border-[var(--color-warning)]/30 p-3 text-[13px] text-[var(--color-warning)]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Configure your API key in Settings first</span>
            </div>
          )}

          {!isOnline && (
            <div className="flex items-center gap-2 rounded-[var(--radius-default)] bg-[var(--color-warning-light)] border border-[var(--color-warning)]/30 p-3 text-[13px] text-[var(--color-warning)]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>You're offline. Connect to use AI features.</span>
            </div>
          )}

          {/* Prompt editors */}
              {/* Side-by-side layout for Step 1 and Step 2 with separator */}
              <div className="flex gap-0 min-h-[400px]">
                {/* Step 1: Transcription Prompt */}
                <div className="flex-1 flex flex-col pr-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <label className="text-[13px] font-medium text-[var(--text-primary)]">
                        Step 1: Transcription Prompt
                      </label>
                      <Tooltip content={STEP1_TOOLTIP} position="bottom" maxWidth={360}>
                        <Info className="h-3.5 w-3.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-help" />
                      </Tooltip>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleResetTranscription}
                      className="h-7 text-[11px]"
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                  </div>
                  <textarea
                    ref={transcriptionRef}
                    value={transcriptionPrompt}
                    onChange={(e) => setTranscriptionPrompt(e.target.value)}
                    className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-[12px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none h-[240px]"
                  />
                  <VariableChips
                    promptType="transcription"
                    promptText={transcriptionPrompt}
                    variableStatuses={transcriptionVarStatuses}
                    onInsert={(v) => handleInsertVariable(v, transcriptionRef, setTranscriptionPrompt)}
                    className="mt-2"
                  />
                  
                  {/* Transcription Output Schema */}
                  <div className="mt-3">
                    <SchemaSelector
                      promptType="transcription"
                      value={transcriptionSchema}
                      onChange={setTranscriptionSchema}
                      showPreview
                      compact
                      generatorSlot={
                        !showTranscriptionGenerator ? (
                          <SchemaGeneratorInline
                            promptType="transcription"
                            isExpanded={false}
                            onToggle={() => setShowTranscriptionGenerator(true)}
                            onSchemaGenerated={handleTranscriptionSchemaGenerated}
                          />
                        ) : null
                      }
                    />
                    {showTranscriptionGenerator && (
                      <SchemaGeneratorInline
                        promptType="transcription"
                        isExpanded={true}
                        onToggle={() => setShowTranscriptionGenerator(false)}
                        onSchemaGenerated={handleTranscriptionSchemaGenerated}
                      />
                    )}
                  </div>
                </div>

                {/* Vertical Separator */}
                <div className="w-px bg-[var(--border-default)] mx-2 self-stretch" />

                {/* Step 2: Evaluation Prompt */}
                <div className="flex-1 flex flex-col pl-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <label className="text-[13px] font-medium text-[var(--text-primary)]">
                        Step 2: Evaluation Prompt
                      </label>
                      <Tooltip content={STEP2_TOOLTIP} position="bottom" maxWidth={360}>
                        <Info className="h-3.5 w-3.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-help" />
                      </Tooltip>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleResetEvaluation}
                      className="h-7 text-[11px]"
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                  </div>
                  <textarea
                    ref={evaluationRef}
                    value={evaluationPrompt}
                    onChange={(e) => setEvaluationPrompt(e.target.value)}
                    className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-[12px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none h-[240px]"
                  />
                  <VariableChips
                    promptType="evaluation"
                    promptText={evaluationPrompt}
                    variableStatuses={evaluationVarStatuses}
                    onInsert={(v) => handleInsertVariable(v, evaluationRef, setEvaluationPrompt)}
                    className="mt-2"
                  />
                  
                  {/* Evaluation Output Schema */}
                  <div className="mt-3">
                    <SchemaSelector
                      promptType="evaluation"
                      value={evaluationSchema}
                      onChange={setEvaluationSchema}
                      showPreview
                      compact
                      generatorSlot={
                        !showEvaluationGenerator ? (
                          <SchemaGeneratorInline
                            promptType="evaluation"
                            isExpanded={false}
                            onToggle={() => setShowEvaluationGenerator(true)}
                            onSchemaGenerated={handleEvaluationSchemaGenerated}
                          />
                        ) : null
                      }
                    />
                    {showEvaluationGenerator && (
                      <SchemaGeneratorInline
                        promptType="evaluation"
                        isExpanded={true}
                        onToggle={() => setShowEvaluationGenerator(false)}
                        onSchemaGenerated={handleEvaluationSchemaGenerated}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Validation errors */}
              {validationErrors.length > 0 && (
                <div className="flex items-start gap-2 rounded-[var(--radius-default)] bg-[var(--color-error-light)] border border-[var(--color-error)]/30 p-3 text-[13px] text-[var(--color-error)]">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Cannot run evaluation:</p>
                    <ul className="mt-1 list-disc list-inside space-y-0.5">
                      {validationErrors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
        </div>

        {/* Fixed Actions at bottom */}
        <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)] mt-4 shrink-0">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleRun} disabled={!canRun} className="gap-2">
            <Play className="h-4 w-4" />
            Run Evaluation
          </Button>
        </div>
      </div>
    </Modal>
  );
}
