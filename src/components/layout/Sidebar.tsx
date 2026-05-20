import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  PanelLeftClose,
  PanelLeft,
  Settings,
  BookOpen,
  LogOut,
  KeyRound,
} from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Tooltip,
} from "@/components/ui";
import {
  useUIStore,
  useAppStore,
} from "@/stores";
import { useAuthStore } from "@/stores/authStore";
import { useCurrentAppMetadata } from "@/hooks";
import { cn } from "@/utils";
import { userHasAnyPermission, usePermission, USER_MANAGEMENT_PERMISSIONS } from "@/utils/permissions";
import { isAdminPath, routes, settingsRouteForApp } from "@/config/routes";
import { APP_IDS } from '@/types';
import type { AppId } from '@/types';
import { getAdminNavGroups, getNavItems, type SidebarNavGroup, type SidebarNavItem } from "@/config/sidebarNav";
import { AppSwitcher } from "./AppSwitcher";
import { AppIcon, type AppIconKind } from "./AppIcon";
import { iconKindOf } from "./appIconKind";
import { KairaSidebarContent } from "./KairaSidebarContent";
import { VoiceRxSidebarContent } from "./VoiceRxSidebarContent";
import { InsideSalesSidebarContent } from "./InsideSalesSidebarContent";
import { AdminSidebarContent } from "./AdminSidebarContent";
import { ChangePasswordDialog } from "@/features/auth/ChangePasswordDialog";
import { QuickActionsProvider } from "@/features/quickActions/QuickActionsProvider";
import type { QuickActionItem } from "@/features/quickActions/types";
import type { ActionAvailabilityBlocker } from "@/utils/actionAvailability";

