/**
 * Phase 2 (sherlock-builder) — context chip rendered inside `ChatInput`.
 *
 * Visual model: an "attachment-style" pill pinned at the top of the chat
 * input container (think Cursor's file attachment chips). Two visual
 * states:
 *   - Collapsed: dashed-border pill — pulse dot + verb + workflow name +
 *     CRM/Clinical badge + chevron + dismiss.
 *   - Expanded: clicking the pill body slides open a details panel
 *     (framer-motion) showing workflow / selection / canvas stats — every
 *     field derived from `pageContext`, no hardcoded strings.
 *
 * View-mode chip is self-actuating: the in-pill "Switch to Edit" button
 * flips `workflowBuilderStore.setViewMode('edit')` so the user can unlock
 * authoring without hunting for the canvas pencil button.
 *
 * Visual tokens are pulled from `globals.css` only — no hex literals.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Circle, Eye, Pencil, X } from 'lucide-react';

import { cn } from '@/utils/cn';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import type { PageContext } from '@/features/orchestration/copilot/usePageContext';

/**
 * Phase 3 — authoring-shape heuristic + suggestion text.
 *
 * The chat widget consults this during `send()` when the user is in
 * `view` mode on the builder. A whole-word match on any of the listed
 * verbs (case-insensitive) triggers a one-time inline suggestion in
 * the chat thread; the user's message still goes through and the LLM
 * refuses via the supervisor prompt — this is an early-feedback
 * affordance, not a gate.
 *
 * Heuristic is intentionally crude: false positives are cheap (the
 * LLM refuses anyway), false negatives just mean no early feedback.
 * Do not import a NLP library; do not call an LLM to classify intent.
 */
const AUTHORING_VERBS: readonly string[] = [
  'add',
  'remove',
  'build',
  'connect',
  'change',
  'delete',
  'update',
  'edit',
  'create',
];

const AUTHORING_VERB_REGEX = new RegExp(
  `\\b(?:${AUTHORING_VERBS.join('|')})\\b`,
  'i',
);

export function isAuthoringShapedPrompt(text: string): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return AUTHORING_VERB_REGEX.test(text);
}

export const VIEW_MODE_SUGGESTION_TEXT =
  "You're viewing — click Edit on the canvas to let me make changes.";

interface BuilderContextChipProps {
  pageContext: Extract<PageContext, { kind: 'orchestration_builder' }>;
  onDismiss: () => void;
}

const WORKFLOW_TYPE_LABEL: Record<'crm' | 'clinical', string> = {
  crm: 'CRM',
  clinical: 'Clinical',
};

const HASH_PREVIEW_CHARS = 7;

