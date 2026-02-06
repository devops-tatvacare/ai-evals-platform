import { X, FileText, Code2, Variable } from 'lucide-react';
import { Button } from '@/components/ui';
import type { Listing, SchemaDefinition } from '@/types';

interface EvaluationPreviewOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  prompt: string;
  schema: SchemaDefinition | null;
  listing: Listing;
  promptType: 'transcription' | 'evaluation';
}

// Simple variable resolver for preview
function resolvePromptVariables(prompt: string, listing: Listing): string {
  let resolved = prompt;
  
  // Replace common variables
  if (listing.apiResponse) {
    resolved = resolved.replace(/\{\{gemini_response\}\}/g, JSON.stringify(listing.apiResponse, null, 2));
  }
  if (listing.transcript) {
    const transcriptText = listing.transcript.segments.map((s, idx) => 
      `${idx + 1}. [${s.speaker}] ${s.text}`
    ).join('\n');
    resolved = resolved.replace(/\{\{transcript\}\}/g, transcriptText);
  }
  if (listing.aiEval?.llmTranscript) {
    const aiTranscriptText = listing.aiEval.llmTranscript.segments.map((s, idx) => 
      `${idx + 1}. [${s.speaker}] ${s.text}`
    ).join('\n');
    resolved = resolved.replace(/\{\{llm_transcript\}\}/g, aiTranscriptText);
  }
  
  // Replace segment count
  const segmentCount = listing.transcript?.segments?.length || 0;
  resolved = resolved.replace(/\{\{segment_count\}\}/g, String(segmentCount));
  
  // Add more replacements as needed...
  
  return resolved;
}

export function EvaluationPreviewOverlay({
  isOpen,
  onClose,
  title,
  prompt,
  schema,
  listing,
}: EvaluationPreviewOverlayProps) {
  if (!isOpen) return null;

  // Resolve variables in prompt
  const resolvedPrompt = resolvePromptVariables(prompt, listing);
  
  // Extract variable context
  const variableMatches = prompt.match(/\{\{([^}]+)\}\}/g) || [];
  const variables = Array.from(new Set(variableMatches.map(v => v.replace(/[{}]/g, ''))));

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      
      {/* Slide-over Panel */}
      <div className="fixed inset-y-0 right-0 z-[101] w-[70vw] bg-[var(--bg-primary)] shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
            <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Close preview"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-5 space-y-6">
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
                  {resolvedPrompt}
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
                      // Get resolved value
                      const testPrompt = `{{${variable}}}`;
                      const resolved = resolvePromptVariables(testPrompt, listing);
                      const value = resolved === testPrompt ? '(unavailable)' : resolved;
                      
                      return (
                        <div key={idx} className="flex items-start gap-3 p-3">
                          <code className="shrink-0 text-[11px] font-mono text-[var(--color-brand-primary)] bg-[var(--bg-tertiary)] px-2 py-1 rounded">
                            {`{{${variable}}}`}
                          </code>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] text-[var(--text-secondary)] break-words">
                              {value}
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
        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-end px-6 py-4 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <Button onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      </div>
    </>
  );
}
