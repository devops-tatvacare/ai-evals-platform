import type { Listing } from '@/types';

export interface ExportData {
  listing: Listing;
  exportedAt: Date;
}

export interface Exporter {
  id: string;
  name: string;
  extension: string;
  mimeType: string;
  export(data: ExportData): Promise<Blob>;
}
