import { Play, AlertCircle, Loader2 } from 'lucide-react';
import { Button, Card, ModelBadge } from '@/components/ui';
import { useSettingsStore } from '@/stores';
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
  const { llm } = useSettingsStore();
  const isOnline = useNetworkStatus();

  const canEvaluate = hasAudio && hasTranscript && llm.apiKey && isOnline && !isEvaluating;

  return (
    <Card className="border-dashed">
      <div className="text-center">
        <h3 className="mb-2 font-medium text-[var(--text-primary)]">
          AI Transcript Evaluation
        </h3>
        <p className="mb-4 text-[13px] text-[var(--text-secondary)]">
          Generate an AI transcript from the audio and compare it with the original.
        </p>

        {!llm.apiKey && (
          <div className="mb-4 flex items-center justify-center gap-2 text-[13px] text-[var(--color-warning)]">
            <AlertCircle className="h-4 w-4" />
            <span>Configure your API key in Settings first</span>
          </div>
        )}

        {!isOnline && (
          <div className="mb-4 flex items-center justify-center gap-2 text-[13px] text-[var(--color-warning)]">
            <AlertCircle className="h-4 w-4" />
            <span>You're offline. Connect to use AI features.</span>
          </div>
        )}

        {!hasAudio && (
          <div className="mb-4 flex items-center justify-center gap-2 text-[13px] text-[var(--color-warning)]">
            <AlertCircle className="h-4 w-4" />
            <span>No audio file available for this listing</span>
          </div>
        )}

        {!hasTranscript && (
          <div className="mb-4 flex items-center justify-center gap-2 text-[13px] text-[var(--color-warning)]">
            <AlertCircle className="h-4 w-4" />
            <span>No transcript available for comparison</span>
          </div>
        )}

        {isEvaluating ? (
          <div className="py-4 flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-brand-primary)]" />
            <span className="text-[13px] text-[var(--text-secondary)]">
              Evaluation in progress... Check the progress indicator in the bottom-right corner.
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Button
              onClick={onRequestEval}
              disabled={!canEvaluate}
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              Request AI Evaluation
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

        <p className="mt-4 text-[12px] text-[var(--text-muted)]">
          This will send the audio to the AI model to generate a transcript,
          then compare it with the original.
        </p>
      </div>
    </Card>
  );
}
