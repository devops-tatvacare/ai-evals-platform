import { useState, useCallback, useEffect } from 'react';
import { Wand2, Sparkles, AlertCircle } from 'lucide-react';
import { Modal, Button, ModelBadge } from '@/components/ui';
import { discoverGeminiModels, createLLMPipeline, type GeminiModel } from '@/services/llm';
import { PROMPT_GENERATOR_SYSTEM_PROMPT } from '@/constants';
import { useSettingsStore } from '@/stores';

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
  const { llm } = useSettingsStore();
  const [userIdea, setUserIdea] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelInfo, setModelInfo] = useState<GeminiModel | null>(null);

  // Load model info when modal opens
  useEffect(() => {
    if (isOpen && llm.apiKey && llm.selectedModel) {
      discoverGeminiModels(llm.apiKey)
        .then((models) => {
          const model = models.find((m) => m.name === llm.selectedModel);
          setModelInfo(model || null);
        })
        .catch(() => setModelInfo(null));
    }
  }, [isOpen, llm.apiKey, llm.selectedModel]);

  const handleGenerate = useCallback(async () => {
    if (!userIdea.trim()) {
      setError('Please enter your prompt idea');
      return;
    }

    if (!llm.apiKey) {
      setError('Please configure your API key in Settings first');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const pipeline = createLLMPipeline();
      
      // Build the meta-prompt with user's idea
      const metaPrompt = PROMPT_GENERATOR_SYSTEM_PROMPT
        .replace('{{promptType}}', promptType.toUpperCase())
        .replace('{{userIdea}}', userIdea);

      const response = await pipeline.invoke({
        prompt: metaPrompt,
        context: {
          source: 'prompt-gen',
          sourceId: `prompt-${Date.now()}`,
        },
        output: {
          format: 'text',
        },
        config: {
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      });

      if (response.output.text) {
        onGenerated(response.output.text.trim());
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
  }, [userIdea, llm.apiKey, llm.selectedModel, promptType, onGenerated]);

  const handleClose = useCallback(() => {
    setUserIdea('');
    setError(null);
    onClose();
  }, [onClose]);

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
          <Wand2 className="h-5 w-5 text-[var(--color-brand-primary)]" />
          Generate {PROMPT_TYPE_LABELS[promptType]} Prompt
        </span>
      }
      className="max-w-lg"
    >
      <div className="space-y-4">
        {/* Model Badge */}
        <ModelBadge
          modelName={llm.selectedModel || 'No model selected'}
          displayName={modelInfo?.displayName}
          variant="full"
          isActive
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
            disabled={!userIdea.trim() || isGenerating}
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
