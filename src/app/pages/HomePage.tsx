import { useFileUpload, ApiUploadZone } from '@/features/upload';
import { Spinner, Card, FileDropZone, Button } from '@/components/ui';
import { Sparkles, Upload, FileAudio, FileText, X } from 'lucide-react';
import { useState } from 'react';
import { validateFiles, type ValidatedFile } from '@/features/upload/utils/fileValidation';

export function HomePage() {
  const { uploadFiles, isUploading, progress } = useFileUpload();
  const [selectedEvalFiles, setSelectedEvalFiles] = useState<ValidatedFile[]>([]);

  const handleEvalFiles = (files: File[]) => {
    const validated = validateFiles(files);
    setSelectedEvalFiles(validated);
  };

  const handleStartEvaluation = () => {
    if (selectedEvalFiles.length > 0) {
      uploadFiles(selectedEvalFiles);
      setSelectedEvalFiles([]);
    }
  };

  const handleRemoveEvalFile = (index: number) => {
    setSelectedEvalFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (file: File | ValidatedFile) => {
    const name = 'file' in file ? file.file.name : file.name;
    if (name.match(/\.(wav|mp3|webm)$/i)) {
      return <FileAudio className="h-6 w-6 text-[var(--color-brand-primary)]" />;
    }
    return <FileText className="h-6 w-6 text-[var(--color-success)]" />;
  };

  const hasValidEvalFiles = selectedEvalFiles.some((f) => !f.error);

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
      <div className="w-full max-w-6xl">
        <div className="mb-12 text-center">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Voice Rx Evaluator</h1>
          <p className="mt-2 text-[15px] text-[var(--text-secondary)]">
            Choose how you want to transcribe your audio
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Quick API Transcription */}
          <Card className="p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-start gap-4 mb-4">
              <div className="shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-brand-primary)] to-[var(--color-brand-accent)] p-3.5 shadow-lg">
                <Sparkles className="h-7 w-7 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  Quick API Transcription
                </h2>
                <p className="mt-1 text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  Select an audio file to instantly transcribe using Gemini AI. Fast and accurate results in seconds.
                </p>
              </div>
            </div>

            <ApiUploadZone />
          </Card>

          {/* Full Evaluation Flow */}
          <Card className="p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-start gap-4 mb-4">
              <div className="shrink-0 flex items-center justify-center rounded-xl bg-[var(--color-brand-accent)]/20 p-3.5">
                <Upload className="h-7 w-7 text-[var(--color-brand-primary)]" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  Full Evaluation
                </h2>
                <p className="mt-1 text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  Upload audio files and transcripts to evaluate transcription quality with detailed analysis.
                </p>
              </div>
            </div>

            {selectedEvalFiles.length > 0 ? (
              <Card className="overflow-hidden p-0 bg-[var(--bg-secondary)]">
                <div className="p-6">
                  <div className="flex items-center justify-center gap-3 py-8">
                    {selectedEvalFiles.slice(0, 3).map((file, index) => (
                      <div key={index} className="relative inline-block">
                        <div className="flex items-center justify-center rounded-xl bg-[var(--color-brand-accent)]/20 p-4">
                          {getFileIcon(file)}
                        </div>
                        <button
                          onClick={() => handleRemoveEvalFile(index)}
                          className="absolute -top-2 -right-2 rounded-full bg-[var(--bg-primary)] border border-[var(--border-default)] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors shadow-sm"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {selectedEvalFiles.length > 3 && (
                      <div className="flex items-center justify-center rounded-xl bg-[var(--bg-primary)] border border-[var(--border-default)] p-4 min-w-[56px]">
                        <span className="text-[13px] font-medium text-[var(--text-muted)]">
                          +{selectedEvalFiles.length - 3}
                        </span>
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={handleStartEvaluation}
                    className="w-full"
                    size="sm"
                    disabled={!hasValidEvalFiles}
                  >
                    Start Evaluation
                  </Button>
                </div>
              </Card>
            ) : (
              <FileDropZone
                onFilesSelected={handleEvalFiles}
                accept=".wav,.mp3,.webm,.json,.txt"
                multiple={true}
                disabled={false}
              >
                <div className="flex items-center justify-center rounded-full bg-[var(--color-brand-accent)]/20 mb-3 h-10 w-10">
                  <Upload className="h-5 w-5 text-[var(--color-brand-primary)]" />
                </div>
                <p className="text-[14px] font-medium text-[var(--text-primary)]">
                  Drop files or click to browse
                </p>
                <div className="mt-3 flex gap-3 text-[11px] text-[var(--text-muted)]">
                  <div className="flex items-center gap-1">
                    <FileAudio className="h-3.5 w-3.5" />
                    <span>.wav, .mp3, .webm</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    <span>.json, .txt</span>
                  </div>
                </div>
              </FileDropZone>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
