import { Info } from 'lucide-react';

import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/utils';

interface InspectorInfoButtonProps {
  content: React.ReactNode;
  ariaLabel: string;
}

function InspectorInfoButton({ content, ariaLabel }: InspectorInfoButtonProps) {
  return (
    <Tooltip content={content} position="top" maxWidth={280} closeDelay={120}>
      <button
        type="button"
        aria-label={ariaLabel}
        className={cn(
          'inline-flex h-5 w-5 items-center justify-center rounded-full',
          'text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]',
        )}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  );
}

interface InspectorFieldProps {
  label: string;
  children: React.ReactNode;
  description?: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
}

export function InspectorField({
  label,
  children,
  description,
  required = false,
  htmlFor,
  className,
}: InspectorFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-1.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--text-primary)]">
            {label}
            {required ? <span className="ml-1 text-[var(--color-error)]">*</span> : null}
          </label>
        ) : (
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {label}
            {required ? <span className="ml-1 text-[var(--color-error)]">*</span> : null}
          </span>
        )}
        {description ? (
          <InspectorInfoButton
            content={description}
            ariaLabel={`More info about ${label}`}
          />
        ) : null}
      </div>
      {children}
    </div>
  );
}

interface InspectorSectionProps {
  title: string;
  children: React.ReactNode;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function InspectorSection({
  title,
  children,
  description,
  actions,
  className,
}: InspectorSectionProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <h4 className="truncate text-sm font-medium text-[var(--text-primary)]">{title}</h4>
          {description ? (
            <InspectorInfoButton
              content={description}
              ariaLabel={`More info about ${title}`}
            />
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function InspectorCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function InspectorEmptyState({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'rounded-[var(--radius-default)] border border-dashed border-[var(--border-default)]',
        'bg-[var(--bg-tertiary)] px-3 py-2 text-xs text-[var(--text-secondary)]',
        className,
      )}
    >
      {children}
    </p>
  );
}
