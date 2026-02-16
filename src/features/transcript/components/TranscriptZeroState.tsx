import { FileText } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import type { ListingSourceType } from '@/types';

interface TranscriptZeroStateProps {
  sourceType: ListingSourceType;
}

export function TranscriptZeroState({ sourceType }: TranscriptZeroStateProps) {
  let description: string;

  switch (sourceType) {
    case 'api':
      description = "Click 'Fetch from API' to transcribe this audio.";
      break;
    case 'upload':
      description = "Upload a transcript file to continue.";
      break;
    case 'pending':
    default:
      description = "Use the header actions to 'Fetch from API' or 'Add Transcripts'.";
      break;
  }

  return (
    <EmptyState
      icon={FileText}
      title="No transcript yet"
      description={description}
    />
  );
}
