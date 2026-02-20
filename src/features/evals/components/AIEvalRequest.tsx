import { Link } from 'react-router-dom';
import { Play, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { Button, ModelBadge, EmptyState } from '@/components/ui';
import { useLLMSettingsStore, hasLLMCredentials } from '@/stores';
import { useNetworkStatus } from '@/hooks';
import { routes } from '@/config/routes';

interface AIEvalRequestProps {
  onRequestEval: () => void;
  isEvaluating: boolean;
  hasAudio: boolean;
  hasTranscript: boolean;
  onCancel?: () => void;
  activeRunId?: string;
}

export function AIEvalRequest({
  onRequestEval,
  isEvaluating,
  hasAudio,
  hasTranscript,
  activeRunId,
}: AIEvalRequestProps) {
  const hasHydrated = useLLMSettingsStore((state) => state._hasHydrated);
  const llm = useLLMSettingsStore();
  const isOnline = useNetworkStatus();

  const credentialsOk = hasLLMCredentials(llm);
  const canEvaluate = hasHydrated && hasAudio && hasTranscript && credentialsOk && isOnline && !isEvaluating;

  const warnings: { message: string }[] = [];
  if (!hasHydrated) {
    // loading state handled below
  } else if (!credentialsOk) {
    warnings.push({ message: 'Configure your API key or service account in Settings first' });
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
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--text-brand)]" />
            <span className="text-[13px] text-[var(--text-secondary)]">Evaluating...</span>
          </div>
          {activeRunId && (
            <Link
              to={routes.voiceRx.runDetail(activeRunId)}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-brand)] hover:underline"
            >
              View Run
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
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
          {credentialsOk && (
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
