import { NavLink } from 'react-router-dom';
import { cn } from '@/utils';
import type { SidebarNavItem } from '@/config/sidebarNav';

interface AdminSidebarContentProps {
  items: SidebarNavItem[];
}

export function AdminSidebarContent({ items }: AdminSidebarContentProps) {
  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2">
      {items.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
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
