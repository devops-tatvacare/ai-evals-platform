import { useState } from 'react';
import { Trash2, ChevronDown, ChevronUp, Clock, Sparkles, AlertCircle } from 'lucide-react';
import { Card, Button, Badge, ModelBadge } from '@/components/ui';
import { JsonViewer } from './JsonViewer';
import type { StructuredOutput } from '@/types';
import { cn } from '@/utils';

interface OutputCardProps {
  output: StructuredOutput;
  onDelete: (id: string) => void;
}

export function OutputCard({ output, onDelete }: OutputCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date instanceof Date ? date : new Date(date));
  };

  const statusColors: Record<string, string> = {
    completed: 'bg-green-500/10 text-green-600 dark:text-green-400',
    failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
    processing: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    pending: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  };

  const sourceLabels: Record<string, string> = {
    transcript: 'Transcript',
    audio: 'Audio',
    both: 'Both',
  };

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
              {formatDate(output.createdAt)}
              <span>•</span>
              <span>{sourceLabels[output.inputSource]}</span>
              <span>•</span>
              <ModelBadge modelName={output.model} variant="inline" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(output.id);
            }}
            className="text-[var(--text-muted)] hover:text-red-500"
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
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 p-3">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
                <div>
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    Extraction failed
                  </p>
                  <p className="text-xs text-red-600/80 dark:text-red-400/80">
                    {output.error || 'Unknown error'}
                  </p>
                  {output.rawResponse && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-red-600/60 dark:text-red-400/60 hover:underline">
                        Show raw response
                      </summary>
                      <pre className="mt-2 max-h-32 overflow-auto rounded bg-red-500/5 p-2 text-xs">
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
