import { useState, useCallback, useRef } from 'react';
import { FileSpreadsheet, Upload, CheckCircle2, AlertCircle, BarChart3, Users, MessageSquare, Calendar } from 'lucide-react';
import { cn } from '@/utils';
import { Alert } from '@/components/ui';
import { previewCsv } from '@/services/api/evalRunsApi';
import type { PreviewResponse } from '@/types';

interface CsvUploadStepProps {
  file: File | null;
  previewData: PreviewResponse | null;
  onFileChange: (file: File | null) => void;
  onPreviewData: (data: PreviewResponse | null) => void;
}

export function CsvUploadStep({ file, previewData, onFileChange, onPreviewData }: CsvUploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (selectedFile: File) => {
    setError(null);

    if (!selectedFile.name.endsWith('.csv')) {
      setError('Please upload a CSV file.');
      return;
    }

    if (selectedFile.size > 50 * 1024 * 1024) {
      setError('File size exceeds 50MB limit.');
      return;
    }

    onFileChange(selectedFile);
    setIsUploading(true);

    try {
      const preview = await previewCsv(selectedFile);
      onPreviewData(preview);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse CSV file.';
      setError(msg);
      onPreviewData(null);
    } finally {
      setIsUploading(false);
    }
  }, [onFileChange, onPreviewData]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) processFile(droppedFile);
  }, [processFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) processFile(selectedFile);
  }, [processFile]);

  const handleReset = useCallback(() => {
    onFileChange(null);
    onPreviewData(null);
    setError(null);
  }, [onFileChange, onPreviewData]);

  return (
    <div className="space-y-4">
      {/* Hidden file input — triggered via ref to avoid browser quirks with opacity-0 inputs in overlays */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleFileInput}
        className="hidden"
      />

      {/* Drop zone (show when no file or on error) */}
      {!file || error ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-all py-10 px-6 cursor-pointer',
            isDragging
              ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-accent)]/10'
              : 'border-[var(--border-default)] bg-[var(--bg-secondary)]',
            'hover:border-[var(--color-brand-primary)] hover:bg-[var(--color-brand-accent)]/5'
          )}
        >
          <div className="flex items-center justify-center rounded-full bg-[var(--color-brand-accent)]/20 mb-3 h-10 w-10">
            <Upload className="h-5 w-5 text-[var(--color-brand-primary)]" />
          </div>
          <p className="text-[14px] font-medium text-[var(--text-primary)]">
            {isDragging ? 'Drop CSV file here' : 'Drop CSV file or click to browse'}
          </p>
          <div className="mt-2 flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>.csv (max 50MB)</span>
          </div>
        </div>
      ) : null}

      {/* Error */}
      {error && (
        <Alert variant="error">{error}</Alert>
      )}

      {/* Loading */}
      {isUploading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[6px] bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
          <div className="h-4 w-4 border-2 border-[var(--interactive-primary)] border-t-transparent rounded-full animate-spin" />
          <span className="text-[13px] text-[var(--text-secondary)]">Analyzing CSV file...</span>
        </div>
      )}

      {/* Preview card */}
      {file && previewData && !isUploading && !error && (
        <div className="space-y-3">
          {/* File info */}
          <div className="flex items-center justify-between px-4 py-3 rounded-[6px] bg-[var(--surface-success)] border border-[var(--border-success)]">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">{file.name}</span>
              <span className="text-[11px] text-[var(--text-muted)]">
                ({(file.size / 1024).toFixed(1)} KB)
              </span>
            </div>
            <button
              onClick={handleReset}
              className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors underline"
            >
              Change file
            </button>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatItem icon={MessageSquare} label="Messages" value={previewData.totalMessages.toLocaleString()} />
            <StatItem icon={BarChart3} label="Threads" value={previewData.totalThreads.toLocaleString()} />
            <StatItem icon={Users} label="Users" value={previewData.totalUsers.toLocaleString()} />
            <StatItem
              icon={Calendar}
              label="Date Range"
              value={
                previewData.dateRange
                  ? `${formatDate(previewData.dateRange.start)} — ${formatDate(previewData.dateRange.end)}`
                  : 'N/A'
              }
            />
          </div>

          {/* Warnings */}
          {previewData.messagesWithErrors > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-warning)]">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{previewData.messagesWithErrors} messages with parse errors</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-[6px] bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
      <Icon className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
        <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{value}</p>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}
