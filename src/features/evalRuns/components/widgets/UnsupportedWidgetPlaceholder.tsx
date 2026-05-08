/**
 * UnsupportedWidgetPlaceholder — rendered when an adversarial transcript
 * carries an `assistant_widget` whose `kind` doesn't resolve in the registry.
 *
 * Forward-compat: instead of silently dropping the widget, we tell engineers
 * exactly what kind landed and that the renderer hasn't been written yet.
 * Adding the renderer is a one-line entry in `widgets/index.ts`.
 */

import { AlertTriangle } from 'lucide-react';

interface Props {
  kind: string;
  data?: unknown;
}

export function UnsupportedWidgetPlaceholder({ kind, data }: Props) {
  return (
    <div className="mt-3 max-w-md rounded-xl border border-dashed border-[var(--color-warning)] bg-[var(--surface-warning)]/30 p-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">
          Unsupported widget
        </span>
        <code className="ml-auto rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
          {kind}
        </code>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
        The Kaira API returned a widget kind the platform doesn&rsquo;t yet render. The
        run completed; the raw payload is preserved on the transcript for
        forensics. Add a renderer to <code>widgets/index.ts</code> to fix.
      </p>
      {data !== undefined && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[11px] text-[var(--text-muted)]">
            Raw payload
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-[var(--bg-tertiary)] p-2 text-[10px] text-[var(--text-primary)]">
            {JSON.stringify(data, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
