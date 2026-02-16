import { ArrowDown } from 'lucide-react';
import { cn } from '@/utils';

interface ScrollToBottomProps {
  visible: boolean;
  onClick: () => void;
  unreadCount?: number;
  className?: string;
}

export function ScrollToBottom({ visible, onClick, unreadCount, className }: ScrollToBottomProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-full',
        'bg-[var(--bg-elevated)] shadow-[var(--shadow-md)] border border-[var(--border-subtle)]',
        'text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
        className
      )}
      aria-label="Scroll to bottom"
    >
      <ArrowDown className="h-4 w-4" />
      {unreadCount != null && unreadCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--interactive-primary)] text-[10px] font-bold text-white px-1">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
