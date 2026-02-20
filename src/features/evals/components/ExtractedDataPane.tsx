import { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  AlertTriangle,
  AlertCircle,
  Database,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react';
import type { FieldCritique, CritiqueSeverity } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterCategory = 'match' | 'critical' | 'moderate' | 'minor';

interface ExpandSignal {
  /** Incremented on each expand/collapse all action */
  gen: number;
  /** Target state for all nodes */
  expanded: boolean;
}

interface ExtractedDataPaneProps {
  data: Record<string, unknown>;
  critiques: FieldCritique[];
  selectedFieldPath?: string;
  onFieldSelect: (path: string) => void;
}

interface FieldNodeProps {
  path: string;
  name: string;
  value: unknown;
  depth: number;
  critique?: FieldCritique;
  critiqueMap: Map<string, FieldCritique>;
  isSelected: boolean;
  selectedFieldPath?: string;
  onSelect: (path: string) => void;
  expandSignal: ExpandSignal;
  visiblePaths: Set<string> | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect all ancestor paths for a given field path.
 * e.g. "segments[0].speaker" → ["segments[0]", "segments"]
 */
function getAncestorPaths(fieldPath: string): string[] {
  const ancestors: string[] = [];
  let remaining = fieldPath;
  while (true) {
    const lastDot = remaining.lastIndexOf('.');
    const lastBracket = remaining.lastIndexOf('[');
    const cutPoint = Math.max(lastDot, lastBracket);
    if (cutPoint <= 0) break;
    remaining = remaining.substring(0, cutPoint);
    ancestors.push(remaining);
  }
  return ancestors;
}

function matchesFilter(critique: FieldCritique, filter: FilterCategory): boolean {
  switch (filter) {
    case 'match': return critique.match;
    case 'critical': return !critique.match && critique.severity === 'critical';
    case 'moderate': return !critique.match && critique.severity === 'moderate';
    case 'minor': return !critique.match && critique.severity === 'minor';
  }
}

function getStatusIcon(critique?: FieldCritique) {
  if (!critique || critique.match) {
    return <CheckCircle className="h-3.5 w-3.5 text-[var(--color-success)]" />;
  }
  const iconMap: Record<CritiqueSeverity, React.ReactNode> = {
    critical: <XCircle className="h-3.5 w-3.5 text-[var(--color-error)]" />,
    moderate: <AlertCircle className="h-3.5 w-3.5 text-orange-500" />,
    minor: <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-warning)]" />,
    none: <CheckCircle className="h-3.5 w-3.5 text-[var(--color-success)]" />,
  };
  return iconMap[critique.severity] || iconMap.none;
}

function getRowBgClass(critique?: FieldCritique, isSelected?: boolean) {
  if (isSelected) {
    return 'bg-[var(--color-brand-primary)]/10 border-l-2 border-l-[var(--color-brand-primary)]';
  }
  if (!critique || critique.match) {
    return 'hover:bg-[var(--bg-secondary)]';
  }
  const bgMap: Record<CritiqueSeverity, string> = {
    critical: 'bg-[var(--color-error)]/5 hover:bg-[var(--color-error)]/10',
    moderate: 'bg-orange-500/5 hover:bg-orange-500/10',
    minor: 'bg-[var(--color-warning)]/5 hover:bg-[var(--color-warning)]/10',
    none: 'hover:bg-[var(--bg-secondary)]',
  };
  return bgMap[critique.severity] || bgMap.none;
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `Array[${value.length}]`;
  if (typeof value === 'object') return `Object{${Object.keys(value).length}}`;
  return String(value);
}

// ---------------------------------------------------------------------------
// Filter badge config — single source of truth for categories
// ---------------------------------------------------------------------------

interface FilterBadgeDef {
  category: FilterCategory;
  icon: React.ReactNode;
  activeIcon: React.ReactNode;
  color: string;
  activeBg: string;
  activeRing: string;
  label: string;
}