function shortHash(hash: string): string {
  if (!hash) return '—';
  return hash.length > HASH_PREVIEW_CHARS ? hash.slice(0, HASH_PREVIEW_CHARS) : hash;
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function BuilderContextChip({ pageContext, onDismiss }: BuilderContextChipProps) {
  const [expanded, setExpanded] = useState(false);
  const setViewMode = useWorkflowBuilderStore((s) => s.setViewMode);
  const isEdit = pageContext.viewMode === 'edit';
  const Icon = isEdit ? Pencil : Eye;

  const verb = isEdit ? 'Editing' : 'Viewing';
  const workflowName = pageContext.workflowName.trim() || 'Untitled workflow';
  const typeLabel = WORKFLOW_TYPE_LABEL[pageContext.workflowType];

  const selectedNode = pageContext.selectedNodeId
    ? pageContext.definition.nodes.find((n) => n.id === pageContext.selectedNodeId)
    : null;

  const nodeCount = pageContext.definition.nodes.length;
  const edgeCount = pageContext.definition.edges.length;

  const handleHeaderClick = () => setExpanded((v) => !v);
  const handleHeaderKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setExpanded((v) => !v);
    }
  };

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-dashed',
        isEdit
          ? 'border-[var(--border-brand)] bg-[var(--surface-brand-subtle)]'
          : 'border-[var(--border-default)] bg-[var(--bg-primary)]',
      )}
      data-testid="builder-context-chip"
    >
      {/* Collapsed header — always visible, click to expand. */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleHeaderClick}
        onKeyDown={handleHeaderKey}
        aria-expanded={expanded}
        aria-controls="builder-context-chip-details"
        aria-label={`${verb} ${workflowName}, ${expanded ? 'hide' : 'show'} details`}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 text-[12px]',
          'cursor-pointer select-none transition-colors',
          isEdit
            ? 'hover:bg-[var(--surface-brand-hover)]'
            : 'hover:bg-[var(--bg-secondary)]',
          'focus-visible:outline-none focus-visible:ring-1',
          'focus-visible:ring-[var(--color-brand-accent)]',
        )}
        data-testid="builder-context-chip-header"
      >
        <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
          {isEdit ? (
            <>
              <span
                className={cn(
                  'absolute inline-flex h-full w-full rounded-full opacity-75',
                  'bg-[var(--color-brand-primary)] animate-ping',
                )}
              />
              <Circle
                className="relative h-2 w-2 fill-[var(--color-brand-primary)] text-[var(--color-brand-primary)]"
                aria-hidden
              />
            </>
          ) : (
            <Circle
              className="relative h-2 w-2 fill-[var(--text-muted)] text-[var(--text-muted)]"
              aria-hidden
            />
          )}
        </span>

        <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" aria-hidden />

        <span
          className={cn(
            'truncate font-medium',
            isEdit ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
          )}
        >
          {`${verb}: ${workflowName}`}
        </span>

        <span
          className={cn(
            'ml-auto flex shrink-0 items-center gap-1 text-[var(--text-muted)]',
          )}
        >
          <span
            className={cn(
              'rounded-sm px-1.5 py-px text-[10px] font-medium tracking-wide uppercase',
              'border border-[var(--border-default)] bg-[var(--bg-primary)]',
            )}
          >
            {typeLabel}
          </span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-150',
              expanded ? 'rotate-180' : 'rotate-0',
            )}
            aria-hidden
          />
        </span>

        {isEdit ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded',
              'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
              'hover:bg-[var(--bg-tertiary)] focus-visible:outline-none',
              'focus-visible:ring-1 focus-visible:ring-[var(--color-brand-accent)]',
            )}
            aria-label="Skip canvas context for next message"
            title="Skip canvas context for next message"
            data-testid="builder-context-chip-dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      {/* Expanded details — derived from pageContext, never hardcoded. */}
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id="builder-context-chip-details"
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden border-t border-dashed border-[var(--border-default)]"
            data-testid="builder-context-chip-details"
          >
            <dl
              className={cn(
                'grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5',
                'px-3 py-2 text-[11px]',
              )}
            >
              <DetailRow label="Workflow">
                <span className="font-medium text-[var(--text-primary)]">{workflowName}</span>
              </DetailRow>

              <DetailRow label="Selection">
                {selectedNode ? (
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="font-mono text-[var(--text-primary)]">
                      {selectedNode.type}
                    </span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span className="font-mono text-[var(--text-secondary)]">
                      {selectedNode.id}
                    </span>
                  </span>
                ) : (
                  <span className="italic text-[var(--text-muted)]">no selection</span>
                )}
              </DetailRow>

              <DetailRow label="Canvas">
                <span className="flex flex-wrap items-center gap-1.5 text-[var(--text-secondary)]">
                  <span>{formatCount(nodeCount, 'node', 'nodes')}</span>
                  <span className="text-[var(--text-muted)]">·</span>
                  <span>{formatCount(edgeCount, 'edge', 'edges')}</span>
                  <span className="text-[var(--text-muted)]">·</span>
                  <span
                    className="font-mono text-[var(--text-muted)]"
                    title={`Data hash: ${pageContext.dataHash}`}
                  >
                    {shortHash(pageContext.dataHash)}
                  </span>
                </span>
              </DetailRow>

              {!isEdit ? (
                <DetailRow label="Mode">
                  <span className="flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
                    <span>Read-only — Sherlock can't change the canvas.</span>
                    <button
                      type="button"
                      onClick={() => setViewMode('edit')}
                      className={cn(
                        'inline-flex items-center gap-1 rounded',
                        'border border-[var(--border-brand)] bg-[var(--surface-brand-subtle)]',
                        'px-2 py-0.5 text-[11px] font-medium text-[var(--text-brand)]',
                        'hover:bg-[var(--surface-brand-hover)]',
                        'focus-visible:outline-none focus-visible:ring-1',
                        'focus-visible:ring-[var(--color-brand-accent)]',
                      )}
                      data-testid="builder-context-chip-switch-to-edit"
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                      Switch to Edit
                    </button>
                  </span>
                </DetailRow>
              ) : null}
            </dl>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt
        className={cn(
          'text-[10px] font-medium uppercase tracking-wide',
          'text-[var(--text-muted)] self-center',
        )}
      >
        {label}
      </dt>
      <dd className="text-[var(--text-secondary)] min-w-0">{children}</dd>
    </>
  );
}
