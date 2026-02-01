import type { TranscriptData } from './transcript.types';
import type { StructuredOutput, StructuredOutputReference, AIEvaluation, HumanEvaluation } from './eval.types';

export type ListingStatus = 'draft' | 'processing' | 'completed';

export interface FileReference {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface AudioFileReference extends FileReference {
  duration?: number;
}

export interface TranscriptFileReference extends FileReference {
  format: 'json' | 'txt';
}

export interface Listing {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  status: ListingStatus;
  audioFile?: AudioFileReference;
  transcriptFile?: TranscriptFileReference;
  structuredJsonFile?: FileReference;
  transcript?: TranscriptData;
  structuredOutputReferences: StructuredOutputReference[];
  structuredOutputs: StructuredOutput[];
  aiEval?: AIEvaluation;
  humanEval?: HumanEvaluation;
}
