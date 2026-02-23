import type { Listing, AIEvaluation, HumanReview } from '@/types';

export interface ExportData {
  listing: Listing;
  exportedAt: Date;
  /** AI evaluation data (from eval_runs API) */
  aiEval?: AIEvaluation | null;
  /** Human review data (from eval_runs API) */
  humanReview?: HumanReview | null;
}

export interface Exporter {
  id: string;
  name: string;
  extension: string;
  mimeType: string;
  export(data: ExportData): Promise<Blob>;
}
