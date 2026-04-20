import { useEffect, useState } from 'react';
import { Archive, Check, FileStack, Pencil, Star, X } from 'lucide-react';

import { Button, ConfirmDialog, EmptyState, Tooltip } from '@/components/ui';
import { SettingsSlideOver } from '@/features/settings/components/SettingsSlideOver';
import { reportsApi } from '@/services/api/reportsApi';
import { notificationService } from '@/services/notifications';
import { useAuthStore } from '@/stores/authStore';
import type { ReportConfigSummary } from '@/types';

interface ManageBlueprintsSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  configs: ReportConfigSummary[];
  onConfigsChanged: () => Promise<void> | void;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function sectionCountOf(config: ReportConfigSummary): number {
  const sections = (config.presentationConfig as { sections?: unknown[] } | undefined)?.sections;
  return Array.isArray(sections) ? sections.length : 0;
}

export function ManageBlueprintsSlideOver({
  isOpen,
  onClose,
  configs,
  onConfigsChanged,
}: ManageBlueprintsSlideOverProps) {
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<ReportConfigSummary | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setEditingId(null);
      setDraftName('');
      setPendingId(null);
      setConfirmArchive(null);
    }
  }, [isOpen]);

  const startRename = (config: ReportConfigSummary) => {
    setEditingId(config.id);
    setDraftName(config.name);
  };

  const cancelRename = () => {
    setEditingId(null);
    setDraftName('');
  };

  const commitRename = async (config: ReportConfigSummary) => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      notificationService.error('Name cannot be empty');
      return;
    }
    if (trimmed === config.name) {
      cancelRename();
      return;
    }
    setPendingId(config.id);
    try {
      await reportsApi.updateBlueprint(config.id, { name: trimmed });
      notificationService.success('Blueprint renamed');
      cancelRename();
      await onConfigsChanged();
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : 'Rename failed');
    } finally {
      setPendingId(null);
    }
  };

  const setAsDefault = async (config: ReportConfigSummary) => {
    if (config.isDefault) return;
    setPendingId(config.id);
    try {
      await reportsApi.updateBlueprint(config.id, { isDefault: true });
      notificationService.success('Default blueprint updated');
      await onConfigsChanged();
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to set default');
    } finally {
      setPendingId(null);
    }
  };

  const archive = async (config: ReportConfigSummary) => {
    setPendingId(config.id);
    try {
      await reportsApi.archiveBlueprint(config.id);
      notificationService.success('Blueprint archived');
      setConfirmArchive(null);
      await onConfigsChanged();
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : 'Archive failed');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <>
      <SettingsSlideOver
        isOpen={isOpen}
        onClose={onClose}
        title="Manage blueprints"
        description="Rename, set a default, or archive saved blueprints for this app."
        widthClassName="w-[720px] max-w-[92vw]"
      >
        {configs.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title="No blueprints yet"
            description="Compose a blueprint in Sherlock and save it to see it here."
          />
        ) : (
          <ul className="space-y-2">
            {configs.map((config) => {
              const isOwn = currentUserId !== null && config.userId === currentUserId;
              const isEditing = editingId === config.id;
              const isPending = pendingId === config.id;
              const sections = sectionCountOf(config);
              return (
                <li
                  key={config.id}
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={draftName}
                            onChange={(event) => setDraftName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void commitRename(config);
                              if (event.key === 'Escape') cancelRename();
                            }}
                            disabled={isPending}
                            className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-accent-purple)]"
                          />
                          <Button
                            size="sm"
                            variant="primary"
                            icon={Check}
                            onClick={() => void commitRename(config)}
                            disabled={isPending}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={X}
                            onClick={cancelRename}
                            disabled={isPending}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
                            {config.name}
                          </span>
                          {config.isDefault ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--color-accent-purple)_18%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent-purple)]">
                              <Star className="h-3 w-3" /> Default
                            </span>
                          ) : null}
                          {!isOwn ? (
                            <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                              System
                            </span>
                          ) : null}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
                        <span className="font-mono">{config.reportId}</span>
                        <span aria-hidden>·</span>
                        <span>{`${sections} section${sections === 1 ? '' : 's'}`}</span>
                        <span aria-hidden>·</span>
                        <span>Updated {formatDate(config.updatedAt)}</span>
                      </div>
                      {config.description ? (
                        <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
                          {config.description}
                        </p>
                      ) : null}
                    </div>
                    {!isEditing ? (
                      <div className="flex shrink-0 items-center gap-1">
                        {isOwn ? (
                          <>
                            <Tooltip content={config.isDefault ? 'Already the default' : 'Set as default'}>
                              <Button
                                size="sm"
                                variant="ghost"
                                iconOnly
                                icon={Star}
                                disabled={config.isDefault || isPending}
                                onClick={() => void setAsDefault(config)}
                                aria-label="Set as default"
                              />
                            </Tooltip>
                            <Tooltip content="Rename">
                              <Button
                                size="sm"
                                variant="ghost"
                                iconOnly
                                icon={Pencil}
                                disabled={isPending}
                                onClick={() => startRename(config)}
                                aria-label="Rename"
                              />
                            </Tooltip>
                            <Tooltip content="Archive">
                              <Button
                                size="sm"
                                variant="ghost"
                                iconOnly
                                icon={Archive}
                                disabled={isPending}
                                onClick={() => setConfirmArchive(config)}
                                aria-label="Archive"
                              />
                            </Tooltip>
                          </>
                        ) : (
                          <span className="text-[11px] text-[var(--text-muted)]">Read-only</span>
                        )}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSlideOver>
      <ConfirmDialog
        isOpen={confirmArchive !== null}
        onClose={() => setConfirmArchive(null)}
        onConfirm={() => {
          if (confirmArchive) void archive(confirmArchive);
        }}
        title="Archive blueprint?"
        description={
          confirmArchive
            ? `"${confirmArchive.name}" will stop appearing in pickers. Existing reports generated from it are unaffected.`
            : ''
        }
        confirmLabel="Archive"
        variant="danger"
        isLoading={pendingId === confirmArchive?.id}
      />
    </>
  );
}
