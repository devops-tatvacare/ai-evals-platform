import { cn } from '@/utils';

interface PromptDiffProps {
  oldText: string;
  newText: string;
  oldLabel: string;
  newLabel: string;
}

function computeDiff(oldText: string, newText: string) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  const annotatedOld = oldLines.map((line) => ({
    text: line,
    status: newSet.has(line) ? 'unchanged' : 'removed',
  }));

  const annotatedNew = newLines.map((line) => ({
    text: line,
    status: oldSet.has(line) ? 'unchanged' : 'added',
  }));

  return { annotatedOld, annotatedNew };
}

export function PromptDiff({ oldText, newText, oldLabel, newLabel }: PromptDiffProps) {
  const { annotatedOld, annotatedNew } = computeDiff(oldText, newText);

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Old */}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {oldLabel}
        </span>
        <pre className="overflow-auto rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 text-[12px] font-mono text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words">
          {annotatedOld.map((line, i) => (
            <span
              key={i}
              className={cn(
                'block',
                line.status === 'removed' && 'bg-[var(--surface-error)] text-[var(--color-error)]',
              )}
            >
              {line.text || '\u00a0'}
            </span>
          ))}
        </pre>
      </div>

      {/* New */}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {newLabel}
        </span>
        <pre className="overflow-auto rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 text-[12px] font-mono text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words">
          {annotatedNew.map((line, i) => (
            <span
              key={i}
              className={cn(
                'block',
                line.status === 'added' && 'bg-[var(--surface-success)] text-[var(--color-success)]',
              )}
            >
              {line.text || '\u00a0'}
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
}
