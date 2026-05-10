import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-sql';
import { format as formatSql } from 'sql-formatter';
import { cn } from '@/utils/cn';
import { notificationService } from '@/services/notifications';

interface SqlBlockProps {
  sql: string;
  label?: string;
  className?: string;
}

export function SqlBlock({ sql, label = 'sql', className }: SqlBlockProps) {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  // sql-formatter occasionally throws on non-standard syntax; fall back to the raw text.
  const pretty = useMemo(() => {
    try {
      return formatSql(sql, { language: 'postgresql', tabWidth: 2, keywordCase: 'upper' });
    } catch {
      return sql;
    }
  }, [sql]);

  useEffect(() => {
    if (codeRef.current) Prism.highlightElement(codeRef.current);
  }, [pretty]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      notificationService.success('SQL copied');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      notificationService.error('Could not copy SQL');
    }
  };

  return (
    <div className={cn(
      'group relative overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)]',
      className,
    )}>
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          aria-label="Copy SQL"
        >
          {copied ? <Check className="h-3 w-3 text-[var(--color-verdict-pass)]" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words p-2 leading-relaxed">
        <code
          ref={codeRef}
          className="language-sql font-mono text-[10.5px] text-[var(--text-primary)]"
        >
          {pretty}
        </code>
      </pre>
    </div>
  );
}
