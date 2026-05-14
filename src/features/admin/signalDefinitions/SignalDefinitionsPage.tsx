import { useMemo, useState } from 'react';
import { Radar, Plus, Pencil, Trash2 } from 'lucide-react';

import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Input,
  RightSlideOverShell,
  Select,
  Switch,
  PageSurface,
  type ColumnDef,
  type SelectOption,
} from '@/components/ui';
import { cn } from '@/utils/cn';
import { notificationService } from '@/services/notifications';
import type { SignalDefinitionRow } from '@/services/api/signalDefinitions';

import {
  useCreateSignalDefinition,
  useDeleteSignalDefinition,
  useSignalDefinitions,
  useUpdateSignalDefinition,
} from './queries';

// ── strategy + predicate vocabulary (mirrors the backend) ────────────────

const STRATEGY_OPTIONS: SelectOption[] = [
  { value: 'rule', label: 'rule — deterministic field-bound rules' },
  { value: 'llm_profile', label: 'llm_profile — LLM over lead profile' },
  { value: 'llm_transcript', label: 'llm_transcript — eval-run signal projection' },
];

const PREDICATE_OPTIONS: SelectOption[] = [
  { value: 'in_set', label: 'in_set — value is one of a list' },
  { value: 'contains_any', label: 'contains_any — value contains any substring' },
  { value: 'numeric_gte', label: 'numeric_gte — first number ≥ threshold' },
  {
    value: 'present_and_not_contains',
    label: 'present_and_not_contains — non-empty and excludes substrings',
  },
];

// Local form shape for one rule signal — flattened so predicate-specific
// args are simple inputs; serialized to the definition body on save.
interface RuleSignalForm {
  signalType: string;
  field: string;
  predicate: string;
  valuesText: string; // in_set / contains_any
  threshold: string; // numeric_gte
  excludeText: string; // present_and_not_contains
}

const EMPTY_RULE_SIGNAL: RuleSignalForm = {
  signalType: '',
  field: '',
  predicate: 'in_set',
  valuesText: '',
  threshold: '',
  excludeText: '',
};

function _splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function _ruleSignalsFromDefinition(def: Record<string, unknown>): RuleSignalForm[] {
  const signals = Array.isArray(def.signals) ? def.signals : [];
  return signals.map((raw): RuleSignalForm => {
    const sig = (raw ?? {}) as Record<string, unknown>;
    const args = (sig.args ?? {}) as Record<string, unknown>;
    const values = Array.isArray(args.values) ? args.values : [];
    const exclude = Array.isArray(args.exclude) ? args.exclude : [];
    return {
      signalType: String(sig.signal_type ?? ''),
      field: String(sig.field ?? ''),
      predicate: String(sig.predicate ?? 'in_set'),
      valuesText: values.map(String).join(', '),
      threshold: args.threshold != null ? String(args.threshold) : '',
      excludeText: exclude.map(String).join(', '),
    };
  });
}

function _ruleScoreFromDefinition(def: Record<string, unknown>): string {
  const score = (def.score ?? null) as Record<string, unknown> | null;
  return score && typeof score.signal_type === 'string' ? score.signal_type : '';
}

function _ruleSignalToBody(s: RuleSignalForm): Record<string, unknown> {
  let args: Record<string, unknown> = {};
  if (s.predicate === 'in_set' || s.predicate === 'contains_any') {
    args = { values: _splitList(s.valuesText) };
  } else if (s.predicate === 'numeric_gte') {
    args = { threshold: Number(s.threshold) };
  } else if (s.predicate === 'present_and_not_contains') {
    args = { exclude: _splitList(s.excludeText) };
  }
  return {
    signal_type: s.signalType.trim(),
    field: s.field.trim(),
    predicate: s.predicate,
    args,
  };
}

// ── editor slide-over ────────────────────────────────────────────────────

interface EditorState {
  mode: 'create' | 'edit';
  row: SignalDefinitionRow | null;
}

