import type { Exporter, ExportData } from '../types';
import type { SegmentCritique, TranscriptCorrection } from '@/types';

// UTF-8 BOM for Excel compatibility
const UTF8_BOM = '\uFEFF';

function escapeCSV(value: string | undefined | null): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const csvExporter: Exporter = {
  id: 'csv',
  name: 'CSV (Transcript Segments)',
  extension: 'csv',
  mimeType: 'text/csv;charset=utf-8',

  async export(data: ExportData): Promise<Blob> {
    const transcript = data.listing.transcript;
    if (!transcript?.segments?.length) {
      return new Blob([UTF8_BOM + 'No transcript data available'], { type: 'text/plain;charset=utf-8' });
    }

    const aiCritiques = data.aiEval?.critique?.segments || [];
    const humanCorrections = data.humanEval?.corrections || [];

    // Build lookup maps for efficient merging
    const critiqueByIndex = new Map<number, SegmentCritique>();
    aiCritiques.forEach(c => critiqueByIndex.set(c.segmentIndex, c));

    const correctionByIndex = new Map<number, TranscriptCorrection>();
    humanCorrections.forEach(c => correctionByIndex.set(c.segmentIndex, c));

    // Headers for comprehensive export
    const headers = [
      'Segment Index',
      'Speaker',
      'Start Time',
      'End Time',
      'Original Text',
      'AI Judge Text',
      'Discrepancy',
      'Severity',
      'Likely Correct',
      'Confidence',
      'Human Corrected Text',
      'Correction Reason',
    ];

    const rows: string[][] = [headers];

    transcript.segments.forEach((segment, index) => {
      const critique = critiqueByIndex.get(index);
      const correction = correctionByIndex.get(index);

      rows.push([
        String(index + 1),
        escapeCSV(segment.speaker),
        escapeCSV(segment.startTime),
        escapeCSV(segment.endTime),
        escapeCSV(segment.text),
        escapeCSV(critique?.judgeText),
        escapeCSV(critique?.discrepancy),
        escapeCSV(critique?.severity),
        escapeCSV(critique?.likelyCorrect),
        escapeCSV(critique?.confidence),
        escapeCSV(correction?.correctedText),
        escapeCSV(correction?.reason),
      ]);
    });

    const csvContent = UTF8_BOM + rows.map(row => row.join(',')).join('\r\n');
    return new Blob([csvContent], { type: this.mimeType });
  },
};
