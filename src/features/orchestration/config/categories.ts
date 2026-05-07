import {
  Database,
  Filter,
  GitBranch,
  Send,
  AlertTriangle,
  CheckCircle2,
  Mail,
  Pause,
  Merge,
  Edit3,
  Inbox,
  type LucideIcon,
} from 'lucide-react';

import type {
  DisplayCategory,
  NodeCategory,
} from '@/features/orchestration/types';

export interface NodeCategoryDef {
  label: string;
  icon: LucideIcon;
  /** Soft panel background for the category bar (light + dark via tokens). */
  surfaceVar: string;
  /** Solid fill for the icon square inside the category bar. */
  iconBgVar: string;
  /** Foreground / accent — used for category text + node border. */
  accentVar: string;
}

/** Phase 11 (Commit 2) — neutral, functional category tokens. The palette
 *  groups nodes by ``displayCategory`` (Phase 11 §4); the canvas card uses
 *  the same map for accent / surface / icon tokens. Internal node type
 *  strings are unchanged.
 *
 *  See ``backend/app/services/orchestration/node_descriptors.py`` for the
 *  authoritative list of categories. */
export const DISPLAY_CATEGORIES: Record<DisplayCategory, NodeCategoryDef> = {
  ingress: {
    label: 'Ingress',
    icon: Inbox,
    surfaceVar: 'var(--surface-success)',
    iconBgVar: 'var(--color-success)',
    accentVar: 'var(--color-success)',
  },
  qualification: {
    label: 'Qualification',
    icon: Filter,
    surfaceVar: 'var(--surface-success)',
    iconBgVar: 'var(--color-success)',
    accentVar: 'var(--color-success)',
  },
  routing: {
    label: 'Routing',
    icon: GitBranch,
    surfaceVar: 'var(--surface-warning)',
    iconBgVar: 'var(--color-warning)',
    accentVar: 'var(--color-warning)',
  },
  suspension: {
    label: 'Suspension',
    icon: Pause,
    surfaceVar: 'var(--surface-warning)',
    iconBgVar: 'var(--color-warning)',
    accentVar: 'var(--color-warning)',
  },
  synchronization: {
    label: 'Synchronization',
    icon: Merge,
    surfaceVar: 'var(--surface-warning)',
    iconBgVar: 'var(--color-warning)',
    accentVar: 'var(--color-warning)',
  },
  dispatch: {
    label: 'Dispatch',
    icon: Send,
    surfaceVar: 'var(--surface-info)',
    iconBgVar: 'var(--color-info)',
    accentVar: 'var(--color-info)',
  },
  mutation: {
    label: 'Mutation',
    icon: Edit3,
    surfaceVar: 'var(--surface-info)',
    iconBgVar: 'var(--color-info)',
    accentVar: 'var(--color-info)',
  },
  termination: {
    label: 'Termination',
    icon: CheckCircle2,
    surfaceVar: 'var(--bg-tertiary)',
    iconBgVar: 'var(--text-muted)',
    accentVar: 'var(--text-secondary)',
  },
};

/** Display order for the palette — matches the `DisplayCategory` declaration
 *  order in the backend descriptor (Phase 11 §4). */
export const DISPLAY_CATEGORY_ORDER: readonly DisplayCategory[] = [
  'ingress',
  'qualification',
  'routing',
  'suspension',
  'synchronization',
  'dispatch',
  'mutation',
  'termination',
];

/** Legacy buckets — preserved for the back-compat ``category`` field on
 *  ``NodeTypeDescriptor`` so older builder code (run-canvas overlay
 *  legacy minimap, the few places that still pass ``category`` through to
 *  ``NodeCard``) keeps rendering until those callers migrate to
 *  ``displayCategory``. New code should use ``DISPLAY_CATEGORIES``. */
export const NODE_CATEGORIES: Record<NodeCategory, NodeCategoryDef> = {
  source: {
    label: 'Source',
    icon: Database,
    surfaceVar: 'var(--surface-success)',
    iconBgVar: 'var(--color-success)',
    accentVar: 'var(--color-success)',
  },
  filter: {
    label: 'Filter',
    icon: Filter,
    surfaceVar: 'var(--surface-success)',
    iconBgVar: 'var(--color-success)',
    accentVar: 'var(--color-success)',
  },
  logic: {
    label: 'Logic',
    icon: GitBranch,
    surfaceVar: 'var(--surface-warning)',
    iconBgVar: 'var(--color-warning)',
    accentVar: 'var(--color-warning)',
  },
  action: {
    label: 'Action',
    icon: Send,
    surfaceVar: 'var(--surface-info)',
    iconBgVar: 'var(--color-info)',
    accentVar: 'var(--color-info)',
  },
  escalation: {
    label: 'Escalation',
    icon: AlertTriangle,
    surfaceVar: 'var(--surface-error)',
    iconBgVar: 'var(--color-error)',
    accentVar: 'var(--color-error)',
  },
  sink: {
    label: 'Sink',
    icon: Mail,
    surfaceVar: 'var(--bg-tertiary)',
    iconBgVar: 'var(--text-muted)',
    accentVar: 'var(--text-secondary)',
  },
};

/** Look up a node-card definition for either a Phase 11 ``displayCategory``
 *  ('dispatch', 'qualification', ...) or a legacy ``category`` ('action',
 *  'filter', ...). Always returns a definition; falls back to ``logic`` /
 *  ``routing`` so visualizations stay rendered even with unknown inputs. */
export function getCategoryDef(category: string): NodeCategoryDef {
  if (category in DISPLAY_CATEGORIES) {
    return DISPLAY_CATEGORIES[category as DisplayCategory];
  }
  if (category in NODE_CATEGORIES) {
    return NODE_CATEGORIES[category as NodeCategory];
  }
  return DISPLAY_CATEGORIES.routing;
}

/** Cross-render minimap helper: pick the accent token for a node's
 *  ``displayCategory``, falling back to the legacy ``category`` when the
 *  Phase-11 field isn't present (e.g. saved definitions still in the
 *  process of migrating). Used by ``Canvas.tsx`` for the React Flow
 *  MiniMap nodeColor. */
export function getCategoryAccentToken(input: {
  displayCategory?: string;
  category?: string;
}): string {
  return getCategoryDef(input.displayCategory ?? input.category ?? '').accentVar;
}
