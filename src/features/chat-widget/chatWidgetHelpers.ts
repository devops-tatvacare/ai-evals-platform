import type { ComposedReport } from '@/features/reportBuilder/types';
import type { ToolCallBadgeData } from './types';

export function upsertToolCall(
  toolCalls: ToolCallBadgeData[],
  next: ToolCallBadgeData,
): ToolCallBadgeData[] {
  const index = toolCalls.findIndex((toolCall) => toolCall.name === next.name);
  if (index === -1) {
    return [...toolCalls, next];
  }

  const updated = [...toolCalls];
  updated[index] = { ...updated[index], ...next };
  return updated;
}

export function buildSaveTemplatePrompt(reportName: string): string {
  return `Save this report as a template called "${reportName}"`;
}

export function buildComposedReportOutline(report: ComposedReport): string {
  const lines = report.sections.map((section) => {
    const title = section.title?.trim() || section.type;
    return `- ${title} (${section.type})`;
  });

  return [report.reportName, ...lines].join('\n');
}
