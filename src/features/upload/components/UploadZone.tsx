import { useCallback, useState } from 'react';
import { FileAudio, Upload, X, AlertCircle, ArrowRight } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { cn } from '@/utils';
import { validateAudioFiles, type ValidatedFile, ACCEPTED_AUDIO_EXTENSIONS } from '../utils/fileValidation';

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
    const validated = validateAudioFiles(files);
    setSelectedFiles(validated);
  }, [disabled]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const validated = validateAudioFiles(files);
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

  const getFileIcon = (validatedFile: ValidatedFile, size: 'sm' | 'lg' = 'sm') => {
    const iconClass = size === 'lg' ? 'h-6 w-6' : 'h-4 w-4';
    if (validatedFile.error) {
      return <AlertCircle className={`${iconClass} text-[var(--color-error)]`} />;
    }
    return <FileAudio className={`${iconClass} text-[var(--text-brand)]`} />;
  };

  const hasValidFiles = selectedFiles.some((f) => !f.error);
  const hasFiles = selectedFiles.length > 0;
  const visibleFiles = selectedFiles.slice(0, 3);
  const remainingCount = selectedFiles.length - 3;

  // Audio file extensions for accept attribute
  const acceptExtensions = ACCEPTED_AUDIO_EXTENSIONS.join(',');

  return (
    <Card className="overflow-hidden p-0 bg-[var(--bg-secondary)]">
      <div className="p-6">
        {hasFiles ? (
          <>
            {/* File Icons Row */}
            <div className="flex items-center justify-center gap-3 py-8">
              {visibleFiles.map((validatedFile, index) => (
                <div key={`${validatedFile.file.name}-${index}`} className="relative inline-block">
                  <div className={cn(
                    "flex items-center justify-center rounded-xl p-4",
                    validatedFile.error 
                      ? "bg-[var(--color-error)]/10"
                      : "bg-[var(--color-brand-accent)]/20"
                  )}>
                    {getFileIcon(validatedFile, 'lg')}
                  </div>
                  <button
                    onClick={() => removeFile(index)}
                    className="absolute -top-2 -right-2 rounded-full bg-[var(--bg-primary)] border border-[var(--border-default)] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors shadow-sm"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {remainingCount > 0 && (
                <div className="flex items-center justify-center rounded-xl bg-[var(--bg-primary)] border border-[var(--border-default)] p-4 min-w-[56px]">
                  <span className="text-[13px] font-medium text-[var(--text-muted)]">
                    +{remainingCount}
                  </span>
                </div>
              )}
            </div>

            {/* Status and Start Button */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--border-subtle)]">
              <div className="flex flex-wrap gap-2 text-[11px]">
                {hasValidFiles && (
                  <span className="flex items-center gap-1 text-[var(--color-success)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                    Audio ready
                  </span>
                )}
              </div>
              
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleUpload}
                disabled={!hasValidFiles}
              >
                Start
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </>
        ) : (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-all w-full py-8 px-6',
              isDragging
                ? 'border-[var(--border-brand)] bg-[var(--color-brand-accent)]/10'
                : 'border-[var(--border-default)] bg-[var(--bg-primary)]',
              !disabled && 'hover:border-[var(--border-brand)] hover:bg-[var(--color-brand-accent)]/5',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <input
              type="file"
              multiple
              accept={acceptExtensions}
              onChange={handleFileInput}
              disabled={disabled}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            
            <div className="flex items-center justify-center rounded-full bg-[var(--color-brand-accent)]/20 mb-3 h-10 w-10">
              <Upload className="h-5 w-5 text-[var(--text-brand)]" />
            </div>
            
            <p className="text-[14px] font-medium text-[var(--text-primary)]">
              {isDragging ? 'Drop audio file here' : 'Drop audio file or click to browse'}
            </p>
            
            <div className="mt-3 flex gap-3 text-[11px] text-[var(--text-muted)]">
              <div className="flex items-center gap-1">
                <FileAudio className="h-3.5 w-3.5" />
                <span>.wav, .mp3, .webm, .m4a</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
