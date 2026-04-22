import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, ShieldAlert } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { APP_IDS, getAppMetadataFromConfig, type AppId } from '@/types';
import { cn } from '@/utils';
import { adminHomeRoute, homeRouteForApp, routes } from '@/config/routes';
import {
  USER_MANAGEMENT_PERMISSIONS,
  userHasAnyPermission,
  userHasPermission,
} from '@/utils/permissions';

interface AppConfig {
  id: AppId | 'admin-view';
  name: string;
  route: string;
  iconType: 'image' | 'glyph';
  iconValue: string;
}

export function AppSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const currentApp = useAppStore((state) => state.currentApp);
  const setCurrentApp = useAppStore((state) => state.setCurrentApp);
  const getAppConfig = useAppStore((state) => state.getAppConfig);
  const user = useAuthStore((s) => s.user);
  const canManageUsers = userHasAnyPermission(user, USER_MANAGEMENT_PERMISSIONS);
  const canViewCost = userHasPermission(user, 'cost:view');
  const canManageSchedules = userHasPermission(user, 'schedule:manage');
  const adminRoute = adminHomeRoute({ canManageUsers, canViewCost, canManageSchedules });
  const isAdminView = location.pathname === routes.adminUsers || location.pathname.startsWith(`${routes.adminRoot}/`);

  const appOptions = APP_IDS.map((appId) => {
    const metadata = getAppMetadataFromConfig(appId, getAppConfig(appId));
    return {
      id: appId,
      name: metadata.name,
      route: homeRouteForApp(appId),
      iconType: 'image' as const,
      iconValue: metadata.icon,
    };
  });

  const adminOption: AppConfig | null = adminRoute
    ? {
        id: 'admin-view',
        name: 'Admin',
        route: adminRoute,
        iconType: 'glyph',
        iconValue: 'shield-alert',
      }
    : null;

  const accessibleApps = user?.isOwner
    ? appOptions
    : appOptions.filter((app) => user?.appAccess.includes(app.id) ?? false);
  const dropdownOptions = adminOption ? [...accessibleApps, adminOption] : accessibleApps;
  const currentOption =
    (isAdminView ? adminOption : accessibleApps.find((app) => app.id === currentApp)) ??
    accessibleApps.find((app) => app.id === currentApp) ??
    dropdownOptions[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectApp = (app: AppConfig) => {
    if (app.id !== 'admin-view') {
      setCurrentApp(app.id);
    }
    setIsOpen(false);
    navigate(app.route);
  };

  const renderOptionIcon = (app: AppConfig, sizeClass: string) => {
    if (app.iconType === 'image') {
      return (
        <img
          src={app.iconValue}
          alt={app.name}
          className={cn(sizeClass, 'rounded object-cover')}
        />
      );
    }

    return (
      <div
        className={cn(
          sizeClass,
          'flex items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
        )}
      >
        <ShieldAlert className="h-4 w-4" />
      </div>
    );
  };

  if (!currentOption) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
          'hover:bg-[var(--interactive-secondary)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] focus-visible:ring-offset-1',
          isOpen && 'bg-[var(--interactive-secondary)]'
        )}
      >
        {renderOptionIcon(currentOption, 'h-6 w-6')}
        <span className="whitespace-nowrap text-base font-semibold text-[var(--text-primary)]">
          {currentOption.name}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-[var(--text-muted)] transition-transform',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] py-1 shadow-lg">
          {accessibleApps.map((app) => (
            <button
              key={app.id}
              onClick={() => handleSelectApp(app)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors',
                'hover:bg-[var(--interactive-secondary)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]',
                !isAdminView && app.id === currentApp && 'bg-[var(--color-brand-accent)]/10'
              )}
            >
              {renderOptionIcon(app, 'h-5 w-5')}
              <span className="flex-1 font-medium text-[var(--text-primary)]">
                {app.name}
              </span>
              {!isAdminView && app.id === currentApp && (
                <Check className="h-4 w-4 text-[var(--text-brand)]" />
              )}
            </button>
          ))}
          {adminOption && accessibleApps.length > 0 && (
            <div className="my-1 border-t border-[var(--border-subtle)]" />
          )}
          {adminOption && (
            <button
              onClick={() => handleSelectApp(adminOption)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors',
                'hover:bg-[var(--interactive-secondary)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]',
                isAdminView && 'bg-[var(--color-brand-accent)]/10'
              )}
            >
              {renderOptionIcon(adminOption, 'h-5 w-5')}
              <span className="flex-1 font-medium text-[var(--text-primary)]">
                {adminOption.name}
              </span>
              {isAdminView && (
                <Check className="h-4 w-4 text-[var(--text-brand)]" />
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
