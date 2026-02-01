import { useState } from 'react';
import { Trash2, ChevronDown, ChevronUp, Clock, Sparkles, AlertCircle, RefreshCw, GitCompare, Link2 } from 'lucide-react';
import { Card, Button, Badge, ModelBadge } from '@/components/ui';
import { JsonViewer } from './JsonViewer';
import type { StructuredOutput, StructuredOutputReference } from '@/types';
import { cn, formatDate } from '@/utils';

interface OutputCardProps {
  output: StructuredOutput;
  linkedReference?: StructuredOutputReference;
  onDelete: (id: string) => void;
  onRegenerate: (id: string) => void;
  onCompare: (outputId: string) => void;
  isRegenerating?: boolean;
}

export function OutputCard({
  output,
  linkedReference,
  onDelete,
  onRegenerate,
  onCompare,
  isRegenerating = false,
}: OutputCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const statusColors: Record<string, string> = {
    completed: 'bg-[var(--color-success-light)] text-[var(--color-success)]',
    failed: 'bg-[var(--color-error-light)] text-[var(--color-error)]',
    processing: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
    pending: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]',
  };

  const sourceLabels: Record<string, string> = {
    transcript: 'Transcript',
    audio: 'Audio',
    both: 'Both',
  };

  const canRegenerate = output.status === 'completed' || output.status === 'failed';
  const canCompare = output.status === 'completed' && output.result && linkedReference;

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between p-4 hover:bg-[var(--interactive-secondary)]"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-[var(--color-brand-accent)]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {output.promptType === 'schema' ? 'Schema Extraction' : 'Freeform Extraction'}
              </span>
              <Badge className={cn('text-xs', statusColors[output.status])}>
                {output.status}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <Clock className="h-3 w-3" />
              Generated {formatDate(output.generatedAt)}
              <span>•</span>
              <span>{sourceLabels[output.inputSource]}</span>
              <span>•</span>
              <ModelBadge modelName={output.model} variant="inline" />
              {linkedReference && (
                <>
                  <span>•</span>
                  <Link2 className="h-3 w-3" />
                  <span className="text-[var(--color-brand-primary)]">
                    {linkedReference.description || linkedReference.uploadedFile?.name || 'Reference'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canCompare && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onCompare(output.id);
              }}
              title="Compare with reference"
            >
              <GitCompare className="h-4 w-4" />
            </Button>
          )}
          {canRegenerate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onRegenerate(output.id);
              }}
              disabled={isRegenerating}
              title="Regenerate"
            >
              <RefreshCw className={cn('h-4 w-4', isRegenerating && 'animate-spin')} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(output.id);
            }}
            className="text-[var(--text-muted)] hover:text-[var(--color-error)]"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-[var(--text-muted)]" />
          ) : (
            <ChevronDown className="h-5 w-5 text-[var(--text-muted)]" />
          )}
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-[var(--border-default)] p-4">
          {/* Prompt */}
          <div className="mb-4">
            <h4 className="mb-2 text-xs font-medium uppercase text-[var(--text-muted)]">
              {output.promptType === 'schema' ? 'Schema' : 'Prompt'}
            </h4>
            <pre className="max-h-32 overflow-auto rounded-lg bg-[var(--bg-surface)] p-3 text-xs text-[var(--text-secondary)]">
              {output.prompt}
            </pre>
          </div>

          {/* Result */}
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase text-[var(--text-muted)]">
              Result
            </h4>
            {output.status === 'completed' && output.result ? (
              <JsonViewer data={output.result} />
            ) : output.status === 'failed' ? (
              <div className="flex items-start gap-2 rounded-lg bg-[var(--color-error-light)] p-3">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-[var(--color-error)]" />
                <div>
                  <p className="text-sm font-medium text-[var(--color-error)]">
                    Extraction failed
                  </p>
                  <p className="text-xs text-[var(--color-error)]/80">
                    {output.error || 'Unknown error'}
                  </p>
                  {output.rawResponse && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-[var(--color-error)]/60 hover:underline">
                        Show raw response
                      </summary>
                      <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--color-error-light)]/50 p-2 text-xs">
                        {output.rawResponse}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-surface)] p-4">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-brand-accent)] border-t-transparent" />
                <span className="text-sm text-[var(--text-muted)]">Processing...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
