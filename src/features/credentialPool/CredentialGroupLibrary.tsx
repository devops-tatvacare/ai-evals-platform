import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save, Trash2, Download, PlusCircle, RefreshCcw } from 'lucide-react';

import { Button, Input, Select } from '@/components/ui';
import { notificationService } from '@/services/notifications';

import type { CredentialGroupStorageAdapter, CredentialPoolGroup } from './types';

interface CredentialGroupLibraryProps {
  storage: CredentialGroupStorageAdapter;
  currentEntries: Array<Record<string, string>>;
  onReplaceEntries: (entries: Array<Record<string, string>>) => void;
  onMergeEntries: (entries: Array<Record<string, string>>) => void;
  variant?: 'card' | 'flat';
  showHeader?: boolean;
}

export function CredentialGroupLibrary({
  storage,
  currentEntries,
  onReplaceEntries,
  onMergeEntries,
  variant = 'card',
  showHeader = true,
}: CredentialGroupLibraryProps) {
  const [groups, setGroups] = useState<CredentialPoolGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const nextGroups = await storage.listGroups();
      setGroups(nextGroups);
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to load credential groups.');
    } finally {
      setLoading(false);
    }
  }, [storage]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const handleSaveNew = async () => {
    if (!groupName.trim()) {
      notificationService.warning('Enter a group name before saving.');
      return;
    }
    if (currentEntries.length === 0) {
      notificationService.warning('Add credential rows before saving a group.');
      return;
    }

    setSaving(true);
    try {
      const group = await storage.saveGroup(groupName.trim(), currentEntries);
      await loadGroups();
      setSelectedGroupId(group.id);
      setGroupName(group.name);
      notificationService.success('Credential group saved.');
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to save credential group.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedGroup) {
      notificationService.warning('Select a saved group to update.');
      return;
    }

    setSaving(true);
    try {
      const updated = await storage.updateGroup(selectedGroup.id, currentEntries, groupName.trim() || selectedGroup.name);
      await loadGroups();
      setSelectedGroupId(updated.id);
      setGroupName(updated.name);
      notificationService.success('Credential group updated.');
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to update credential group.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedGroup) {
      notificationService.warning('Select a saved group to delete.');
      return;
    }

    setDeleting(true);
    try {
      await storage.deleteGroup(selectedGroup.id);
      await loadGroups();
      setSelectedGroupId('');
      setGroupName('');
      notificationService.success('Credential group deleted.');
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to delete credential group.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className={[
        'space-y-3',
        variant === 'card'
          ? 'rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3'
          : '',
      ].join(' ').trim()}
    >
      {showHeader && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-[13px] font-medium text-[var(--text-primary)]">Saved Credential Groups</h4>
            <p className="text-[11px] text-[var(--text-muted)]">
              Load a saved pool, merge it into the current run, or save the current pool for reuse.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => { void loadGroups(); }} icon={RefreshCcw} isLoading={loading}>
            Refresh
          </Button>
        </div>
      )}

      {!showHeader && (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => { void loadGroups(); }} icon={RefreshCcw} isLoading={loading}>
            Refresh
          </Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <label className="block text-[12px] font-medium text-[var(--text-primary)] mb-1.5">Saved Group</label>
          <Select
            value={selectedGroupId}
            onChange={(nextId) => {
              const nextGroup = groups.find((group) => group.id === nextId);
              setSelectedGroupId(nextId);
              setGroupName(nextGroup?.name ?? '');
            }}
            options={groups.map((group) => ({ value: group.id, label: `${group.name} (${group.entries.length})` }))}
            placeholder="Select a credential group"
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[var(--text-primary)] mb-1.5">Group Name</label>
          <Input
            value={groupName}
            placeholder="Save current pool as..."
            onChange={(e) => setGroupName(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={Download}
          disabled={!selectedGroup}
          onClick={() => selectedGroup && onReplaceEntries(selectedGroup.entries)}
        >
          Load
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={PlusCircle}
          disabled={!selectedGroup}
          onClick={() => selectedGroup && onMergeEntries(selectedGroup.entries)}
        >
          Merge
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={Save}
          isLoading={saving}
          onClick={() => { void handleSaveNew(); }}
        >
          Save New
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={Save}
          disabled={!selectedGroup}
          isLoading={saving}
          onClick={() => { void handleUpdate(); }}
        >
          Update Selected
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={Trash2}
          disabled={!selectedGroup}
          isLoading={deleting}
          onClick={() => { void handleDelete(); }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
