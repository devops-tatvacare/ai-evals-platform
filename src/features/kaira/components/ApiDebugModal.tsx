/**
 * API Debug Modal Component
 * Displays raw API request/response for debugging chat messages
 */

import { Code } from 'lucide-react';
import { Modal, EmptyState } from '@/components/ui';
import type { KairaChatRequest, KairaChatResponse } from '@/types';

interface ApiDebugModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiRequest?: KairaChatRequest;
  apiResponse?: KairaChatResponse;
}

export function ApiDebugModal({ 
  isOpen, 
  onClose, 
  apiRequest, 
  apiResponse 
}: ApiDebugModalProps) {
  const hasData = apiRequest || apiResponse;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="API Request/Response"
      className="max-w-4xl max-h-[80vh] flex flex-col"
    >
      <div className="space-y-4 overflow-y-auto flex-1">
        {!hasData ? (
          <EmptyState
            icon={Code}
            title="No API data available"
            description="Send a message to see request/response data here."
            compact
          />
        ) : (
          <>
            {/* API Request */}
            {apiRequest && (
              <div>
                <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-2">
                  Request
                </h3>
                <div className="rounded-lg bg-[var(--bg-tertiary)] p-4 overflow-x-auto">
                  <pre className="text-[12px] font-mono text-[var(--text-primary)] whitespace-pre-wrap">
                    {JSON.stringify(apiRequest, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* API Response */}
            {apiResponse && (
              <div>
                <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-2">
                  Response
                </h3>
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
    </Modal>
  );
}
