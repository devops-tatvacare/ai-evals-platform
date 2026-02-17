import { ArrowDown } from 'lucide-react';
import { cn } from '@/utils';

interface ScrollToBottomProps {
  visible: boolean;
  onClick: () => void;
  className?: string;
}

export function ScrollToBottom({ visible, onClick, className }: ScrollToBottomProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'sticky bottom-4 left-1/2 -translate-x-1/2 flex h-10 w-10 items-center justify-center rounded-full',
        'bg-[var(--bg-elevated)] shadow-[var(--shadow-md)] border border-[var(--border-subtle)]',
        'text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
        className
      )}
      aria-label="Scroll to bottom"
    >
      <ArrowDown className="h-4 w-4" />
    </button>
  );
}
