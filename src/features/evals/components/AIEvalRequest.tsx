import { Play, AlertCircle, Loader2 } from 'lucide-react';
import { Button, ModelBadge, EmptyState } from '@/components/ui';
import { useLLMSettingsStore } from '@/stores';
import { useNetworkStatus } from '@/hooks';

interface AIEvalRequestProps {
  onRequestEval: () => void;
  isEvaluating: boolean;
  hasAudio: boolean;
  hasTranscript: boolean;
  onCancel?: () => void;
}

export function AIEvalRequest({
  onRequestEval,
  isEvaluating,
  hasAudio,
  hasTranscript,
}: AIEvalRequestProps) {
  const hasHydrated = useLLMSettingsStore((state) => state._hasHydrated);
  const llm = useLLMSettingsStore();
  const isOnline = useNetworkStatus();

  const canEvaluate = hasHydrated && hasAudio && hasTranscript && llm.apiKey && isOnline && !isEvaluating;

  const warnings: { message: string }[] = [];
  if (!hasHydrated) {
    // loading state handled below
  } else if (!llm.apiKey) {
    warnings.push({ message: 'Configure your API key in Settings first' });
  }
  if (!isOnline) warnings.push({ message: "You're offline. Connect to use AI features." });
  if (!hasAudio) warnings.push({ message: 'No audio file available for this listing' });
  if (!hasTranscript) warnings.push({ message: 'No transcript available for comparison' });

  return (
    <EmptyState
      icon={Play}
      title="AI Transcript Evaluation"
      description={isEvaluating ? undefined : "Compare AI-generated transcript against the original."}
      className="w-full max-w-md"
    >
      {!hasHydrated ? (
        <div className="flex items-center justify-center gap-2 text-[13px] text-[var(--text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading settings...</span>
        </div>
      ) : (
        <>
          {warnings.map((w) => (
            <div key={w.message} className="flex items-center justify-center gap-2 text-[13px] text-[var(--color-warning)]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{w.message}</span>
            </div>
          ))}
        </>
      )}

      {isEvaluating ? (
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-brand-primary)]" />
          <span className="text-[13px] text-[var(--text-secondary)]">Evaluating...</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Button
            onClick={onRequestEval}
            disabled={!canEvaluate}
            className="gap-2"
          >
            <Play className="h-4 w-4" />
            Run Evaluation
          </Button>
          {llm.apiKey && (
            <ModelBadge
              modelName={llm.selectedModel}
              variant="compact"
              showPoweredBy
            />
          )}
        </div>
      )}
    </EmptyState>
  );
}
