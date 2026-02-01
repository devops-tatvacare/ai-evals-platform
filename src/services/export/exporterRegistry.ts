import type { Exporter, ExportData } from './types';

const exporters = new Map<string, Exporter>();

export const exporterRegistry = {
  register(exporter: Exporter): void {
    exporters.set(exporter.id, exporter);
  },

  unregister(id: string): void {
    exporters.delete(id);
  },

  get(id: string): Exporter | undefined {
    return exporters.get(id);
  },

  getAll(): Exporter[] {
    return Array.from(exporters.values());
  },

  async export(exporterId: string, data: ExportData): Promise<Blob> {
    const exporter = exporters.get(exporterId);
    if (!exporter) {
      throw new Error(`Exporter "${exporterId}" not found`);
    }
    return exporter.export(data);
  },
};
