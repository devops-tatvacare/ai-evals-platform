import { useState } from 'react';
import { Modal, Button } from '@/components/ui';
import { Sparkles, FileText, Volume2, AlertCircle, WifiOff } from 'lucide-react';
import { useNetworkStatus } from '@/hooks';
import { useSettingsStore } from '@/stores';
import { cn } from '@/utils';

type InputSource = 'transcript' | 'audio' | 'both';
type PromptType = 'freeform' | 'schema';

interface ExtractionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    prompt: string;
    promptType: PromptType;
    inputSource: InputSource;
  }) => void;
  isLoading: boolean;
  error: string | null;
  hasTranscript: boolean;
  hasAudio: boolean;
}

const EXAMPLE_SCHEMA = `{
  "type": "object",
  "properties": {
    "patient_name": { "type": "string" },
    "symptoms": { 
      "type": "array",
      "items": { "type": "string" }
    },
    "diagnosis": { "type": "string" },
    "medications": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "dosage": { "type": "string" }
        }
      }
    }
  }
}`;

const EXAMPLE_FREEFORM = `Extract the following information:
- Patient name
- List of symptoms mentioned
- Doctor's diagnosis
- Prescribed medications with dosages`;

export function ExtractionModal({
  isOpen,
  onClose,
  onSubmit,
  isLoading,
  error,
  hasTranscript,
  hasAudio,
}: ExtractionModalProps) {
  const [promptType, setPromptType] = useState<PromptType>('freeform');
  const [prompt, setPrompt] = useState('');
  const [inputSource, setInputSource] = useState<InputSource>('transcript');
  const { isOnline } = useNetworkStatus();
  const { llm } = useSettingsStore();

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    onSubmit({ prompt: prompt.trim(), promptType, inputSource });
  };

  const handleUseExample = () => {
    setPrompt(promptType === 'schema' ? EXAMPLE_SCHEMA : EXAMPLE_FREEFORM);
  };

  const canSubmit = prompt.trim() && isOnline && llm.apiKey;

  const inputSourceOptions: { value: InputSource; label: string; icon: typeof FileText; available: boolean }[] = [
    { value: 'transcript', label: 'Transcript', icon: FileText, available: hasTranscript },
    { value: 'audio', label: 'Audio', icon: Volume2, available: hasAudio },
    { value: 'both', label: 'Both', icon: Sparkles, available: hasTranscript && hasAudio },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Extract Structured Data" className="max-w-2xl">
      <div className="space-y-4">
        {/* Offline banner */}
        {!isOnline && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400">
            <WifiOff className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm">You're offline. Connect to the internet to use AI features.</span>
          </div>
        )}

        {/* API key warning */}
        {!llm.apiKey && isOnline && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm">API key not configured. Go to Settings to add your Gemini API key.</span>
          </div>
        )}

        {/* Prompt type toggle */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            Prompt Type
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPromptType('freeform')}
              className={cn(
                'flex-1 rounded-lg border px-4 py-2 text-sm transition-colors',
                promptType === 'freeform'
                  ? 'border-[var(--color-brand-accent)] bg-[var(--color-brand-accent)]/10 text-[var(--color-brand-accent)]'
                  : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)]'
              )}
            >
              Freeform
            </button>
            <button
              type="button"
              onClick={() => setPromptType('schema')}
              className={cn(
                'flex-1 rounded-lg border px-4 py-2 text-sm transition-colors',
                promptType === 'schema'
                  ? 'border-[var(--color-brand-accent)] bg-[var(--color-brand-accent)]/10 text-[var(--color-brand-accent)]'
                  : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)]'
              )}
            >
              JSON Schema
            </button>
          </div>
        </div>

        {/* Input source selector */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            Input Source
          </label>
          <div className="flex gap-2">
            {inputSourceOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setInputSource(option.value)}
                  disabled={!option.available}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors',
                    !option.available && 'cursor-not-allowed opacity-50',
                    inputSource === option.value && option.available
                      ? 'border-[var(--color-brand-accent)] bg-[var(--color-brand-accent)]/10 text-[var(--color-brand-accent)]'
                      : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)]'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Prompt input */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-[var(--text-primary)]">
              {promptType === 'schema' ? 'JSON Schema' : 'Instructions'}
            </label>
            <button
              type="button"
              onClick={handleUseExample}
              className="text-xs text-[var(--color-brand-accent)] hover:underline"
            >
              Use example
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={promptType === 'schema' 
              ? 'Paste your JSON schema here...'
              : 'Describe what data to extract from the transcript...'
            }
            className="h-48 w-full resize-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
          />
        </div>

        {/* Error display */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 p-3 text-red-600 dark:text-red-400">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || isLoading}
            isLoading={isLoading}
          >
            <Sparkles className="h-4 w-4" />
            {isLoading ? 'Extracting...' : 'Extract'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
