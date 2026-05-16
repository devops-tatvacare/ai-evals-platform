import { useState, useCallback } from 'react';
import { Sparkles, ChevronDown, ChevronUp, RefreshCw, Check, X } from 'lucide-react';

import { Button, LLMConfigSection } from '@/components/ui';
import { llmAssistApi } from '@/services/api/llmAssistApi';
import type { LLMProvider } from '@/services/api/aiSettingsApi';
import { cn } from '@/utils';

type PromptType = 'transcription' | 'evaluation' | 'extraction';

interface SchemaGeneratorInlineProps {
  promptType: PromptType;
  isExpanded: boolean;
  onToggle: () => void;
  onSchemaGenerated: (schema: Record<string, unknown>, name: string) => void;
  className?: string;
}

const PROMPT_TYPE_PLACEHOLDERS: Record<PromptType, string> = {
  transcription: 'e.g., "Include confidence scores for each segment, add speaker emotion detection"',
  evaluation: 'e.g., "Add which transcript is likely correct, confidence levels, error categories"',
  extraction: 'e.g., "Extract patient demographics, medications with dosages, diagnoses"',
};

const DEFAULT_SCHEMA_NAMES: Record<PromptType, string> = {
  transcription: 'Custom Transcript Schema',
  evaluation: 'Custom Evaluation Schema',
  extraction: 'Custom Extraction Schema',
};

export function SchemaGeneratorInline({
  promptType,
  isExpanded,
  onToggle,
  onSchemaGenerated,
  className,
}: SchemaGeneratorInlineProps) {
  const [provider, setProvider] = useState<LLMProvider | ''>('');
  const [model, setModel] = useState('');
  const [userIdea, setUserIdea] = useState('');
  const [schemaName, setSchemaName] = useState(DEFAULT_SCHEMA_NAMES[promptType]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedSchema, setGeneratedSchema] = useState<Record<string, unknown> | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!userIdea.trim()) {
      setError('Please describe the output structure you need');
      return;
    }
    if (!provider || !model) {
      setError('Please pick a provider and model');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedSchema(null);

    try {
      const { schema } = await llmAssistApi.generateSchema({
        provider,
        model,
        promptType,
        userIdea,
      });
      if (schema && schema.type === 'object' && schema.properties) {
        setGeneratedSchema(schema);
      } else {
        setError('Generated schema must be an object with properties');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate schema';
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }, [userIdea, provider, model, promptType]);

  const handleUseSchema = useCallback(() => {
    if (generatedSchema && schemaName.trim()) {
      onSchemaGenerated(generatedSchema, schemaName.trim());
      // Reset state
      setUserIdea('');
      setGeneratedSchema(null);
      setSchemaName(DEFAULT_SCHEMA_NAMES[promptType]);
      setError(null);
    }
  }, [generatedSchema, schemaName, onSchemaGenerated, promptType]);

  const handleCancel = useCallback(() => {
    setUserIdea('');
    setGeneratedSchema(null);
    setSchemaName(DEFAULT_SCHEMA_NAMES[promptType]);
    setError(null);
    onToggle();
  }, [onToggle, promptType]);

  const handleRegenerate = useCallback(() => {
    setGeneratedSchema(null);
    handleGenerate();
  }, [handleGenerate]);

  if (!isExpanded) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggle}
        className={cn('h-8 gap-1.5 text-[11px]', className)}
        title="Generate schema with AI"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Generate
        <ChevronDown className="h-3 w-3" />
      </Button>
    );
  }

  return (
    <div className={cn('mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--text-brand)]" />
          <span className="text-[13px] font-medium text-[var(--text-primary)]">
            Generate Custom Schema
          </span>
        </div>
        <button
          onClick={handleCancel}
          className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-[var(--color-error-light)] border border-[var(--color-error)]/30 p-2 text-[12px] text-[var(--color-error)]">
          <X className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Input area */}
      {!generatedSchema && (
        <>
          <div className="mb-3">
            <LLMConfigSection
              provider={provider}
              onProviderChange={setProvider}
              model={model}
              onModelChange={setModel}
              compact
            />
          </div>
          <label className="mb-1.5 block text-[12px] text-[var(--text-secondary)]">
            Describe the output structure you need:
          </label>
          <textarea
            value={userIdea}
            onChange={(e) => setUserIdea(e.target.value)}
            placeholder={PROMPT_TYPE_PLACEHOLDERS[promptType]}
            rows={2}
            disabled={isGenerating}
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-2.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none disabled:opacity-50"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={isGenerating}
              className="h-7 text-[11px]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleGenerate}
              isLoading={isGenerating}
              disabled={!userIdea.trim() || !provider || !model || isGenerating}
              className="h-7 text-[11px] gap-1.5"
            >
              <Sparkles className="h-3 w-3" />
              {isGenerating ? 'Generating...' : 'Generate'}
            </Button>
          </div>
        </>
      )}

      {/* Preview area */}
      {generatedSchema && (
        <>
          <label className="mb-1.5 block text-[12px] text-[var(--text-secondary)]">
            Preview generated schema:
          </label>
          <div className="mb-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-2.5 max-h-40 overflow-auto">
            <pre className="text-[11px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap">
              {JSON.stringify(generatedSchema, null, 2)}
            </pre>
          </div>

          <label className="mb-1.5 block text-[12px] text-[var(--text-secondary)]">
            Schema name:
          </label>
          <input
            type="text"
            value={schemaName}
            onChange={(e) => setSchemaName(e.target.value)}
            className="w-full h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-[12px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50"
          />

          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="h-7 text-[11px]"
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRegenerate}
              className="h-7 text-[11px] gap-1.5"
            >
              <RefreshCw className="h-3 w-3" />
              Regenerate
            </Button>
            <Button
              size="sm"
              onClick={handleUseSchema}
              disabled={!schemaName.trim()}
              className="h-7 text-[11px] gap-1.5"
            >
              <Check className="h-3 w-3" />
              Use This Schema
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
