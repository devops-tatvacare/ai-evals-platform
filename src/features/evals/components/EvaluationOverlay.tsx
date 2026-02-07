import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  Play,
  AlertCircle,
  Info,
  FileText,
  Clock,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff,
  Key,
  Music,
  FileCheck,
  Eye,
  ArrowLeft,
  Plus,
  Save,
} from "lucide-react";
import { Button, Tooltip, VariablePickerPopover } from "@/components/ui";
import { cn } from "@/utils";
import { deriveSchemaFromApiResponse } from "@/utils/schemaDerivation";
import { SchemaSelector } from "@/features/settings/components/SchemaSelector";
import { SchemaModal } from "@/features/settings/components/SchemaModal";
import { SchemaGeneratorInline } from "@/features/settings/components/SchemaGeneratorInline";
import { InlineSchemaBuilder } from "./InlineSchemaBuilder";
import { PromptSelector } from "@/features/settings/components/PromptSelector";
import { EvaluationPreviewOverlay } from "./EvaluationPreviewOverlay";
import { useSettingsStore, useAppStore } from "@/stores";
import { useSchemasStore } from "@/stores/schemasStore";
import { usePromptsStore } from "@/stores/promptsStore";
import { useCurrentPromptsActions } from "@/hooks";
import { useNetworkStatus } from "@/hooks";
import {
  validatePromptVariables,
  getAvailableDataKeys,
  type VariableContext,
} from "@/services/templates";
import { generateJsonSchema } from "@/services/evaluators/schemaGenerator";
import { notificationService } from "@/services/notifications";
import type {
  Listing,
  SchemaDefinition,
  NormalizationTarget,
  EvaluatorOutputField,
} from "@/types";
import type { EvaluationConfig } from "../hooks/useAIEvaluation";

type TabType = "prerequisites" | "transcription" | "evaluation";

interface TransientSchemaDraft {
  schema: Record<string, unknown>;
  source: "derived" | "generated" | "visual";
}

// Supported languages for the prerequisites step
const SUPPORTED_LANGUAGES = [
  { value: "Hindi", label: "Hindi" },
  { value: "Tamil", label: "Tamil" },
  { value: "Gujarati", label: "Gujarati" },
  { value: "Marathi", label: "Marathi" },
  { value: "Bengali", label: "Bengali" },
  { value: "English", label: "English" },
  { value: "Hinglish", label: "Hinglish (Hindi+English)" },
] as const;

// Script options
const SCRIPT_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "devanagari", label: "Devanagari" },
  { value: "roman", label: "Roman (Latin)" },
  { value: "tamil", label: "Tamil Script" },
  { value: "gujarati", label: "Gujarati Script" },
] as const;

const TARGET_SCRIPT_OPTIONS = [
  { value: "roman", label: "Roman (English)" },
  { value: "devanagari", label: "Devanagari" },
] as const;

// Normalization target options
const NORMALIZATION_TARGET_OPTIONS = [
  {
    value: "original" as NormalizationTarget,
    label: "Original transcript only",
    description: "Normalize the system under test",
  },
  {
    value: "judge" as NormalizationTarget,
    label: "Judge AI transcript only",
    description: "Normalize the reference transcript",
  },
  {
    value: "both" as NormalizationTarget,
    label: "Both transcripts",
    description: "Normalize both for fair comparison",
  },
] as const;

// Prerequisites step tooltip
const PREREQUISITES_TOOLTIP = (
  <div className="space-y-2">
    <p className="font-medium">Step 1: Prerequisites</p>
    <p>
      Configure language, script, and normalization settings before evaluation.
    </p>
    <p className="font-medium mt-2">Options:</p>
    <ul className="list-disc list-inside text-[11px] space-y-1">
      <li>Language detection for medical terminology</li>
      <li>Script normalization (transliteration)</li>
      <li>Code-switching preservation for Hinglish</li>
    </ul>
  </div>
);

// Tooltip content for steps
const STEP1_TOOLTIP = (
  <div className="space-y-2">
    <p className="font-medium">Call 1: AI Transcription</p>
    <p>
      The LLM listens to the audio and generates its own transcript using the
      exact time windows from your original transcript.
    </p>
    <p className="font-medium mt-2">Requirements:</p>
    <ul className="list-disc list-inside text-[11px] space-y-1">
      <li>
        <code className="bg-[var(--bg-tertiary)] px-1 rounded">
          {"{{time_windows}}"}
        </code>{" "}
        — Required for time-aligned segments
      </li>
      <li>
        <code className="bg-[var(--bg-tertiary)] px-1 rounded">
          {"{{segment_count}}"}
        </code>{" "}
        — Tells LLM how many segments to output
      </li>
      <li>
        Schema must have{" "}
        <code className="bg-[var(--bg-tertiary)] px-1 rounded">startTime</code>{" "}
        and{" "}
        <code className="bg-[var(--bg-tertiary)] px-1 rounded">endTime</code> as
        required fields
      </li>
    </ul>
  </div>
);

const STEP2_TOOLTIP = (
  <div className="space-y-2">
    <p className="font-medium">Call 2: LLM-as-Judge Evaluation</p>
    <p>
      The LLM compares the original transcript (system under test) with its own
      transcript from Call 1, using the audio to determine ground truth.
    </p>
    <p className="font-medium mt-2">Available Variables:</p>
    <ul className="list-disc list-inside text-[11px] space-y-1">
      <li>
        <code className="bg-[var(--bg-tertiary)] px-1 rounded">
          {"{{transcript}}"}
        </code>{" "}
        — Original AI transcript
      </li>
      <li>
        <code className="bg-[var(--bg-tertiary)] px-1 rounded">
          {"{{llm_transcript}}"}
        </code>{" "}
        — Judge transcript from Call 1
      </li>
      <li>
        <code className="bg-[var(--bg-tertiary)] px-1 rounded">
          {"{{audio}}"}
        </code>{" "}
        — Audio file for verification
      </li>
    </ul>
    <p className="font-medium mt-2">Output:</p>
    <p className="text-[11px]">
      Per-segment critique with severity, likelyCorrect determination, and
      confidence scores.
    </p>
  </div>
);

interface EvaluationOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  listing: Listing;
  onStartEvaluation: (config: EvaluationConfig) => void;
  hasAudioBlob: boolean;
  /** Pre-select evaluation variant from header button */
  initialVariant?: "segments" | "regular";
}

