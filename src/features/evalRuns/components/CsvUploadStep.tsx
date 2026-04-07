import { useState, useCallback, useRef, type ElementType } from 'react';
import { FileSpreadsheet, AlertCircle, BarChart3, Users, MessageSquare, Calendar, RotateCcw, Upload } from 'lucide-react';
import { cn } from '@/utils';
import { Alert } from '@/components/ui';
import { previewCsv } from '@/services/api/evalRunsApi';
import type { PreviewResponse } from '@/types';
import { CsvFileInfoBar } from '@/features/csvImport/components/CsvFileInfoBar';
import { useCsvImportWorkflow } from '@/features/csvImport/useCsvImportWorkflow';
import {
  type ColumnMapping,
  CSV_FIELD_SCHEMA,
} from '../utils/csvSchema';
import { CsvFieldCallout } from './CsvFieldCallout';
import { CsvDataPreview } from './CsvDataPreview';
import { CsvFieldMapper } from './CsvFieldMapper';

interface CsvUploadStepProps {
  file: File | null;
  previewData: PreviewResponse | null;
  onFileChange: (file: File | null) => void;
  onPreviewData: (data: PreviewResponse | null) => void;
  columnMapping: ColumnMapping;
  onColumnMappingChange: (mapping: ColumnMapping) => void;
  appId: string;
}

export function CsvUploadStep({
  file,
  previewData,
  onFileChange,
  onPreviewData,
  columnMapping,
  onColumnMappingChange,
  appId,
}: CsvUploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Reset the native file input so re-selecting the same file fires onChange. */
  const resetFileInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const {
    error,
    csvPreview,
    headerValidation,
    isProcessing,
    needsMapping,
    mappingComplete,
    processFile,
    handleApplyMapping,
    handleRetry,
    handleReset,
  } = useCsvImportWorkflow<PreviewResponse>({
    schema: CSV_FIELD_SCHEMA,
    file,
    data: previewData,
    columnMapping,
    onFileChange,
    onDataChange: onPreviewData,
    onColumnMappingChange,
    analyzeCsv: async ({ file: sourceFile, csvText }) => {
      return previewCsv(
        new File([new Blob([csvText], { type: 'text/csv' })], sourceFile.name, { type: 'text/csv' }),
        appId,
      );
    },
  });

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

  const handleResetWithInput = useCallback(() => {
    handleReset();
    resetFileInput();
  }, [handleReset, resetFileInput]);

  return (
    <div className="space-y-4">
      {/* ── No file: show callout + drop zone ── */}
      {!file && (
        <>
          <CsvFieldCallout />

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-all py-10 px-6 cursor-pointer',
              isDragging
                ? 'border-[var(--border-brand)] bg-[var(--color-brand-accent)]/10'
                : 'border-[var(--border-default)] bg-[var(--bg-secondary)]',
              'hover:border-[var(--border-brand)] hover:bg-[var(--color-brand-accent)]/5'
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileInput}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            <div className="flex items-center justify-center rounded-full bg-[var(--color-brand-accent)]/20 mb-3 h-10 w-10">
              <Upload className="h-5 w-5 text-[var(--text-brand)]" />
            </div>
            <p className="text-[14px] font-medium text-[var(--text-primary)]">
              {isDragging ? 'Drop CSV file here' : 'Drop CSV file or click to browse'}
            </p>
            <div className="mt-2 flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>.csv (max 50MB)</span>
            </div>
          </div>

          {/* Validation error (wrong extension / too large) shown below drop zone */}
          {error && <Alert variant="error">{error}</Alert>}
        </>
      )}

      {/* ── File selected: loading state ── */}
      {file && isProcessing && (
        <div className="space-y-3">
          <CsvFileInfoBar file={file} variant="neutral" onReset={handleResetWithInput} />
          <div className="flex items-center gap-3 px-4 py-3 rounded-[6px] bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
            <div className="h-4 w-4 border-2 border-[var(--interactive-primary)] border-t-transparent rounded-full animate-spin" />
            <span className="text-[13px] text-[var(--text-secondary)]">Analyzing CSV file...</span>
          </div>
        </div>
      )}

      {/* ── File selected: backend error ── */}
      {file && error && !isProcessing && (
        <div className="space-y-3">
          <CsvFileInfoBar file={file} variant="error" onReset={handleResetWithInput} />
          <Alert variant="error">{error}</Alert>
          <button
            onClick={handleRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-md hover:bg-[var(--bg-secondary)] transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {/* ── File selected: needs column mapping ── */}
      {file && needsMapping && !isProcessing && !error && (
        <div className="space-y-3">
          <CsvFileInfoBar file={file} variant="warning" onReset={handleResetWithInput} />

          <CsvFieldMapper
            csvHeaders={csvPreview?.headers ?? []}
            mapping={columnMapping}
            onMappingChange={onColumnMappingChange}
            missingFields={headerValidation?.missing ?? []}
          />

          {mappingComplete && (
            <button
              onClick={handleApplyMapping}
              className="w-full px-4 py-2 text-[13px] font-medium rounded-md bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
            >
              Apply Mapping & Analyze
            </button>
          )}

          {csvPreview && <CsvDataPreview preview={csvPreview} columnMapping={columnMapping} />}
        </div>
      )}

      {/* ── File selected: success ── */}
      {file && previewData && !isProcessing && !error && !needsMapping && (
        <div className="space-y-3">
          <CsvFileInfoBar file={file} variant="success" onReset={handleResetWithInput} />

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

          {previewData.messagesWithErrors > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-warning)]">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{previewData.messagesWithErrors} messages with parse errors</span>
            </div>
          )}

          {csvPreview && <CsvDataPreview preview={csvPreview} />}
        </div>
      )}
    </div>
  );
}

function StatItem({ icon: Icon, label, value }: { icon: ElementType; label: string; value: string }) {
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
