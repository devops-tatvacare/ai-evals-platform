import { useState, useCallback } from 'react';
import { Wand2, Sparkles, AlertCircle } from 'lucide-react';

import { Modal, Button, LLMConfigSection } from '@/components/ui';
import { llmAssistApi } from '@/services/api/llmAssistApi';
import type { LLMProvider } from '@/services/api/aiSettingsApi';

type PromptType = 'transcription' | 'evaluation' | 'extraction';

interface PromptGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptType: PromptType;
  onGenerated: (prompt: string) => void;
}

const PROMPT_TYPE_LABELS: Record<PromptType, string> = {
  transcription: 'Transcription',
  evaluation: 'Evaluation',
  extraction: 'Extraction',
};

const PROMPT_TYPE_PLACEHOLDERS: Record<PromptType, string> = {
  transcription: 'e.g., "Focus on cardiology terms and abbreviations, identify doctor vs nurse vs patient"',
  evaluation: 'e.g., "Be strict about medication dosages and patient identifiers, flag any numerical discrepancies"',
  extraction: 'e.g., "Extract patient demographics, medications, diagnoses, and follow-up instructions"',
};

export function PromptGeneratorModal({
  isOpen,
  onClose,
  promptType,
  onGenerated,
}: PromptGeneratorModalProps) {
  const [provider, setProvider] = useState<LLMProvider | ''>('');
  const [model, setModel] = useState('');
  const [userIdea, setUserIdea] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setUserIdea('');
    setError(null);
    onClose();
  }, [onClose]);

  const handleGenerate = useCallback(async () => {
    if (!userIdea.trim()) {
      setError('Please enter your prompt idea');
      return;
    }
    if (!provider || !model) {
      setError('Please pick a provider and model');
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const { prompt } = await llmAssistApi.generatePrompt({
        provider,
        model,
        promptType,
        userIdea,
      });
      if (prompt) {
        onGenerated(prompt.trim());
        handleClose();
      } else {
        setError('No response generated. Please try again.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate prompt';
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }, [userIdea, provider, model, promptType, onGenerated, handleClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isGenerating) {
      e.preventDefault();
      handleGenerate();
    }
  }, [handleGenerate, isGenerating]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={isGenerating ? () => {} : handleClose}
      title={
        <span className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-[var(--text-brand)]" />
          Generate {PROMPT_TYPE_LABELS[promptType]} Prompt
        </span>
      }
      className="max-w-lg"
    >
      <div className="space-y-4">
        <LLMConfigSection
          provider={provider}
          onProviderChange={setProvider}
          model={model}
          onModelChange={setModel}
          compact
        />

        <p className="text-[13px] text-[var(--text-secondary)]">
          Describe your requirements briefly, and AI will generate a professional prompt for you.
        </p>

        {error && (
          <div className="flex items-center gap-2 rounded-[var(--radius-default)] bg-[var(--color-error-light)] border border-[var(--color-error)]/30 p-3 text-[13px] text-[var(--color-error)]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--text-primary)]">
            Your Idea
          </label>
          <textarea
            value={userIdea}
            onChange={(e) => setUserIdea(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={PROMPT_TYPE_PLACEHOLDERS[promptType]}
            rows={4}
            disabled={isGenerating}
            className="w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none disabled:opacity-50"
          />
          <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
            Press Enter to generate, or click the button below
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={isGenerating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            isLoading={isGenerating}
            disabled={!userIdea.trim() || !provider || !model || isGenerating}
            className="gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {isGenerating ? 'Generating...' : 'Generate Prompt'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
