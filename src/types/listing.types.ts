import type { TranscriptData } from './transcript.types';
import type { StructuredOutput, StructuredOutputReference, AIEvaluation, HumanEvaluation } from './eval.types';
import type { AppId } from './app.types';
import type { GeminiApiResponse } from './api.types';

export type ListingStatus = 'draft' | 'processing' | 'completed';
export type ListingSourceType = 'upload' | 'api' | 'pending';

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
  appId: AppId;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  status: ListingStatus;
  sourceType: ListingSourceType;
  audioFile?: AudioFileReference;
  transcriptFile?: TranscriptFileReference;
  structuredJsonFile?: FileReference;
  transcript?: TranscriptData;
  apiResponse?: GeminiApiResponse;
  structuredOutputReferences: StructuredOutputReference[];
  structuredOutputs: StructuredOutput[];
  aiEval?: AIEvaluation;
  humanEval?: HumanEvaluation;
}