export function Sidebar() {
  const location = useLocation();
  const appId = useAppStore((state) => state.currentApp);
  const appMetadata = useCurrentAppMetadata();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  const isGuideActive = location.pathname === routes.guide;

  // Auth
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isAdminView = isAdminPath(location.pathname);
  // App-scoped settings target. ``null`` when the current view is not bound
  // to an app (e.g. admin chrome) so ``UserMenu`` hides the Settings entry
  // — keeps the avatar menu free of dangling links into a different context.
  const settingsPath = isAdminView ? null : settingsRouteForApp(appId);
  const isSettingsActive =
    settingsPath !== null &&
    APP_IDS.some((candidateAppId) => location.pathname === settingsRouteForApp(candidateAppId));
  const canViewCost = usePermission('cost:view');
  const canManageSchedules = usePermission('schedule:manage');
  const canManageOrchestration = usePermission('orchestration:manage');
  const canManageCommCap = usePermission('orchestration:admin:comm_cap');
  const canEditConfiguration = usePermission('configuration:edit');
  const canManageNotifications = usePermission('notifications:manage');
  // User-mgmt nav entry stays tied to user-specific permissions, even though
  // the admin chrome is now reachable via `schedule:manage` alone.
  const canManageUsers = userHasAnyPermission(user, USER_MANAGEMENT_PERMISSIONS);
  const adminPermissions = {
    canManageUsers,
    canViewCost,
    canManageSchedules,
    canManageOrchestration,
    canManageCommCap,
    canEditConfiguration,
    canManageNotifications,
  };
  const adminNavGroups = getAdminNavGroups(adminPermissions);
  // Flat list for the collapsed sidebar rail — mirrors the grouped layout used
  // by the expanded chrome but discards group titles since collapsed nav has
  // no room for them.
  const adminNavItems = adminNavGroups.flatMap((group) => group.items);
  const navItems = isAdminView ? adminNavItems : getNavItems(appId as AppId);

  // Entries that drive the collapsed icon strip. Admin view tags each item
  // with its group so the tooltip can carry the section name; other views
  // pass the item through unannotated.
  type CollapsedEntry = { item: SidebarNavItem; group: SidebarNavGroup | null };
  const collapsedEntries: CollapsedEntry[] = isAdminView
    ? adminNavGroups.flatMap((group) => group.items.map((item) => ({ item, group })))
    : navItems.map((item) => ({ item, group: null }));

  // Controlled state for the +New popover
  const [newMenuOpen, setNewMenuOpen] = useState(false);

  // Change password dialog
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  // User menu popover
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Aggregate availability across all configured quick actions. The Run
  // button itself is disabled only when EVERY action is disabled — partial
  // disablement is communicated per-row inside the menu. This keeps the
  // primary CTA usable as long as at least one item can fire.
  const aggregateDisabled = (items: QuickActionItem[]) =>
    items.length > 0 && items.every((item) => item.disabled);
  const aggregateLoading = (items: QuickActionItem[]) =>
    items.some((item) => item.isLoading);
  const aggregateBlockers = (items: QuickActionItem[]): ActionAvailabilityBlocker[] =>
    items.flatMap((item) => item.blockers);

  const renderNewAction = (
    variant: 'collapsed' | 'expanded',
    items: QuickActionItem[],
  ) => {
    if (isAdminView || items.length === 0) return null;

    const disabled = aggregateDisabled(items);
    const isLoading = aggregateLoading(items);
    const blockers = disabled ? aggregateBlockers(items) : [];
    const position: 'bottom' | 'right' = variant === 'collapsed' ? 'right' : 'bottom';

    const triggerButton = variant === 'collapsed' ? (
      <Button
        size="sm"
        disabled={disabled}
        className="h-9 w-9 p-0"
        title={appMetadata.newItemLabel}
      >
        <Plus className="h-4 w-4" />
      </Button>
    ) : (
      <Button
        size="md"
        disabled={disabled}
        isLoading={isLoading}
        className="w-full gap-1.5"
      >
        <Plus className="h-4 w-4" />
        Run
      </Button>
    );

    const tooltip = disabled && blockers.length > 0 ? (
      <div className="space-y-2">
        <div className="font-medium text-[var(--text-primary)]">
          {appMetadata.newItemLabel} is unavailable
        </div>
        <div className="space-y-1.5">
          {blockers.map((blocker) => (
            <div key={blocker.key} className="space-y-0.5">
              <div className="font-medium text-[var(--text-primary)]">{blocker.title}</div>
              <div className="text-[var(--text-secondary)]">{blocker.description}</div>
            </div>
          ))}
        </div>
      </div>
    ) : null;

    if (disabled) {
      const wrapped = tooltip ? (
        <Tooltip content={tooltip} position={position} maxWidth={320}>
          <span className="inline-flex">{triggerButton}</span>
        </Tooltip>
      ) : triggerButton;
      return wrapped;
    }

    return (
      <Popover open={newMenuOpen} onOpenChange={setNewMenuOpen}>
        <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
        <PopoverContent
          side={position}
          align="start"
          className={cn('p-1', variant === 'collapsed' ? 'w-[240px]' : 'w-[256px]')}
        >
          <QuickActionMenu items={items} onClose={() => setNewMenuOpen(false)} />
        </PopoverContent>
      </Popover>
    );
  };

  // App-content selection still keys off app id today. Sidebar *content*
  // (chat list / call list / generic nav) is the next slot to declarativize
  // — see docs/plans/ for the planned `sidebarContent` registry. Until then,
  // these locals stay strictly local to the rendering branch below.
  const isKairaBot = appId === 'kaira-bot';
  const isInsideSales = appId === 'inside-sales';

  // Resolves to the icon shown in the collapsed-sidebar header. Single source
  // for both apps (image or glyph, detected from metadata) and admin (the
  // shield glyph), so adding a new app surface only touches the metadata config.
  const collapsedAppIcon: { iconType: AppIconKind; iconValue: string; name: string } = isAdminView
    ? { iconType: 'glyph', iconValue: 'shield-alert', name: 'Admin' }
    : { iconType: iconKindOf(appMetadata.icon), iconValue: appMetadata.icon, name: appMetadata.name };

  // App content key for the AnimatePresence crossfade — changes when the user
  // switches apps or enters/leaves admin view.
  const appContentKey = isAdminView
    ? 'admin'
    : isInsideSales
      ? 'inside-sales'
      : isKairaBot
        ? 'kaira-bot'
        : 'voice-rx';

  return (
    <QuickActionsProvider>
      {(quickActionItems: QuickActionItem[]) => (
    <>
      <motion.aside
        animate={{ width: sidebarCollapsed ? 56 : 230 }}
        transition={{ type: 'spring', stiffness: 400, damping: 40 }}
        initial={false}
        className="flex h-screen flex-col bg-[var(--bg-secondary)] overflow-hidden"
      >
        {sidebarCollapsed ? (
          <>
            <div className="flex h-14 items-center justify-center">
              {/* Active app icon shows by default; the expand-panel control
                  swaps in on hover via Tailwind's `group` pattern (no JS
                  state, no listeners — robust to re-renders). The button
                  itself always toggles the sidebar; the icon is decorative
                  context for the current surface. */}
              <button
                onClick={toggleSidebar}
                title="Expand sidebar"
                aria-label="Expand sidebar"
                className="group relative flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
              >
                <AppIcon
                  iconType={collapsedAppIcon.iconType}
                  iconValue={collapsedAppIcon.iconValue}
                  name={collapsedAppIcon.name}
                  className="h-6 w-6 transition-opacity duration-150 group-hover:opacity-0"
                />
                <PanelLeft
                  aria-hidden
                  className="absolute h-5 w-5 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                />
              </button>
            </div>
            <div className="flex-1 flex flex-col items-center py-3 gap-2">
              {renderNewAction('collapsed', quickActionItems)}

              {/* Divider separates the "New …" action from nav items. Hide
                  it in admin view (and any view without a New action), since
                  there is nothing above it to separate from. */}
              {!isAdminView && quickActionItems.length > 0 ? (
                <div className="border-t border-[var(--border-subtle)] w-8 my-1" />
              ) : null}
              {collapsedEntries.map(({ item, group }) => (
                <CollapsedNavLink
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  title={group ? `${group.title} · ${item.label}` : item.label}
                  end={item.end}
                  activeWhen={item.activeWhen}
                />
              ))}
            </div>
            {user && (
              <div className="p-2">
                <Popover open={userMenuOpen} onOpenChange={setUserMenuOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors hover:bg-[var(--interactive-secondary)]"
                      title={user.displayName}
                    >
                      <UserAvatar displayName={user.displayName} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="right" align="end" className="w-[220px] p-1">
                    <UserMenu
                      settingsPath={settingsPath}
                      isSettingsActive={isSettingsActive}
                      isGuideActive={isGuideActive}
                      onLogout={logout}
                      onClose={() => setUserMenuOpen(false)}
                      onChangePassword={() => {
                        setUserMenuOpen(false);
                        setIsChangePasswordOpen(true);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </>
        ) : (
          // Locked-width inner shell (matches the aside's expanded width).
          // The aside animates 56→230; this wrapper renders at the final
          // width so children compute layout once and the resize becomes a
          // pure clipping reveal under the aside's `overflow-hidden` —
          // no per-frame flex/truncate reflow ("dancing").
          <div className="flex h-full min-h-0 w-[230px] flex-col">
            <div className="flex h-14 items-center gap-2 px-3 shrink-0">
              <div className="min-w-0 flex-1">
                <AppSwitcher />
              </div>
              <button
                onClick={toggleSidebar}
                className="shrink-0 rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            {/* Primary action lives on its own row so long app names never
                collide with it, and Run reads as a top-level CTA rather
                than a header chip. Hidden when the surface has no action
                (admin) or no menu items registered. */}
            {!isAdminView && quickActionItems.length > 0 && (
              <div className="px-3 pb-2 shrink-0">
                {renderNewAction('expanded', quickActionItems)}
              </div>
            )}

            {/* Conditional content based on app — crossfades on app switch */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={appContentKey}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex flex-1 flex-col min-h-0"
              >
                {isAdminView ? (
                  <AdminSidebarContent groups={adminNavGroups} />
                ) : isInsideSales ? (
                  <InsideSalesSidebarContent />
                ) : isKairaBot ? (
                  <KairaSidebarContent
                    searchPlaceholder={appMetadata.searchPlaceholder}
                  />
                ) : (
                  <VoiceRxSidebarContent
                    searchPlaceholder={appMetadata.searchPlaceholder}
                  />
                )}
              </motion.div>
            </AnimatePresence>

            {/* Bottom: single user row → popover with all options */}
            {user && (
              <div className="mt-auto p-2 shrink-0">
                <Popover open={userMenuOpen} onOpenChange={setUserMenuOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className="flex w-full items-center gap-2.5 rounded-[6px] px-2 py-2 transition-colors hover:bg-[var(--interactive-secondary)]"
                    >
                      <UserAvatar displayName={user.displayName} />
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-[12px] font-medium leading-tight text-[var(--text-primary)]">
                          {user.displayName}
                        </div>
                        <div className="truncate text-[11px] leading-tight text-[var(--text-muted)]">
                          {user.tenantName}
                          {user.roleName && (
                            <span className="ml-1 text-[var(--text-brand)]">{user.roleName}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-[220px] p-1">
                    <UserMenu
                      settingsPath={settingsPath}
                      isSettingsActive={isSettingsActive}
                      isGuideActive={isGuideActive}
                      onLogout={logout}
                      onClose={() => setUserMenuOpen(false)}
                      onChangePassword={() => {
                        setUserMenuOpen(false);
                        setIsChangePasswordOpen(true);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>
        )}
      </motion.aside>
      <ChangePasswordDialog
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
      />
    </>
      )}
    </QuickActionsProvider>
  );
}

function QuickActionMenu({
  items,
  onClose,
}: {
  items: QuickActionItem[];
  onClose: () => void;
}) {
  return (
    <div className="py-1">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          disabled={item.disabled}
          title={item.disabled && item.blockers.length > 0 ? item.blockers[0].title : undefined}
          className="w-full flex items-start gap-3 px-3 py-2 text-left rounded-md hover:bg-[var(--interactive-secondary)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          <item.icon className="h-4 w-4 mt-0.5 text-[var(--text-secondary)] shrink-0" />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[var(--text-primary)]">
              {item.label}
            </div>
            <div className="text-[11px] text-[var(--text-muted)] leading-tight">
              {item.description}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function UserMenu({
  settingsPath,
  isSettingsActive,
  isGuideActive,
  onLogout,
  onChangePassword,
  onClose,
}: {
  /** ``null`` when the current view has no app-scoped settings (e.g. admin)
   *  — Settings entry is hidden in that case. */
  settingsPath: string | null;
  isSettingsActive: boolean;
  isGuideActive: boolean;
  onLogout: () => void;
  onChangePassword: () => void;
  /** Dismiss the popover. Navigating items don't unmount the menu, so each
   *  must close it explicitly. */
  onClose: () => void;
}) {
  const menuLinkClass = "flex w-full items-center gap-2.5 rounded-[6px] px-3 py-1.5 text-[13px] font-medium transition-colors text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]";
  const activeLinkClass = "flex w-full items-center gap-2.5 rounded-[6px] px-3 py-1.5 text-[13px] font-medium transition-colors bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]";

  return (
    <div className="py-1">
      {settingsPath && (
        <Link to={settingsPath} onClick={onClose} className={isSettingsActive ? activeLinkClass : menuLinkClass}>
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      )}
      <Link to={routes.guide} onClick={onClose} className={isGuideActive ? activeLinkClass : menuLinkClass}>
        <BookOpen className="h-4 w-4" />
        Guide
      </Link>
      <div className="my-1 border-t border-[var(--border-subtle)]" />
      <button
        onClick={onChangePassword}
        className={menuLinkClass}
      >
        <KeyRound className="h-4 w-4" />
        Change Password
      </button>
      <button
        onClick={() => {
          onClose();
          onLogout();
        }}
        className="flex w-full items-center gap-2.5 rounded-[6px] px-3 py-1.5 text-[13px] font-medium transition-colors text-red-400 hover:bg-red-500/10 hover:text-red-300"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );
}

function UserAvatar({ displayName }: { displayName: string }) {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-accent)]/20 text-[10px] font-semibold text-[var(--text-brand)]">
      {displayName
        .split(' ')
        .map((name) => name[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)}
    </div>
  );
}

function CollapsedNavLink({
  to,
  icon: Icon,
  title,
  end,
  activeWhen,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  end?: boolean;
  activeWhen?: (pathname: string) => boolean;
}) {
  const { pathname } = useLocation();
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive: navLinkActive }) => {
        const isActive = activeWhen ? activeWhen(pathname) : navLinkActive;
        return cn(
          'relative flex h-9 w-9 items-center justify-center rounded-[6px] transition-colors',
          isActive
            ? 'text-[var(--text-brand)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]',
        );
      }}
      title={title}
    >
      {({ isActive: navLinkActive }) => {
        const isActive = activeWhen ? activeWhen(pathname) : navLinkActive;
        return (
          <>
            {isActive && (
              <motion.span
                layoutId="sidebar-active-pill-collapsed"
                className="absolute inset-0 rounded-[6px] bg-[var(--color-brand-accent)]/20"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            <Icon className="relative h-5 w-5" />
          </>
        );
      }}
    </NavLink>
  );
}
