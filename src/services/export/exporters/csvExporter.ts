import type { Exporter, ExportData } from '../types';

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export const csvExporter: Exporter = {
  id: 'csv',
  name: 'CSV (Transcript Segments)',
  extension: 'csv',
  mimeType: 'text/csv',

  async export(data: ExportData): Promise<Blob> {
    const transcript = data.listing.transcript;
    if (!transcript?.segments?.length) {
      return new Blob(['No transcript data available'], { type: 'text/plain' });
    }

    const headers = ['Segment Index', 'Speaker', 'Start Time', 'End Time', 'Text'];
    const rows: string[][] = [headers];

    transcript.segments.forEach((segment, index) => {
      rows.push([
        String(index + 1),
        escapeCSV(segment.speaker),
        segment.startTime,
        segment.endTime,
        escapeCSV(segment.text),
      ]);
    });

    const csvContent = rows.map(row => row.join(',')).join('\n');
    return new Blob([csvContent], { type: this.mimeType });
  },
};
