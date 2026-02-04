import { useFileUpload, UploadZone } from '@/features/upload';
import { Spinner } from '@/components/ui';
import type { ValidatedFile } from '@/features/upload/utils/fileValidation';

export function HomePage() {
  const { uploadFiles, isUploading, progress } = useFileUpload();

  const handleFilesSelected = (files: ValidatedFile[]) => {
    if (files.length > 0) {
      uploadFiles(files);
    }
  };

  if (isUploading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="mx-auto max-w-md flex flex-col items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-12">
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
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Voice Rx Evaluator</h1>
          <p className="mt-2 text-[15px] text-[var(--text-secondary)]">
            Upload audio to get started
          </p>
        </div>

        <UploadZone onFilesSelected={handleFilesSelected} disabled={isUploading} />
        
        <p className="mt-4 text-center text-[12px] text-[var(--text-muted)]">
          After upload, you can fetch from API or add transcripts manually
        </p>
      </div>
    </div>
  );
}
