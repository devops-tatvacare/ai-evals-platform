import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { RotateCcw, Play, AlertCircle, Info, FileText, Clock, Check, X, ChevronDown, ChevronRight, Wifi, WifiOff, Key, Music, FileCheck } from 'lucide-react';
import { Modal, Button, Tooltip } from '@/components/ui';
import { VariableChips } from '@/features/settings/components/VariableChips';
import { VariablesGuide } from '@/features/settings/components/VariablesGuide';
import { SchemaSelector } from '@/features/settings/components/SchemaSelector';
import { SchemaGeneratorInline } from '@/features/settings/components/SchemaGeneratorInline';
import { PromptSelector } from '@/features/settings/components/PromptSelector';
import { useSettingsStore, useAppStore } from '@/stores';
import { useSchemasStore } from '@/stores/schemasStore';
import { usePromptsStore } from '@/stores/promptsStore';
import { useCurrentPromptsActions } from '@/hooks';
import { useNetworkStatus } from '@/hooks';
import {
  validatePromptVariables,
  getAvailableDataKeys,
  type VariableContext,
} from '@/services/templates';
import type { Listing, TemplateVariableStatus, SchemaDefinition } from '@/types';
import type { EvaluationConfig } from '../hooks/useAIEvaluation';

type TabType = 'transcription' | 'evaluation';

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
  /** Pre-select evaluation variant from header button */
  initialVariant?: 'segments' | 'regular';
}

