import { useState } from 'react';
import { X } from 'lucide-react';

import { Button, Combobox, RightSlideOverShell } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import type {
  VerifiedQueryCreateInput,
  VerifiedQueryRow,
  VerifiedQueryUpdateInput,
} from '@/services/api/sherlockAdmin';

const APP_OPTIONS = [
  { value: 'voice-rx', label: 'voice-rx' },
  { value: 'inside-sales', label: 'inside-sales' },
  { value: 'kaira-bot', label: 'kaira-bot' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Null = create mode. Non-null = edit mode (only the row's own tenant rows). */
  target: VerifiedQueryRow | null;
  defaultAppId: string;
  onSubmitCreate: (input: VerifiedQueryCreateInput) => Promise<unknown>;
  onSubmitUpdate: (id: string, input: VerifiedQueryUpdateInput) => Promise<unknown>;
  submitting: boolean;
}

export function VerifiedQueryEditor({
  isOpen,
  onClose,
  target,
  defaultAppId,
  onSubmitCreate,
  onSubmitUpdate,
  submitting,
}: Props) {
  return (
    <RightSlideOverShell
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="verified-query-editor-title"
      widthClassName="w-[640px] max-w-[92vw]"
    >
      {/* Key the form by target.id (or 'new') so switching between rows
          OR closing/reopening the panel remounts with fresh state. This
          replaces the useEffect-based form reset that triggered the
          react-hooks/set-state-in-effect lint rule. */}
      <EditorForm
        key={target?.id ?? 'new'}
        target={target}
        defaultAppId={defaultAppId}
        onClose={onClose}
        onSubmitCreate={onSubmitCreate}
        onSubmitUpdate={onSubmitUpdate}
        submitting={submitting}
      />
    </RightSlideOverShell>
  );
}

type EditorFormProps = Omit<Props, 'isOpen'>;

function EditorForm({
  target,
  defaultAppId,
  onClose,
  onSubmitCreate,
  onSubmitUpdate,
  submitting,
}: EditorFormProps) {
  const isEdit = target !== null;

  const [appId, setAppId] = useState(target?.appId ?? defaultAppId);
  const [question, setQuestion] = useState(target?.question ?? '');
  const [sql, setSql] = useState(target?.sql ?? '');
  const [enabled, setEnabled] = useState(target?.enabled ?? true);

  const canSubmit = question.trim().length > 0 && sql.trim().length > 0 && !submitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (isEdit && target) {
      void onSubmitUpdate(target.id, {
        question: question.trim(),
        sql: sql.trim(),
        enabled,
      });
    } else {
      void onSubmitCreate({
        appId,
        question: question.trim(),
        sql: sql.trim(),
        enabled,
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3">
        <h2
          id="verified-query-editor-title"
          className="text-[14px] font-semibold text-[var(--text-primary)]"
        >
          {isEdit ? 'Edit verified query' : 'New verified query'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <Field label="App">
          {isEdit ? (
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[13px] text-[var(--text-secondary)]">
              {appId} <span className="text-[var(--text-muted)]">(cannot change)</span>
            </div>
          ) : (
            <Combobox
              options={APP_OPTIONS}
              value={appId}
              onChange={(v) => setAppId(v)}
            />
          )}
        </Field>

        <Field label="Question (natural language)">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Pass rate trend by week"
          />
        </Field>

        <Field label="SQL (must start with SELECT or WITH)">
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="SELECT ... FROM analytics.fact_evaluation WHERE tenant_id = :tenant_id AND app_id = :app_id"
            className="min-h-[260px] w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 font-mono text-[12.5px] text-[var(--text-primary)] focus:border-[var(--interactive-primary)] focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Use the bind placeholders <code>:tenant_id</code> and <code>:app_id</code>.
            No DDL, DML, or stacked statements (server-side validated).
          </p>
        </Field>

        <Field label="">
          <label className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled (visible to the data_specialist retriever)
          </label>
        </Field>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={!canSubmit}
          isLoading={submitting}
        >
          {isEdit ? 'Save changes' : 'Create'}
        </Button>
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</label>
      ) : null}
      {children}
    </div>
  );
}
