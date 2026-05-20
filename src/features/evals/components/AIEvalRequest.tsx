import { Link } from 'react-router-dom';
import { Play, AlertCircle, Loader2, ExternalLink } from 'lucide-react';

import { Button, EmptyState } from '@/components/ui';
import { useProviderConfigs } from '@/services/api/aiSettingsQueries';
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
  const { data: providerConfigs = [], isLoading: hydrating } = useProviderConfigs();
  const isOnline = useNetworkStatus();

  // BYOK: a provider is "ready" only when the admin has enabled it and the
  // last validation passed. The actual provider+model picked by the run
  // (overlay state) is independent of this gate.
  const credentialsOk = providerConfigs.some(
    (c) => c.isEnabled && c.validationStatus === 'ok',
  );
  const canEvaluate = !hydrating && hasAudio && hasTranscript && credentialsOk && isOnline && !isEvaluating;

  const warnings: { message: string }[] = [];
  if (!hydrating && !credentialsOk) {
    warnings.push({
      message: 'No LLM provider configured. An admin must set one up in AI Settings.',
    });
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
      {hydrating ? (
        <div className="flex items-center justify-center gap-2 text-[13px] text-[var(--text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading provider configuration...</span>
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
        </div>
      )}
    </EmptyState>
  );
}
