import type { Exporter, ExportData } from '../types';

export const jsonExporter: Exporter = {
  id: 'json',
  name: 'JSON (Full Data)',
  extension: 'json',
  mimeType: 'application/json',

  async export(data: ExportData): Promise<Blob> {
    const exportObj = {
      version: '1.0',
      exportedAt: data.exportedAt.toISOString(),
      listing: {
        id: data.listing.id,
        title: data.listing.title,
        status: data.listing.status,
        createdAt: data.listing.createdAt,
        updatedAt: data.listing.updatedAt,
        audioFile: data.listing.audioFile ? {
          name: data.listing.audioFile.name,
          mimeType: data.listing.audioFile.mimeType,
          size: data.listing.audioFile.size,
          duration: data.listing.audioFile.duration,
        } : null,
        transcriptFile: data.listing.transcriptFile ? {
          name: data.listing.transcriptFile.name,
          format: data.listing.transcriptFile.format,
          size: data.listing.transcriptFile.size,
        } : null,
        transcript: data.listing.transcript,
        structuredOutputs: data.listing.structuredOutputs.map(so => ({
          id: so.id,
          createdAt: so.createdAt,
          prompt: so.prompt,
          promptType: so.promptType,
          inputSource: so.inputSource,
          model: so.model,
          result: so.result,
          status: so.status,
        })),
        aiEval: data.aiEval ? {
          id: data.aiEval.id,
          createdAt: data.aiEval.createdAt,
          flowType: data.aiEval.flowType,
          status: data.aiEval.status,
          judgeOutput: data.aiEval.judgeOutput,
          critique: data.aiEval.critique,
        } : null,
        humanEval: data.humanEval ? {
          id: data.humanEval.id,
          createdAt: data.humanEval.createdAt,
          updatedAt: data.humanEval.updatedAt,
          overallScore: data.humanEval.overallScore,
          notes: data.humanEval.notes,
          corrections: data.humanEval.corrections,
          status: data.humanEval.status,
        } : null,
      },
    };

    const jsonString = JSON.stringify(exportObj, null, 2);
    return new Blob([jsonString], { type: this.mimeType });
  },
};
