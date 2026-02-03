/**
 * Trace Export Utilities
 * Export chat trace data to JSON and CSV formats
 */

import type { KairaChatMessage, KairaChatSession } from '@/types';
import { extractTraceData } from '../utils/traceDataExtractor';

/**
 * Export trace data to JSON
 */
export function exportTraceJSON(
  session: KairaChatSession,
  messages: KairaChatMessage[]
): Blob {
  const exportData = {
    session: {
      id: session.id,
      title: session.title,
      userId: session.userId,
      threadId: session.threadId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: session.status,
    },
    messages: messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      status: message.status,
      errorMessage: message.errorMessage,
      metadata: message.metadata,
      extracted: extractTraceData(message.metadata),
    })),
    exportedAt: new Date().toISOString(),
  };
  
  const json = JSON.stringify(exportData, null, 2);
  return new Blob([json], { type: 'application/json' });
}

/**
 * Export trace data to CSV
 */
export function exportTraceCSV(
  _session: KairaChatSession,
  messages: KairaChatMessage[]
): Blob {
  const rows: string[] = [];
  
  // Header row
  rows.push([
    'Timestamp',
    'Role',
    'Status',
    'Content',
    'Agent',
    'Confidence',
    'Processing Time (s)',
    'Response ID',
    'Has Food Data',
    'Has Intent Data',
    'Error',
  ].join(','));
  
  // Data rows
  messages.forEach(message => {
    const extracted = extractTraceData(message.metadata);
    
    const row = [
      message.timestamp.toString(),
      message.role,
      message.status,
      `"${message.content.replace(/"/g, '""')}"`, // Escape quotes in CSV
      extracted.primaryIntent?.agent || '',
      extracted.primaryIntent?.confidence?.toFixed(3) || '',
      extracted.processingTime?.toFixed(3) || '',
      extracted.responseId || '',
      extracted.foodAgentState ? 'Yes' : 'No',
      extracted.primaryIntent ? 'Yes' : 'No',
      message.errorMessage ? `"${message.errorMessage.replace(/"/g, '""')}"` : '',
    ];
    
    rows.push(row.join(','));
  });
  
  const csv = rows.join('\n');
  return new Blob([csv], { type: 'text/csv' });
}

/**
 * Download a blob as a file
 */
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
