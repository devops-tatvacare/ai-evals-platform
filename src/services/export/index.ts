export type { Exporter, ExportData } from './types';
export { exporterRegistry } from './exporterRegistry';
export { jsonExporter, csvExporter, pdfExporter, correctionsExporter } from './exporters';

// Initialize exporters on import
import { exporterRegistry } from './exporterRegistry';
import { jsonExporter, csvExporter, pdfExporter, correctionsExporter } from './exporters';

exporterRegistry.register(jsonExporter);
exporterRegistry.register(csvExporter);
exporterRegistry.register(pdfExporter);
exporterRegistry.register(correctionsExporter);

// Helper function to download a blob
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