export function EvaluationModal({
  isOpen,
  onClose,
  listing,
  onStartEvaluation,
  hasAudioBlob,
  initialVariant,
}: EvaluationModalProps) {
  const sourceType = listing.sourceType || 'upload'; // Default to upload for backward compatibility
  const llm = useSettingsStore((state) => state.llm);
  const transcription = useSettingsStore((state) => state.transcription);
  const loadSchemas = useSchemasStore((state) => state.loadSchemas);
  const getSchemasByType = useSchemasStore((state) => state.getSchemasByType);
  const appId = useAppStore((state) => state.currentApp);
  const getPromptFromStore = usePromptsStore((state) => state.getPrompt);
  const getPromptsByType = usePromptsStore((state) => state.getPromptsByType);
  const { loadPrompts } = useCurrentPromptsActions();
  const isOnline = useNetworkStatus();
  
  // Get available prompts filtered by type and sourceType
  const transcriptionPrompts = useMemo(
    () => getPromptsByType(appId, 'transcription', sourceType === 'pending' ? undefined : sourceType),
    [getPromptsByType, appId, sourceType]
  );
  const evaluationPrompts = useMemo(
    () => getPromptsByType(appId, 'evaluation', sourceType === 'pending' ? undefined : sourceType),
    [getPromptsByType, appId, sourceType]
  );
  
  // Get prompts: use previously stored prompts if available, otherwise use active prompt from settings
  const getInitialTranscriptionPrompt = useCallback(() => {
    // First check if listing has stored prompt
    if (listing.aiEval?.prompts?.transcription) {
      return listing.aiEval.prompts.transcription;
    }
    
    // For API flow, use API-specific prompt if available
    if (sourceType === 'api') {
      const apiPromptId = llm.defaultPrompts?.apiTranscription;
      if (apiPromptId) {
        const apiPrompt = getPromptFromStore(appId, apiPromptId);
        if (apiPrompt) {
          return apiPrompt.prompt;
        }
      }
      // Fallback: simplified transcription prompt for API flow (no segments)
      return `You are a medical transcription expert. Listen to this audio recording and produce an accurate transcript with structured medical data (prescriptions, diagnoses, vitals, etc.).

Focus on:
- Medical terminology accuracy (drug names, dosages, conditions)
- Speaker identification (Doctor, Patient, etc.)
- Clinical instructions and treatment plans
- Structured data extraction matching the provided schema

Output the transcript as plain text along with extracted structured medical data.`;
    }
    
    // For upload flow, use standard transcription prompt
    const activePromptId = llm.defaultPrompts?.transcription;
    if (activePromptId) {
      const activePrompt = getPromptFromStore(appId, activePromptId);
      if (activePrompt) {
        return activePrompt.prompt;
      }
    }
    // Fall back to legacy prompt text
    return llm.transcriptionPrompt || '';
  }, [listing.aiEval?.prompts?.transcription, llm.defaultPrompts?.transcription, llm.defaultPrompts?.apiTranscription, llm.transcriptionPrompt, appId, getPromptFromStore, sourceType]);

  const getInitialEvaluationPrompt = useCallback(() => {
    // First check if listing has stored prompt
    if (listing.aiEval?.prompts?.evaluation) {
      return listing.aiEval.prompts.evaluation;
    }
    
    // For API flow, use API-specific critique prompt if available
    if (sourceType === 'api') {
      const apiCritiqueId = llm.defaultPrompts?.apiCritique;
      if (apiCritiqueId) {
        const apiCritique = getPromptFromStore(appId, apiCritiqueId);
        if (apiCritique) {
          return apiCritique.prompt;
        }
      }
      // Fallback: simplified evaluation prompt for API flow (no segments)
      return `You are an expert medical transcription auditor. Compare the API system's output with your Judge AI output to evaluate quality.

**YOUR TASK:**
Provide a detailed field-by-field comparison of the structured medical data. You MUST evaluate EVERY field present in the API output.

**REFERENCE MATERIALS:**
- ORIGINAL TRANSCRIPT (from API): {{transcript}}
- JUDGE TRANSCRIPT (your reference): {{llm_transcript}}
- AUDIO (for verification): {{audio}}

**EVALUATION INSTRUCTIONS:**

1. **Transcript Comparison:**
   - Compare both full transcripts
   - Calculate overall match percentage (0-100)
   - Provide detailed critique explaining differences

2. **Structured Data Comparison:**
   - Examine EVERY field in both outputs (medications, dosages, diagnoses, vitals, etc.)
   - For EACH field, provide:
     * fieldPath: JSON path (e.g., "medications[0].name", "bloodPressure.systolic")
     * apiValue: Value from API system
     * judgeValue: Value from your Judge output
     * match: true/false
     * critique: Explanation of difference or confirmation of match
     * severity: "none" (match), "minor", "moderate", or "critical"
     * confidence: "low", "medium", or "high"
   - Calculate overall accuracy percentage across all fields
   - Provide summary of structured data quality

3. **Overall Assessment:**
   - Comprehensive summary with specific examples
   - Highlight any critical errors (medication names, dosages, diagnoses)

**SEVERITY CLASSIFICATION:**
- CRITICAL: Patient safety risk (dosage errors, wrong drugs, missed allergies)
- MODERATE: Clinical meaning affected (missing history, incomplete symptoms)
- MINOR: No clinical impact (formatting differences, minor paraphrasing)
- NONE: Perfect match

**IMPORTANT:** You MUST populate the fields array with critiques for every structured field present. An empty fields array is not acceptable.`;
    }
    
    // For upload flow, use standard evaluation prompt
    const activePromptId = llm.defaultPrompts?.evaluation;
    if (activePromptId) {
      const activePrompt = getPromptFromStore(appId, activePromptId);
      if (activePrompt) {
        return activePrompt.prompt;
      }
    }
    // Fall back to legacy prompt text
    return llm.evaluationPrompt || '';
  }, [listing.aiEval?.prompts?.evaluation, llm.defaultPrompts?.evaluation, llm.defaultPrompts?.apiCritique, llm.evaluationPrompt, appId, getPromptFromStore, sourceType]);

  const [transcriptionPrompt, setTranscriptionPrompt] = useState(getInitialTranscriptionPrompt);
  const [evaluationPrompt, setEvaluationPrompt] = useState(getInitialEvaluationPrompt);
  
  // Selected prompt IDs for dropdowns
  const [selectedTranscriptionPromptId, setSelectedTranscriptionPromptId] = useState<string | null>(null);
  const [selectedEvaluationPromptId, setSelectedEvaluationPromptId] = useState<string | null>(null);
  
  // Tab state for wizard interface
  const [activeTab, setActiveTab] = useState<TabType>('transcription');
  
  // Schema state
  const [transcriptionSchema, setTranscriptionSchema] = useState<SchemaDefinition | null>(null);
  const [evaluationSchema, setEvaluationSchema] = useState<SchemaDefinition | null>(null);
  const [showTranscriptionGenerator, setShowTranscriptionGenerator] = useState(false);
  const [showEvaluationGenerator, setShowEvaluationGenerator] = useState(false);
  
  // Skip transcription state - reuse existing AI transcript
  const [skipTranscription, setSkipTranscription] = useState(false);
  const [showExistingTranscript, setShowExistingTranscript] = useState(false);
  
  // Use segments mode - controlled by initialVariant or auto-detected from listing
  const [useSegments, setUseSegments] = useState<boolean>(() => {
    if (initialVariant === 'segments') return true;
    if (initialVariant === 'regular') return false;
    // Auto-detect: use segments if upload flow has segments
    return sourceType === 'upload' && (listing.transcript?.segments?.length ?? 0) > 0;
  });
  
  // Normalize original transcript state
  const [normalizeOriginal, setNormalizeOriginal] = useState(false);
  
  const transcriptionRef = useRef<HTMLTextAreaElement>(null);
  const evaluationRef = useRef<HTMLTextAreaElement>(null);

  // Check if existing AI transcript is available
  const existingAITranscript = listing.aiEval?.llmTranscript;
  const existingTranscriptMeta = useMemo(() => {
    if (!existingAITranscript || !listing.aiEval) return null;
    return {
      segmentCount: existingAITranscript.segments.length,
      model: listing.aiEval.model,
      createdAt: listing.aiEval.createdAt,
    };
  }, [existingAITranscript, listing.aiEval]);

  // Load schemas on mount
  useEffect(() => {
    loadSchemas(appId);
  }, [loadSchemas, appId]);

  // Reset prompts and load schemas ONLY when modal opens
  useEffect(() => {
    if (isOpen) {
      // Load prompts to ensure we have the latest active prompt
      loadPrompts();
      
      // Get fresh prompt values
      setTranscriptionPrompt(getInitialTranscriptionPrompt());
      setEvaluationPrompt(getInitialEvaluationPrompt());
      setSkipTranscription(false);
      setShowExistingTranscript(false);
      setActiveTab('transcription'); // Reset to first tab
      
      // Set useSegments based on initialVariant or auto-detect
      if (initialVariant === 'segments') {
        setUseSegments(true);
      } else if (initialVariant === 'regular') {
        setUseSegments(false);
      } else {
        // Auto-detect: use segments if upload flow has segments
        setUseSegments(sourceType === 'upload' && (listing.transcript?.segments?.length ?? 0) > 0);
      }
      
      // Load schemas: prioritize listing's stored schemas, then settings defaults, then first default
      const transcriptionSchemas = getSchemasByType(appId, 'transcription');
      const evaluationSchemas = getSchemasByType(appId, 'evaluation');
      
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]); // ONLY run when modal opens/closes

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
    () => validatePromptVariables(transcriptionPrompt, 'transcription', availableDataKeys, sourceType),
    [transcriptionPrompt, availableDataKeys, sourceType]
  );

  // Validate evaluation prompt (note: {{llm_transcript}} will be available after Call 1)
  const evaluationValidation = useMemo(() => {
    // For evaluation prompt, {{llm_transcript}} will be computed during eval
    const evalDataKeys = new Set(availableDataKeys);
    evalDataKeys.add('{{llm_transcript}}'); // Will be available after Call 1
    return validatePromptVariables(evaluationPrompt, 'evaluation', evalDataKeys, sourceType);
  }, [evaluationPrompt, availableDataKeys, sourceType]);

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
    
    // Only include segment-based variables for upload flow
    if (sourceType === 'upload') {
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
    }
    
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
  }, [hasAudioBlob, listing.transcript, sourceType]);

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
      available: segmentCount > 0 || sourceType === 'api', // API flow has flat transcript
      reason: segmentCount > 0 || sourceType === 'api'
        ? sourceType === 'api' ? 'Available from API' : `${segmentCount} segments`
        : 'Original transcript not available',
    });
    
    map.set('{{llm_transcript}}', {
      key: '{{llm_transcript}}',
      available: false,
      reason: 'Will be generated in Call 1',
    });
    
    // Only include segment-based variables for upload flow
    if (sourceType === 'upload') {
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
    }
    
    return map;
  }, [hasAudioBlob, listing.transcript, sourceType]);

  // Validate time_windows is in transcription prompt (mandatory for time-aligned mode in upload flow)
  const timeWindowsValidation = useMemo(() => {
    // Skip this validation for API flow (no segments)
    if (sourceType === 'api') {
      return { valid: true, error: null };
    }
    
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
  }, [transcriptionPrompt, listing.transcript?.segments?.length, sourceType]);

  // Validate transcription schema has required time fields (only for upload flow)
  const schemaValidation = useMemo(() => {
    // Skip schema time field validation for API flow (no segments)
    if (sourceType === 'api') {
      return { valid: true, error: null };
    }
    
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
  }, [transcriptionSchema, sourceType]);

  // Check if we can run evaluation
  const canRun = useMemo(() => {
    const baseValid = isOnline && llm.apiKey && hasAudioBlob && listing.transcript;
    
    if (skipTranscription) {
      // When skipping, only validate evaluation prompt and require existing transcript
      return (
        baseValid &&
        !!existingAITranscript &&
        evaluationValidation.unknownVariables.length === 0
      );
    }
    
    // Full validation when running transcription
    return (
      baseValid &&
      transcriptionValidation.unknownVariables.length === 0 &&
      evaluationValidation.unknownVariables.length === 0 &&
      timeWindowsValidation.valid &&
      schemaValidation.valid
    );
  }, [isOnline, llm.apiKey, hasAudioBlob, listing.transcript, skipTranscription, existingAITranscript, transcriptionValidation, evaluationValidation, timeWindowsValidation, schemaValidation]);

  // Collect all validation errors for display
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!isOnline) errors.push('No network connection');
    if (!llm.apiKey) errors.push('API key not configured');
    if (!hasAudioBlob) errors.push('Audio file not loaded');
    if (!listing.transcript) errors.push('Original transcript required');
    
    if (skipTranscription) {
      // Only check evaluation prompt when skipping
      if (!existingAITranscript) {
        errors.push('No existing AI transcript available to reuse');
      }
      if (evaluationValidation.unknownVariables.length > 0) {
        errors.push(`Unknown variables in evaluation prompt: ${evaluationValidation.unknownVariables.join(', ')}`);
      }
    } else {
      // Full validation when running transcription
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
    }
    return errors;
  }, [isOnline, llm.apiKey, hasAudioBlob, listing.transcript, skipTranscription, existingAITranscript, transcriptionValidation, evaluationValidation, timeWindowsValidation, schemaValidation]);

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

  const saveSchema = useSchemasStore((state) => state.saveSchema);

  const handleTranscriptionSchemaGenerated = useCallback(async (schema: Record<string, unknown>, name: string) => {
    try {
      const newSchema = await saveSchema(appId, {
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
  }, [saveSchema, appId]);

  const handleEvaluationSchemaGenerated = useCallback(async (schema: Record<string, unknown>, name: string) => {
    try {
      const newSchema = await saveSchema(appId, {
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
  }, [saveSchema, appId]);

  // Handle prompt selection from dropdown
  const handleTranscriptionPromptSelect = useCallback((promptId: string) => {
    setSelectedTranscriptionPromptId(promptId);
    const prompt = transcriptionPrompts.find(p => p.id === promptId);
    if (prompt) {
      setTranscriptionPrompt(prompt.prompt);
    }
  }, [transcriptionPrompts]);

  const handleEvaluationPromptSelect = useCallback((promptId: string) => {
    setSelectedEvaluationPromptId(promptId);
    const prompt = evaluationPrompts.find(p => p.id === promptId);
    if (prompt) {
      setEvaluationPrompt(prompt.prompt);
    }
  }, [evaluationPrompts]);

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
      skipTranscription,
      normalizeOriginal,
      useSegments,
    });
  }, [onStartEvaluation, transcriptionPrompt, evaluationPrompt, transcriptionSchema, evaluationSchema, skipTranscription, normalizeOriginal, useSegments]);

  // Status items for summary sidebar
  const statusItems = useMemo(() => {
    const segmentCount = listing.transcript?.segments?.length || 0;
    return [
      {
        label: 'Network',
        ok: isOnline,
        detail: isOnline ? 'Online' : 'Offline',
        icon: isOnline ? Wifi : WifiOff,
      },
      {
        label: 'API Key',
        ok: !!llm.apiKey,
        detail: llm.apiKey ? 'Configured' : 'Not set',
        icon: Key,
      },
      {
        label: 'Audio',
        ok: hasAudioBlob,
        detail: hasAudioBlob ? 'Loaded' : 'Not loaded',
        icon: Music,
      },
      {
        label: 'Transcript',
        ok: segmentCount > 0,
        detail: segmentCount > 0 ? `${segmentCount} segments` : 'Not loaded',
        icon: FileCheck,
      },
    ];
  }, [isOnline, llm.apiKey, hasAudioBlob, listing.transcript?.segments?.length]);

  // Configuration summary for each step
  const stepSummary = useMemo(() => ({
    transcription: {
      promptConfigured: transcriptionPrompt.length > 0,
      schemaName: transcriptionSchema?.name || 'Default',
      skip: skipTranscription,
      hasErrors: !skipTranscription && (transcriptionValidation.unknownVariables.length > 0 || !timeWindowsValidation.valid || !schemaValidation.valid),
    },
    evaluation: {
      promptConfigured: evaluationPrompt.length > 0,
      schemaName: evaluationSchema?.name || 'Default',
      hasErrors: evaluationValidation.unknownVariables.length > 0,
    },
  }), [transcriptionPrompt, evaluationPrompt, transcriptionSchema, evaluationSchema, skipTranscription, transcriptionValidation, evaluationValidation, timeWindowsValidation, schemaValidation]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="AI Evaluation"
      className="max-w-7xl max-h-[90vh]"
    >
      <div className="flex flex-col min-h-0 h-[calc(90vh-100px)]">
        {/* Main content: Tabs + Sidebar */}
        <div className="flex gap-4 min-h-0 flex-1">
          {/* Left: Tab content area */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/* Tab Navigation */}
            <div className="flex border-b border-[var(--border-default)] mb-4 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('transcription')}
                className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                  activeTab === 'transcription'
                    ? 'border-[var(--color-brand-primary)] text-[var(--color-brand-primary)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold ${
                  activeTab === 'transcription' 
                    ? 'bg-[var(--color-brand-primary)] text-white' 
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                }`}>1</span>
                Transcription
                {stepSummary.transcription.skip && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">Skip</span>
                )}
                {stepSummary.transcription.hasErrors && !stepSummary.transcription.skip && (
                  <AlertCircle className="h-3.5 w-3.5 text-[var(--color-error)]" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('evaluation')}
                className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                  activeTab === 'evaluation'
                    ? 'border-[var(--color-brand-primary)] text-[var(--color-brand-primary)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold ${
                  activeTab === 'evaluation' 
                    ? 'bg-[var(--color-brand-primary)] text-white' 
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                }`}>2</span>
                Evaluation
                {stepSummary.evaluation.hasErrors && (
                  <AlertCircle className="h-3.5 w-3.5 text-[var(--color-error)]" />
                )}
              </button>
            </div>

            {/* Tab Content - Scrollable */}
            <div className="flex-1 overflow-y-auto pr-2 min-h-0">
              {/* Transcription Tab */}
              {activeTab === 'transcription' && (
                <div className="space-y-4">
                  {/* Header with info and reset */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
                        AI Transcription Prompt
                      </h3>
                      <Tooltip content={STEP1_TOOLTIP} position="bottom" maxWidth={360}>
                        <Info className="h-4 w-4 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-help" />
                      </Tooltip>
                    </div>
                    {!skipTranscription && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleResetTranscription}
                        className="h-7 text-[11px]"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Reset to Default
                      </Button>
                    )}
                  </div>

                  {/* Skip Transcription Option */}
                  {existingTranscriptMeta && (
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={skipTranscription}
                          onChange={(e) => setSkipTranscription(e.target.checked)}
                          className="h-4 w-4 rounded border-[var(--border-default)] text-[var(--color-brand-primary)] focus:ring-[var(--color-brand-accent)]"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium text-[var(--text-primary)]">
                            Skip transcription — reuse existing
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
                            <span className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {existingTranscriptMeta.segmentCount} segments
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(existingTranscriptMeta.createdAt).toLocaleDateString()}
                            </span>
                            <span className="truncate">
                              {existingTranscriptMeta.model}
                            </span>
                          </div>
                        </div>
                        {skipTranscription && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              setShowExistingTranscript(!showExistingTranscript);
                            }}
                            className="shrink-0 text-[11px] text-[var(--color-brand-primary)] hover:underline flex items-center gap-0.5"
                          >
                            {showExistingTranscript ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            {showExistingTranscript ? 'Hide' : 'View'}
                          </button>
                        )}
                      </label>
                      
                      {/* Existing transcript preview */}
                      {skipTranscription && showExistingTranscript && existingAITranscript && (
                        <div className="mt-3 max-h-[180px] overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                          <div className="space-y-1.5 text-[11px] font-mono">
                            {existingAITranscript.segments.map((seg, idx) => (
                              <div key={idx} className="flex gap-2">
                                <span className="shrink-0 text-[var(--text-muted)] w-5">{idx + 1}.</span>
                                <span className="text-[var(--color-brand-primary)] shrink-0">[{seg.speaker}]</span>
                                <span className="text-[var(--text-primary)]">{seg.text}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Normalize Original Transcript Option */}
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={normalizeOriginal}
                        onChange={(e) => setNormalizeOriginal(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-[var(--border-default)] text-[var(--color-brand-primary)] focus:ring-[var(--color-brand-accent)]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-[var(--text-primary)]">
                          Normalize original to {
                            transcription.scriptPreference === 'devanagari' 
                              ? 'Devanagari'
                              : transcription.scriptPreference === 'romanized'
                                ? 'Roman'
                                : 'Roman'
                          } script
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--text-muted)] leading-relaxed">
                          Transliterates original transcript to match target script before evaluation.
                        </div>
                        {normalizeOriginal && (
                          <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-[var(--color-info)] leading-snug">
                            <Info className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>Original will be transliterated before Call 2 (critique)</span>
                          </div>
                        )}
                      </div>
                    </label>
                  </div>

                  {/* Prompt Editor */}
                  <div className={skipTranscription ? 'opacity-40 pointer-events-none' : ''}>
                    {/* Prompt Selector */}
                    {transcriptionPrompts.length > 0 && (
                      <div className="mb-3">
                        <PromptSelector
                          prompts={transcriptionPrompts}
                          selectedId={selectedTranscriptionPromptId}
                          onSelect={handleTranscriptionPromptSelect}
                          label="Load Prompt Template"
                          disabled={skipTranscription}
                        />
                      </div>
                    )}
                    
                    <textarea
                      ref={transcriptionRef}
                      value={transcriptionPrompt}
                      onChange={(e) => setTranscriptionPrompt(e.target.value)}
                      disabled={skipTranscription}
                      placeholder="Enter your transcription prompt..."
                      className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-[13px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none h-[280px] disabled:bg-[var(--bg-secondary)] disabled:cursor-not-allowed"
                    />
                    
                    {/* Variables Section */}
                    <div className="mt-4 space-y-3">
                      <VariablesGuide
                        promptType="transcription"
                        variableStatuses={transcriptionVarStatuses}
                      />
                      <VariableChips
                        promptType="transcription"
                        promptText={transcriptionPrompt}
                        variableStatuses={transcriptionVarStatuses}
                        onInsert={(v) => handleInsertVariable(v, transcriptionRef, setTranscriptionPrompt)}
                      />
                    </div>

                    {/* Schema Section - Collapsible */}
                    <SchemaSection
                      title="Output Schema"
                      promptType="transcription"
                      schema={transcriptionSchema}
                      onSchemaChange={setTranscriptionSchema}
                      showGenerator={showTranscriptionGenerator}
                      onToggleGenerator={() => setShowTranscriptionGenerator(!showTranscriptionGenerator)}
                      onSchemaGenerated={handleTranscriptionSchemaGenerated}
                    />
                  </div>
                </div>
              )}

              {/* Evaluation Tab */}
              {activeTab === 'evaluation' && (
                <div className="space-y-4">
                  {/* Header with info and reset */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
                        LLM-as-Judge Evaluation Prompt
                      </h3>
                      <Tooltip content={STEP2_TOOLTIP} position="bottom" maxWidth={360}>
                        <Info className="h-4 w-4 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-help" />
                      </Tooltip>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleResetEvaluation}
                      className="h-7 text-[11px]"
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Reset to Default
                    </Button>
                  </div>

                  {/* Prompt Selector */}
                  {evaluationPrompts.length > 0 && (
                    <div className="mb-3">
                      <PromptSelector
                        prompts={evaluationPrompts}
                        selectedId={selectedEvaluationPromptId}
                        onSelect={handleEvaluationPromptSelect}
                        label="Load Prompt Template"
                      />
                    </div>
                  )}

                  {/* Prompt Editor */}
                  <textarea
                    ref={evaluationRef}
                    value={evaluationPrompt}
                    onChange={(e) => setEvaluationPrompt(e.target.value)}
                    placeholder="Enter your evaluation prompt..."
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-[13px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none h-[280px]"
                  />

                  {/* Variables Section */}
                  <div className="mt-4 space-y-3">
                    <VariablesGuide
                      promptType="evaluation"
                      variableStatuses={evaluationVarStatuses}
                    />
                    <VariableChips
                      promptType="evaluation"
                      promptText={evaluationPrompt}
                      variableStatuses={evaluationVarStatuses}
                      onInsert={(v) => handleInsertVariable(v, evaluationRef, setEvaluationPrompt)}
                    />
                  </div>

                  {/* Schema Section - Collapsible */}
                  <SchemaSection
                    title="Output Schema"
                    promptType="evaluation"
                    schema={evaluationSchema}
                    onSchemaChange={setEvaluationSchema}
                    showGenerator={showEvaluationGenerator}
                    onToggleGenerator={() => setShowEvaluationGenerator(!showEvaluationGenerator)}
                    onSchemaGenerated={handleEvaluationSchemaGenerated}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right: Summary Sidebar */}
          <div className="w-[240px] shrink-0 border-l border-[var(--border-default)] pl-4">
            <div className="space-y-5">
              {/* Configuration Summary */}
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                  Configuration
                </h4>
                <div className="space-y-3">
                  {/* Step 1 Summary */}
                  <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-semibold bg-[var(--bg-tertiary)] text-[var(--text-muted)]">1</span>
                      <span className="text-[12px] font-medium text-[var(--text-primary)]">Transcription</span>
                      {stepSummary.transcription.skip ? (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-warning-light)] text-[var(--color-warning)]">Skip</span>
                      ) : stepSummary.transcription.hasErrors ? (
                        <X className="ml-auto h-3.5 w-3.5 text-[var(--color-error)]" />
                      ) : (
                        <Check className="ml-auto h-3.5 w-3.5 text-[var(--color-success)]" />
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] space-y-1 pl-6">
                      <div className="flex items-center justify-between">
                        <span>Prompt</span>
                        <span className={stepSummary.transcription.promptConfigured ? 'text-[var(--text-secondary)]' : 'text-[var(--color-warning)]'}>
                          {stepSummary.transcription.promptConfigured ? '✓ Set' : 'Empty'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Schema</span>
                        <span className="text-[var(--text-secondary)] truncate max-w-[80px]" title={stepSummary.transcription.schemaName}>
                          {stepSummary.transcription.schemaName}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Step 2 Summary */}
                  <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-semibold bg-[var(--bg-tertiary)] text-[var(--text-muted)]">2</span>
                      <span className="text-[12px] font-medium text-[var(--text-primary)]">Evaluation</span>
                      {stepSummary.evaluation.hasErrors ? (
                        <X className="ml-auto h-3.5 w-3.5 text-[var(--color-error)]" />
                      ) : (
                        <Check className="ml-auto h-3.5 w-3.5 text-[var(--color-success)]" />
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] space-y-1 pl-6">
                      <div className="flex items-center justify-between">
                        <span>Prompt</span>
                        <span className={stepSummary.evaluation.promptConfigured ? 'text-[var(--text-secondary)]' : 'text-[var(--color-warning)]'}>
                          {stepSummary.evaluation.promptConfigured ? '✓ Set' : 'Empty'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Schema</span>
                        <span className="text-[var(--text-secondary)] truncate max-w-[80px]" title={stepSummary.evaluation.schemaName}>
                          {stepSummary.evaluation.schemaName}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Section */}
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                  Status
                </h4>
                <div className="space-y-2">
                  {statusItems.map((item) => (
                    <div key={item.label} className="flex items-center gap-2 text-[12px]">
                      <item.icon className={`h-3.5 w-3.5 ${item.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`} />
                      <span className="text-[var(--text-muted)]">{item.label}</span>
                      <span className={`ml-auto ${item.ok ? 'text-[var(--text-secondary)]' : 'text-[var(--color-error)]'}`}>
                        {item.detail}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Validation Errors */}
              {validationErrors.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-error)] mb-2">
                    Issues
                  </h4>
                  <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error-light)] p-3">
                    <ul className="space-y-1.5 text-[11px] text-[var(--color-error)]">
                      {validationErrors.map((error, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                          <span>{error}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
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

// Collapsible Schema Section Component
interface SchemaSectionProps {
  title: string;
  promptType: 'transcription' | 'evaluation';
  schema: SchemaDefinition | null;
  onSchemaChange: (schema: SchemaDefinition | null) => void;
  showGenerator: boolean;
  onToggleGenerator: () => void;
  onSchemaGenerated: (schema: Record<string, unknown>, name: string) => void;
}

function SchemaSection({
  title,
  promptType,
  schema,
  onSchemaChange,
  showGenerator,
  onToggleGenerator,
  onSchemaGenerated,
}: SchemaSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mt-4 border border-[var(--border-subtle)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
          )}
          <span className="text-[13px] font-medium text-[var(--text-primary)]">{title}</span>
        </div>
        <span className="text-[12px] text-[var(--text-muted)]">
          {schema?.name || 'Default'}
        </span>
      </button>
      
      {isExpanded && (
        <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]">
          <SchemaSelector
            promptType={promptType}
            value={schema}
            onChange={onSchemaChange}
            showPreview
            compact
            generatorSlot={
              !showGenerator ? (
                <SchemaGeneratorInline
                  promptType={promptType}
                  isExpanded={false}
                  onToggle={onToggleGenerator}
                  onSchemaGenerated={onSchemaGenerated}
                />
              ) : null
            }
          />
          {showGenerator && (
            <SchemaGeneratorInline
              promptType={promptType}
              isExpanded={true}
              onToggle={onToggleGenerator}
              onSchemaGenerated={onSchemaGenerated}
            />
          )}
        </div>
      )}
    </div>
  );
}
