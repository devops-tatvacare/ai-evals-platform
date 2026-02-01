import type { Exporter, ExportData } from '../types';

export const correctionsExporter: Exporter = {
  id: 'corrections-json',
  name: 'JSON (Human Corrections Only)',
  extension: 'json',
  mimeType: 'application/json',

  async export(data: ExportData): Promise<Blob> {
    const humanEval = data.listing.humanEval;
    
    if (!humanEval) {
      return new Blob([JSON.stringify({ error: 'No human evaluation data available' })], { type: this.mimeType });
    }

    const exportObj = {
      version: '1.0',
      exportedAt: data.exportedAt.toISOString(),
      listingId: data.listing.id,
      listingTitle: data.listing.title,
      humanEvaluation: {
        id: humanEval.id,
        status: humanEval.status,
        overallScore: humanEval.overallScore,
        notes: humanEval.notes,
        createdAt: humanEval.createdAt,
        updatedAt: humanEval.updatedAt,
        corrections: humanEval.corrections.map(correction => ({
          segmentIndex: correction.segmentIndex,
          originalText: correction.originalText,
          correctedText: correction.correctedText,
          reason: correction.reason,
        })),
      },
      // Include original segments for context
      originalSegments: data.listing.transcript?.segments.map((seg, idx) => ({
        index: idx,
        speaker: seg.speaker,
        text: seg.text,
      })) || [],
    };

    const jsonString = JSON.stringify(exportObj, null, 2);
    return new Blob([jsonString], { type: this.mimeType });
  },
};
