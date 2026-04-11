import { useState } from 'react';
import { Check, Copy, Save } from 'lucide-react';
import { Button } from '@/components/ui';
import { notificationService } from '@/services/notifications';
import type { ComposedReport } from '@/features/reportBuilder/types';
import { buildComposedReportOutline } from './chatWidgetHelpers';

interface ComposedReportCardProps {
  report: ComposedReport;
  onSaveTemplate: (reportName: string) => void;
}

export function ComposedReportCard({ report, onSaveTemplate }: ComposedReportCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyOutline = async () => {
    await navigator.clipboard.writeText(buildComposedReportOutline(report));
    setCopied(true);
    notificationService.success('Report outline copied');
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
        Composed Report
      </div>
      <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
        {report.reportName}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {report.sections.map((section) => (
          <span
            key={section.id}
            className="rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
          >
            {section.title || section.type}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" icon={Save} onClick={() => onSaveTemplate(report.reportName)}>
          Save as Template
        </Button>
        <Button variant="ghost" size="sm" icon={copied ? Check : Copy} onClick={handleCopyOutline}>
          {copied ? 'Copied' : 'Copy Outline'}
        </Button>
      </div>
    </div>
  );
}
