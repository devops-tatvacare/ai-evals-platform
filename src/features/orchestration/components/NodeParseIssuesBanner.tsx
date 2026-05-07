import { AlertTriangle } from 'lucide-react';

import {
  useNodeParseIssueSummary,
  useWorkflowBuilderStore,
} from '@/features/orchestration/store/workflowBuilderStore';

/**
 * Phase 14 / Phase D — top-of-canvas banner that surfaces nodes whose
 * config failed the Zod parse boundary (either at hydrate or after
 * `updateNodeConfig`). Log+continue mode means the builder stays usable
 * and saves keep working — but the operator gets a clear "this node will
 * not pass publish" affordance.
 *
 * Click on a row focuses the node so the operator can fix it without
 * scanning the canvas for a small badge.
 */
export function NodeParseIssuesBanner() {
  const issueGroups = useNodeParseIssueSummary();
  const setSelectedNode = useWorkflowBuilderStore((s) => s.setSelectedNode);
  if (issueGroups.length === 0) return null;
  const totalIssues = issueGroups.reduce((acc, g) => acc + g.issues.length, 0);
  return (
    <div
      role="alert"
      className="border-b border-[var(--color-warning)] bg-[var(--surface-warning)] px-3 py-1.5"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]"
        />
        <div className="min-w-0 flex-1 text-xs text-[var(--text-primary)]">
          <span className="font-medium">
            {issueGroups.length} node{issueGroups.length === 1 ? '' : 's'} with
            invalid config ({totalIssues} issue{totalIssues === 1 ? '' : 's'})
          </span>
          <span className="text-[var(--text-secondary)]">
            {' '}
            — published runs may reject these. Click to focus.
          </span>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {issueGroups.slice(0, 5).map((g) => (
              <li key={g.nodeId}>
                <button
                  type="button"
                  onClick={() => setSelectedNode(g.nodeId)}
                  className="text-left underline-offset-2 hover:underline"
                  title={g.issues.map((i) => i.message).join('\n')}
                >
                  <span className="font-medium">{g.nodeType}</span>
                  <span className="text-[var(--text-secondary)]">
                    {' · '}
                    {g.issues[0].field || '(config)'}: {g.issues[0].message}
                    {g.issues.length > 1
                      ? ` (+${g.issues.length - 1} more)`
                      : ''}
                  </span>
                </button>
              </li>
            ))}
            {issueGroups.length > 5 ? (
              <li className="text-[var(--text-secondary)]">
                …and {issueGroups.length - 5} more
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}
