import { useState, useEffect, useRef } from 'react';
import { Bug, Copy, Check } from 'lucide-react';
import { cn } from '@/utils';

interface DebugSection {
  title: string;
  items: Array<{ label: string; value: string | number | boolean | undefined | null; copyable?: boolean }>;
}

interface DebugFabProps {
  sections: DebugSection[];
  className?: string;
}

function FabMetadataItem({ label, value, copyable = true }: DebugSection['items'][number]) {
  const [copied, setCopied] = useState(false);

  const displayValue = value === undefined || value === null ? '—' : String(value);

  const handleCopy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(String(value));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-[var(--text-muted)] shrink-0">{label}:</span>
      <code className="font-mono text-[var(--text-secondary)] truncate max-w-[200px]">
        {displayValue}
      </code>
      {copyable && value && (
        <button
          onClick={handleCopy}
          className="shrink-0 p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
          title="Copy to clipboard"
        >
          {copied ? (
            <Check className="h-3 w-3 text-[var(--color-success)]" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}

export function DebugFab({ sections, className }: DebugFabProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <div ref={containerRef} className={cn('z-50', className)}>
      {isOpen && (
        <div
          className={cn(
            'absolute bottom-full right-0 mb-2 w-72',
            'bg-[var(--bg-primary)] border border-[var(--border-subtle)]',
            'rounded-lg shadow-[var(--shadow-md)]',
            'max-h-80 overflow-y-auto',
            'p-3 space-y-3'
          )}
        >
          {sections.map((section) => (
            <div key={section.title} className="space-y-1">
              <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                {section.title}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <FabMetadataItem key={item.label} {...item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'rounded-full p-2',
          isOpen
            ? 'bg-orange-500 text-white'
            : 'bg-orange-500 text-white opacity-75 hover:opacity-100',
          'shadow-[var(--shadow-md)]',
          'transition-colors'
        )}
        title="Debug Info"
      >
        <Bug className="h-4 w-4" />
      </button>
    </div>
  );
}
