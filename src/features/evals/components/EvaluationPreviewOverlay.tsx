import { useState, useEffect, useCallback } from 'react';
import { X, FileText, Code2, Variable } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/utils';
import { resolvePrompt, type VariableContext } from '@/services/templates';
import type { Listing, SchemaDefinition, EvaluationPrerequisites } from '@/types';

interface EvaluationPreviewOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  prompt: string;
  schema: SchemaDefinition | null;
  listing: Listing;
  promptType: 'transcription' | 'evaluation';
  prerequisites?: EvaluationPrerequisites;
  hasAudioBlob?: boolean;
}

export function EvaluationPreviewOverlay({
  isOpen,
  onClose,
  title,
  prompt,
  schema,
  listing,
  prerequisites,
  hasAudioBlob = false,
}: EvaluationPreviewOverlayProps) {
  const [isVisible, setIsVisible] = useState(false);

  // Trigger slide-in animation after mount
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  // Build variable context for proper resolution
  const variableContext: VariableContext = {
    listing,
    aiEval: listing.aiEval,
    audioBlob: hasAudioBlob ? new Blob() : undefined,
    prerequisites,
  };

  // Resolve variables using the centralized resolver
  const resolved = resolvePrompt(prompt, variableContext);

  // Extract variable context
  const variableMatches = prompt.match(/\{\{([^}]+)\}\}/g) || [];
  const variables = Array.from(new Set(variableMatches.map(v => v.replace(/[{}]/g, ''))));

  return (
    <div className="fixed inset-0 z-[100] flex">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm transition-opacity duration-300",
          isVisible ? "opacity-100" : "opacity-0"
        )}
      />

      {/* Slide-in panel */}
      <div
        className={cn(
          "ml-auto relative z-10 h-full w-[70vw] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isVisible ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-[6px] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Resolved Prompt Section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-4 w-4 text-[var(--text-muted)]" />
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                Resolved Prompt
              </h3>
            </div>
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
              <pre className="text-[12px] font-mono text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                {resolved.prompt}
              </pre>
            </div>
          </div>

          {/* Variables Section */}
          {variables.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Variable className="h-4 w-4 text-[var(--text-muted)]" />
                <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                  Variables ({variables.length})
                </h3>
              </div>
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]">
                <div className="divide-y divide-[var(--border-subtle)]">
                  {variables.map((variable, idx) => {
                    const varKey = `{{${variable}}}`;
                    const varValue = resolved.resolvedVariables.get(varKey);
                    const isUnresolved = resolved.unresolvedVariables.includes(varKey);

                    // Format value for display
                    let displayValue: string;
                    if (isUnresolved) {
                      displayValue = '(unavailable)';
                    } else if (varValue === undefined) {
                      displayValue = '(not found)';
                    } else if (typeof varValue === 'string') {
                      displayValue = varValue;
                    } else if (varValue instanceof Blob) {
                      displayValue = `[Audio file: ${varValue.size} bytes]`;
                    } else {
                      displayValue = String(varValue);
                    }

                    return (
                      <div key={idx} className="flex items-start gap-3 p-3">
                        <code className="shrink-0 text-[11px] font-mono text-[var(--color-brand-primary)] bg-[var(--bg-tertiary)] px-2 py-1 rounded">
                          {varKey}
                        </code>
                        <div className="flex-1 min-w-0">
                          <div className={cn(
                            "text-[12px] break-words",
                            isUnresolved ? 'text-[var(--text-muted)] italic' : 'text-[var(--text-secondary)]'
                          )}>
                            {displayValue}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Schema Section */}
          {schema && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Code2 className="h-4 w-4 text-[var(--text-muted)]" />
                <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                  Output Schema: {schema.name}
                </h3>
              </div>
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                <pre className="text-[11px] font-mono text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(schema.schema, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-end px-6 py-4 border-t border-[var(--border-subtle)]">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
