import { useState, useCallback, useEffect, memo } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface EnhancedJsonViewerProps {
  data: unknown;
  searchTerm?: string;
  expandAll?: boolean | null;
  onPathChange?: (path: string[]) => void;
}

interface JsonNodeProps {
  keyName?: string;
  value: unknown;
  depth: number;
  path: string[];
  searchTerm?: string;
  expandAll?: boolean | null;
  onPathChange?: (path: string[]) => void;
}

function highlightText(text: string, searchTerm: string): React.ReactNode {
  if (!searchTerm) return text;
  
  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  
  return parts.map((part, i) => 
    regex.test(part) ? (
      <mark key={i} className="bg-[var(--surface-warning)] rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

const JsonNode = memo(function JsonNode({
  keyName,
  value,
  depth,
  path,
  searchTerm,
  expandAll,
  onPathChange,
}: JsonNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);

  // React to expandAll changes
  useEffect(() => {
    if (expandAll === true) {
      setIsExpanded(true);
    } else if (expandAll === false) {
      setIsExpanded(depth < 1); // Keep root expanded when collapsing
    }
  }, [expandAll, depth]);

  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);
  const isEmpty = isObject && Object.keys(value as object).length === 0;

  const currentPath = keyName ? [...path, keyName] : path;

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
    onPathChange?.(currentPath);
  }, [currentPath, onPathChange]);

  const getValueColor = (val: unknown): string => {
    if (val === null) return 'text-[var(--text-muted)]';
    switch (typeof val) {
      case 'string':
        return 'text-[var(--color-success)]';
      case 'number':
        return 'text-[var(--color-info)]';
      case 'boolean':
        return 'text-[var(--text-brand)]';
      default:
        return 'text-[var(--text-primary)]';
    }
  };

  const formatValue = (val: unknown): string => {
    if (val === null) return 'null';
    if (typeof val === 'string') return `"${val}"`;
    return String(val);
  };

  // Primitive value
  if (!isObject) {
    const displayValue = formatValue(value);
    return (
      <div 
        className="flex items-start py-0.5 hover:bg-[var(--interactive-hover)]" 
        style={{ paddingLeft: depth * 16 }}
        onClick={() => onPathChange?.(currentPath)}
      >
        {keyName && (
          <span className="text-[var(--text-secondary)]">
            {searchTerm ? highlightText(`"${keyName}"`, searchTerm) : `"${keyName}"`}:{' '}
          </span>
        )}
        <span className={getValueColor(value)}>
          {searchTerm ? highlightText(displayValue, searchTerm) : displayValue}
        </span>
      </div>
    );
  }

  const entries = Object.entries(value as object);
  const bracketOpen = isArray ? '[' : '{';
  const bracketClose = isArray ? ']' : '}';

  // Empty object/array
  if (isEmpty) {
    return (
      <div className="flex items-center py-0.5" style={{ paddingLeft: depth * 16 }}>
        {keyName && (
          <span className="text-[var(--text-secondary)]">"{keyName}": </span>
        )}
        <span className="text-[var(--text-muted)]">{bracketOpen}{bracketClose}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex cursor-pointer items-center py-0.5 hover:bg-[var(--interactive-hover)]"
        style={{ paddingLeft: depth * 16 }}
        onClick={toggleExpand}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        )}
        {keyName && (
          <span className="text-[var(--text-secondary)]">
            {searchTerm ? highlightText(`"${keyName}"`, searchTerm) : `"${keyName}"`}:{' '}
          </span>
        )}
        <span className="text-[var(--text-muted)]">
          {bracketOpen}
          {!isExpanded && (
            <span className="text-[var(--text-muted)]">
              {' '}...{entries.length} {isArray ? 'items' : 'keys'}{' '}
            </span>
          )}
          {!isExpanded && bracketClose}
        </span>
      </div>
      {isExpanded && (
        <>
          {entries.map(([key, val], index) => (
            <div key={key}>
              <JsonNode
                keyName={isArray ? undefined : key}
                value={val}
                depth={depth + 1}
                path={currentPath}
                searchTerm={searchTerm}
                expandAll={expandAll}
                onPathChange={onPathChange}
              />
              {index < entries.length - 1 && (
                <span 
                  className="text-[var(--text-muted)]" 
                  style={{ paddingLeft: (depth + 1) * 16 }}
                >
                  ,
                </span>
              )}
            </div>
          ))}
          <div style={{ paddingLeft: depth * 16 }}>
            <span className="text-[var(--text-muted)]">{bracketClose}</span>
          </div>
        </>
      )}
    </div>
  );
});

export function EnhancedJsonViewer({ 
  data, 
  searchTerm, 
  expandAll,
  onPathChange 
}: EnhancedJsonViewerProps) {
  return (
    <div className="p-4 font-mono text-xs">
      <JsonNode 
        value={data} 
        depth={0} 
        path={[]}
        searchTerm={searchTerm}
        expandAll={expandAll}
        onPathChange={onPathChange}
      />
    </div>
  );
}
