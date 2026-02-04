import { FileText } from 'lucide-react';

interface TranscriptZeroStateProps {
  sourceType: 'upload' | 'api';
}

export function TranscriptZeroState({ sourceType }: TranscriptZeroStateProps) {
  const message = sourceType === 'api'
    ? "No transcript yet. Click 'Fetch from API' to transcribe this audio."
    : "No transcript available. Upload a transcript file to continue.";

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center mb-4">
        <FileText className="h-6 w-6 text-[var(--text-tertiary)]" />
      </div>
      <p className="text-sm text-[var(--text-secondary)] max-w-sm">
        {message}
      </p>
    </div>
  );
}
