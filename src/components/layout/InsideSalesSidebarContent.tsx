/**
 * Inside Sales Sidebar Content
 * Nav-only sidebar — no search bar, no scrollable list.
 */

import { NavLink } from 'react-router-dom';
import { LayoutGrid, FileText, ListChecks, LayoutDashboard, ScrollText, ChartArea } from 'lucide-react';
import { cn } from '@/utils';
import { routes } from '@/config/routes';

const NAV_ITEMS = [
  { to: routes.insideSales.listing, icon: LayoutGrid, label: 'Listing' },
  { to: routes.insideSales.dashboard, icon: LayoutDashboard, label: 'Dashboard' },
  { to: routes.insideSales.evaluators, icon: FileText, label: 'Evaluators' },
  { to: routes.insideSales.runs, icon: ListChecks, label: 'Runs' },
  { to: routes.insideSales.logs, icon: ScrollText, label: 'Logs' },
  { to: routes.insideSales.analytics, icon: ChartArea, label: 'Analytics' },
];

export function InsideSalesSidebarContent() {
  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2">
      {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === routes.insideSales.listing}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2 rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors',
              isActive
                ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]'
            )
          }
        >
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
