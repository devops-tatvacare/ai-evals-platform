import { useCallback, useState } from 'react';
import { FileAudio, FileText, Upload, X, AlertCircle } from 'lucide-react';
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

  return (
    <Card className="p-6">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center transition-colors',
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
        
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-brand-accent)]/20">
          <Upload className="h-6 w-6 text-[var(--color-brand-primary)]" />
        </div>
        
        <h2 className="text-base font-medium text-[var(--text-primary)]">
          {isDragging ? 'Drop files here' : 'Start a new evaluation'}
        </h2>
        <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
          Drop files here or click to browse
        </p>
        
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
      </div>

      {selectedFiles.length > 0 && (
        <div className="mt-6 space-y-3">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Selected Files</h3>
          
          <ul className="space-y-2">
            {selectedFiles.map((validatedFile, index) => (
              <li
                key={`${validatedFile.file.name}-${index}`}
                className={cn(
                  'flex items-center justify-between rounded-lg border p-3',
                  validatedFile.error
                    ? 'border-[var(--color-error)]/30 bg-[var(--color-error)]/5'
                    : 'border-[var(--border-default)] bg-[var(--bg-tertiary)]'
                )}
              >
                <div className="flex items-center gap-3">
                  {getCategoryIcon(validatedFile.category)}
                  <div>
                    <p className="text-[13px] font-medium text-[var(--text-primary)]">
                      {validatedFile.file.name}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {formatFileSize(validatedFile.file.size)}
                      {validatedFile.error && (
                        <span className="ml-2 text-[var(--color-error)]">
                          {validatedFile.error}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {!validatedFile.error && (
                    <Badge variant={validatedFile.category === 'audio' ? 'primary' : 'success'}>
                      {validatedFile.category}
                    </Badge>
                  )}
                  <button
                    onClick={() => removeFile(index)}
                    className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-4">
            <div className="text-[12px] text-[var(--text-muted)]">
              {hasAudio && <span className="mr-3">✓ Audio file</span>}
              {hasTranscript && <span>✓ Transcript file</span>}
              {!hasAudio && !hasTranscript && <span className="text-[var(--color-warning)]">Add audio or transcript file</span>}
            </div>
            
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedFiles([])}
              >
                Clear
              </Button>
              <Button
                size="sm"
                onClick={handleUpload}
                disabled={!hasValidFiles}
              >
                Create Evaluation
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
