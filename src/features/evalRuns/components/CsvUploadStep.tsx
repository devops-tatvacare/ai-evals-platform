import { useState, useCallback, useRef, useEffect } from 'react';
import { FileSpreadsheet, Upload, CheckCircle2, AlertCircle, BarChart3, Users, MessageSquare, Calendar, RotateCcw } from 'lucide-react';
import { cn } from '@/utils';
import { Alert } from '@/components/ui';
import { previewCsv } from '@/services/api/evalRunsApi';
import type { PreviewResponse } from '@/types';
import {
  parseCsvPreview,
  validateCsvHeaders,
  remapCsvContent,
  type CsvPreviewResult,
  type ColumnMapping,
  type HeaderValidation,
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
}

export function CsvUploadStep({
  file,
  previewData,
  onFileChange,
  onPreviewData,
  columnMapping,
  onColumnMappingChange,
}: CsvUploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvPreview, setCsvPreview] = useState<CsvPreviewResult | null>(null);
  const [headerValidation, setHeaderValidation] = useState<HeaderValidation | null>(null);
  const [rawCsvText, setRawCsvText] = useState<string | null>(null);

  // When file is cleared externally, reset local state
  useEffect(() => {
    if (!file) {
      setCsvPreview(null);
      setHeaderValidation(null);
      setRawCsvText(null);
    }
  }, [file]);

  /** Reset the native file input so re-selecting the same file fires onChange. */
  const resetFileInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  /** Read file, validate headers, then send to backend (with remapping if needed). */
  const processFile = useCallback(async (selectedFile: File) => {
    setError(null);
    setCsvPreview(null);
    setHeaderValidation(null);
    onColumnMappingChange(new Map());

    if (!selectedFile.name.endsWith('.csv')) {
      setError('Please upload a CSV file.');
      resetFileInput();
      return;
    }

    if (selectedFile.size > 50 * 1024 * 1024) {
      setError('File size exceeds 50MB limit.');
      resetFileInput();
      return;
    }

    // Read file text for client-side parsing
    const text = await selectedFile.text();
    setRawCsvText(text);

    // Parse preview (first 10 rows)
    const preview = parseCsvPreview(text, 10);
    setCsvPreview(preview);

    // Validate headers
    const validation = validateCsvHeaders(preview.headers);
    setHeaderValidation(validation);

    onFileChange(selectedFile);

    // If headers are valid, immediately send to backend for stats
    if (validation.isValid) {
      await sendToBackend(selectedFile, text);
    }
    // If headers are invalid, user needs to map columns first — don't auto-upload
  }, [onFileChange, onColumnMappingChange, resetFileInput]);

  /** Send CSV to backend for preview stats (possibly with remapped content). */
  const sendToBackend = useCallback(async (originalFile: File, csvText: string) => {
    setIsUploading(true);
    setError(null);
    try {
      // Create a File with the (possibly remapped) content
      const blob = new Blob([csvText], { type: 'text/csv' });
      const fileToUpload = new File([blob], originalFile.name, { type: 'text/csv' });
      const preview = await previewCsv(fileToUpload);
      onPreviewData(preview);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse CSV file.';
      setError(msg);
      onPreviewData(null);
    } finally {
      setIsUploading(false);
    }
  }, [onPreviewData]);

  /** Called when user completes field mapping and clicks "Apply Mapping". */
  const handleApplyMapping = useCallback(async () => {
    if (!rawCsvText || !file) return;

    const remapped = remapCsvContent(rawCsvText, columnMapping);
    setRawCsvText(remapped);

    // Re-parse preview with remapped content
    const preview = parseCsvPreview(remapped, 10);
    setCsvPreview(preview);

    // Re-validate
    const validation = validateCsvHeaders(preview.headers);
    setHeaderValidation(validation);

    if (validation.isValid) {
      await sendToBackend(file, remapped);
    }
  }, [rawCsvText, file, columnMapping, sendToBackend]);

  /** Retry sending to backend (when previous attempt failed). */
  const handleRetry = useCallback(async () => {
    if (!file || !rawCsvText) return;
    await sendToBackend(file, rawCsvText);
  }, [file, rawCsvText, sendToBackend]);

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
    onColumnMappingChange(new Map());
    setError(null);
    setCsvPreview(null);
    setHeaderValidation(null);
    setRawCsvText(null);
    resetFileInput();
  }, [onFileChange, onPreviewData, onColumnMappingChange, resetFileInput]);

  const needsMapping = headerValidation != null && !headerValidation.isValid;
  const mappingComplete = needsMapping && headerValidation.missing.every((f) => columnMapping.has(f));

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleFileInput}
        className="hidden"
      />

      {/* ── No file: show callout + drop zone ── */}
      {!file && (
        <>
          <CsvFieldCallout />

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

          {/* Validation error (wrong extension / too large) shown below drop zone */}
          {error && <Alert variant="error">{error}</Alert>}
        </>
      )}

      {/* ── File selected: loading state ── */}
      {file && isUploading && (
        <div className="space-y-3">
          <FileInfoBar file={file} variant="neutral" onReset={handleReset} />
          <div className="flex items-center gap-3 px-4 py-3 rounded-[6px] bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
            <div className="h-4 w-4 border-2 border-[var(--interactive-primary)] border-t-transparent rounded-full animate-spin" />
            <span className="text-[13px] text-[var(--text-secondary)]">Analyzing CSV file...</span>
          </div>
        </div>
      )}

      {/* ── File selected: backend error ── */}
      {file && error && !isUploading && (
        <div className="space-y-3">
          <FileInfoBar file={file} variant="error" onReset={handleReset} />
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
      {file && needsMapping && !isUploading && !error && (
        <div className="space-y-3">
          <FileInfoBar file={file} variant="warning" onReset={handleReset} />

          <CsvFieldMapper
            csvHeaders={csvPreview?.headers ?? []}
            mapping={columnMapping}
            onMappingChange={onColumnMappingChange}
            missingFields={headerValidation.missing}
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
      {file && previewData && !isUploading && !error && !needsMapping && (
        <div className="space-y-3">
          <FileInfoBar file={file} variant="success" onReset={handleReset} />

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

/* ── File Info Bar (extracted to avoid 4x duplication) ── */

type FileInfoVariant = 'success' | 'error' | 'warning' | 'neutral';

const FILE_BAR_STYLES: Record<FileInfoVariant, { bg: string; border: string; icon: typeof CheckCircle2; iconColor: string }> = {
  success:  { bg: 'bg-[var(--surface-success)]', border: 'border-[var(--border-success)]', icon: CheckCircle2, iconColor: 'text-[var(--color-success)]' },
  error:    { bg: 'bg-[var(--surface-error)]',   border: 'border-[var(--border-error)]',   icon: AlertCircle,  iconColor: 'text-[var(--color-error)]' },
  warning:  { bg: 'bg-[var(--color-warning-light)]', border: 'border-[var(--color-warning)]/30', icon: AlertCircle, iconColor: 'text-[var(--color-warning)]' },
  neutral:  { bg: 'bg-[var(--bg-secondary)]',    border: 'border-[var(--border-subtle)]',  icon: FileSpreadsheet, iconColor: 'text-[var(--text-muted)]' },
};

function FileInfoBar({ file, variant, onReset }: { file: File; variant: FileInfoVariant; onReset: () => void }) {
  const style = FILE_BAR_STYLES[variant];
  const Icon = style.icon;

  return (
    <div className={cn('flex items-center justify-between px-4 py-3 rounded-[6px]', style.bg, 'border', style.border)}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', style.iconColor)} />
        <span className="text-[13px] font-medium text-[var(--text-primary)]">{file.name}</span>
        <span className="text-[11px] text-[var(--text-muted)]">
          ({(file.size / 1024).toFixed(1)} KB)
        </span>
      </div>
      <button
        onClick={onReset}
        className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors underline"
      >
        Change file
      </button>
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
