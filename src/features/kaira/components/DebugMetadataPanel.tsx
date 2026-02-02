/**
 * Debug Metadata Panel
 * Shows session and API metadata for debugging (dev mode only)
 */

import { useState } from 'react';
import { Bug, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { cn } from '@/utils';
import type { KairaChatSession, KairaChatMessage } from '@/types';

interface DebugMetadataPanelProps {
  session: KairaChatSession | null;
  lastAssistantMessage?: KairaChatMessage;
}

interface MetadataItemProps {
  label: string;
  value: string | number | boolean | undefined | null;
  copyable?: boolean;
}

function MetadataItem({ label, value, copyable = true }: MetadataItemProps) {
  const [copied, setCopied] = useState(false);
  
  const displayValue = value === undefined || value === null ? '—' : String(value);
  
  const handleCopy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(String(value));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-[var(--text-muted)] shrink-0">{label}:</span>
      <code className="font-mono text-[var(--text-secondary)] truncate max-w-[200px]">
        {displayValue}
      </code>
      {copyable && value && (
        <button
          onClick={handleCopy}
          className="shrink-0 p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
          title="Copy to clipboard"
        >
          {copied ? (
            <Check className="h-3 w-3 text-[var(--color-success)]" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}

export function DebugMetadataPanel({ session, lastAssistantMessage }: DebugMetadataPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Only render in development mode
  if (!import.meta.env.DEV) {
    return null;
  }

  const metadata = lastAssistantMessage?.metadata;

  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/50">
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'w-full flex items-center justify-between px-4 py-1.5',
          'text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
          'transition-colors'
        )}
      >
        <div className="flex items-center gap-1.5">
          <Bug className="h-3 w-3" />
          <span className="font-medium">Debug Info</span>
          {session?.serverSessionId && (
            <span className="text-[10px] opacity-60">
              (session: {session.serverSessionId.slice(0, 8)}...)
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronUp className="h-3 w-3" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* Session Info */}
          <div className="space-y-1">
            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
              Session
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <MetadataItem label="Local ID" value={session?.id} />
              <MetadataItem label="Thread ID" value={session?.threadId} />
              <MetadataItem label="Server Session" value={session?.serverSessionId} />
              <MetadataItem label="User ID" value={session?.userId} />
              <MetadataItem label="Status" value={session?.status} copyable={false} />
            </div>
          </div>

          {/* Last Response Info */}
          {metadata && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                Last Response
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <MetadataItem label="Response ID" value={metadata.responseId} />
                <MetadataItem 
                  label="Processing Time" 
                  value={metadata.processingTime ? `${metadata.processingTime.toFixed(2)}s` : undefined} 
                  copyable={false}
                />
                <MetadataItem 
                  label="Multi-Intent" 
                  value={metadata.isMultiIntent !== undefined ? String(metadata.isMultiIntent) : undefined} 
                  copyable={false}
                />
                <MetadataItem 
                  label="Agents" 
                  value={metadata.intents?.map(i => i.agent).join(', ')} 
                  copyable={false}
                />
              </div>
              
              {/* Agent Responses Detail */}
              {metadata.agentResponses && metadata.agentResponses.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] text-[var(--text-muted)] mb-1">Agent Responses:</div>
                  <div className="space-y-1">
                    {metadata.agentResponses.map((agent, idx) => (
                      <div 
                        key={idx}
                        className={cn(
                          'text-[10px] px-2 py-1 rounded bg-[var(--bg-secondary)]',
                          agent.success ? 'border-l-2 border-[var(--color-success)]' : 'border-l-2 border-[var(--color-error)]'
                        )}
                      >
                        <span className="font-medium">{agent.agent}</span>
                        <span className="text-[var(--text-muted)] ml-1">
                          ({agent.success ? 'success' : 'failed'})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Intent Confidence */}
              {metadata.intents && metadata.intents.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] text-[var(--text-muted)] mb-1">Intent Confidence:</div>
                  <div className="flex flex-wrap gap-1">
                    {metadata.intents.map((intent, idx) => (
                      <span 
                        key={idx}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] font-mono"
                      >
                        {intent.agent}: {(intent.confidence * 100).toFixed(0)}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
