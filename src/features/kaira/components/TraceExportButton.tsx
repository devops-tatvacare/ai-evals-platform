/**
 * Trace Export Button
 * Export trace data to JSON or CSV
 */

import { useState } from 'react';
import { Download, FileJson, FileText, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/utils';
import { exportTraceJSON, exportTraceCSV, downloadBlob } from '../utils/traceExport';
import type { KairaChatSession, KairaChatMessage } from '@/types';

interface TraceExportButtonProps {
  session: KairaChatSession;
  messages: KairaChatMessage[];
  className?: string;
}

type ExportFormat = 'json' | 'csv';

export function TraceExportButton({ session, messages, className }: TraceExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [lastExported, setLastExported] = useState<ExportFormat | null>(null);

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true);
    
    try {
      const safeTitle = session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const timestamp = new Date().toISOString().split('T')[0];
      
      let blob: Blob;
      let extension: string;
      
      if (format === 'json') {
        blob = exportTraceJSON(session, messages);
        extension = 'json';
      } else {
        blob = exportTraceCSV(session, messages);
        extension = 'csv';
      }
      
      const filename = `${safeTitle}_trace_${timestamp}.${extension}`;
      downloadBlob(blob, filename);
      
      setLastExported(format);
      setTimeout(() => setLastExported(null), 2000);
      setIsOpen(false);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <Button
        variant="secondary"
        onClick={() => setIsOpen(!isOpen)}
        className="gap-2"
      >
        <Download className="h-4 w-4" />
        Export Trace
      </Button>
      
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-2 w-48 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg shadow-lg overflow-hidden z-20">
            <button
              onClick={() => handleExport('json')}
              disabled={isExporting}
              className="w-full px-4 py-2.5 text-left text-[13px] hover:bg-[var(--interactive-secondary)] transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {lastExported === 'json' ? (
                <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
              ) : (
                <FileJson className="h-4 w-4 text-[var(--text-secondary)]" />
              )}
              <div>
                <div className="text-[var(--text-primary)]">JSON</div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  Complete trace data
                </div>
              </div>
            </button>
            
            <button
              onClick={() => handleExport('csv')}
              disabled={isExporting}
              className="w-full px-4 py-2.5 text-left text-[13px] hover:bg-[var(--interactive-secondary)] transition-colors flex items-center gap-2 disabled:opacity-50 border-t border-[var(--border-subtle)]"
            >
              {lastExported === 'csv' ? (
                <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
              ) : (
                <FileText className="h-4 w-4 text-[var(--text-secondary)]" />
              )}
              <div>
                <div className="text-[var(--text-primary)]">CSV</div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  Tabular format
                </div>
              </div>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
