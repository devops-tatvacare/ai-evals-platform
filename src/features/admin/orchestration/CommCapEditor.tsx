import { useId, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import {
  Button,
  Combobox,
  Input,
  RightSlideOverShell,
  Switch,
} from '@/components/ui';
import { notificationService } from '@/services/notifications';
import { rolesApi } from '@/services/api/rolesApi';
import {
  decodeApiError,
  summarizeApiErrorBody,
} from '@/features/orchestration/contracts/errorDecoder';
import type { CommCapPolicy } from '@/services/api/orchestrationAdmin';
import { useAuthStore } from '@/stores/authStore';
import { useUpsertCommCapPolicy } from './queries';

interface Props {
  /** Existing policy to edit, or null to create a new one. */
  policy: CommCapPolicy | null;
  /** App ids already capped — excluded from the picker when creating. */
  existingAppIds: string[];
  onClose: () => void;
}

const DEFAULT_MAX_COUNT = 1;
const DEFAULT_WINDOW_SECONDS = 86_400;

/** Reach-limit create/edit slide-over. Tenant is fixed to the current admin's
 *  tenant; the app is the only scope choice. */
export function CommCapEditor({ policy, existingAppIds, onClose }: Props) {
  const titleId = useId();
  const isCreate = policy === null;
  const user = useAuthStore((s) => s.user);
  const upsert = useUpsertCommCapPolicy();
  const { data: apps = [], isLoading: appsLoading } = useQuery({
    queryKey: ['apps', 'list'],
    queryFn: rolesApi.listApps,
  });

  const [appId, setAppId] = useState(policy?.appId ?? '');
  const [maxCount, setMaxCount] = useState(String(policy?.maxCount ?? DEFAULT_MAX_COUNT));
  const [windowSeconds, setWindowSeconds] = useState(
    String(policy?.windowSeconds ?? DEFAULT_WINDOW_SECONDS),
  );
  const [isActive, setIsActive] = useState(policy?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  // When creating, only offer apps without a limit yet; when editing, the
  // app is fixed (one policy per tenant+app).
  const appOptions = useMemo(() => {
    const taken = new Set(existingAppIds);
    return apps
      .filter((app) => isCreate ? !taken.has(app.id) : app.id === policy?.appId)
      .map((app) => ({ value: app.id, label: app.displayName }));
  }, [apps, existingAppIds, isCreate, policy?.appId]);

  const handleSave = () => {
    setError(null);
    if (!user) {
      setError('Your session has no tenant context.');
      return;
    }
    if (!appId) {
      setError('Pick an app for this limit.');
      return;
    }
    const max = Number(maxCount);
    const window = Number(windowSeconds);
    if (!Number.isInteger(max) || max < 1) {
      setError('Max times a contact can be reached must be a whole number above zero.');
      return;
    }
    if (!Number.isInteger(window) || window < 1) {
      setError('Window length must be a whole number of seconds above zero.');
      return;
    }
    upsert.mutate(
      {
        tenantId: user.tenantId,
        appId,
        maxCount: max,
        windowSeconds: window,
        isActive,
      },
      {
        onSuccess: () => {
          notificationService.success('Reach limit saved.');
          onClose();
        },
        onError: (err) => {
          const message = summarizeApiErrorBody(decodeApiError(err), 'please try again');
          setError(message);
          notificationService.error(message);
        },
      },
    );
  };

  return (
    <RightSlideOverShell
      isOpen
      onClose={onClose}
      labelledBy={titleId}
      widthClassName="w-[var(--overlay-width-sm)] max-w-[85vw]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-6 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[15px] font-semibold text-[var(--text-primary)]"
            >
              Reach limit
            </h2>
            <p className="truncate text-[12px] text-[var(--text-muted)]">
              {user?.tenantName ?? 'Current workspace'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <Field label="App">
            <Combobox
              value={appId}
              options={appOptions}
              placeholder={appsLoading ? 'Loading apps…' : 'Pick an app'}
              disabled={appsLoading || !isCreate}
              onChange={setAppId}
            />
          </Field>

          <Field label="Max times a contact can be reached">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={maxCount}
              onChange={(e) => setMaxCount(e.target.value)}
            />
          </Field>

          <Field label="Window length">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={windowSeconds}
              onChange={(e) => setWindowSeconds(e.target.value)}
            />
            <FieldHint>In seconds (86400 = 1 day).</FieldHint>
          </Field>

          <div className="flex items-center justify-between">
            <label className="text-[12px] font-medium text-[var(--text-primary)]">
              Enforce this limit
            </label>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          {error && (
            <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error-light)] px-3 py-2 text-[12px] text-[var(--color-error)]">
              {error}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-6 py-3">
          <Button variant="secondary" onClick={onClose} disabled={upsert.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={upsert.isPending}>
            {upsert.isPending ? 'Saving…' : 'Save limit'}
          </Button>
        </footer>
      </div>
    </RightSlideOverShell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-[var(--text-primary)]">
        {label}
      </label>
      {children}
    </div>
  );
}

function FieldHint({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-[11px] text-[var(--text-muted)]">{children}</p>;
}