const FILTER_BADGES: FilterBadgeDef[] = [
  {
    category: 'critical',
    icon: <XCircle className="h-3 w-3" />,
    activeIcon: <XCircle className="h-3.5 w-3.5" />,
    color: 'text-[var(--color-error)]',
    activeBg: 'bg-[var(--color-error)]/20',
    activeRing: 'ring-[var(--color-error)]/40',
    label: 'Critical',
  },
  {
    category: 'moderate',
    icon: <AlertCircle className="h-3 w-3" />,
    activeIcon: <AlertCircle className="h-3.5 w-3.5" />,
    color: 'text-orange-500',
    activeBg: 'bg-orange-500/20',
    activeRing: 'ring-orange-500/40',
    label: 'Moderate',
  },
  {
    category: 'minor',
    icon: <AlertTriangle className="h-3 w-3" />,
    activeIcon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: 'text-[var(--color-warning)]',
    activeBg: 'bg-[var(--color-warning)]/20',
    activeRing: 'ring-[var(--color-warning)]/40',
    label: 'Minor',
  },
  {
    category: 'match',
    icon: <CheckCircle className="h-3 w-3" />,
    activeIcon: <CheckCircle className="h-3.5 w-3.5" />,
    color: 'text-[var(--color-success)]',
    activeBg: 'bg-[var(--color-success)]/20',
    activeRing: 'ring-[var(--color-success)]/40',
    label: 'Correct',
  },
];

// ---------------------------------------------------------------------------
// FieldNode
// ---------------------------------------------------------------------------

const FieldNode = memo(function FieldNode({
  path,
  name,
  value,
  depth,
  critique,
  critiqueMap,
  isSelected,
  selectedFieldPath,
  onSelect,
  expandSignal,
  visiblePaths,
}: FieldNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const prevGenRef = useRef(expandSignal.gen);

  // Sync with global expand/collapse signal
  useEffect(() => {
    if (expandSignal.gen !== prevGenRef.current) {
      prevGenRef.current = expandSignal.gen;
      setIsExpanded(expandSignal.expanded);
    }
  }, [expandSignal.gen, expandSignal.expanded]);

  const isExpandable = typeof value === 'object' && value !== null;
  const isPrimitive = !isExpandable;

  // When filter is active, hide non-matching paths
  if (visiblePaths && !visiblePaths.has(path)) {
    return null;
  }

  // When filter is active, force-expand ancestor nodes so matching leaves are visible
  const effectiveExpanded = visiblePaths ? true : isExpanded;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!visiblePaths) {
      setIsExpanded(!isExpanded);
    }
  };

  const handleSelect = () => {
    onSelect(path);
  };

  const renderChildren = () => {
    if (!isExpandable || !effectiveExpanded) return null;
    if (Array.isArray(value)) {
      return value.map((item, index) => {
        const childPath = `${path}[${index}]`;
        return (
          <FieldNode
            key={childPath}
            path={childPath}
            name={`[${index}]`}
            value={item}
            depth={depth + 1}
            critique={critiqueMap.get(childPath)}
            critiqueMap={critiqueMap}
            isSelected={selectedFieldPath === childPath}
            selectedFieldPath={selectedFieldPath}
            onSelect={onSelect}
            expandSignal={expandSignal}
            visiblePaths={visiblePaths}
          />
        );
      });
    }
    return Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      const childPath = path ? `${path}.${key}` : key;
      return (
        <FieldNode
          key={childPath}
          path={childPath}
          name={key}
          value={val}
          depth={depth + 1}
          critique={critiqueMap.get(childPath)}
          critiqueMap={critiqueMap}
          isSelected={selectedFieldPath === childPath}
          selectedFieldPath={selectedFieldPath}
          onSelect={onSelect}
          expandSignal={expandSignal}
          visiblePaths={visiblePaths}
        />
      );
    });
  };

  return (
    <div className="select-none">
      {/* Field row */}
      <div
        onClick={handleSelect}
        className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors ${getRowBgClass(critique, isSelected)}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* Expand/collapse toggle */}
        {isExpandable ? (
          <button
            onClick={handleToggle}
            className={`p-0.5 rounded ${visiblePaths ? 'opacity-40 cursor-default' : 'hover:bg-[var(--bg-tertiary)]'}`}
          >
            {effectiveExpanded ? (
              <ChevronDown className="h-3 w-3 text-[var(--text-muted)]" />
            ) : (
              <ChevronRight className="h-3 w-3 text-[var(--text-muted)]" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}

        {/* Status icon */}
        {getStatusIcon(critique)}

        {/* Field name */}
        <span className="text-xs font-mono text-[var(--color-brand-primary)]">
          {name}
        </span>

        {/* Colon separator */}
        <span className="text-[var(--text-muted)]">:</span>

        {/* Value preview */}
        {isPrimitive ? (
          <span className={`text-xs font-mono truncate ${
            typeof value === 'string' ? 'text-[var(--color-success)]' :
            typeof value === 'number' ? 'text-[var(--color-info)]' :
            typeof value === 'boolean' ? 'text-[var(--color-warning)]' :
            'text-[var(--text-muted)]'
          }`}>
            {formatValue(value)}
          </span>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">
            {formatValue(value)}
          </span>
        )}
      </div>

      {/* Children */}
      {renderChildren()}
    </div>
  );
});

