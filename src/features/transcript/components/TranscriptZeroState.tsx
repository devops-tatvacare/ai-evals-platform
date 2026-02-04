import { FileText } from 'lucide-react';
import type { ListingSourceType } from '@/types';

interface TranscriptZeroStateProps {
  sourceType: ListingSourceType;
}

export function TranscriptZeroState({ sourceType }: TranscriptZeroStateProps) {
  let message: string;
  
  switch (sourceType) {
    case 'api':
      message = "No transcript yet. Click 'Fetch from API' to transcribe this audio.";
      break;
    case 'upload':
      message = "No transcript available. Upload a transcript file to continue.";
      break;
    case 'pending':
    default:
      message = "No transcript yet. Use the header actions to 'Fetch from API' or 'Add Transcripts'.";
      break;
  }

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
