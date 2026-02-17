/**
 * API Debug Overlay Component
 * Right-side slide-over panel displaying raw API request/response for debugging
 */

import { useState } from 'react';
import { X, Code, Copy, Check } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import type { KairaChatRequest, KairaChatResponse } from '@/types';

interface ApiDebugOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  apiRequest?: KairaChatRequest;
  apiResponse?: KairaChatResponse;
}

export function ApiDebugOverlay({
  isOpen,
  onClose,
  apiRequest,
  apiResponse,
}: ApiDebugOverlayProps) {
  const [copiedSection, setCopiedSection] = useState<'request' | 'response' | null>(null);

  if (!isOpen) return null;

  const hasData = apiRequest || apiResponse;

  const handleCopy = async (data: unknown, section: 'request' | 'response') => {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

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
            <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">
              API Request / Response
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
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {!hasData ? (
              <EmptyState
                icon={Code}
                title="No API data available"
                description="Send a message to see request/response data here."
                compact
              />
            ) : (
              <>
                {apiRequest && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                        Request
                      </h3>
                      <button
                        onClick={() => handleCopy(apiRequest, 'request')}
                        className="flex items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        aria-label="Copy request"
                      >
                        {copiedSection === 'request' ? (
                          <><Check className="h-3.5 w-3.5 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
                        ) : (
                          <><Copy className="h-3.5 w-3.5" /><span>Copy</span></>
                        )}
                      </button>
                    </div>
                    <div className="rounded-lg bg-[var(--bg-tertiary)] p-4 overflow-x-auto">
                      <pre className="text-[12px] font-mono text-[var(--text-primary)] whitespace-pre-wrap">
                        {JSON.stringify(apiRequest, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {apiResponse && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                        Response
                      </h3>
                      <button
                        onClick={() => handleCopy(apiResponse, 'response')}
                        className="flex items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        aria-label="Copy response"
                      >
                        {copiedSection === 'response' ? (
                          <><Check className="h-3.5 w-3.5 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
                        ) : (
                          <><Copy className="h-3.5 w-3.5" /><span>Copy</span></>
                        )}
                      </button>
                    </div>
                    <div className="rounded-lg bg-[var(--bg-tertiary)] p-4 overflow-x-auto">
                      <pre className="text-[12px] font-mono text-[var(--text-primary)] whitespace-pre-wrap">
                        {JSON.stringify(apiResponse, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </>
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
