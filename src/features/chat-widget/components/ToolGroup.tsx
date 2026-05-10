import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';
import { ToolStack } from './ToolStack';
import type { ToolCallPart } from '../types';

interface ToolGroupProps {
  tools: ToolCallPart[];
  autoCollapsed?: boolean;
}

const SPECIALIST_LABELS: Record<string, string> = {
  data_specialist: 'data specialist',
  retrieval_specialist: 'retrieval specialist',
  action_specialist: 'action specialist',
};

function specialistLabel(name: string): string {
  return SPECIALIST_LABELS[name] ?? name.replace(/_/g, ' ');
}

function summarizeConsultation(tools: ToolCallPart[]): string {
  // Group by specialist; e.g. "consulted the data specialist (3 turns)" or
  // "consulted the data and retrieval specialists" for the multi-specialist case.
  const counts = new Map<string, number>();
  for (const t of tools) {
    counts.set(t.toolName, (counts.get(t.toolName) ?? 0) + 1);
  }
  const labels = Array.from(counts.entries()).map(([name, n]) => {
    const label = specialistLabel(name);
    return n > 1 ? `${label} (${n} turns)` : label;
  });
  if (labels.length === 1) return `Sherlock consulted the ${labels[0]}`;
  return `Sherlock consulted the ${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

export function ToolGroup({ tools, autoCollapsed = false }: ToolGroupProps) {
  const [collapsed, setCollapsed] = useState(autoCollapsed);

  useEffect(() => {
    if (autoCollapsed) {
      setCollapsed(true);
    }
  }, [autoCollapsed]);

  if (tools.length === 0) {
    return null;
  }

  const heading = summarizeConsultation(tools);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={heading}
        className="inline-flex w-fit items-center gap-1.5 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', !collapsed && 'rotate-90')} />
        <span className="font-mono uppercase tracking-[0.08em]">{heading}</span>
      </button>
      {!collapsed ? <ToolStack tools={tools} /> : null}
    </div>
  );
}
