import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-[var(--border-default)] overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center gap-2.5 bg-[var(--bg-secondary)]/50 hover:bg-[var(--bg-secondary)]/80 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
        )}
        <div className="text-left">
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h3>
          {subtitle && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-3 border-t border-[var(--border-subtle)]">
          {children}
        </div>
      )}
    </div>
  );
}
