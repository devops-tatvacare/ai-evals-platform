import type { Listing, AIEvaluation, HumanEvaluation } from '@/types';

export interface ExportData {
  listing: Listing;
  exportedAt: Date;
  /** AI evaluation data (from eval_runs API) */
  aiEval?: AIEvaluation | null;
  /** Human evaluation data (from eval_runs API or local state) */
  humanEval?: HumanEvaluation | null;
}

export interface Exporter {
  id: string;
  name: string;
  extension: string;
  mimeType: string;
  export(data: ExportData): Promise<Blob>;
}
