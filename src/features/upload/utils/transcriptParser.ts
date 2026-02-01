import type { TranscriptData, TranscriptSegment } from '@/types';

/**
 * Parse HH:MM:SS timestamp to seconds
 */
export function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(':').map(Number);
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }
  return 0;
}

interface RawJsonTranscript {
  format_version: string;
  generated_at: string;
  metadata: {
    recording_id: string;
    job_id: string;
    processed_at: string;
  };
  speaker_mapping: Record<string, string>;
  segments: Array<{
    speaker: string;
    start_time: string;
    end_time: string;
    text: string;
  }>;
}

/**
 * Parse JSON transcript format
 */
export function parseJsonTranscript(content: string): TranscriptData {
  const raw: RawJsonTranscript = JSON.parse(content);
  
  const segments: TranscriptSegment[] = raw.segments.map((seg) => ({
    speaker: seg.speaker,
    startTime: seg.start_time,
    endTime: seg.end_time,
    text: seg.text,
    startSeconds: parseTimestamp(seg.start_time),
    endSeconds: parseTimestamp(seg.end_time),
  }));
  
  // Build full transcript from segments
  const fullTranscript = segments
    .map((seg) => `[${seg.startTime}] ${seg.speaker}: ${seg.text}`)
    .join('\n');
  
  return {
    formatVersion: raw.format_version,
    generatedAt: raw.generated_at,
    metadata: {
      recordingId: raw.metadata.recording_id,
      jobId: raw.metadata.job_id,
      processedAt: raw.metadata.processed_at,
    },
    speakerMapping: raw.speaker_mapping,
    segments,
    fullTranscript,
  };
}

/**
 * Parse TXT transcript format
 * Format: [HH:MM:SS-HH:MM:SS] Speaker: Text
 */
export function parseTxtTranscript(content: string): TranscriptData {
  const lines = content.trim().split('\n').filter(Boolean);
  const segments: TranscriptSegment[] = [];
  const speakers = new Set<string>();
  
  // Regex to match: [00:00:00-00:00:02] Doctor: text
  const lineRegex = /^\[(\d{2}:\d{2}:\d{2})-(\d{2}:\d{2}:\d{2})\]\s*([^:]+):\s*(.+)$/;
  
  for (const line of lines) {
    const match = line.match(lineRegex);
    if (match) {
      const [, startTime, endTime, speaker, text] = match;
      speakers.add(speaker.trim());
      segments.push({
        speaker: speaker.trim(),
        startTime,
        endTime,
        text: text.trim(),
        startSeconds: parseTimestamp(startTime),
        endSeconds: parseTimestamp(endTime),
      });
    }
  }
  
  // Create speaker mapping
  const speakerMapping: Record<string, string> = {};
  speakers.forEach((speaker, index) => {
    speakerMapping[`SPEAKER_${String(index).padStart(2, '0')}`] = speaker;
  });
  
  const fullTranscript = segments
    .map((seg) => `[${seg.startTime}] ${seg.speaker}: ${seg.text}`)
    .join('\n');
  
  return {
    formatVersion: '1.0',
    generatedAt: new Date().toISOString(),
    metadata: {
      recordingId: '',
      jobId: '',
      processedAt: new Date().toISOString(),
    },
    speakerMapping,
    segments,
    fullTranscript,
  };
}

/**
 * Parse transcript file based on format
 */
export async function parseTranscriptFile(file: File): Promise<TranscriptData> {
  const content = await file.text();
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  
  if (ext === '.json') {
    return parseJsonTranscript(content);
  }
  if (ext === '.txt') {
    return parseTxtTranscript(content);
  }
  
  throw new Error(`Unsupported transcript format: ${ext}`);
}

/**
 * Get audio duration using Web Audio API
 */
export async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(audio.src);
      resolve(audio.duration);
    };
    
    audio.onerror = () => {
      URL.revokeObjectURL(audio.src);
      reject(new Error('Failed to load audio metadata'));
    };
    
    audio.src = URL.createObjectURL(file);
  });
}

/**
 * Generate a title from filename or transcript
 */
export function generateTitle(filename: string, transcript?: TranscriptData): string {
  // Try to extract a meaningful title from the filename
  // Format: ambient-voice-rx-recording-2025-12-10T10-31-19-715Z.webm_transcript.json
  const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    const date = new Date(dateMatch[1]);
    const formatted = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `Recording ${formatted}`;
  }
  
  // Use first few words of first segment
  if (transcript && transcript.segments.length > 0) {
    const firstText = transcript.segments[0].text;
    const words = firstText.split(' ').slice(0, 5).join(' ');
    return words.length > 30 ? words.slice(0, 30) + '...' : words;
  }
  
  // Fallback to cleaned filename
  return filename
    .replace(/\.(wav|mp3|webm|json|txt)$/i, '')
    .replace(/_/g, ' ')
    .slice(0, 40);
}