function SignalDefinitionEditor({
  state,
  onClose,
}: {
  state: EditorState;
  onClose: () => void;
}) {
  const isEdit = state.mode === 'edit';
  const existing = state.row;
  const createMutation = useCreateSignalDefinition();
  const updateMutation = useUpdateSignalDefinition();
  const saving = createMutation.isPending || updateMutation.isPending;

  const [appId, setAppId] = useState(existing?.appId ?? '');
  const [signalSet, setSignalSet] = useState(existing?.signalSet ?? '');
  const [strategy, setStrategy] = useState(existing?.strategy ?? 'rule');
  const [sourceSurface, setSourceSurface] = useState(
    existing?.sourceSurface ?? 'dim_lead',
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [ruleSignals, setRuleSignals] = useState<RuleSignalForm[]>(
    existing ? _ruleSignalsFromDefinition(existing.definition) : [],
  );
  const [scoreSignalType, setScoreSignalType] = useState(
    existing ? _ruleScoreFromDefinition(existing.definition) : '',
  );

  function buildDefinition(): Record<string, unknown> {
    if (strategy !== 'rule') {
      // llm_profile / llm_transcript carry no tunable body today.
      return {};
    }
    const body: Record<string, unknown> = {
      signals: ruleSignals.map(_ruleSignalToBody),
    };
    if (scoreSignalType.trim()) {
      body.score = { signal_type: scoreSignalType.trim(), kind: 'count_true' };
    }
    return body;
  }

  async function handleSave() {
    try {
      if (isEdit && existing) {
        await updateMutation.mutateAsync({
          id: existing.id,
          body: {
            sourceSurface,
            definition: buildDefinition(),
            enabled,
          },
        });
        notificationService.success('Signal definition updated');
      } else {
        await createMutation.mutateAsync({
          appId: appId.trim(),
          signalSet: signalSet.trim(),
          strategy,
          sourceSurface: sourceSurface.trim(),
          definition: buildDefinition(),
          enabled,
        });
        notificationService.success('Signal definition created');
      }
      onClose();
    } catch (err) {
      notificationService.error((err as Error).message);
    }
  }

  function updateRuleSignal(i: number, patch: Partial<RuleSignalForm>) {
    setRuleSignals((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );
  }

  const fieldLabel = 'block text-[11px] font-medium text-secondary mb-1';

  return (
    <RightSlideOverShell isOpen onClose={onClose} widthClassName="w-[560px]">
      <div className="flex h-full flex-col">
        <header className="border-b border-default px-5 py-4">
          <h2 className="text-sm font-semibold text-primary">
            {isEdit ? 'Edit signal definition' : 'New signal definition'}
          </h2>
          <p className="mt-0.5 text-[11px] text-tertiary">
            {isEdit
              ? `${existing?.appId} · ${existing?.signalSet} · ${existing?.strategy}`
              : 'Tenant-owned definition. Same (app, signal set) as a system template shadows it.'}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!isEdit && (
            <>
              <div>
                <label className={fieldLabel}>App ID</label>
                <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="inside-sales" />
              </div>
              <div>
                <label className={fieldLabel}>Signal set</label>
                <Input value={signalSet} onChange={(e) => setSignalSet(e.target.value)} placeholder="mql" />
              </div>
              <div>
                <label className={fieldLabel}>Strategy</label>
                <Select value={strategy} onChange={setStrategy} options={STRATEGY_OPTIONS} />
              </div>
            </>
          )}

          <div>
            <label className={fieldLabel}>Source surface</label>
            <Input
              value={sourceSurface}
              onChange={(e) => setSourceSurface(e.target.value)}
              placeholder="dim_lead"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-secondary">Enabled</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {strategy === 'rule' ? (
            <div className="space-y-3 border-t border-default pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-semibold text-primary">Rule signals</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRuleSignals((p) => [...p, { ...EMPTY_RULE_SIGNAL }])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add signal
                </Button>
              </div>
              {ruleSignals.length === 0 && (
                <p className="text-[11px] text-tertiary">
                  No rule signals yet. Each row maps a normalized field to a predicate.
                </p>
              )}
              {ruleSignals.map((sig, i) => (
                <div key={i} className="rounded-md border border-default p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      value={sig.signalType}
                      onChange={(e) => updateRuleSignal(i, { signalType: e.target.value })}
                      placeholder="signal_type (e.g. mql_age)"
                    />
                    <button
                      type="button"
                      className="text-tertiary hover:text-danger"
                      onClick={() => setRuleSignals((p) => p.filter((_, idx) => idx !== i))}
                      aria-label="Remove signal"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Input
                    value={sig.field}
                    onChange={(e) => updateRuleSignal(i, { field: e.target.value })}
                    placeholder="field — e.g. city or attributes_at_first_seen.age_group"
                  />
                  <Select
                    value={sig.predicate}
                    onChange={(v) => updateRuleSignal(i, { predicate: v })}
                    options={PREDICATE_OPTIONS}
                  />
                  {(sig.predicate === 'in_set' || sig.predicate === 'contains_any') && (
                    <Input
                      value={sig.valuesText}
                      onChange={(e) => updateRuleSignal(i, { valuesText: e.target.value })}
                      placeholder="values, comma-separated"
                    />
                  )}
                  {sig.predicate === 'numeric_gte' && (
                    <Input
                      value={sig.threshold}
                      onChange={(e) => updateRuleSignal(i, { threshold: e.target.value })}
                      placeholder="threshold (number)"
                    />
                  )}
                  {sig.predicate === 'present_and_not_contains' && (
                    <Input
                      value={sig.excludeText}
                      onChange={(e) => updateRuleSignal(i, { excludeText: e.target.value })}
                      placeholder="exclude substrings, comma-separated"
                    />
                  )}
                </div>
              ))}
              <div className="border-t border-default pt-3">
                <label className={fieldLabel}>Roll-up score signal_type (optional)</label>
                <Input
                  value={scoreSignalType}
                  onChange={(e) => setScoreSignalType(e.target.value)}
                  placeholder="e.g. mql_score — counts the true signals"
                />
              </div>
            </div>
          ) : (
            <p className="border-t border-default pt-4 text-[11px] text-tertiary">
              The <code>{strategy}</code> strategy carries no tunable rule body — its
              derivation logic is fixed in code. This definition just registers the
              strategy + source surface for its app.
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-default px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
          </Button>
        </footer>
      </div>
    </RightSlideOverShell>
  );
}

// ── page ─────────────────────────────────────────────────────────────────

export function SignalDefinitionsPage() {
  const { data, isLoading, error } = useSignalDefinitions();
  const deleteMutation = useDeleteSignalDefinition();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SignalDefinitionRow | null>(
    null,
  );

  const columns = useMemo<ColumnDef<SignalDefinitionRow>[]>(
    () => [
      { key: 'appId', header: 'App', render: (r) => r.appId },
      { key: 'signalSet', header: 'Signal set', render: (r) => r.signalSet },
      { key: 'strategy', header: 'Strategy', render: (r) => r.strategy },
      { key: 'sourceSurface', header: 'Source', render: (r) => r.sourceSurface },
      {
        key: 'state',
        header: 'State',
        render: (r) => (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
              r.enabled
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-amber-500/15 text-amber-400',
            )}
          >
            {r.enabled ? 'Enabled' : 'Disabled'}
          </span>
        ),
      },
      {
        key: 'origin',
        header: 'Origin',
        render: (r) =>
          r.isSystemTemplate ? (
            <span className="text-[11px] text-tertiary">System template</span>
          ) : (
            <span className="text-[11px] text-secondary">Tenant</span>
          ),
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (r) =>
          r.isSystemTemplate ? (
            <span className="text-[11px] text-tertiary">read-only</span>
          ) : (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditor({ mode: 'edit', row: r })}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPendingDelete(r)}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          ),
      },
    ],
    [],
  );

  return (
    <PageSurface
      icon={Radar}
      title="Signal definitions"
      subtitle="Tenant-editable signal derivation config. System templates are read-only; create a tenant row to override one."
      actions={
        <Button size="sm" onClick={() => setEditor({ mode: 'create', row: null })}>
          <Plus className="mr-1 h-3.5 w-3.5" /> New definition
        </Button>
      }
    >
      {error ? (
        <EmptyState
          icon={Radar}
          title="Failed to load signal definitions"
          description={(error as Error).message}
        />
      ) : (
        <DataTable
          columns={columns}
          data={data?.definitions ?? []}
          keyExtractor={(r) => r.id}
          loading={isLoading}
          emptyIcon={Radar}
          emptyTitle="No signal definitions"
          emptyDescription="System templates are seeded at boot; create a tenant definition to start."
        />
      )}

      {editor && (
        <SignalDefinitionEditor state={editor} onClose={() => setEditor(null)} />
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete signal definition"
        description={
          pendingDelete
            ? `Delete ${pendingDelete.appId} · ${pendingDelete.signalSet}? Existing fact_lead_signal rows keep their data; their lineage FK is nulled.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await deleteMutation.mutateAsync({ id: pendingDelete.id });
            notificationService.success('Signal definition deleted');
            setPendingDelete(null);
          } catch (err) {
            notificationService.error((err as Error).message);
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </PageSurface>
  );
}