// ---------------------------------------------------------------------------
// ExtractedDataPane
// ---------------------------------------------------------------------------

export const ExtractedDataPane = memo(function ExtractedDataPane({
  data,
  critiques,
  selectedFieldPath,
  onFieldSelect,
}: ExtractedDataPaneProps) {
  // Expand / collapse all signal
  const [expandSignal, setExpandSignal] = useState<ExpandSignal>({ gen: 0, expanded: true });

  // Severity filter
  const [activeFilter, setActiveFilter] = useState<FilterCategory | null>(null);

  const critiqueMap = useMemo(() => {
    const map = new Map<string, FieldCritique>();
    critiques.forEach(c => map.set(c.fieldPath, c));
    return map;
  }, [critiques]);

  const stats = useMemo(() => {
    const total = critiques.length;
    const match = critiques.filter(c => c.match).length;
    const critical = critiques.filter(c => !c.match && c.severity === 'critical').length;
    const moderate = critiques.filter(c => !c.match && c.severity === 'moderate').length;
    const minor = critiques.filter(c => !c.match && c.severity === 'minor').length;
    return { total, match, critical, moderate, minor };
  }, [critiques]);

  const omissions = useMemo(() => {
    return critiques.filter(c =>
      (!c.match && c.critique.toLowerCase().includes('missing')) ||
      c.critique.toLowerCase().includes('omit')
    );
  }, [critiques]);

  // Compute visible paths from active filter
  const visiblePaths = useMemo(() => {
    if (!activeFilter) return null;

    const matching = critiques.filter(c => matchesFilter(c, activeFilter));
    const paths = new Set<string>();
    for (const c of matching) {
      paths.add(c.fieldPath);
      for (const ancestor of getAncestorPaths(c.fieldPath)) {
        paths.add(ancestor);
      }
    }
    return paths;
  }, [activeFilter, critiques]);

  // Filter omissions when filter is active
  const filteredOmissions = useMemo(() => {
    if (!activeFilter || !visiblePaths) return omissions;
    return omissions.filter(o => visiblePaths.has(o.fieldPath));
  }, [omissions, activeFilter, visiblePaths]);

  // Critiques matching the active filter (for flat-list fallback when tree paths don't exist in data)
  const filteredCritiques = useMemo(() => {
    if (!activeFilter) return [];
    return critiques.filter(c => matchesFilter(c, activeFilter));
  }, [activeFilter, critiques]);

  // Check if any visible paths actually exist as top-level data keys or their prefixes
  const hasTreeHits = useMemo(() => {
    if (!visiblePaths) return true;
    const dataKeys = new Set(Object.keys(data));
    for (const p of visiblePaths) {
      const root = p.split(/[.[\]]/)[0];
      if (dataKeys.has(root)) return true;
    }
    return false;
  }, [visiblePaths, data]);

  const handleExpandAll = useCallback(() => {
    setExpandSignal(prev => ({ gen: prev.gen + 1, expanded: true }));
  }, []);

  const handleCollapseAll = useCallback(() => {
    setExpandSignal(prev => ({ gen: prev.gen + 1, expanded: false }));
  }, []);

  const toggleFilter = useCallback((category: FilterCategory) => {
    setActiveFilter(prev => prev === category ? null : category);
  }, []);

  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] p-4">
        <Database className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm text-center">No structured data available</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header — min-h aligned with Source Transcript pane */}
      <div className="px-3 min-h-[37px] flex items-center border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide flex items-center gap-1.5 shrink-0">
          <Database className="h-3.5 w-3.5" />
          Extracted Data
        </h3>

        <div className="ml-auto flex items-center gap-1">
          {/* Collapse / Expand all */}
          <button
            type="button"
            onClick={handleCollapseAll}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            title="Collapse all"
          >
            <ChevronsDownUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleExpandAll}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            title="Expand all"
          >
            <ChevronsUpDown className="h-3 w-3" />
          </button>

          {/* Separator */}
          <div className="w-px h-3 bg-[var(--border-subtle)] mx-0.5" />

          {/* Filter badges — each is a clickable toggle */}
          {FILTER_BADGES.map(badge => {
            const count = stats[badge.category];
            if (count === 0 && badge.category !== 'match') return null;
            const isActive = activeFilter === badge.category;

            return (
              <button
                key={badge.category}
                type="button"
                onClick={() => toggleFilter(badge.category)}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-all ${badge.color} ${
                  isActive
                    ? `${badge.activeBg} ring-1 ${badge.activeRing} scale-105`
                    : `hover:${badge.activeBg}`
                }`}
                title={isActive ? `Showing ${badge.label.toLowerCase()} only — click to clear` : `Filter: ${badge.label} (${count})`}
              >
                {isActive ? badge.activeIcon : badge.icon}
                {count}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active filter indicator */}
      {activeFilter && (
        <div className="px-3 py-1 bg-[var(--bg-tertiary)] border-b border-[var(--border-subtle)] flex items-center justify-between">
          <span className="text-[10px] text-[var(--text-muted)]">
            {filteredCritiques.length} {activeFilter === 'match' ? 'correct' : activeFilter} field{filteredCritiques.length !== 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={() => setActiveFilter(null)}
            className="text-[10px] text-[var(--color-brand-primary)] hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Tree view */}
      <div className="flex-1 overflow-auto">
        {/* When filter is active but critique paths don't exist in the tree data,
            show matching critiques as a clickable flat list instead of an empty tree */}
        {activeFilter && !hasTreeHits ? (
          <div className="p-2 space-y-1">
            {filteredCritiques.map((fc) => (
              <button
                key={fc.fieldPath}
                onClick={() => onFieldSelect(fc.fieldPath)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center gap-1.5 ${
                  selectedFieldPath === fc.fieldPath
                    ? 'bg-[var(--color-brand-primary)]/10 border-l-2 border-l-[var(--color-brand-primary)]'
                    : 'hover:bg-[var(--bg-secondary)]'
                }`}
              >
                {getStatusIcon(fc)}
                <span className="font-mono text-[var(--color-brand-primary)]">{fc.fieldPath}</span>
                <span className="text-[var(--text-muted)] ml-auto truncate max-w-[40%] text-[10px]">
                  {fc.critique.slice(0, 50)}{fc.critique.length > 50 ? '...' : ''}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <>
            {Object.entries(data).map(([key, value]) => (
              <FieldNode
                key={key}
                path={key}
                name={key}
                value={value}
                depth={0}
                critique={critiqueMap.get(key)}
                critiqueMap={critiqueMap}
                isSelected={selectedFieldPath === key}
                selectedFieldPath={selectedFieldPath}
                onSelect={onFieldSelect}
                expandSignal={expandSignal}
                visiblePaths={visiblePaths}
              />
            ))}

            {/* Omissions section — filtered when filter is active */}
            {filteredOmissions.length > 0 && (
              <div className="mt-4 mx-2 p-2 border border-[var(--color-warning)]/30 rounded bg-[var(--color-warning)]/5">
                <h4 className="text-[10px] font-medium text-[var(--color-warning)] uppercase mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Potential Omissions
                </h4>
                {filteredOmissions.map((omission, idx) => (
                  <button
                    key={idx}
                    onClick={() => onFieldSelect(omission.fieldPath)}
                    className="block w-full text-left text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] py-1 px-2 rounded hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    <span className="font-mono text-[var(--color-brand-primary)]">{omission.fieldPath}</span>
                    <span className="text-[var(--text-muted)]"> — </span>
                    <span className="truncate">{omission.critique.slice(0, 60)}{omission.critique.length > 60 ? '...' : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Legend */}
      <div className="px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-3 text-[9px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1">
            <CheckCircle className="h-2.5 w-2.5 text-[var(--color-success)]" /> Correct
          </span>
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-2.5 w-2.5 text-[var(--color-warning)]" /> Minor
          </span>
          <span className="flex items-center gap-1">
            <AlertCircle className="h-2.5 w-2.5 text-orange-500" /> Moderate
          </span>
          <span className="flex items-center gap-1">
            <XCircle className="h-2.5 w-2.5 text-[var(--color-error)]" /> Critical
          </span>
        </div>
      </div>
    </div>
  );
});
