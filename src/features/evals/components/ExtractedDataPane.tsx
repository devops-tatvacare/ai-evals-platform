import { useState, useMemo, memo, useCallback } from 'react';
import { 
  ChevronDown, 
  ChevronRight, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  AlertCircle,
  Database 
} from 'lucide-react';
import type { FieldCritique, CritiqueSeverity } from '@/types';

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
}

/**
 * Get status icon based on critique severity
 */
function getStatusIcon(critique?: FieldCritique) {
  if (!critique) {
    return <CheckCircle className="h-3.5 w-3.5 text-[var(--color-success)]" />;
  }
  
  if (critique.match) {
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

/**
 * Get background color class based on critique and selection
 */
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

/**
 * Format a value for display
 */
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

/**
 * Single field node in the tree
 */
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
}: FieldNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  
  const isExpandable = typeof value === 'object' && value !== null;
  const isPrimitive = !isExpandable;
  
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  }, [isExpanded]);
  
  const handleSelect = useCallback(() => {
    onSelect(path);
  }, [path, onSelect]);

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
            className="p-0.5 hover:bg-[var(--bg-tertiary)] rounded"
          >
            {isExpanded ? (
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
      {isExpandable && isExpanded && (
        <div>
          {Array.isArray(value) ? (
            value.map((item, index) => {
              const childPath = `${path}[${index}]`;
              const childCritique = critiqueMap.get(childPath);
              return (
                <FieldNode
                  key={childPath}
                  path={childPath}
                  name={`[${index}]`}
                  value={item}
                  depth={depth + 1}
                  critique={childCritique}
                  critiqueMap={critiqueMap}
                  isSelected={selectedFieldPath === childPath}
                  selectedFieldPath={selectedFieldPath}
                  onSelect={onSelect}
                />
              );
            })
          ) : (
            Object.entries(value as Record<string, unknown>).map(([key, val]) => {
              const childPath = path ? `${path}.${key}` : key;
              const childCritique = critiqueMap.get(childPath);
              return (
                <FieldNode
                  key={childPath}
                  path={childPath}
                  name={key}
                  value={val}
                  depth={depth + 1}
                  critique={childCritique}
                  critiqueMap={critiqueMap}
                  isSelected={selectedFieldPath === childPath}
                  selectedFieldPath={selectedFieldPath}
                  onSelect={onSelect}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Center pane showing extracted data with field status indicators
 */
export const ExtractedDataPane = memo(function ExtractedDataPane({
  data,
  critiques,
  selectedFieldPath,
  onFieldSelect,
}: ExtractedDataPaneProps) {
  // Create a lookup map for critiques by field path
  const critiqueMap = useMemo(() => {
    const map = new Map<string, FieldCritique>();
    critiques.forEach(c => map.set(c.fieldPath, c));
    return map;
  }, [critiques]);
  
  // Calculate summary stats
  const stats = useMemo(() => {
    const total = critiques.length;
    const matches = critiques.filter(c => c.match).length;
    const mismatches = total - matches;
    const critical = critiques.filter(c => !c.match && c.severity === 'critical').length;
    const moderate = critiques.filter(c => !c.match && c.severity === 'moderate').length;
    const minor = critiques.filter(c => !c.match && c.severity === 'minor').length;
    
    return { total, matches, mismatches, critical, moderate, minor };
  }, [critiques]);
  
  // Omissions (fields that should exist but don't) 
  const omissions = useMemo(() => {
    return critiques.filter(c => 
      !c.match && 
      c.critique.toLowerCase().includes('missing') || 
      c.critique.toLowerCase().includes('omit')
    );
  }, [critiques]);

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
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" />
            Extracted Data
          </h3>
          
          {/* Stats */}
          <div className="flex items-center gap-2 text-[10px]">
            {stats.critical > 0 && (
              <span className="flex items-center gap-1 text-[var(--color-error)]">
                <XCircle className="h-3 w-3" />
                {stats.critical}
              </span>
            )}
            {stats.moderate > 0 && (
              <span className="flex items-center gap-1 text-orange-500">
                <AlertCircle className="h-3 w-3" />
                {stats.moderate}
              </span>
            )}
            {stats.minor > 0 && (
              <span className="flex items-center gap-1 text-[var(--color-warning)]">
                <AlertTriangle className="h-3 w-3" />
                {stats.minor}
              </span>
            )}
            <span className="flex items-center gap-1 text-[var(--color-success)]">
              <CheckCircle className="h-3 w-3" />
              {stats.matches}
            </span>
          </div>
        </div>
      </div>

      {/* Tree view */}
      <div className="flex-1 overflow-auto">
        {Object.entries(data).map(([key, value]) => {
          const critique = critiqueMap.get(key);
          return (
            <FieldNode
              key={key}
              path={key}
              name={key}
              value={value}
              depth={0}
              critique={critique}
              critiqueMap={critiqueMap}
              isSelected={selectedFieldPath === key}
              selectedFieldPath={selectedFieldPath}
              onSelect={onFieldSelect}
            />
          );
        })}
        
        {/* Omissions section */}
        {omissions.length > 0 && (
          <div className="mt-4 mx-2 p-2 border border-[var(--color-warning)]/30 rounded bg-[var(--color-warning)]/5">
            <h4 className="text-[10px] font-medium text-[var(--color-warning)] uppercase mb-2 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Potential Omissions
            </h4>
            {omissions.map((omission, idx) => (
              <button
                key={idx}
                onClick={() => onFieldSelect(omission.fieldPath)}
                className="block w-full text-left text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] py-1 px-2 rounded hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <span className="font-mono text-[var(--color-brand-primary)]">{omission.fieldPath}</span>
                <span className="text-[var(--text-muted)]"> - </span>
                <span className="truncate">{omission.critique.slice(0, 60)}{omission.critique.length > 60 ? '...' : ''}</span>
              </button>
            ))}
          </div>
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
