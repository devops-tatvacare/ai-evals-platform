import { X } from 'lucide-react';
import { Button } from '@/components/ui';
import { JsonViewer } from '@/features/structured-outputs/components/JsonViewer';

interface ReadOnlyViewOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Render JSON schema via JsonViewer */
  jsonData?: Record<string, unknown>;
  /** Render plain text (prompt) */
  textContent?: string;
}

export function ReadOnlyViewOverlay({
  isOpen,
  onClose,
  title,
  description,
  jsonData,
  textContent,
}: ReadOnlyViewOverlayProps) {
  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 z-[101] w-[60vw] max-w-[900px] bg-[var(--bg-primary)] shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
            <h2 className="text-[16px] font-semibold text-[var(--text-primary)] truncate">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {description && (
              <p className="text-[13px] text-[var(--text-secondary)] mb-4">
                {description}
              </p>
            )}

            {jsonData && (
              <div className="rounded-md border border-[var(--border-default)]">
                <JsonViewer data={jsonData} initialExpanded={true} />
              </div>
            )}

            {textContent && (
              <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
                <pre className="text-[12px] font-mono text-[var(--text-primary)] whitespace-pre-wrap">
                  {textContent}
                </pre>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 flex items-center justify-end px-6 py-3 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
