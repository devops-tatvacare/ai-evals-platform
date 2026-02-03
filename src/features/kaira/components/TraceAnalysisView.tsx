/**
 * Trace Analysis View
 * Displays message-by-message trace metadata for a chat session
 */

import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { TraceMessageRow } from './TraceMessageRow';
import { TraceStatisticsBar } from './TraceStatisticsBar';
import { TraceExportButton } from './TraceExportButton';
import { extractTraceData } from '../utils/traceDataExtractor';
import type { KairaChatMessage, KairaChatSession } from '@/types';

interface TraceAnalysisViewProps {
  session: KairaChatSession | null;
  messages: KairaChatMessage[];
}

type RoleFilter = 'all' | 'user' | 'assistant';
type StatusFilter = 'all' | 'complete' | 'error' | 'streaming' | 'pending';

export function TraceAnalysisView({ session, messages }: TraceAnalysisViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  
  // Get unique agents from messages
  const availableAgents = useMemo(() => {
    const agents = new Set<string>();
    messages.forEach(m => {
      const extracted = extractTraceData(m.metadata);
      if (extracted.primaryIntent?.agent) {
        agents.add(extracted.primaryIntent.agent);
      }
    });
    return Array.from(agents).sort();
  }, [messages]);
  
  // Filter messages
  const filteredMessages = useMemo(() => {
    return messages.filter(message => {
      // Role filter
      if (roleFilter !== 'all' && message.role !== roleFilter) {
        return false;
      }
      
      // Status filter
      if (statusFilter !== 'all' && message.status !== statusFilter) {
        return false;
      }
      
      // Agent filter
      if (agentFilter !== 'all') {
        const extracted = extractTraceData(message.metadata);
        if (extracted.primaryIntent?.agent !== agentFilter) {
          return false;
        }
      }
      
      // Search query (in message content)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return message.content.toLowerCase().includes(query);
      }
      
      return true;
    });
  }, [messages, roleFilter, statusFilter, agentFilter, searchQuery]);
  
  // Check if any filters are active
  const hasActiveFilters = roleFilter !== 'all' || statusFilter !== 'all' || agentFilter !== 'all' || searchQuery.trim() !== '';
  
  // Clear all filters
  const clearFilters = () => {
    setRoleFilter('all');
    setStatusFilter('all');
    setAgentFilter('all');
    setSearchQuery('');
  };

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <p className="text-[12px] text-[var(--text-secondary)]">No messages in this conversation yet</p>
        </div>
      </div>
    );
  }

  // Display messages in reverse chronological order (newest first)
  const reversedMessages = [...filteredMessages].reverse();

  return (
    <div className="h-full flex flex-col">
      {/* Statistics Bar */}
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
        <TraceStatisticsBar messages={messages} />
      </div>
      
      {/* Filters Bar */}
      <div className="border-b border-[var(--border-subtle)] px-4 py-2 bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-7 pl-7 pr-2 text-[11px] rounded border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
            />
          </div>
          
          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            className="h-7 px-2 text-[11px] rounded border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
          >
            <option value="all">All Roles</option>
            <option value="user">User</option>
            <option value="assistant">Assistant</option>
          </select>
          
          {/* Agent Filter */}
          {availableAgents.length > 0 && (
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="h-7 px-2 text-[11px] rounded border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
            >
              <option value="all">All Agents</option>
              {availableAgents.map(agent => (
                <option key={agent} value={agent}>{agent}</option>
              ))}
            </select>
          )}
          
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="h-7 px-2 text-[11px] rounded border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
          >
            <option value="all">All Status</option>
            <option value="complete">Complete</option>
            <option value="error">Error</option>
            <option value="streaming">Streaming</option>
            <option value="pending">Pending</option>
          </select>
          
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="h-7 px-2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
          
          {/* Results count */}
          <span className="text-[11px] text-[var(--text-muted)]">
            {filteredMessages.length} of {messages.length}
          </span>
          
          {/* Export Button */}
          {session && (
            <div className="ml-auto">
              <TraceExportButton session={session} messages={messages} />
            </div>
          )}
        </div>
      </div>
      
      {/* Messages Table */}
      <div className="flex-1 overflow-y-auto">
        {reversedMessages.length > 0 ? (
          <div>
            {reversedMessages.map((message) => (
              <TraceMessageRow key={message.id} message={message} />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-[12px] text-[var(--text-secondary)]">No messages match filters</p>
              <button
                onClick={clearFilters}
                className="mt-2 text-[11px] text-[var(--text-brand)] hover:underline"
              >
                Clear filters
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
