import { useState, useCallback } from 'react';
import { FileJson, ChevronDown, ChevronRight, Trash2, GitCompare } from 'lucide-react';
import { Card, Badge, Button } from '@/components/ui';
import { JsonViewer } from './JsonViewer';
import { formatDate } from '@/utils';
import type { StructuredOutputReference } from '@/types';

interface ReferenceCardProps {
  reference: StructuredOutputReference;
  onDelete: (id: string) => void;
  onCompare: (referenceId: string) => void;
  hasLinkedOutputs: boolean;
}

export function ReferenceCard({
  reference,
  onDelete,
  onCompare,
  hasLinkedOutputs,
}: ReferenceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleDelete = useCallback(() => {
    if (hasLinkedOutputs) {
      if (!confirm('This reference has linked LLM outputs. Deleting it will unlink them. Continue?')) {
        return;
      }
    }
    onDelete(reference.id);
  }, [reference.id, onDelete, hasLinkedOutputs]);

  return (
    <Card className="p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-0.5 rounded p-0.5 hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        <FileJson className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--color-success)]" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium text-[13px] text-[var(--text-primary)] truncate">
              {reference.description || reference.uploadedFile?.name || 'Reference Output'}
            </h4>
            <Badge variant="neutral" className="text-[9px]">
              Reference
            </Badge>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
            {reference.uploadedFile && (
              <span>{reference.uploadedFile.name}</span>
            )}
            <span>•</span>
            <span>{formatDate(reference.createdAt)}</span>
            {hasLinkedOutputs && (
              <>
                <span>•</span>
                <span className="text-[var(--color-brand-primary)]">Has linked outputs</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCompare(reference.id)}
            title="Compare with LLM outputs"
          >
            <GitCompare className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            title="Delete reference"
          >
            <Trash2 className="h-4 w-4 text-[var(--color-error)]" />
          </Button>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="p-4 space-y-3">
          {reference.description && (
            <div>
              <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                Description
              </label>
              <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                {reference.description}
              </p>
            </div>
          )}

          <div>
            <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
              Content
            </label>
            <div className="mt-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3 max-h-64 overflow-auto">
              <JsonViewer data={reference.content} />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
