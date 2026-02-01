import { UploadZone, useFileUpload } from '@/features/upload';
import { Spinner } from '@/components/ui';

export function HomePage() {
  const { uploadFiles, isUploading, progress } = useFileUpload();

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Voice RX Evaluator</h1>
        <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
          Upload audio files and transcripts to evaluate transcription quality
        </p>
      </div>

      {isUploading ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-12">
          <Spinner size="lg" />
          <p className="mt-4 text-[14px] text-[var(--text-secondary)]">
            Processing files...
          </p>
          <div className="mt-4 h-2 w-48 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
            <div 
              className="h-full bg-[var(--color-brand-primary)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] text-[var(--text-muted)]">{progress}%</p>
        </div>
      ) : (
        <UploadZone onFilesSelected={uploadFiles} />
      )}
    </div>
  );
}
