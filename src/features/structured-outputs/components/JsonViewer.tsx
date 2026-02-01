import { useState, useCallback, memo } from 'react';
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react';
import { cn } from '@/utils';

interface JsonViewerProps {
  data: unknown;
  initialExpanded?: boolean;
}

interface JsonNodeProps {
  keyName?: string;
  value: unknown;
  depth: number;
  initialExpanded: boolean;
}

const JsonNode = memo(function JsonNode({
  keyName,
  value,
  depth,
  initialExpanded,
}: JsonNodeProps) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded && depth < 2);

  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);
  const isEmpty = isObject && Object.keys(value as object).length === 0;

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const getValueColor = (val: unknown): string => {
    if (val === null) return 'text-gray-500';
    switch (typeof val) {
      case 'string':
        return 'text-green-600 dark:text-green-400';
      case 'number':
        return 'text-blue-600 dark:text-blue-400';
      case 'boolean':
        return 'text-purple-600 dark:text-purple-400';
      default:
        return 'text-[var(--text-primary)]';
    }
  };

  const formatValue = (val: unknown): string => {
    if (val === null) return 'null';
    if (typeof val === 'string') return `"${val}"`;
    return String(val);
  };

  if (!isObject) {
    return (
      <div className="flex items-center" style={{ paddingLeft: depth * 16 }}>
        {keyName && (
          <span className="text-[var(--text-secondary)]">"{keyName}": </span>
        )}
        <span className={getValueColor(value)}>{formatValue(value)}</span>
      </div>
    );
  }

  const entries = Object.entries(value as object);
  const bracketOpen = isArray ? '[' : '{';
  const bracketClose = isArray ? ']' : '}';

  if (isEmpty) {
    return (
      <div className="flex items-center" style={{ paddingLeft: depth * 16 }}>
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
        className="flex cursor-pointer items-center hover:bg-[var(--interactive-secondary)]"
        style={{ paddingLeft: depth * 16 }}
        onClick={toggleExpand}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
        )}
        {keyName && (
          <span className="text-[var(--text-secondary)]">"{keyName}": </span>
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
                initialExpanded={initialExpanded}
              />
              {index < entries.length - 1 && (
                <span className="text-[var(--text-muted)]" style={{ paddingLeft: (depth + 1) * 16 }}>
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

export function JsonViewer({ data, initialExpanded = true }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [data]);

  return (
    <div className="relative rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)]">
      <div className="absolute right-2 top-2">
        <button
          onClick={handleCopy}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
            copied
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-[var(--interactive-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <div className="overflow-x-auto p-4 font-mono text-sm">
        <JsonNode value={data} depth={0} initialExpanded={initialExpanded} />
      </div>
    </div>
  );
}
