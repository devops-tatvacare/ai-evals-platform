import type { EvaluatorOutputField } from '@/types';
import { Badge } from '@/components/ui/Badge';
import type { BadgeVariant } from '@/components/ui/Badge';

interface SchemaDiffProps {
  oldFields: EvaluatorOutputField[];
  newFields: EvaluatorOutputField[];
}

type ChangeStatus = 'added' | 'modified' | 'removed' | 'unchanged';

interface DiffRow {
  key: string;
  type: string;
  status: ChangeStatus;
  detail: string;
}

function buildDiff(oldFields: EvaluatorOutputField[], newFields: EvaluatorOutputField[]): DiffRow[] {
  const oldMap = new Map(oldFields.map((f) => [f.key, f]));
  const newMap = new Map(newFields.map((f) => [f.key, f]));
  const rows: DiffRow[] = [];

  // Additions and modifications
  for (const [key, newField] of newMap) {
    const oldField = oldMap.get(key);
    if (!oldField) {
      rows.push({ key, type: newField.type, status: 'added', detail: 'New field' });
    } else {
      const changes: string[] = [];
      if (oldField.type !== newField.type) changes.push(`type ${oldField.type} → ${newField.type}`);
      if (oldField.displayMode !== newField.displayMode) changes.push(`display ${oldField.displayMode} → ${newField.displayMode}`);
      if (oldField.isMainMetric !== newField.isMainMetric) changes.push(newField.isMainMetric ? 'set main metric' : 'unset main metric');
      if (oldField.description !== newField.description) changes.push('description changed');
      if (changes.length > 0) {
        rows.push({ key, type: newField.type, status: 'modified', detail: changes.join(', ') });
      } else {
        rows.push({ key, type: newField.type, status: 'unchanged', detail: '' });
      }
    }
  }

  // Removals
  for (const [key, oldField] of oldMap) {
    if (!newMap.has(key)) {
      rows.push({ key, type: oldField.type, status: 'removed', detail: 'Removed' });
    }
  }

  return rows;
}

const badgeVariantMap: Record<ChangeStatus, BadgeVariant> = {
  added: 'success',
  modified: 'warning',
  removed: 'error',
  unchanged: 'neutral',
};

export function SchemaDiff({ oldFields, newFields }: SchemaDiffProps) {
  const rows = buildDiff(oldFields, newFields);
  const added = rows.filter((r) => r.status === 'added').length;
  const modified = rows.filter((r) => r.status === 'modified').length;
  const removed = rows.filter((r) => r.status === 'removed').length;

  return (
    <div className="flex flex-col gap-3">
      {/* Summary header */}
      <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
        {added > 0 && (
          <span className="text-[var(--color-success)] font-medium">+{added} added</span>
        )}
        {modified > 0 && (
          <span className="text-[var(--color-warning)] font-medium">{modified} modified</span>
        )}
        {removed > 0 && (
          <span className="text-[var(--color-error)] font-medium">{removed} removed</span>
        )}
        {added === 0 && modified === 0 && removed === 0 && (
          <span className="text-[var(--text-muted)]">No changes</span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-[6px] border border-[var(--border-default)]">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
              <th className="px-3 py-2 text-left font-semibold text-[var(--text-muted)] uppercase tracking-wide text-[11px]">
                Field
              </th>
              <th className="px-3 py-2 text-left font-semibold text-[var(--text-muted)] uppercase tracking-wide text-[11px]">
                Type
              </th>
              <th className="px-3 py-2 text-left font-semibold text-[var(--text-muted)] uppercase tracking-wide text-[11px]">
                Change
              </th>
              <th className="px-3 py-2 text-left font-semibold text-[var(--text-muted)] uppercase tracking-wide text-[11px]">
                Detail
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-secondary)]"
              >
                <td className="px-3 py-2 font-mono text-[var(--text-primary)]">{row.key}</td>
                <td className="px-3 py-2 text-[var(--text-secondary)]">{row.type}</td>
                <td className="px-3 py-2">
                  <Badge variant={badgeVariantMap[row.status]} size="sm">
                    {row.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
