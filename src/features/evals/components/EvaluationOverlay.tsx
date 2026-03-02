import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Play,
  AlertCircle,
  Info,
  Check,
  X,
  Wifi,
  WifiOff,
  Key,
  Music,
  FileCheck,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import {
  Button,
  Badge,
  SearchableSelect,
  LLMConfigSection,
} from "@/components/ui";
import type { SearchableSelectOption } from "@/components/ui";
import { cn } from "@/utils";
import {
  LANGUAGES,
  findLanguage,
  getLanguageLabel,
} from "@/constants/languages";
import { SCRIPTS } from "@/constants/scripts";
import { ModelSelector } from "@/features/settings/components/ModelSelector";
import { useLLMSettingsStore, getProviderApiKey, hasProviderCredentials, LLM_PROVIDERS } from "@/stores";
import type { LLMProvider } from "@/types";
import { useNetworkStatus } from "@/hooks";
import type {
  Listing,
  AIEvaluation,
  NormalizationTarget,
} from "@/types";
import { schemasRepository } from "@/services/api/schemasApi";
import { notificationService } from "@/services/notifications";
import type { EvaluationConfig } from "../hooks/useAIEvaluation";

type TabType = "prerequisites" | "review";

// Language options derived from curated registry
const LANGUAGE_OPTIONS: SearchableSelectOption[] = LANGUAGES.map((l) => ({
  value: l.code,
  label: getLanguageLabel(l),
  searchText: `${l.name} ${l.nativeName} ${l.code}`,
}));

// Script options derived from registry
const SCRIPT_OPTIONS: SearchableSelectOption[] = SCRIPTS.map((s) => ({
  value: s.id,
  label: s.name,
}));

// Target scripts: all except "auto"
const TARGET_SCRIPT_OPTIONS: SearchableSelectOption[] = SCRIPTS.filter(
  (s) => s.id !== "auto",
).map((s) => ({
  value: s.id,
  label: s.name,
}));

// Step definitions for 2-tab wizard
const WIZARD_STEPS: { key: TabType; label: string }[] = [
  { key: "prerequisites", label: "Prerequisites" },
  { key: "review", label: "Review & Run" },
];


interface EvaluationOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  listing: Listing;
  onStartEvaluation: (config: EvaluationConfig) => void;
  hasAudioBlob: boolean;
  /** Pre-select evaluation variant from header button */
  initialVariant?: "segments" | "regular";
  /** AI evaluation data (fetched from eval_runs API by parent) */
  aiEval?: AIEvaluation | null;
}

