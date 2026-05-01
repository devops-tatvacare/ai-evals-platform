import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/Input';
import type { StructuredRequestBody } from '@/features/orchestration/types';

interface Props {
  value: StructuredRequestBody | undefined;
  onChange(next: StructuredRequestBody): void;
}

/**
 * Phase 11 (Commit 2) — structured request body editor for `core.webhook_out`.
 *
 * The persisted shape is a JSON-shaped object whose leaves may be JSON
 * literals or ``{"$payload": "field"}`` references. Authoring this through
 * a tree UI is the right experience but a deeper change than this
 * checkpoint can absorb — the editor surfaces the structured contract
 * through a JSON textarea with payload-reference syntax help and live
 * validation.
 *
 * The textarea is parsed on change; invalid JSON keeps the raw text but
 * surfaces an inline error. ``onChange`` is only called when the parse
 * succeeds — preserves ``body`` from being silently corrupted.
 */
export function StructuredRequestBodyEditor({ value, onChange }: Props) {
  const initialText = useMemo(() => stringify(value), [value]);
  const [text, setText] = useState<string>(initialText);
  const [parseError, setParseError] = useState<string | null>(null);

  // Sync from props when the value changes externally (e.g. a different
  // node selected). Avoid clobbering the user's in-progress edit when the
  // serialized form already matches what they typed.
  useEffect(() => {
    const next = stringify(value);
    if (next !== text) {
      setText(next);
      setParseError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (next: string) => {
    setText(next);
    if (next.trim() === '') {
      setParseError(null);
      onChange({});
      return;
    }
    try {
      const parsed = JSON.parse(next) as StructuredRequestBody;
      setParseError(null);
      onChange(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-[var(--text-secondary)]">
        Structured request body. Leaves can be JSON literals or payload
        references like <code>{'{ "$payload": "first_name" }'}</code>. Use{' '}
        <code>recipient_id</code> to reference the recipient&apos;s id.
      </p>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={10}
        spellCheck={false}
        className="block w-full resize-y rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--color-brand)] focus:outline-none"
      />
      {parseError ? (
        <p className="text-xs text-[var(--color-error)]">JSON parse error: {parseError}</p>
      ) : null}
      <details className="text-xs text-[var(--text-secondary)]">
        <summary className="cursor-pointer">Insert reference helpers</summary>
        <RefHelper text={text} setText={handleChange} />
      </details>
    </div>
  );
}

function stringify(v: StructuredRequestBody | undefined): string {
  if (v === undefined) return '{}';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return '{}';
  }
}

function RefHelper({
  text,
  setText,
}: {
  text: string;
  setText(next: string): void;
}) {
  const [field, setField] = useState('');
  const insert = () => {
    if (!field) return;
    const ref = `{ "$payload": "${field}" }`;
    setText(text.endsWith('\n') ? `${text}${ref}` : `${text}\n${ref}`);
    setField('');
  };
  return (
    <div className="mt-1 flex items-center gap-1">
      <Input
        value={field}
        onChange={(e) => setField(e.target.value)}
        placeholder="payload field name"
      />
      <button
        type="button"
        onClick={insert}
        className="rounded-[var(--radius-default)] border border-[var(--border-default)] px-2 py-0.5 hover:bg-[var(--bg-tertiary)]"
      >
        Insert reference
      </button>
    </div>
  );
}
