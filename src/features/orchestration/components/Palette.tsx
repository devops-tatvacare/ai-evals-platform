import { useEffect, useMemo, type DragEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { fetchNodeTypes } from '@/services/api/orchestration';
import {
  DISPLAY_CATEGORIES,
  DISPLAY_CATEGORY_ORDER,
  getCategoryDef,
} from '@/features/orchestration/config/categories';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import type {
  DisplayCategory,
  NodeTypeDescriptor,
} from '@/features/orchestration/types';
import { cn } from '@/utils';

import { PaletteItem } from './PaletteItem';

interface CategoryGroup {
  key: DisplayCategory;
  label: string;
  items: NodeTypeDescriptor[];
}

/**
 * Phase 11 (Commit 2) — palette grouped by neutral, functional
 * ``displayCategory`` (Phase 11 §4) instead of the legacy product buckets.
 *
 * Nodes whose ``authoringStatus !== 'active'`` are filtered out — they
 * still validate and execute when present in saved definitions but are
 * hidden from new authoring (Phase 11 §6.2).
 */
export function Palette() {
  const workflowType = useWorkflowBuilderStore((s) => s.workflowType);
  const palette = useWorkflowBuilderStore((s) => s.paletteCatalog);
  const collapsed = useWorkflowBuilderStore((s) => s.paletteCollapsed);
  const setCatalog = useWorkflowBuilderStore((s) => s.setPaletteCatalog);
  const setLoading = useWorkflowBuilderStore((s) => s.setPaletteLoading);
  const setCollapsed = useWorkflowBuilderStore((s) => s.setPaletteCollapsed);

  useEffect(() => {
    if (!workflowType) return;
    let alive = true;
    setLoading(true);
    fetchNodeTypes(workflowType)
      .then((catalog) => {
        if (alive) setCatalog(catalog);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [workflowType, setCatalog, setLoading]);

  const groups = useMemo<CategoryGroup[]>(() => {
    return DISPLAY_CATEGORY_ORDER.map((key) => ({
      key,
      label: DISPLAY_CATEGORIES[key].label,
      items: palette.filter(
        (p) =>
          p.displayCategory === key && p.authoringStatus === 'active',
      ),
    })).filter((g) => g.items.length > 0);
  }, [palette]);

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--border-subtle)]',
        'transition-[width] duration-200 ease-out',
        collapsed ? 'w-12' : 'w-64',
      )}
    >
      <div
        className={cn(
          'flex h-9 items-center border-b border-[var(--border-subtle)]',
          collapsed ? 'justify-center px-0' : 'justify-between px-3',
        )}
      >
        {collapsed ? null : (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Nodes
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand palette' : 'Collapse palette'}
          aria-expanded={!collapsed}
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-2">
        {groups.map((g) =>
          collapsed ? (
            <CollapsedGroup key={g.key} group={g} />
          ) : (
            <ExpandedGroup key={g.key} group={g} />
          ),
        )}
      </div>
    </aside>
  );
}

function ExpandedGroup({ group }: { group: CategoryGroup }) {
  return (
    <div>
      <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        {group.label}
      </div>
      <div className="flex flex-col gap-1">
        {group.items.map((d) => (
          <PaletteItem key={`${d.workflowType}-${d.nodeType}`} desc={d} />
        ))}
      </div>
    </div>
  );
}

/** Icon-only stack used when the rail is collapsed. Each icon stays
 *  draggable so authors can drop nodes onto the canvas without
 *  expanding the rail; the description rides along as the tooltip. */
function CollapsedGroup({ group }: { group: CategoryGroup }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {group.items.map((d) => (
        <CollapsedTile key={`${d.workflowType}-${d.nodeType}`} desc={d} />
      ))}
    </div>
  );
}

function CollapsedTile({ desc }: { desc: NodeTypeDescriptor }) {
  const cat = getCategoryDef(desc.displayCategory);
  const Icon = cat.icon;
  const onDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData('application/orchestration-node', JSON.stringify(desc));
    event.dataTransfer.effectAllowed = 'move';
  };
  return (
    <div
      draggable
      onDragStart={onDragStart}
      title={`${desc.displayLabel}${desc.description ? ` — ${desc.description}` : ''}`}
      className="flex h-7 w-7 cursor-grab items-center justify-center rounded-[var(--radius-default)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-tertiary)]"
      style={{ boxShadow: `inset 2px 0 0 0 ${cat.accentVar}` }}
    >
      <Icon className="h-3 w-3" style={{ color: cat.accentVar }} />
    </div>
  );
}