export function EvaluationOverlay({
  isOpen,
  onClose,
  listing,
  onStartEvaluation,
  hasAudioBlob,
  initialVariant,
}: EvaluationOverlayProps) {
  const sourceType = listing.sourceType || "upload"; // Default to upload for backward compatibility
  const llm = useSettingsStore((state) => state.llm);
  const transcription = useSettingsStore((state) => state.transcription);
  const loadSchemas = useSchemasStore((state) => state.loadSchemas);
  const saveSchema = useSchemasStore((state) => state.saveSchema);
  const appId = useAppStore((state) => state.currentApp);

  // Access prompts directly from store state for reactivity
  const allPrompts = usePromptsStore((state) => state.prompts[appId] || []);
  const { loadPrompts } = useCurrentPromptsActions();
  const isOnline = useNetworkStatus();

  // Handle escape key
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, handleEscape]);

  // Get available prompts filtered by type (no sourceType filter - Phase 2)
  // Fixed: React to actual prompts data, not getter function reference
  const transcriptionPrompts = useMemo(
    () => allPrompts.filter((p) => p.promptType === "transcription"),
    [allPrompts],
  );
  const evaluationPrompts = useMemo(
    () => allPrompts.filter((p) => p.promptType === "evaluation"),
    [allPrompts],
  );

  // Phase 2: Start with empty prompts, no auto-selection
  const [transcriptionPrompt, setTranscriptionPrompt] = useState("");
  const [evaluationPrompt, setEvaluationPrompt] = useState("");

  // Selected prompt IDs for dropdowns
  const [selectedTranscriptionPromptId, setSelectedTranscriptionPromptId] =
    useState<string | null>(null);
  const [selectedEvaluationPromptId, setSelectedEvaluationPromptId] = useState<
    string | null
  >(null);

  // Tab state for wizard interface
  const [activeTab, setActiveTab] = useState<TabType>("prerequisites");

  // Persisted schema selection + transient schema drafts
  const [selectedTranscriptionSchema, setSelectedTranscriptionSchema] =
    useState<SchemaDefinition | null>(null);
  const [selectedEvaluationSchema, setSelectedEvaluationSchema] =
    useState<SchemaDefinition | null>(null);
  const [transientTranscriptionSchema, setTransientTranscriptionSchema] =
    useState<TransientSchemaDraft | null>(null);
  const [transientEvaluationSchema, setTransientEvaluationSchema] =
    useState<TransientSchemaDraft | null>(null);
  const [showTranscriptionSaveForm, setShowTranscriptionSaveForm] =
    useState(false);
  const [showEvaluationSaveForm, setShowEvaluationSaveForm] = useState(false);
  const [transcriptionSchemaName, setTranscriptionSchemaName] = useState("");
  const [evaluationSchemaName, setEvaluationSchemaName] = useState("");
  const [transcriptionSchemaDescription, setTranscriptionSchemaDescription] =
    useState("");
  const [evaluationSchemaDescription, setEvaluationSchemaDescription] =
    useState("");
  const [isSavingTranscriptionSchema, setIsSavingTranscriptionSchema] =
    useState(false);
  const [isSavingEvaluationSchema, setIsSavingEvaluationSchema] =
    useState(false);

  // Skip transcription state - reuse existing AI transcript
  const [skipTranscription, setSkipTranscription] = useState(false);
  const [showExistingTranscript, setShowExistingTranscript] = useState(false);

  // Preview overlay state
  const [showTranscriptionPreview, setShowTranscriptionPreview] =
    useState(false);
  const [showEvaluationPreview, setShowEvaluationPreview] = useState(false);

  // Schema modal state
  const [showTranscriptionSchemaModal, setShowTranscriptionSchemaModal] =
    useState(false);
  const [showEvaluationSchemaModal, setShowEvaluationSchemaModal] =
    useState(false);

  // Inline schema generator state
  const [showTranscriptionGenerator, setShowTranscriptionGenerator] =
    useState(false);
  const [showEvaluationGenerator, setShowEvaluationGenerator] = useState(false);

  // Inline schema builder state (field-based)
  const [transcriptionFields, setTranscriptionFields] = useState<
    EvaluatorOutputField[]
  >([]);
  const [evaluationFields, setEvaluationFields] = useState<
    EvaluatorOutputField[]
  >([]);
  const [showTranscriptionBuilder, setShowTranscriptionBuilder] =
    useState(false);
  const [showEvaluationBuilder, setShowEvaluationBuilder] = useState(false);

  // Use segments mode - controlled by initialVariant or auto-detected from listing
  const [useSegments, setUseSegments] = useState<boolean>(() => {
    if (initialVariant === "segments") return true;
    if (initialVariant === "regular") return false;
    // Auto-detect: use segments if upload flow has segments
    return (
      sourceType === "upload" && (listing.transcript?.segments?.length ?? 0) > 0
    );
  });

  // Prerequisites state (Step 1)
  const [selectedLanguage, setSelectedLanguage] = useState(
    transcription.languageHint || "Hindi",
  );
  const [sourceScript, setSourceScript] = useState("auto");
  const [targetScript, setTargetScript] = useState(
    transcription.scriptPreference === "devanagari" ? "devanagari" : "roman",
  );
  const [normalizationEnabled, setNormalizationEnabled] = useState(false);
  const [normalizationTarget, setNormalizationTarget] =
    useState<NormalizationTarget>("both");
  const [preserveCodeSwitching, setPreserveCodeSwitching] = useState(
    transcription.preserveCodeSwitching,
  );

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

      // Phase 2: Start with empty prompts - no auto-selection
      setTranscriptionPrompt("");
      setEvaluationPrompt("");
      setSkipTranscription(false);
      setShowExistingTranscript(false);
      setActiveTab("prerequisites"); // Reset to first tab (prerequisites)

      // Reset prerequisites state
      setSelectedLanguage(transcription.languageHint || "Hindi");
      setSourceScript("auto");
      setTargetScript(
        transcription.scriptPreference === "devanagari"
          ? "devanagari"
          : "roman",
      );
      setNormalizationEnabled(false);
      setNormalizationTarget("both");
      setPreserveCodeSwitching(transcription.preserveCodeSwitching);

      // Set useSegments based on initialVariant or auto-detect
      if (initialVariant === "segments") {
        setUseSegments(true);
      } else if (initialVariant === "regular") {
        setUseSegments(false);
      } else {
        // Auto-detect: use segments if upload flow has segments
        setUseSegments(
          sourceType === "upload" &&
            (listing.transcript?.segments?.length ?? 0) > 0,
        );
      }

      // Phase 1: reset schema state for fresh modal session
      setSelectedTranscriptionSchema(null);
      setSelectedEvaluationSchema(null);
      setTransientTranscriptionSchema(null);
      setTransientEvaluationSchema(null);
      setShowTranscriptionSaveForm(false);
      setShowEvaluationSaveForm(false);
      setTranscriptionSchemaName("");
      setEvaluationSchemaName("");
      setTranscriptionSchemaDescription("");
      setEvaluationSchemaDescription("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]); // ONLY run when modal opens/closes

  // Build variable context
  const variableContext: VariableContext = useMemo(
    () => ({
      listing,
      aiEval: listing.aiEval,
      audioBlob: hasAudioBlob ? new Blob() : undefined, // Just for availability check
    }),
    [listing, hasAudioBlob],
  );

  const availableDataKeys = useMemo(
    () => getAvailableDataKeys(variableContext),
    [variableContext],
  );

  // Validate transcription prompt (Phase 2: No sourceType filtering)
  const transcriptionValidation = useMemo(
    () =>
      validatePromptVariables(
        transcriptionPrompt,
        "transcription",
        availableDataKeys,
      ),
    [transcriptionPrompt, availableDataKeys],
  );

  // Validate evaluation prompt (note: {{llm_transcript}} will be available after Call 1)
  const evaluationValidation = useMemo(() => {
    // For evaluation prompt, {{llm_transcript}} will be computed during eval
    const evalDataKeys = new Set(availableDataKeys);
    evalDataKeys.add("{{llm_transcript}}"); // Will be available after Call 1
    return validatePromptVariables(
      evaluationPrompt,
      "evaluation",
      evalDataKeys,
    );
  }, [evaluationPrompt, availableDataKeys]);

  // Check if we can run evaluation (Phase 2: Simplified validation - only API key & audio)
  const canRun = useMemo(() => {
    const baseValid =
      isOnline && llm.apiKey && hasAudioBlob && listing.transcript;

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
      evaluationValidation.unknownVariables.length === 0
    );
  }, [
    isOnline,
    llm.apiKey,
    hasAudioBlob,
    listing.transcript,
    skipTranscription,
    existingAITranscript,
    transcriptionValidation,
    evaluationValidation,
  ]);

  // Collect all validation errors for display (Phase 2: Simplified - only base checks)
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!isOnline) errors.push("No network connection");
    if (!llm.apiKey) errors.push("API key not configured");
    if (!hasAudioBlob) errors.push("Audio file not loaded");
    if (!listing.transcript) errors.push("Original transcript required");

    if (skipTranscription) {
      // Only check evaluation prompt when skipping
      if (!existingAITranscript) {
        errors.push("No existing AI transcript available to reuse");
      }
      if (evaluationValidation.unknownVariables.length > 0) {
        errors.push(
          `Unknown variables in evaluation prompt: ${evaluationValidation.unknownVariables.join(", ")}`,
        );
      }
    } else {
      // Full validation when running transcription
      if (transcriptionValidation.unknownVariables.length > 0) {
        errors.push(
          `Unknown variables in transcription prompt: ${transcriptionValidation.unknownVariables.join(", ")}`,
        );
      }
      if (evaluationValidation.unknownVariables.length > 0) {
        errors.push(
          `Unknown variables in evaluation prompt: ${evaluationValidation.unknownVariables.join(", ")}`,
        );
      }
    }
    return errors;
  }, [
    isOnline,
    llm.apiKey,
    hasAudioBlob,
    listing.transcript,
    skipTranscription,
    existingAITranscript,
    transcriptionValidation,
    evaluationValidation,
  ]);

  const handleInsertVariable = useCallback(
    (
      variable: string,
      ref: React.RefObject<HTMLTextAreaElement | null>,
      setter: (v: string) => void,
    ) => {
      const textarea = ref.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentValue = textarea.value;
      const newValue =
        currentValue.substring(0, start) +
        variable +
        currentValue.substring(end);
      setter(newValue);

      // Restore cursor position after the inserted variable
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(
          start + variable.length,
          start + variable.length,
        );
      }, 0);
    },
    [],
  );

  // Phase 1: derive applies transient schema only
  const handleDeriveTranscriptionSchema = useCallback(() => {
    if (!listing.apiResponse) {
      notificationService.error(
        "No API response available to derive schema from",
      );
      return;
    }

    try {
      const derivedSchema = deriveSchemaFromApiResponse(
        listing.apiResponse as unknown as Record<string, unknown>,
      );
      if (!derivedSchema) {
        notificationService.error("Could not derive schema from API response");
        return;
      }

      setSelectedTranscriptionSchema(null);
      setTransientTranscriptionSchema({
        schema: derivedSchema,
        source: "derived",
      });
      setShowTranscriptionSaveForm(false);
      setTranscriptionSchemaName("Derived Transcription Schema");
      setTranscriptionSchemaDescription("Derived from API structured output");
      notificationService.success("Derived schema applied for this run");
    } catch (err) {
      console.error("Failed to derive schema:", err);
      notificationService.error(
        "Failed to derive schema from structured output",
      );
    }
  }, [listing.apiResponse]);

  const handleDeriveEvaluationSchema = useCallback(() => {
    if (!listing.apiResponse) {
      notificationService.error(
        "No API response available to derive schema from",
      );
      return;
    }

    try {
      const derivedSchema = deriveSchemaFromApiResponse(
        listing.apiResponse as unknown as Record<string, unknown>,
      );
      if (!derivedSchema) {
        notificationService.error("Could not derive schema from API response");
        return;
      }

      setSelectedEvaluationSchema(null);
      setTransientEvaluationSchema({
        schema: derivedSchema,
        source: "derived",
      });
      setShowEvaluationSaveForm(false);
      setEvaluationSchemaName("Derived Evaluation Schema");
      setEvaluationSchemaDescription("Derived from API structured output");
      notificationService.success("Derived schema applied for this run");
    } catch (err) {
      console.error("Failed to derive schema:", err);
      notificationService.error(
        "Failed to derive schema from structured output",
      );
    }
  }, [listing.apiResponse]);

  // Handle schema modal close with callback to set newly created schema
  const handleTranscriptionSchemaModalClose = useCallback(() => {
    setShowTranscriptionSchemaModal(false);
    // Reload schemas to get the newly created one
    loadSchemas(appId);
  }, [loadSchemas, appId]);

  const handleEvaluationSchemaModalClose = useCallback(() => {
    setShowEvaluationSchemaModal(false);
    // Reload schemas to get the newly created one
    loadSchemas(appId);
  }, [loadSchemas, appId]);

  // Handle inline schema generator callbacks
  const handleTranscriptionSchemaGenerated = useCallback(
    (schema: Record<string, unknown>, name: string) => {
      setSelectedTranscriptionSchema(null);
      setTransientTranscriptionSchema({ schema, source: "generated" });
      setShowTranscriptionGenerator(false);
      setShowTranscriptionSaveForm(false);
      setTranscriptionSchemaName(
        name.trim() || "Generated Transcription Schema",
      );
      setTranscriptionSchemaDescription("AI-generated schema");
      notificationService.success("Generated schema applied for this run");
    },
    [],
  );

  const handleEvaluationSchemaGenerated = useCallback(
    (schema: Record<string, unknown>, name: string) => {
      setSelectedEvaluationSchema(null);
      setTransientEvaluationSchema({ schema, source: "generated" });
      setShowEvaluationGenerator(false);
      setShowEvaluationSaveForm(false);
      setEvaluationSchemaName(name.trim() || "Generated Evaluation Schema");
      setEvaluationSchemaDescription("AI-generated schema");
      notificationService.success("Generated schema applied for this run");
    },
    [],
  );

  // Handle inline schema builder save
  const handleSaveTranscriptionFields = useCallback(() => {
    if (transcriptionFields.length === 0) {
      notificationService.error("Add at least one field");
      return;
    }

    const hasEmptyKeys = transcriptionFields.some((f) => !f.key.trim());
    if (hasEmptyKeys) {
      notificationService.error("All fields must have a key name");
      return;
    }

    const jsonSchema = generateJsonSchema(transcriptionFields);
    setSelectedTranscriptionSchema(null);
    setTransientTranscriptionSchema({
      schema: jsonSchema as Record<string, unknown>,
      source: "visual",
    });
    setShowTranscriptionBuilder(false);
    setTranscriptionFields([]);
    setShowTranscriptionSaveForm(false);
    setTranscriptionSchemaName("Visual Transcription Schema");
    setTranscriptionSchemaDescription("Built visually in evaluation flow");
    notificationService.success("Visual schema applied for this run");
  }, [transcriptionFields]);

  const handleSaveEvaluationFields = useCallback(() => {
    if (evaluationFields.length === 0) {
      notificationService.error("Add at least one field");
      return;
    }

    const hasEmptyKeys = evaluationFields.some((f) => !f.key.trim());
    if (hasEmptyKeys) {
      notificationService.error("All fields must have a key name");
      return;
    }

    const jsonSchema = generateJsonSchema(evaluationFields);
    setSelectedEvaluationSchema(null);
    setTransientEvaluationSchema({
      schema: jsonSchema as Record<string, unknown>,
      source: "visual",
    });
    setShowEvaluationBuilder(false);
    setEvaluationFields([]);
    setShowEvaluationSaveForm(false);
    setEvaluationSchemaName("Visual Evaluation Schema");
    setEvaluationSchemaDescription("Built visually in evaluation flow");
    notificationService.success("Visual schema applied for this run");
  }, [evaluationFields]);

  const handleSaveTransientTranscriptionSchema = useCallback(async () => {
    if (!transientTranscriptionSchema) {
      return;
    }

    const trimmedName = transcriptionSchemaName.trim();
    if (!trimmedName) {
      notificationService.error("Schema name is required");
      return;
    }

    setIsSavingTranscriptionSchema(true);
    try {
      const savedSchema = await saveSchema(appId, {
        name: trimmedName,
        promptType: "transcription",
        schema: transientTranscriptionSchema.schema,
        description: transcriptionSchemaDescription.trim() || undefined,
      });
      setSelectedTranscriptionSchema(savedSchema);
      setTransientTranscriptionSchema(null);
      setShowTranscriptionSaveForm(false);
      notificationService.success("Schema saved to library");
    } catch (err) {
      console.error("Failed to save schema:", err);
      notificationService.error("Failed to save schema");
    } finally {
      setIsSavingTranscriptionSchema(false);
    }
  }, [
    transientTranscriptionSchema,
    transcriptionSchemaName,
    transcriptionSchemaDescription,
    saveSchema,
    appId,
  ]);

  const handleSaveTransientEvaluationSchema = useCallback(async () => {
    if (!transientEvaluationSchema) {
      return;
    }

    const trimmedName = evaluationSchemaName.trim();
    if (!trimmedName) {
      notificationService.error("Schema name is required");
      return;
    }

    setIsSavingEvaluationSchema(true);
    try {
      const savedSchema = await saveSchema(appId, {
        name: trimmedName,
        promptType: "evaluation",
        schema: transientEvaluationSchema.schema,
        description: evaluationSchemaDescription.trim() || undefined,
      });
      setSelectedEvaluationSchema(savedSchema);
      setTransientEvaluationSchema(null);
      setShowEvaluationSaveForm(false);
      notificationService.success("Schema saved to library");
    } catch (err) {
      console.error("Failed to save schema:", err);
      notificationService.error("Failed to save schema");
    } finally {
      setIsSavingEvaluationSchema(false);
    }
  }, [
    transientEvaluationSchema,
    evaluationSchemaName,
    evaluationSchemaDescription,
    saveSchema,
    appId,
  ]);

  // Handle prompt selection from dropdown
  const handleTranscriptionPromptSelect = useCallback(
    (promptId: string) => {
      setSelectedTranscriptionPromptId(promptId);
      const prompt = transcriptionPrompts.find((p) => p.id === promptId);
      if (prompt) {
        setTranscriptionPrompt(prompt.prompt);
      }
    },
    [transcriptionPrompts],
  );

  const handleEvaluationPromptSelect = useCallback(
    (promptId: string) => {
      setSelectedEvaluationPromptId(promptId);
      const prompt = evaluationPrompts.find((p) => p.id === promptId);
      if (prompt) {
        setEvaluationPrompt(prompt.prompt);
      }
    },
    [evaluationPrompts],
  );

  const effectiveTranscriptionSchema = useMemo<SchemaDefinition | null>(() => {
    if (selectedTranscriptionSchema) {
      return selectedTranscriptionSchema;
    }
    if (!transientTranscriptionSchema) {
      return null;
    }
    return {
      id: "__transient_transcription__",
      name: "Transient (this run only)",
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      promptType: "transcription",
      schema: transientTranscriptionSchema.schema,
      description: "Not saved to schema library",
    };
  }, [selectedTranscriptionSchema, transientTranscriptionSchema]);

  const effectiveEvaluationSchema = useMemo<SchemaDefinition | null>(() => {
    if (selectedEvaluationSchema) {
      return selectedEvaluationSchema;
    }
    if (!transientEvaluationSchema) {
      return null;
    }
    return {
      id: "__transient_evaluation__",
      name: "Transient (this run only)",
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      promptType: "evaluation",
      schema: transientEvaluationSchema.schema,
      description: "Not saved to schema library",
    };
  }, [selectedEvaluationSchema, transientEvaluationSchema]);

  const handleRun = useCallback(() => {
    // Sync normalizeOriginal with prerequisites normalization setting
    const shouldNormalize =
      normalizationEnabled &&
      (normalizationTarget === "original" || normalizationTarget === "both");

    onStartEvaluation({
      prompts: {
        transcription: transcriptionPrompt,
        evaluation: evaluationPrompt,
      },
      schemas: {
        transcription: effectiveTranscriptionSchema || undefined,
        evaluation: effectiveEvaluationSchema || undefined,
      },
      skipTranscription,
      normalizeOriginal: shouldNormalize,
      useSegments,
      // New prerequisites config for the unified pipeline
      prerequisites: {
        language: selectedLanguage,
        sourceScript,
        targetScript,
        normalizationEnabled,
        normalizationTarget,
        preserveCodeSwitching,
      },
    });
  }, [
    onStartEvaluation,
    transcriptionPrompt,
    evaluationPrompt,
    effectiveTranscriptionSchema,
    effectiveEvaluationSchema,
    skipTranscription,
    useSegments,
    normalizationEnabled,
    normalizationTarget,
    selectedLanguage,
    sourceScript,
    targetScript,
    preserveCodeSwitching,
  ]);

  // Status items for summary sidebar
  const statusItems = useMemo(() => {
    const segmentCount = listing.transcript?.segments?.length || 0;
    return [
      {
        label: "Network",
        ok: isOnline,
        detail: isOnline ? "Online" : "Offline",
        icon: isOnline ? Wifi : WifiOff,
      },
      {
        label: "API Key",
        ok: !!llm.apiKey,
        detail: llm.apiKey ? "Configured" : "Not set",
        icon: Key,
      },
      {
        label: "Audio",
        ok: hasAudioBlob,
        detail: hasAudioBlob ? "Loaded" : "Not loaded",
        icon: Music,
      },
      {
        label: "Transcript",
        ok: segmentCount > 0,
        detail: segmentCount > 0 ? `${segmentCount} segments` : "Not loaded",
        icon: FileCheck,
      },
    ];
  }, [
    isOnline,
    llm.apiKey,
    hasAudioBlob,
    listing.transcript?.segments?.length,
  ]);

  // Configuration summary for each step (Phase 2: Simplified error checking)
  const stepSummary = useMemo(
    () => ({
      prerequisites: {
        languageSet: !!selectedLanguage,
        normalizationEnabled,
        hasErrors: false, // Prerequisites are always valid
      },
      transcription: {
        promptConfigured: transcriptionPrompt.length > 0,
        schemaName: effectiveTranscriptionSchema?.name || "Not selected",
        isTransient:
          !selectedTranscriptionSchema && !!transientTranscriptionSchema,
        skip: skipTranscription,
        hasErrors:
          !skipTranscription &&
          transcriptionValidation.unknownVariables.length > 0,
      },
      evaluation: {
        promptConfigured: evaluationPrompt.length > 0,
        schemaName: effectiveEvaluationSchema?.name || "Not selected",
        isTransient: !selectedEvaluationSchema && !!transientEvaluationSchema,
        hasErrors: evaluationValidation.unknownVariables.length > 0,
      },
    }),
    [
      selectedLanguage,
      normalizationEnabled,
      transcriptionPrompt,
      evaluationPrompt,
      effectiveTranscriptionSchema,
      effectiveEvaluationSchema,
      selectedTranscriptionSchema,
      transientTranscriptionSchema,
      selectedEvaluationSchema,
      transientEvaluationSchema,
      skipTranscription,
      transcriptionValidation,
      evaluationValidation,
    ],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop - not clickable */}
      <div
        className={cn(
          "absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Slide-in panel */}
      <div
        className={cn(
          "ml-auto relative z-10 h-full w-[85vw] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            AI Evaluation
          </h2>
          <button
            onClick={onClose}
            className="rounded-[6px] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col min-h-0 h-full">
            {/* Main content: Tabs + Sidebar */}
            <div className="flex gap-4 min-h-0 flex-1">
              {/* Left: Tab content area */}
              <div className="flex-1 flex flex-col min-h-0 min-w-0">
                {/* Tab Navigation */}
                <div className="flex border-b border-[var(--border-default)] mb-4 shrink-0">
                  {/* Prerequisites Tab */}
                  <button
                    type="button"
                    onClick={() => setActiveTab("prerequisites")}
                    className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                      activeTab === "prerequisites"
                        ? "border-[var(--color-brand-primary)] text-[var(--color-brand-primary)]"
                        : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold ${
                        activeTab === "prerequisites"
                          ? "bg-[var(--color-brand-primary)] text-white"
                          : "bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                      }`}
                    >
                      1
                    </span>
                    Prerequisites
                    {stepSummary.prerequisites.normalizationEnabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]">
                        Norm
                      </span>
                    )}
                  </button>
                  {/* Transcription Tab */}
                  <button
                    type="button"
                    onClick={() => setActiveTab("transcription")}
                    className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                      activeTab === "transcription"
                        ? "border-[var(--color-brand-primary)] text-[var(--color-brand-primary)]"
                        : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold ${
                        activeTab === "transcription"
                          ? "bg-[var(--color-brand-primary)] text-white"
                          : "bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                      }`}
                    >
                      2
                    </span>
                    Transcription
                    {stepSummary.transcription.skip && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                        Skip
                      </span>
                    )}
                    {stepSummary.transcription.hasErrors &&
                      !stepSummary.transcription.skip && (
                        <AlertCircle className="h-3.5 w-3.5 text-[var(--color-error)]" />
                      )}
                  </button>
                  {/* Evaluation Tab */}
                  <button
                    type="button"
                    onClick={() => setActiveTab("evaluation")}
                    className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                      activeTab === "evaluation"
                        ? "border-[var(--color-brand-primary)] text-[var(--color-brand-primary)]"
                        : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold ${
                        activeTab === "evaluation"
                          ? "bg-[var(--color-brand-primary)] text-white"
                          : "bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                      }`}
                    >
                      3
                    </span>
                    Evaluation
                    {stepSummary.evaluation.hasErrors && (
                      <AlertCircle className="h-3.5 w-3.5 text-[var(--color-error)]" />
                    )}
                  </button>
                </div>

                {/* Tab Content - Scrollable */}
                <div className="flex-1 overflow-y-auto pr-2 min-h-0">
                  {/* Prerequisites Tab */}
                  {activeTab === "prerequisites" && (
                    <div className="space-y-6">
                      {/* Header */}
                      <div className="flex items-center gap-2">
                        <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
                          Prerequisites
                        </h3>
                        <Tooltip
                          content={PREREQUISITES_TOOLTIP}
                          position="bottom"
                          maxWidth={360}
                        >
                          <Info className="h-4 w-4 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-help" />
                        </Tooltip>
                      </div>

                      {/* Language & Script Section */}
                      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                        <h4 className="text-[13px] font-medium text-[var(--text-primary)] mb-4">
                          Language & Script
                        </h4>
                        <div className="grid grid-cols-3 gap-4">
                          {/* Source Language */}
                          <div>
                            <label className="block text-[12px] font-medium text-[var(--text-muted)] mb-1.5">
                              Source Language *
                            </label>
                            <select
                              value={selectedLanguage}
                              onChange={(e) =>
                                setSelectedLanguage(e.target.value)
                              }
                              className="w-full h-9 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50"
                            >
                              {SUPPORTED_LANGUAGES.map((lang) => (
                                <option key={lang.value} value={lang.value}>
                                  {lang.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          {/* Source Script */}
                          <div>
                            <label className="block text-[12px] font-medium text-[var(--text-muted)] mb-1.5">
                              Source Script
                            </label>
                            <select
                              value={sourceScript}
                              onChange={(e) => setSourceScript(e.target.value)}
                              className="w-full h-9 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50"
                            >
                              {SCRIPT_OPTIONS.map((script) => (
                                <option key={script.value} value={script.value}>
                                  {script.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          {/* Target Script */}
                          <div>
                            <label className="block text-[12px] font-medium text-[var(--text-muted)] mb-1.5">
                              Target/Output Script *
                            </label>
                            <select
                              value={targetScript}
                              onChange={(e) => setTargetScript(e.target.value)}
                              className="w-full h-9 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50"
                            >
                              {TARGET_SCRIPT_OPTIONS.map((script) => (
                                <option key={script.value} value={script.value}>
                                  {script.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Normalization Section */}
                      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            id="normalization-enabled"
                            checked={normalizationEnabled}
                            onChange={(e) =>
                              setNormalizationEnabled(e.target.checked)
                            }
                            className="mt-0.5 h-4 w-4 rounded border-[var(--border-default)] text-[var(--color-brand-primary)] focus:ring-[var(--color-brand-accent)]"
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="normalization-enabled"
                              className="block text-[13px] font-medium text-[var(--text-primary)] cursor-pointer"
                            >
                              Enable Normalization
                            </label>
                            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                              Transliterate transcripts to target script before
                              comparison
                            </p>
                          </div>
                        </div>

                        {normalizationEnabled && (
                          <div className="mt-4 pl-7 space-y-4">
                            <div>
                              <label className="block text-[12px] font-medium text-[var(--text-muted)] mb-2">
                                Apply normalization to:
                              </label>
                              <div className="space-y-2">
                                {NORMALIZATION_TARGET_OPTIONS.map((option) => (
                                  <label
                                    key={option.value}
                                    className="flex items-start gap-2.5 cursor-pointer"
                                  >
                                    <input
                                      type="radio"
                                      name="normalization-target"
                                      value={option.value}
                                      checked={
                                        normalizationTarget === option.value
                                      }
                                      onChange={(e) =>
                                        setNormalizationTarget(
                                          e.target.value as NormalizationTarget,
                                        )
                                      }
                                      className="mt-0.5 h-4 w-4 border-[var(--border-default)] text-[var(--color-brand-primary)] focus:ring-[var(--color-brand-accent)]"
                                    />
                                    <div>
                                      <span className="text-[12px] font-medium text-[var(--text-primary)]">
                                        {option.label}
                                      </span>
                                      <span className="block text-[11px] text-[var(--text-muted)]">
                                        {option.description}
                                      </span>
                                    </div>
                                  </label>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Additional Options */}
                      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                        <h4 className="text-[13px] font-medium text-[var(--text-primary)] mb-3">
                          Additional Options
                        </h4>
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={preserveCodeSwitching}
                            onChange={(e) =>
                              setPreserveCodeSwitching(e.target.checked)
                            }
                            className="mt-0.5 h-4 w-4 rounded border-[var(--border-default)] text-[var(--color-brand-primary)] focus:ring-[var(--color-brand-accent)]"
                          />
                          <div>
                            <span className="text-[12px] font-medium text-[var(--text-primary)]">
                              Preserve code-switching
                            </span>
                            <span className="block text-[11px] text-[var(--text-muted)]">
                              Maintain language mixing (e.g., Hinglish) in
                              output
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Transcription Tab */}
                  {activeTab === "transcription" && (
                    <div className="space-y-4">
                      {/* Header with info and preview */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
                            AI Transcription Prompt
                          </h3>
                          <Tooltip
                            content={STEP1_TOOLTIP}
                            position="bottom"
                            maxWidth={360}
                          >
                            <Info className="h-4 w-4 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-help" />
                          </Tooltip>
                        </div>
                        <button
                          onClick={() => setShowTranscriptionPreview(true)}
                          disabled={skipTranscription || !transcriptionPrompt}
                          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          title="Preview prompt"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Skip Transcription Option */}
                      {existingTranscriptMeta && (
                        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                          <label className="flex items-center gap-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={skipTranscription}
                              onChange={(e) =>
                                setSkipTranscription(e.target.checked)
                              }
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
                                  {new Date(
                                    existingTranscriptMeta.createdAt,
                                  ).toLocaleDateString()}
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
                                  setShowExistingTranscript(
                                    !showExistingTranscript,
                                  );
                                }}
                                className="shrink-0 text-[11px] text-[var(--color-brand-primary)] hover:underline flex items-center gap-0.5"
                              >
                                {showExistingTranscript ? (
                                  <ChevronDown className="h-3 w-3" />
                                ) : (
                                  <ChevronRight className="h-3 w-3" />
                                )}
                                {showExistingTranscript ? "Hide" : "View"}
                              </button>
                            )}
                          </label>

                          {/* Existing transcript preview */}
                          {skipTranscription &&
                            showExistingTranscript &&
                            existingAITranscript && (
                              <div className="mt-3 max-h-[180px] overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                                <div className="space-y-1.5 text-[11px] font-mono">
                                  {existingAITranscript.segments.map(
                                    (seg, idx) => (
                                      <div key={idx} className="flex gap-2">
                                        <span className="shrink-0 text-[var(--text-muted)] w-5">
                                          {idx + 1}.
                                        </span>
                                        <span className="text-[var(--color-brand-primary)] shrink-0">
                                          [{seg.speaker}]
                                        </span>
                                        <span className="text-[var(--text-primary)]">
                                          {seg.text}
                                        </span>
                                      </div>
                                    ),
                                  )}
                                </div>
                              </div>
                            )}
                        </div>
                      )}

                      {/* Prompt Editor */}
                      <div
                        className={
                          skipTranscription
                            ? "opacity-40 pointer-events-none"
                            : ""
                        }
                      >
                        {/* Prompt Selector */}
                        {transcriptionPrompts.length > 0 && (
                          <div className="mb-3">
                            <PromptSelector
                              prompts={transcriptionPrompts}
                              selectedId={selectedTranscriptionPromptId}
                              onSelect={handleTranscriptionPromptSelect}
                              label="Prompt Template"
                              disabled={skipTranscription}
                            />
                          </div>
                        )}

                        <textarea
                          ref={transcriptionRef}
                          value={transcriptionPrompt}
                          onChange={(e) =>
                            setTranscriptionPrompt(e.target.value)
                          }
                          disabled={skipTranscription}
                          placeholder="Select a prompt or write your own..."
                          className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-[13px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none h-[280px] disabled:bg-[var(--bg-secondary)] disabled:cursor-not-allowed"
                        />

                        {/* Variables Section */}
                        <div className="mt-4">
                          <VariablePickerPopover
                            listing={listing}
                            promptType="transcription"
                            onInsert={(v) =>
                              handleInsertVariable(
                                v,
                                transcriptionRef,
                                setTranscriptionPrompt,
                              )
                            }
                          />
                        </div>

                        {/* Schema Section - Flat */}
                        <div className="mt-4 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleDeriveTranscriptionSchema}
                              disabled={
                                !(sourceType === "api" && !!listing.apiResponse)
                              }
                              className="h-8 gap-1.5 text-[11px]"
                            >
                              Derive from Structured Output
                            </Button>
                          </div>
                          <SchemaSelector
                            promptType="transcription"
                            value={selectedTranscriptionSchema}
                            onChange={setSelectedTranscriptionSchema}
                            label="Output Schema"
                            showPreview
                            compact
                            generatorSlot={
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setShowTranscriptionSchemaModal(true)
                                }
                                className="h-8 gap-1.5"
                                title="Create new schema"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Create
                              </Button>
                            }
                          />

                          {transientTranscriptionSchema && (
                            <div className="rounded-md border border-[var(--color-brand-primary)]/30 bg-[var(--color-brand-accent)]/10 p-3 space-y-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-[11px] text-[var(--text-secondary)]">
                                  Using transient schema for this run (
                                  {transientTranscriptionSchema.source})
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setShowTranscriptionSaveForm(
                                      (prev) => !prev,
                                    )
                                  }
                                  className="h-7 gap-1 text-[11px]"
                                >
                                  <Save className="h-3.5 w-3.5" />
                                  Save to Library
                                </Button>
                              </div>

                              {showTranscriptionSaveForm && (
                                <div className="space-y-2">
                                  <input
                                    value={transcriptionSchemaName}
                                    onChange={(e) =>
                                      setTranscriptionSchemaName(e.target.value)
                                    }
                                    placeholder="Schema name"
                                    className="w-full h-8 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-[12px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none"
                                  />
                                  <textarea
                                    value={transcriptionSchemaDescription}
                                    onChange={(e) =>
                                      setTranscriptionSchemaDescription(
                                        e.target.value,
                                      )
                                    }
                                    placeholder="Description (optional)"
                                    rows={2}
                                    className="w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-2 text-[12px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none resize-none"
                                  />
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        setShowTranscriptionSaveForm(false)
                                      }
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={
                                        handleSaveTransientTranscriptionSchema
                                      }
                                      isLoading={isSavingTranscriptionSchema}
                                      disabled={
                                        isSavingTranscriptionSchema ||
                                        !transcriptionSchemaName.trim()
                                      }
                                    >
                                      Save
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Inline AI Schema Generator */}
                          <SchemaGeneratorInline
                            promptType="transcription"
                            isExpanded={showTranscriptionGenerator}
                            onToggle={() =>
                              setShowTranscriptionGenerator(
                                !showTranscriptionGenerator,
                              )
                            }
                            onSchemaGenerated={
                              handleTranscriptionSchemaGenerated
                            }
                          />

                          {/* Inline Field-Based Schema Builder */}
                          {!showTranscriptionBuilder ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowTranscriptionBuilder(true)}
                              className="gap-1.5 text-[11px]"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Build Schema Visually
                            </Button>
                          ) : (
                            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                              <InlineSchemaBuilder
                                fields={transcriptionFields}
                                onChange={setTranscriptionFields}
                              />
                              <div className="flex justify-end gap-2 mt-4">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setShowTranscriptionBuilder(false);
                                    setTranscriptionFields([]);
                                  }}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={handleSaveTranscriptionFields}
                                  disabled={transcriptionFields.length === 0}
                                >
                                  Save Schema
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Evaluation Tab */}
                  {activeTab === "evaluation" && (
                    <div className="space-y-4">
                      {/* Header with info and preview */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
                            LLM-as-Judge Evaluation Prompt
                          </h3>
                          <Tooltip
                            content={STEP2_TOOLTIP}
                            position="bottom"
                            maxWidth={360}
                          >
                            <Info className="h-4 w-4 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-help" />
                          </Tooltip>
                        </div>
                        <button
                          onClick={() => setShowEvaluationPreview(true)}
                          disabled={!evaluationPrompt}
                          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          title="Preview prompt"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Prompt Selector */}
                      {evaluationPrompts.length > 0 && (
                        <div className="mb-3">
                          <PromptSelector
                            prompts={evaluationPrompts}
                            selectedId={selectedEvaluationPromptId}
                            onSelect={handleEvaluationPromptSelect}
                            label="Prompt Template"
                          />
                        </div>
                      )}

                      {/* Prompt Editor */}
                      <textarea
                        ref={evaluationRef}
                        value={evaluationPrompt}
                        onChange={(e) => setEvaluationPrompt(e.target.value)}
                        placeholder="Select a prompt or write your own..."
                        className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-[13px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none h-[280px]"
                      />

                      {/* Variables Section */}
                      <div className="mt-4">
                        <VariablePickerPopover
                          listing={listing}
                          promptType="evaluation"
                          onInsert={(v) =>
                            handleInsertVariable(
                              v,
                              evaluationRef,
                              setEvaluationPrompt,
                            )
                          }
                        />
                      </div>

                      {/* Schema Section - Flat */}
                      <div className="mt-4 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleDeriveEvaluationSchema}
                            disabled={
                              !(sourceType === "api" && !!listing.apiResponse)
                            }
                            className="h-8 gap-1.5 text-[11px]"
                          >
                            Derive from Structured Output
                          </Button>
                        </div>
                        <SchemaSelector
                          promptType="evaluation"
                          value={selectedEvaluationSchema}
                          onChange={setSelectedEvaluationSchema}
                          label="Output Schema"
                          showPreview
                          compact
                          generatorSlot={
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowEvaluationSchemaModal(true)}
                              className="h-8 gap-1.5"
                              title="Create new schema"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Create
                            </Button>
                          }
                        />

                        {transientEvaluationSchema && (
                          <div className="rounded-md border border-[var(--color-brand-primary)]/30 bg-[var(--color-brand-accent)]/10 p-3 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-[11px] text-[var(--text-secondary)]">
                                Using transient schema for this run (
                                {transientEvaluationSchema.source})
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setShowEvaluationSaveForm((prev) => !prev)
                                }
                                className="h-7 gap-1 text-[11px]"
                              >
                                <Save className="h-3.5 w-3.5" />
                                Save to Library
                              </Button>
                            </div>

                            {showEvaluationSaveForm && (
                              <div className="space-y-2">
                                <input
                                  value={evaluationSchemaName}
                                  onChange={(e) =>
                                    setEvaluationSchemaName(e.target.value)
                                  }
                                  placeholder="Schema name"
                                  className="w-full h-8 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-[12px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none"
                                />
                                <textarea
                                  value={evaluationSchemaDescription}
                                  onChange={(e) =>
                                    setEvaluationSchemaDescription(
                                      e.target.value,
                                    )
                                  }
                                  placeholder="Description (optional)"
                                  rows={2}
                                  className="w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-2 text-[12px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none resize-none"
                                />
                                <div className="flex justify-end gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      setShowEvaluationSaveForm(false)
                                    }
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={
                                      handleSaveTransientEvaluationSchema
                                    }
                                    isLoading={isSavingEvaluationSchema}
                                    disabled={
                                      isSavingEvaluationSchema ||
                                      !evaluationSchemaName.trim()
                                    }
                                  >
                                    Save
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Inline AI Schema Generator */}
                        <SchemaGeneratorInline
                          promptType="evaluation"
                          isExpanded={showEvaluationGenerator}
                          onToggle={() =>
                            setShowEvaluationGenerator(!showEvaluationGenerator)
                          }
                          onSchemaGenerated={handleEvaluationSchemaGenerated}
                        />

                        {/* Inline Field-Based Schema Builder */}
                        {!showEvaluationBuilder ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowEvaluationBuilder(true)}
                            className="gap-1.5 text-[11px]"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Build Schema Visually
                          </Button>
                        ) : (
                          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                            <InlineSchemaBuilder
                              fields={evaluationFields}
                              onChange={setEvaluationFields}
                            />
                            <div className="flex justify-end gap-2 mt-4">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setShowEvaluationBuilder(false);
                                  setEvaluationFields([]);
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={handleSaveEvaluationFields}
                                disabled={evaluationFields.length === 0}
                              >
                                Save Schema
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
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
                      {/* Step 1 Summary - Prerequisites */}
                      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-semibold bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                            1
                          </span>
                          <span className="text-[12px] font-medium text-[var(--text-primary)]">
                            Prerequisites
                          </span>
                          <Check className="ml-auto h-3.5 w-3.5 text-[var(--color-success)]" />
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] space-y-1 pl-6">
                          <div className="flex items-center justify-between">
                            <span>Language</span>
                            <span className="text-[var(--text-secondary)]">
                              {selectedLanguage}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Normalization</span>
                            <span
                              className={
                                normalizationEnabled
                                  ? "text-[var(--color-brand-primary)]"
                                  : "text-[var(--text-muted)]"
                              }
                            >
                              {normalizationEnabled ? "Enabled" : "Off"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Step 2 Summary - Transcription */}
                      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-semibold bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                            2
                          </span>
                          <span className="text-[12px] font-medium text-[var(--text-primary)]">
                            Transcription
                          </span>
                          {stepSummary.transcription.skip ? (
                            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-warning-light)] text-[var(--color-warning)]">
                              Skip
                            </span>
                          ) : stepSummary.transcription.hasErrors ? (
                            <X className="ml-auto h-3.5 w-3.5 text-[var(--color-error)]" />
                          ) : (
                            <Check className="ml-auto h-3.5 w-3.5 text-[var(--color-success)]" />
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] space-y-1 pl-6">
                          <div className="flex items-center justify-between">
                            <span>Prompt</span>
                            <span
                              className={
                                stepSummary.transcription.promptConfigured
                                  ? "text-[var(--text-secondary)]"
                                  : "text-[var(--color-warning)]"
                              }
                            >
                              {stepSummary.transcription.promptConfigured
                                ? "✓ Set"
                                : "Empty"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Schema</span>
                            <span
                              className="text-[var(--text-secondary)] truncate max-w-[80px]"
                              title={stepSummary.transcription.schemaName}
                            >
                              {stepSummary.transcription.schemaName}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Step 3 Summary - Evaluation */}
                      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-semibold bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                            3
                          </span>
                          <span className="text-[12px] font-medium text-[var(--text-primary)]">
                            Evaluation
                          </span>
                          {stepSummary.evaluation.hasErrors ? (
                            <X className="ml-auto h-3.5 w-3.5 text-[var(--color-error)]" />
                          ) : (
                            <Check className="ml-auto h-3.5 w-3.5 text-[var(--color-success)]" />
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] space-y-1 pl-6">
                          <div className="flex items-center justify-between">
                            <span>Prompt</span>
                            <span
                              className={
                                stepSummary.evaluation.promptConfigured
                                  ? "text-[var(--text-secondary)]"
                                  : "text-[var(--color-warning)]"
                              }
                            >
                              {stepSummary.evaluation.promptConfigured
                                ? "✓ Set"
                                : "Empty"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Schema</span>
                            <span
                              className="text-[var(--text-secondary)] truncate max-w-[80px]"
                              title={stepSummary.evaluation.schemaName}
                            >
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
                        <div
                          key={item.label}
                          className="flex items-center gap-2 text-[12px]"
                        >
                          <item.icon
                            className={`h-3.5 w-3.5 ${item.ok ? "text-[var(--color-success)]" : "text-[var(--color-error)]"}`}
                          />
                          <span className="text-[var(--text-muted)]">
                            {item.label}
                          </span>
                          <span
                            className={`ml-auto ${item.ok ? "text-[var(--text-secondary)]" : "text-[var(--color-error)]"}`}
                          >
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
          </div>
        </div>

        {/* Fixed Footer with Navigation */}
        <div className="shrink-0 flex justify-between px-6 py-4 border-t border-[var(--border-subtle)]">
          <div>
            {activeTab !== "prerequisites" && (
              <Button
                variant="ghost"
                onClick={() => {
                  if (activeTab === "transcription")
                    setActiveTab("prerequisites");
                  if (activeTab === "evaluation") setActiveTab("transcription");
                }}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {activeTab === "evaluation" ? (
              <Button onClick={handleRun} disabled={!canRun} className="gap-2">
                <Play className="h-4 w-4" />
                Run Evaluation
              </Button>
            ) : (
              <Button
                onClick={() => {
                  if (activeTab === "prerequisites")
                    setActiveTab("transcription");
                  if (activeTab === "transcription") setActiveTab("evaluation");
                }}
                className="gap-2"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Preview Overlays */}
      <EvaluationPreviewOverlay
        isOpen={showTranscriptionPreview}
        onClose={() => setShowTranscriptionPreview(false)}
        title="Transcription Prompt Preview"
        prompt={transcriptionPrompt}
        schema={effectiveTranscriptionSchema}
        listing={listing}
        promptType="transcription"
        hasAudioBlob={hasAudioBlob}
        transcriptionPreferences={{
          languageHint: selectedLanguage,
          scriptPreference:
            targetScript === "devanagari" ? "devanagari" : "romanized",
          preserveCodeSwitching,
        }}
      />
      <EvaluationPreviewOverlay
        isOpen={showEvaluationPreview}
        onClose={() => setShowEvaluationPreview(false)}
        title="Evaluation Prompt Preview"
        prompt={evaluationPrompt}
        schema={effectiveEvaluationSchema}
        listing={listing}
        promptType="evaluation"
        hasAudioBlob={hasAudioBlob}
        transcriptionPreferences={{
          languageHint: selectedLanguage,
          scriptPreference:
            targetScript === "devanagari" ? "devanagari" : "romanized",
          preserveCodeSwitching,
        }}
      />

      {/* Schema Creation Modals */}
      <SchemaModal
        isOpen={showTranscriptionSchemaModal}
        onClose={handleTranscriptionSchemaModalClose}
        promptType="transcription"
        initialSchema={null}
      />
      <SchemaModal
        isOpen={showEvaluationSchemaModal}
        onClose={handleEvaluationSchemaModalClose}
        promptType="evaluation"
        initialSchema={null}
      />
    </div>
  );
}
