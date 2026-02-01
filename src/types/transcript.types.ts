export interface TranscriptMetadata {
  recordingId: string;
  jobId: string;
  processedAt: string;
}

export interface TranscriptSegment {
  speaker: string;
  startTime: string;
  endTime: string;
  text: string;
  startSeconds?: number;
  endSeconds?: number;
}

export interface TranscriptData {
  formatVersion: string;
  generatedAt: string;
  metadata: TranscriptMetadata;
  speakerMapping: Record<string, string>;
  segments: TranscriptSegment[];
  fullTranscript: string;
}
