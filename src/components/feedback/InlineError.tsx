import { AlertCircle } from 'lucide-react';
import { cn } from '@/utils';

interface InlineErrorProps {
  message: string;
  className?: string;
}

export function InlineError({ message, className }: InlineErrorProps) {
  return (
    <div className={cn('flex items-center gap-2 text-[var(--color-error)]', className)}>
      <AlertCircle className="h-4 w-4 flex-shrink-0" />
      <span className="text-[13px]">{message}</span>
    </div>
  );
}
