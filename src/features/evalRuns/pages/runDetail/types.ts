import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** A tab in the run-detail surface. Matches the shape `Tabs` expects. */
export interface RunDetailTab {
  id: string;
  label: string;
  content: ReactNode;
}

export interface RunDetailHeader {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

/**
 * The view an app entry produces for a given run. The generic `RunDetailPage`
 * renders the shared shell (PageSurface + InlineReviewProvider + the bounded
 * body wrapper) and never branches on `app_id` — every per-app concern is
 * expressed through this discriminated union.
 *
 * For the tabbed body, entries compose `body` with `<RunDetailTabStrip>` so the
 * `fillHeight` + `flex-1 / min-h-0 / overflow-y-auto` scroll wiring stays in one
 * place and cannot drift per app.
 */
export type RunDetailView =
  | { phase: 'loading' }
  | { phase: 'notFound' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      /** ID used for InlineReviewProvider + review-mode matching. */
      reviewRunId: string;
      header: RunDetailHeader;
      /**
       * The page body, composed by the entry. Use `<RunDetailTabStrip>` for the
       * tabbed case; render a custom node for drill-downs (e.g. inside-sales
       * `/calls/:callId`) or review mode. The page wraps this in a bounded
       * `flex flex-1 min-h-0 flex-col` container.
       */
      body: ReactNode;
      /**
       * Optional back-link override. Defaults to the app's runs list
       * (`runsForApp(appId)`); entries set this only for drill-down sub-routes.
       */
      back?: { to: string; label: string };
      /** Confirm dialogs etc. that must mount alongside the page. */
      dialogs?: ReactNode;
    };

