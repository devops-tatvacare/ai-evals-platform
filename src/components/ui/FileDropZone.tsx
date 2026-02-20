import { useCallback, useState } from 'react';
import { Upload, FileAudio, FileText } from 'lucide-react';
import { cn } from '@/utils';
import { Card } from './Card';

interface FileDropZoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  acceptLabel?: string;
  children?: React.ReactNode;
}

export function FileDropZone({ 
  onFilesSelected, 
  accept = '.wav,.mp3,.webm,.json,.txt',
  multiple = false,
  disabled = false,
  acceptLabel,
  children
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

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
    onFilesSelected(files);
  }, [disabled, onFilesSelected]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      onFilesSelected(files);
    }
  }, [onFilesSelected]);

  const showAudioFormats = accept.includes('.wav') || accept.includes('.mp3') || accept.includes('.webm');
  const showTextFormats = accept.includes('.json') || accept.includes('.txt');

  return (
    <Card className="overflow-hidden p-0 bg-[var(--bg-secondary)]">
      <div className="p-6">
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
            multiple={multiple}
            accept={accept}
            onChange={handleFileInput}
            disabled={disabled}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
          
          {children || (
            <>
              <div className="flex items-center justify-center rounded-full bg-[var(--color-brand-accent)]/20 mb-3 h-10 w-10">
                <Upload className="h-5 w-5 text-[var(--text-brand)]" />
              </div>
              
              <p className="text-[14px] font-medium text-[var(--text-primary)]">
                {isDragging ? 'Drop files here' : `Drop ${multiple ? 'files' : 'file'} or click to browse`}
              </p>
              
              {acceptLabel ? (
                <p className="mt-3 text-[11px] text-[var(--text-muted)]">{acceptLabel}</p>
              ) : (
                <div className="mt-3 flex gap-3 text-[11px] text-[var(--text-muted)]">
                  {showAudioFormats && (
                    <div className="flex items-center gap-1">
                      <FileAudio className="h-3.5 w-3.5" />
                      <span>.wav, .mp3, .webm</span>
                    </div>
                  )}
                  {showTextFormats && (
                    <div className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      <span>.json, .txt</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
