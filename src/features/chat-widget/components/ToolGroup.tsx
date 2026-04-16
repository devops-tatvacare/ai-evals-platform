import { useEffect, useState } from 'react';
import { ChevronDown, Wrench } from 'lucide-react';
import { cn } from '@/utils/cn';
import { ToolStack } from './ToolStack';
import type { ToolCallPart } from '../types';

interface ToolGroupProps {
  tools: ToolCallPart[];
  autoCollapsed?: boolean;
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

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={`Used ${tools.length} tools`}
        className="inline-flex w-fit items-center gap-2 rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
      >
        <Wrench className="h-3.5 w-3.5" />
        <span>{`Used ${tools.length} tools`}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !collapsed && 'rotate-180')} />
      </button>
      {!collapsed ? <ToolStack tools={tools} /> : null}
    </div>
  );
}
