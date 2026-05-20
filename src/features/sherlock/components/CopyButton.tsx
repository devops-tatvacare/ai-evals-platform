/** Hover-revealed copy affordance for a message block. */
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { cn } from '@/utils/cn';

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton({ text, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const Icon = copied ? Check : Copy;

  const handleCopy = async () => {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={copied ? 'Copied' : 'Copy message'}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-md',
        'text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]',
        'focus-visible:opacity-100 group-hover:opacity-100',
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