export function EvaluationOverlay({
  isOpen,
  onClose,
  listing,
  onStartEvaluation,
  hasAudioBlob,
}: EvaluationOverlayProps) {
  const [isVisible, setIsVisible] = useState(false);

  const sourceType = (listing.sourceType === 'pending' ? 'upload' : listing.sourceType) || 'upload';
  const geminiApiKey = useLLMSettingsStore((s) => s.geminiApiKey);
  const openaiApiKey = useLLMSettingsStore((s) => s.openaiApiKey);
  const azureApiKey = useLLMSettingsStore((s) => s.azureOpenaiApiKey);
  const azureEndpoint = useLLMSettingsStore((s) => s.azureOpenaiEndpoint);
  const anthropicApiKey = useLLMSettingsStore((s) => s.anthropicApiKey);
  const llmSAConfigured = useLLMSettingsStore((s) => s._serviceAccountConfigured);
  const defaultProvider = useLLMSettingsStore((s) => s.provider);
  const isOnline = useNetworkStatus();

  // Provider + model selection
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider>(defaultProvider || 'gemini');
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedThinking, setSelectedThinking] = useState("low");
  const [modelsLoading, setModelsLoading] = useState(false);

  // Per-step model overrides (empty = use default model above)
  const [showStepModels, setShowStepModels] = useState(false);
  const [transcriptionModel, setTranscriptionModel] = useState("");
  const [normalizationModel, setNormalizationModel] = useState("");
  const [evaluationModel, setEvaluationModel] = useState("");

  const storeSlice = { geminiApiKey, openaiApiKey, azureOpenaiApiKey: azureApiKey, azureOpenaiEndpoint: azureEndpoint, anthropicApiKey, _serviceAccountConfigured: llmSAConfigured };
  const effectiveApiKey = getProviderApiKey(selectedProvider, storeSlice);
  const credentialsOk = hasProviderCredentials(selectedProvider, storeSlice);
  const isServiceAccount = selectedProvider === 'gemini' && llmSAConfigured;

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>("prerequisites");
  const currentStepIndex = WIZARD_STEPS.findIndex((s) => s.key === activeTab);

  // Prerequisites state
  const [selectedLanguage, setSelectedLanguage] = useState("auto");
  const [sourceScript, setSourceScript] = useState("auto");
  const [targetScript, setTargetScript] = useState("latin");
  const [normalizationEnabled, setNormalizationEnabled] = useState(false);
  const [preserveCodeSwitching, setPreserveCodeSwitching] = useState(true);

  // Schema sync state (API flow only)
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const handleSyncSchema = useCallback(async () => {
    if (!listing.id) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await schemasRepository.syncFromListing(listing.id);
      setSyncResult(`Synced ${result.field_count} rx fields`);
      notificationService.success(`Judge schema synced — ${result.field_count} rx fields`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Sync failed";
      setSyncResult(null);
      notificationService.error(msg);
    } finally {
      setSyncing(false);
    }
  }, [listing.id]);

  // Trigger slide-in animation after mount
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
          onClose();
        }
      }
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "unset";
      };
    }
  }, [isOpen, onClose]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab("prerequisites");
      setSelectedProvider(defaultProvider || 'gemini');
      setSelectedModel("");
      setSelectedThinking("low");
      setShowStepModels(false);
      setTranscriptionModel("");
      setNormalizationModel("");
      setEvaluationModel("");
      setSelectedLanguage("auto");
      setSourceScript("auto");
      setTargetScript("latin");
      setNormalizationEnabled(false);
      setPreserveCodeSwitching(true);
      setSyncResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Can we run?
  const canRun = useMemo(() => {
    if (sourceType === 'api') {
      return isOnline && credentialsOk && hasAudioBlob && !!listing.apiResponse;
    }
    return isOnline && credentialsOk && hasAudioBlob && !!listing.transcript;
  }, [isOnline, credentialsOk, hasAudioBlob, sourceType, listing.transcript, listing.apiResponse]);

  // Validation errors
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!isOnline) errors.push("No network connection");
    if (!credentialsOk) errors.push("Credentials not configured — set an API key or service account in Settings");
    if (!hasAudioBlob) errors.push("Audio file not loaded");
    if (sourceType === 'api') {
      if (!listing.apiResponse) errors.push("No API response available");
    } else {
      if (!listing.transcript) errors.push("Original transcript required");
    }
    return errors;
  }, [isOnline, credentialsOk, hasAudioBlob, sourceType, listing.transcript, listing.apiResponse]);

  const handleRun = useCallback(() => {
    // Build step_models only if any overrides are set
    const hasOverrides = transcriptionModel || normalizationModel || evaluationModel;
    onStartEvaluation({
      provider: selectedProvider,
      model: selectedModel || undefined,
      ...(hasOverrides ? {
        stepModels: {
          transcription: transcriptionModel || undefined,
          normalization: normalizationModel || undefined,
          evaluation: evaluationModel || undefined,
        },
      } : {}),
      thinking: selectedThinking,
      normalizeOriginal: normalizationEnabled,
      prerequisites: {
        language: findLanguage(selectedLanguage)?.name || selectedLanguage,
        sourceScript,
        targetScript,
        normalizationEnabled,
        normalizationTarget: "original" as NormalizationTarget,
        preserveCodeSwitching,
        normalizationModel: selectedModel || undefined,
      },
    });
  }, [
    onStartEvaluation,
    selectedProvider,
    normalizationEnabled,
    selectedModel,
    selectedThinking,
    selectedLanguage,
    sourceScript,
    targetScript,
    preserveCodeSwitching,
    transcriptionModel,
    normalizationModel,
    evaluationModel,
  ]);

  // Status items
  const statusItems = useMemo(() => {
    const segmentCount = listing.transcript?.segments?.length || 0;
    return [
      { label: "Network", ok: isOnline, detail: isOnline ? "Online" : "Offline", icon: isOnline ? Wifi : WifiOff },
      { label: "Credentials", ok: credentialsOk, detail: isServiceAccount ? "Service Account" : effectiveApiKey ? "API Key" : "Not set", icon: Key },
      { label: "Audio", ok: hasAudioBlob, detail: hasAudioBlob ? "Loaded" : "Not loaded", icon: Music },
      { label: "Transcript", ok: segmentCount > 0 || sourceType === 'api', detail: sourceType === 'api' ? "API flow" : segmentCount > 0 ? `${segmentCount} segments` : "Not loaded", icon: FileCheck },
    ];
  }, [isOnline, credentialsOk, isServiceAccount, effectiveApiKey, hasAudioBlob, listing.transcript?.segments?.length, sourceType]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm transition-opacity duration-300",
          isVisible ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div
        className={cn(
          "ml-auto relative z-10 h-full w-[var(--overlay-width-md)] max-w-[85vw] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isVisible ? "translate-x-0" : "translate-x-full",
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

        {/* Step navigation */}
        <div className="shrink-0 border-b border-[var(--border-subtle)] px-6 py-3">
          <div className="flex items-center gap-2">
            {WIZARD_STEPS.map((step, i) => (
              <div key={step.key} className="flex items-center">
                {i > 0 && (
                  <div
                    className={cn(
                      "w-8 h-px mr-2",
                      i <= currentStepIndex ? "bg-[var(--interactive-primary)]" : "bg-[var(--border-default)]",
                    )}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab(step.key)}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <div
                    className={cn(
                      "flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold transition-colors",
                      i === currentStepIndex
                        ? "bg-[var(--interactive-primary)] text-[var(--text-on-color)]"
                        : i < currentStepIndex
                          ? "bg-[var(--surface-info)] text-[var(--color-info)]"
                          : "bg-[var(--bg-tertiary)] text-[var(--text-muted)]",
                    )}
                  >
                    {i < currentStepIndex ? <Check className="h-3 w-3" /> : i + 1}
                  </div>
                  <span
                    className={cn(
                      "text-[12px] font-medium",
                      i === currentStepIndex ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]",
                    )}
                  >
                    {step.label}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {activeTab === "prerequisites" && (
            <div className="space-y-6">
              {/* Pipeline info */}
              <div className="p-3 rounded-lg bg-[var(--surface-info)]/50 border border-[var(--color-info)]/20">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-[var(--color-info)] mt-0.5 shrink-0" />
                  <div className="text-[12px] text-[var(--text-secondary)]">
                    <p className="font-medium text-[var(--text-primary)]">Standard Pipeline</p>
                    <p className="mt-1">
                      {sourceType === 'upload'
                        ? "Step 1: Transcribe audio (Judge). Step 2: Compare transcripts (text-only, no audio). Statistics computed server-side."
                        : "Step 1: Transcribe audio (Judge). Step 2: Compare API output vs Judge output (text-only). Statistics computed server-side."
                      }
                    </p>
                  </div>
                </div>
              </div>

              {/* Audio Language + Source Script side-by-side */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-medium text-[var(--text-primary)] mb-1.5">
                    Audio Language
                  </label>
                  <SearchableSelect
                    options={LANGUAGE_OPTIONS}
                    value={selectedLanguage}
                    onChange={setSelectedLanguage}
                    placeholder="Select language..."
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[var(--text-primary)] mb-1.5">
                    Source Script
                  </label>
                  <SearchableSelect
                    options={SCRIPT_OPTIONS}
                    value={sourceScript}
                    onChange={setSourceScript}
                    placeholder="Select source script..."
                  />
                </div>
              </div>

              {/* Normalization toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-default)]">
                <div>
                  <p className="text-[12px] font-medium text-[var(--text-primary)]">
                    Normalize Original Transcript
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    Transliterate source transcript to target script before comparison
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={normalizationEnabled}
                  onClick={() => setNormalizationEnabled(!normalizationEnabled)}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
                    normalizationEnabled ? "bg-[var(--interactive-primary)]" : "bg-[var(--bg-tertiary)]",
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      normalizationEnabled ? "translate-x-4" : "translate-x-0",
                    )}
                  />
                </button>
              </div>

              {/* Target Script — only shown when normalization is enabled */}
              {normalizationEnabled && (
                <div>
                  <label className="block text-[12px] font-medium text-[var(--text-primary)] mb-1.5">
                    Target Script
                  </label>
                  <SearchableSelect
                    options={TARGET_SCRIPT_OPTIONS}
                    value={targetScript}
                    onChange={setTargetScript}
                    placeholder="Select target script..."
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">
                    Both the original and judge transcripts will be in this script for comparison
                  </p>
                </div>
              )}

              {/* Code-switching toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-default)]">
                <div>
                  <p className="text-[12px] font-medium text-[var(--text-primary)]">
                    Preserve Code-Switching
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    Keep English terms in non-English speech (e.g., "BP check karo")
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preserveCodeSwitching}
                  onClick={() => setPreserveCodeSwitching(!preserveCodeSwitching)}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
                    preserveCodeSwitching ? "bg-[var(--interactive-primary)]" : "bg-[var(--bg-tertiary)]",
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      preserveCodeSwitching ? "translate-x-4" : "translate-x-0",
                    )}
                  />
                </button>
              </div>

              {/* Judge Schema sync (API flow only) */}
              {sourceType === 'api' && listing.apiResponse && (
                <div>
                  <h3 className="text-[12px] font-semibold text-[var(--text-primary)] mb-2">
                    Judge Schema
                  </h3>
                  <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-default)]">
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {syncResult || "Sync schema from the API response shape"}
                    </p>
                    <button
                      type="button"
                      onClick={handleSyncSchema}
                      disabled={syncing}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors shrink-0 ml-3",
                        "border border-[var(--border-default)] text-[var(--text-secondary)]",
                        "hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]",
                        syncing && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
                      {syncing ? "Syncing..." : "Sync from API"}
                    </button>
                  </div>
                </div>
              )}

              {/* Provider + Model + Thinking */}
              <LLMConfigSection
                provider={selectedProvider}
                onProviderChange={(p) => {
                  setSelectedProvider(p);
                  setSelectedModel('');
                  setTranscriptionModel('');
                  setNormalizationModel('');
                  setEvaluationModel('');
                }}
                model={selectedModel}
                onModelChange={setSelectedModel}
                showThinking
                thinking={selectedThinking}
                onThinkingChange={setSelectedThinking}
                onModelsLoading={setModelsLoading}
                dropdownDirection="up"
              />

              {/* Per-step model overrides (collapsible) */}
              <div className="rounded-lg border border-[var(--border-default)]">
                <button
                  type="button"
                  onClick={() => setShowStepModels(!showStepModels)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <span>Per-Step Model Overrides</span>
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showStepModels && "rotate-180")} />
                </button>
                {showStepModels && (
                  <div className="px-3 pb-3 space-y-3 border-t border-[var(--border-subtle)]">
                    <p className="text-[10px] text-[var(--text-muted)] pt-2">
                      Leave empty to use the default model above.
                    </p>
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                        Transcription
                      </label>
                      <ModelSelector
                        apiKey={effectiveApiKey}
                        azureEndpoint={azureEndpoint}
                        selectedModel={transcriptionModel}
                        onChange={setTranscriptionModel}
                        provider={selectedProvider}
                        dropdownDirection="up"
                      />
                    </div>
                    {normalizationEnabled && (
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                          Normalization
                        </label>
                        <ModelSelector
                          apiKey={effectiveApiKey}
                          azureEndpoint={azureEndpoint}
                          selectedModel={normalizationModel}
                          onChange={setNormalizationModel}
                          provider={selectedProvider}
                          dropdownDirection="up"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                        Evaluation
                      </label>
                      <ModelSelector
                        apiKey={effectiveApiKey}
                        azureEndpoint={azureEndpoint}
                        selectedModel={evaluationModel}
                        onChange={setEvaluationModel}
                        provider={selectedProvider}
                        dropdownDirection="up"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "review" && (
            <div className="space-y-5">
              {/* Status badges */}
              <div>
                <h3 className="text-[12px] font-semibold text-[var(--text-primary)] mb-2">
                  System Status
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {statusItems.map((item) => (
                    <Badge
                      key={item.label}
                      variant={item.ok ? "success" : "error"}
                      icon={item.icon}
                    >
                      {item.detail}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Pipeline steps — horizontal stepper */}
              <div>
                <h3 className="text-[12px] font-semibold text-[var(--text-primary)] mb-3">
                  Pipeline Steps
                </h3>
                {(() => {
                  const steps = [
                    { label: "Transcribe", desc: "Judge listens to audio" },
                    ...(normalizationEnabled ? [{ label: "Normalize", desc: "Transliterate to target script" }] : []),
                    { label: "Compare", desc: sourceType === 'upload' ? "Segment-by-segment" : "API vs Judge output" },
                  ];
                  return (
                    <div className="flex">
                      {steps.map((step, i) => (
                        <div key={step.label} className="flex-1 flex flex-col items-center min-w-0">
                          <div className="flex items-center w-full">
                            <div className={cn("h-px flex-1", i > 0 ? "bg-[var(--interactive-primary)]/40" : "")} />
                            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--interactive-primary)] text-[var(--text-on-color)] text-[10px] font-bold shrink-0">
                              {i + 1}
                            </div>
                            <div className={cn("h-px flex-1", i < steps.length - 1 ? "bg-[var(--interactive-primary)]/40" : "")} />
                          </div>
                          <p className="text-[11px] font-medium text-[var(--text-primary)] mt-1.5 text-center">
                            {step.label}
                          </p>
                          <p className="text-[10px] text-[var(--text-muted)] text-center leading-tight">
                            {step.desc}
                          </p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Configuration summary */}
              <div>
                <h3 className="text-[12px] font-semibold text-[var(--text-primary)] mb-2">
                  Configuration
                </h3>
                <div className="rounded-lg border border-[var(--border-default)] divide-y divide-[var(--border-subtle)]">
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-[11px] text-[var(--text-muted)]">Flow Type</span>
                    <span className="text-[11px] font-medium text-[var(--text-primary)]">{sourceType === 'api' ? 'API' : 'Upload'}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-[11px] text-[var(--text-muted)]">Provider</span>
                    <span className="text-[11px] font-medium text-[var(--text-primary)]">{LLM_PROVIDERS.find((p) => p.value === selectedProvider)?.label ?? selectedProvider}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-[11px] text-[var(--text-muted)]">Model</span>
                    <span className="text-[11px] font-medium text-[var(--text-primary)]">{selectedModel || "Default"}</span>
                  </div>
                  {selectedProvider === "gemini" && (
                    <div className="flex justify-between px-3 py-2">
                      <span className="text-[11px] text-[var(--text-muted)]">Thinking</span>
                      <span className="text-[11px] font-medium text-[var(--text-primary)] capitalize">{selectedThinking}</span>
                    </div>
                  )}
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-[11px] text-[var(--text-muted)]">Language</span>
                    <span className="text-[11px] font-medium text-[var(--text-primary)]">{findLanguage(selectedLanguage)?.name || selectedLanguage}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-[11px] text-[var(--text-muted)]">Script</span>
                    <span className="text-[11px] font-medium text-[var(--text-primary)]">
                      {normalizationEnabled ? `${sourceScript} → ${targetScript}` : sourceScript}
                    </span>
                  </div>
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-[11px] text-[var(--text-muted)]">Normalization</span>
                    <span className="text-[11px] font-medium text-[var(--text-primary)]">{normalizationEnabled ? "Enabled" : "Disabled"}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-[11px] text-[var(--text-muted)]">Code-Switching</span>
                    <span className="text-[11px] font-medium text-[var(--text-primary)]">{preserveCodeSwitching ? "Preserved" : "Transliterated"}</span>
                  </div>
                  {sourceType === 'upload' && (
                    <div className="flex justify-between px-3 py-2">
                      <span className="text-[11px] text-[var(--text-muted)]">Segments</span>
                      <span className="text-[11px] font-medium text-[var(--text-primary)]">{listing.transcript?.segments?.length ?? 0}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Errors */}
              {validationErrors.length > 0 && (
                <div className="p-3 rounded-lg bg-[var(--surface-error)]/50 border border-[var(--color-error)]/20">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-[var(--color-error)] mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      {validationErrors.map((err, i) => (
                        <p key={i} className="text-[11px] text-[var(--color-error)]">{err}</p>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            {activeTab === "review" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab("prerequisites")}
              >
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {activeTab === "prerequisites" ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setActiveTab("review")}
                disabled={modelsLoading}
              >
                Next
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={handleRun}
                disabled={!canRun}
                icon={Play}
              >
                Run Evaluation
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
