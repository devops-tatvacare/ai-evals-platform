/**
 * Trace Analysis View
 * Displays message-by-message trace metadata for a chat session
 */

import { useState, useMemo } from 'react';
import { Search, Filter, X } from 'lucide-react';
import { Card, Badge, Button, Input } from '@/components/ui';
import { TraceMessageRow } from './TraceMessageRow';
import { TraceStatisticsBar } from './TraceStatisticsBar';
import { extractTraceData } from '../utils/traceDataExtractor';
import type { KairaChatMessage } from '@/types';

interface TraceAnalysisViewProps {
  messages: KairaChatMessage[];
}

type RoleFilter = 'all' | 'user' | 'assistant';
type StatusFilter = 'all' | 'complete' | 'error' | 'streaming' | 'pending';

export function TraceAnalysisView({ messages }: TraceAnalysisViewProps) {
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
        <Card className="p-8 text-center">
          <p className="text-[var(--text-secondary)]">No messages in this conversation yet</p>
        </Card>
      </div>
    );
  }

  // Display messages in reverse chronological order (newest first)
  const reversedMessages = [...filteredMessages].reverse();

  return (
    <div className="space-y-4 p-6 h-full overflow-y-auto">
      {/* Statistics Bar */}
      <TraceStatisticsBar messages={messages} />
      
      {/* Filters */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-[var(--text-secondary)]" />
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Filters</h3>
          {hasActiveFilters && (
            <Button
              variant="secondary"
              onClick={clearFilters}
              className="ml-auto text-[11px] h-6 px-2"
            >
              <X className="h-3 w-3 mr-1" />
              Clear All
            </Button>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
            <Input
              placeholder="Search in content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 text-[12px] h-8"
            />
          </div>
          
          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            className="h-8 px-2 text-[12px] rounded border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
          >
            <option value="all">All Roles</option>
            <option value="user">User Only</option>
            <option value="assistant">Assistant Only</option>
          </select>
          
          {/* Agent Filter */}
          {availableAgents.length > 0 && (
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="h-8 px-2 text-[12px] rounded border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
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
            className="h-8 px-2 text-[12px] rounded border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
          >
            <option value="all">All Statuses</option>
            <option value="complete">Complete</option>
            <option value="error">Error</option>
            <option value="streaming">Streaming</option>
            <option value="pending">Pending</option>
          </select>
        </div>
      </Card>
      
      {/* Results Summary */}
      <div className="text-sm text-[var(--text-secondary)]">
        {filteredMessages.length === messages.length ? (
          <>
            {messages.length} message{messages.length !== 1 ? 's' : ''} in this conversation
          </>
        ) : (
          <>
            Showing {filteredMessages.length} of {messages.length} message{messages.length !== 1 ? 's' : ''}
            {hasActiveFilters && (
              <Badge variant="info" className="ml-2">
                Filtered
              </Badge>
            )}
          </>
        )}
      </div>
      
      {/* Messages */}
      {reversedMessages.length > 0 ? (
        <div className="space-y-3">
          {reversedMessages.map((message) => (
            <TraceMessageRow key={message.id} message={message} />
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <p className="text-[var(--text-secondary)]">No messages match the current filters</p>
          <Button
            variant="secondary"
            onClick={clearFilters}
            className="mt-4"
          >
            Clear Filters
          </Button>
        </Card>
      )}
    </div>
  );
}
