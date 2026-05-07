/**
 * Inside Sales Sidebar Content
 * Nav-only sidebar — no search bar, no scrollable list.
 */

import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/utils';
import { getNavItems } from '@/config/sidebarNav';

export function InsideSalesSidebarContent() {
  const navItems = getNavItems('inside-sales');
  const { pathname } = useLocation();

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2">
      {navItems.map(({ to, icon: Icon, label, end, activeWhen }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive: navLinkActive }) => {
            // Inside-sales has overlapping URL prefixes (Campaigns at
            // `/orchestration` is a prefix of Connections at
            // `/orchestration/connections`). When a nav item declares
            // `activeWhen`, it owns the active-state decision outright —
            // ignore NavLink's default prefix match.
            const isActive = activeWhen ? activeWhen(pathname) : navLinkActive;
            return cn(
              'flex items-center gap-2 rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors',
              isActive
                ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]'
            );
          }}
        >
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
