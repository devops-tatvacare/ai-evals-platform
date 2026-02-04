import { useCallback, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { useApiUpload } from '../hooks/useApiUpload';

export function ApiUploadZone() {
  const { uploadAudioFile, isUploading, progress } = useApiUpload();
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!isUploading) {
      setIsDragging(true);
    }
  }, [isUploading]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (isUploading) return;
    
    const file = e.dataTransfer.files[0];
    if (file) {
      uploadAudioFile(file);
    }
  }, [isUploading, uploadAudioFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadAudioFile(file);
    }
  }, [uploadAudioFile]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
        transition-colors duration-200
        ${isDragging ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--border-secondary)]'}
        ${isUploading ? 'opacity-50 cursor-not-allowed' : 'hover:border-[var(--color-primary)]'}
      `}
    >
      <input
        type="file"
        accept="audio/*,.wav,.mp3,.webm,.m4a,.ogg"
        onChange={handleFileSelect}
        disabled={isUploading}
        className="hidden"
        id="audio-upload-input"
      />
      
      <label htmlFor="audio-upload-input" className="cursor-pointer">
        <div className="flex flex-col items-center gap-3">
          {isUploading ? (
            <>
              <Loader2 className="h-8 w-8 text-[var(--color-primary)] animate-spin" />
              <p className="text-sm text-[var(--text-secondary)]">
                Processing... {progress}%
              </p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-[var(--text-tertiary)]" />
              <p className="text-sm text-[var(--text-secondary)]">
                Drop audio file or click to browse
              </p>
              <p className="text-xs text-[var(--text-tertiary)]">
                .wav, .mp3, .webm
              </p>
            </>
          )}
        </div>
      </label>
    </div>
  );
}
