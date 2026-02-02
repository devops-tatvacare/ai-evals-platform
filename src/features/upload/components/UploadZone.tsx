import { useCallback, useState } from 'react';
import { FileAudio, FileText, Upload, X, AlertCircle, ArrowRight } from 'lucide-react';
import { Button, Card, Badge } from '@/components/ui';
import { cn, formatFileSize } from '@/utils';
import { validateFiles, type ValidatedFile, type FileCategory } from '../utils/fileValidation';

interface UploadZoneProps {
  onFilesSelected: (files: ValidatedFile[]) => void;
  disabled?: boolean;
}

export function UploadZone({ onFilesSelected, disabled }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<ValidatedFile[]>([]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (disabled) return;
    
    const files = Array.from(e.dataTransfer.files);
    const validated = validateFiles(files);
    setSelectedFiles(validated);
  }, [disabled]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const validated = validateFiles(files);
      setSelectedFiles(validated);
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpload = useCallback(() => {
    const validFiles = selectedFiles.filter((f) => !f.error);
    if (validFiles.length > 0) {
      onFilesSelected(validFiles);
    }
  }, [selectedFiles, onFilesSelected]);

  const getCategoryIcon = (category: FileCategory) => {
    switch (category) {
      case 'audio':
        return <FileAudio className="h-4 w-4 text-[var(--color-brand-primary)]" />;
      case 'transcript':
        return <FileText className="h-4 w-4 text-[var(--color-success)]" />;
      default:
        return <AlertCircle className="h-4 w-4 text-[var(--color-error)]" />;
    }
  };

  const hasValidFiles = selectedFiles.some((f) => !f.error);
  const hasAudio = selectedFiles.some((f) => f.category === 'audio' && !f.error);
  const hasTranscript = selectedFiles.some((f) => f.category === 'transcript' && !f.error);
  const hasFiles = selectedFiles.length > 0;

  return (
    <Card className="overflow-hidden p-0">
      <div className={cn(
        "flex",
        hasFiles ? "flex-row" : "flex-col"
      )}>
        {/* Drop Zone */}
        <div className={cn(
          "flex items-center justify-center",
          hasFiles ? "flex-1 p-6" : "w-full p-6"
        )}>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-all w-full',
              hasFiles ? 'py-10 px-6' : 'p-12',
              isDragging
                ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-accent)]/10'
                : 'border-[var(--border-default)] bg-[var(--bg-secondary)]',
              !disabled && 'hover:border-[var(--color-brand-primary)] hover:bg-[var(--color-brand-accent)]/5',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <input
              type="file"
              multiple
              accept=".wav,.mp3,.webm,.json,.txt"
              onChange={handleFileInput}
              disabled={disabled}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            
            <div className={cn(
              "flex items-center justify-center rounded-full bg-[var(--color-brand-accent)]/20",
              hasFiles ? "mb-3 h-10 w-10" : "mb-4 h-12 w-12"
            )}>
              <Upload className={cn(
                "text-[var(--color-brand-primary)]",
                hasFiles ? "h-5 w-5" : "h-6 w-6"
              )} />
            </div>
            
            <h2 className={cn(
              "font-medium text-[var(--text-primary)]",
              hasFiles ? "text-[14px]" : "text-base"
            )}>
              {isDragging ? 'Drop files here' : hasFiles ? 'Add more files' : 'Start a new evaluation'}
            </h2>
            <p className={cn(
              "text-[var(--text-secondary)]",
              hasFiles ? "mt-1 text-[12px]" : "mt-2 text-[13px]"
            )}>
              Drop files here or click to browse
            </p>
            
            {!hasFiles && (
              <div className="mt-6 flex gap-4 text-[12px] text-[var(--text-muted)]">
                <div className="flex items-center gap-1">
                  <FileAudio className="h-4 w-4" />
                  <span>.wav, .mp3, .webm</span>
                </div>
                <div className="flex items-center gap-1">
                  <FileText className="h-4 w-4" />
                  <span>.json, .txt</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Selected Files Panel */}
        {hasFiles && (
          <div className="flex w-80 shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                Selected Files
              </h3>
              <button
                onClick={() => setSelectedFiles([])}
                className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                Clear all
              </button>
            </div>
            
            <ul className="flex-1 space-y-2 overflow-y-auto max-h-64">
              {selectedFiles.map((validatedFile, index) => (
                <li
                  key={`${validatedFile.file.name}-${index}`}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                    validatedFile.error
                      ? 'border-[var(--color-error)]/30 bg-[var(--color-error)]/5'
                      : 'border-[var(--border-default)] bg-[var(--bg-primary)]'
                  )}
                >
                  <div className="shrink-0">
                    {getCategoryIcon(validatedFile.category)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                      {validatedFile.file.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {formatFileSize(validatedFile.file.size)}
                      </span>
                      {!validatedFile.error && (
                        <Badge 
                          variant={validatedFile.category === 'audio' ? 'primary' : 'success'}
                          className="text-[9px] px-1.5 py-0"
                        >
                          {validatedFile.category}
                        </Badge>
                      )}
                    </div>
                    {validatedFile.error && (
                      <p className="mt-0.5 text-[10px] text-[var(--color-error)]">
                        {validatedFile.error}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => removeFile(index)}
                    className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
              <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
                {hasAudio && (
                  <span className="flex items-center gap-1 text-[var(--color-success)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                    Audio ready
                  </span>
                )}
                {hasTranscript && (
                  <span className="flex items-center gap-1 text-[var(--color-success)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                    Transcript ready
                  </span>
                )}
                {!hasAudio && !hasTranscript && (
                  <span className="text-[var(--color-warning)]">Add audio or transcript</span>
                )}
              </div>
              
              <Button
                className="w-full gap-2"
                onClick={handleUpload}
                disabled={!hasValidFiles}
              >
                Start Evaluation
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
