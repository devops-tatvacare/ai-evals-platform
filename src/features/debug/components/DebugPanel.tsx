import { useState, useEffect, useMemo } from 'react';
import { Bug, X, ChevronDown, ChevronRight, Download, Trash2 } from 'lucide-react';
import { Card, Button, Badge } from '@/components/ui';
import { logger, type LogEntry } from '@/services/logger';
import { useTaskQueueStore } from '@/stores';
import { getStorageUsage } from '@/services/storage/db';
import { cn, formatFileSize } from '@/utils';

interface DebugPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DebugPanel({ isOpen, onClose }: DebugPanelProps) {
  const [activeTab, setActiveTab] = useState<'logs' | 'tasks' | 'storage'>('logs');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [storageInfo, setStorageInfo] = useState({ used: 0, quota: 0, percentage: 0 });
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  
  const { tasks, clearCompletedTasks } = useTaskQueueStore();

  // Refresh logs periodically
  useEffect(() => {
    if (!isOpen) return;
    
    const refreshLogs = () => {
      setLogs(logger.getBuffer());
    };
    
    refreshLogs();
    const interval = setInterval(refreshLogs, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Fetch storage info
  useEffect(() => {
    if (!isOpen || activeTab !== 'storage') return;
    
    getStorageUsage().then(setStorageInfo);
  }, [isOpen, activeTab]);

  const toggleLogExpand = (id: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleExportLogs = () => {
    const data = JSON.stringify(logs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice-rx-logs-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearLogs = () => {
    logger.clearBuffer();
    setLogs([]);
  };

  const logsByLevel = useMemo(() => {
    const counts = { debug: 0, info: 0, warn: 0, error: 0 };
    logs.forEach(log => counts[log.level]++);
    return counts;
  }, [logs]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 w-[560px]">
      <Card className="flex flex-col overflow-hidden shadow-xl border-[var(--border-default)] h-[350px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2">
          <div className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-[var(--color-warning)]" />
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">Debug Panel</span>
            <Badge variant="warning">DEV</Badge>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)]">
          {(['logs', 'tasks', 'storage'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'flex-1 px-4 py-2 text-[12px] font-medium transition-colors',
                activeTab === tab
                  ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] border-b-2 border-[var(--color-brand-primary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'logs' && logs.length > 0 && (
                <span className="ml-1 text-[var(--text-muted)]">({logs.length})</span>
              )}
              {tab === 'tasks' && tasks.length > 0 && (
                <span className="ml-1 text-[var(--text-muted)]">({tasks.length})</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Logs Tab */}
          {activeTab === 'logs' && (
            <div>
              {/* Summary */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                <span className="text-[11px] text-[var(--text-muted)]">
                  {logsByLevel.error > 0 && <span className="text-[var(--color-error)] mr-2">● {logsByLevel.error} errors</span>}
                  {logsByLevel.warn > 0 && <span className="text-[var(--color-warning)] mr-2">● {logsByLevel.warn} warnings</span>}
                  {logsByLevel.info > 0 && <span className="text-[var(--color-info)] mr-2">● {logsByLevel.info} info</span>}
                </span>
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={handleExportLogs} className="h-6 px-2 text-[11px]">
                  <Download className="h-3 w-3 mr-1" />
                  Export
                </Button>
                <Button variant="ghost" size="sm" onClick={handleClearLogs} className="h-6 px-2 text-[11px]">
                  <Trash2 className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              </div>

              {/* Log entries */}
              {logs.length === 0 ? (
                <div className="p-4 text-center text-[12px] text-[var(--text-muted)]">
                  No logs yet
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {[...logs].reverse().map(log => (
                    <div 
                      key={log.id}
                      className="px-3 py-2 hover:bg-[var(--bg-secondary)] cursor-pointer"
                      onClick={() => log.context && toggleLogExpand(log.id)}
                    >
                      <div className="flex items-start gap-2">
                        {log.context && (
                          expandedLogs.has(log.id) 
                            ? <ChevronDown className="h-3 w-3 mt-0.5 text-[var(--text-muted)]" />
                            : <ChevronRight className="h-3 w-3 mt-0.5 text-[var(--text-muted)]" />
                        )}
                        <span className={cn(
                          'shrink-0 text-[10px] font-mono uppercase',
                          log.level === 'error' && 'text-[var(--color-error)]',
                          log.level === 'warn' && 'text-[var(--color-warning)]',
                          log.level === 'info' && 'text-[var(--color-info)]',
                          log.level === 'debug' && 'text-[var(--text-muted)]',
                        )}>
                          {log.level}
                        </span>
                        <span className="text-[11px] text-[var(--text-primary)] break-all flex-1">
                          {log.message}
                        </span>
                        <span className="shrink-0 text-[10px] text-[var(--text-muted)] font-mono">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {expandedLogs.has(log.id) && log.context && (
                        <pre className="mt-2 ml-5 p-2 rounded bg-[var(--bg-tertiary)] text-[10px] font-mono text-[var(--text-secondary)] overflow-x-auto">
                          {JSON.stringify(log.context, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tasks Tab */}
          {activeTab === 'tasks' && (
            <div>
              <div className="px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex items-center justify-between">
                <span className="text-[11px] text-[var(--text-muted)]">
                  Active tasks in queue
                </span>
                <Button variant="ghost" size="sm" onClick={clearCompletedTasks} className="h-6 px-2 text-[11px]">
                  <Trash2 className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              </div>
              {tasks.length === 0 ? (
                <div className="p-4 text-center text-[12px] text-[var(--text-muted)]">
                  No tasks in queue
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {tasks.map(task => (
                    <div key={task.id} className="px-4 py-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-medium text-[var(--text-primary)]">{task.type}</span>
                          {task.type === 'ai_eval' && task.callNumber && (
                            <span className="px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[9px] font-medium bg-[var(--color-brand-accent)]/20 text-[var(--color-brand-primary)]">
                              Call {task.callNumber}/2
                            </span>
                          )}
                          {task.stage && (
                            <span className="text-[10px] text-[var(--text-muted)]">
                              {task.stage}
                            </span>
                          )}
                        </div>
                        <span className={cn(
                          'px-2 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-semibold uppercase',
                          task.status === 'completed' && 'bg-[var(--color-success-light)] text-[var(--color-success)]',
                          task.status === 'failed' && 'bg-[var(--color-error-light)] text-[var(--color-error)]',
                          task.status === 'processing' && 'bg-[var(--color-brand-accent)]/20 text-[var(--color-brand-primary)]',
                          task.status === 'pending' && 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]',
                        )}>
                          {task.status}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                        Listing: {task.listingId.slice(0, 8)}... | Created: {new Date(task.createdAt).toLocaleTimeString()}
                      </div>
                      {task.progress !== undefined && task.progress > 0 && task.progress < 100 && (
                        <div className="mt-2 h-1 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                          <div
                            className="h-full bg-[var(--color-brand-primary)] transition-all duration-300"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      )}
                      {task.error && (
                        <div className="mt-2 p-2 rounded-[var(--radius-sm)] bg-[var(--color-error-light)] border border-[var(--color-error)]/20 text-[10px] text-[var(--color-error)]">
                          <span className="font-semibold">Error:</span> {task.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Storage Tab */}
          {activeTab === 'storage' && (
            <div className="p-4">
              <div className="mb-4">
                <div className="flex justify-between text-[12px] mb-2">
                  <span className="text-[var(--text-secondary)]">IndexedDB Usage</span>
                  <span className="text-[var(--text-primary)]">{storageInfo.percentage.toFixed(1)}%</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                  <div 
                    className="h-full bg-[var(--color-brand-primary)] transition-all"
                    style={{ width: `${Math.min(storageInfo.percentage, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
                  <span>{formatFileSize(storageInfo.used)} used</span>
                  <span>{formatFileSize(storageInfo.quota)} quota</span>
                </div>
              </div>
              <div className="text-[11px] text-[var(--text-muted)]">
                Storage includes audio files, transcripts, and evaluation data stored locally in your browser.
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
