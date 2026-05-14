import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  PanelLeftClose,
  PanelLeft,
  Settings,
  BookOpen,
  MessageSquare,
  FileSpreadsheet,
  FileAudio,
  ShieldAlert,
  LogOut,
  KeyRound,
} from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
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
  useAppSettingsStore,
  useChatStore,
  useKairaBotSettings,
} from "@/stores";
import { useAuthStore } from "@/stores/authStore";
import { useCurrentAppConfig, useCurrentAppMetadata } from "@/hooks";
import { cn } from "@/utils";
import { userHasAnyPermission, usePermission, USER_MANAGEMENT_PERMISSIONS } from "@/utils/permissions";
import { routes, settingsRouteForApp } from "@/config/routes";
import { APP_IDS } from '@/types';
import type { AppId } from '@/types';
import { evaluateActionAvailability } from "@/utils/actionAvailability";
import { getNavItems } from "@/config/sidebarNav";
import { getAdminNavItems } from "@/config/sidebarNav";
import { AppSwitcher } from "./AppSwitcher";
import { AppIcon, type AppIconKind } from "./AppIcon";
import { KairaSidebarContent } from "./KairaSidebarContent";
import { VoiceRxSidebarContent } from "./VoiceRxSidebarContent";
import { InsideSalesSidebarContent } from "./InsideSalesSidebarContent";
import { AdminSidebarContent } from "./AdminSidebarContent";
import { ChangePasswordDialog } from "@/features/auth/ChangePasswordDialog";

interface SidebarProps {
  onVoiceRxUpload?: () => void;
}

export function Sidebar({ onVoiceRxUpload }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const appId = useAppStore((state) => state.currentApp);
  const appConfig = useCurrentAppConfig();
  const appMetadata = useCurrentAppMetadata();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const appSettings = useAppSettingsStore((state) => state.settings[appId]);

  // Kaira chat specific
  const { createSession, isCreatingSession, isStreaming } = useChatStore();
  const { settings: kairaBotSettings } = useKairaBotSettings();
  const kairaChatUserId = kairaBotSettings.kairaChatUserId;

  const isGuideActive = location.pathname === routes.guide;

  // Auth
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isAdminView = location.pathname === routes.adminUsers || location.pathname.startsWith(`${routes.adminRoot}/`);
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
  const canEditConfiguration = usePermission('configuration:edit');
  // User-mgmt nav entry stays tied to user-specific permissions, even though
  // the admin chrome is now reachable via `schedule:manage` alone.
  const canManageUsers = userHasAnyPermission(user, USER_MANAGEMENT_PERMISSIONS);
  const adminNavItems = getAdminNavItems({ canManageUsers, canViewCost, canManageSchedules, canManageOrchestration });
  const navItems = isAdminView ? adminNavItems : getNavItems(appId as AppId);

  // Modal management (for batch/adversarial wizards)
  const openModal = useUIStore((s) => s.openModal);

  // Check app type
  const isKairaBot = appId === "kaira-bot";
  const isInsideSales = appId === "inside-sales";

  // Controlled state for the +New popover
  const [newMenuOpen, setNewMenuOpen] = useState(false);

  // Change password dialog
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  // User menu popover
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Disable new button when creating session or streaming
  const newActionAvailability = evaluateActionAvailability({
    appId,
    action: appConfig.actions.primaryNew,
    sources: {
      appSettings,
    },
    runtimeBlockers: [
      {
        key: 'action-in-progress',
        isActive: isKairaBot && (isCreatingSession || isStreaming),
        title: `${appMetadata.newItemLabel} is temporarily unavailable`,
        description: 'Wait for the current action to finish, then try again.',
      },
    ],
  });
  const isNewButtonDisabled = newActionAvailability.disabled;

  // Kaira "new chat" action — creates a session and navigates to it
  const handleNewKairaChat = useCallback(async () => {
    if (!kairaChatUserId) return;
    if (isCreatingSession || isStreaming) return;
    try {
      const session = await createSession(appId, kairaChatUserId);
      navigate(routes.kaira.chatSession(session.id));
    } catch (err) {
      console.warn("Session creation skipped:", err);
    }
  }, [
    kairaChatUserId,
    isCreatingSession,
    isStreaming,
    appId,
    createSession,
    navigate,
  ]);

  // Generic popover items — one source of truth per app, no hardcoded
  // rendering branches. Each entry drives the same NewMenu component.
  const newMenuItems = useMemo<NewMenuItem[]>(() => {
    if (isKairaBot) {
      return [
        {
          icon: MessageSquare,
          label: "New Chat",
          description: "Start a new Kaira conversation",
          action: handleNewKairaChat,
        },
        {
          icon: FileSpreadsheet,
          label: "Batch Evaluation",
          description: "Evaluate threads from CSV data",
          action: () => openModal("batchEval"),
        },
        {
          icon: ShieldAlert,
          label: "Adversarial Test",
          description: "Run adversarial inputs against Kaira",
          action: () => openModal("adversarialTest"),
        },
      ];
    }
    if (isInsideSales) {
      return [
        {
          icon: FileSpreadsheet,
          label: "Batch Evaluation",
          description: "Evaluate a selected set of calls",
          action: () => openModal("insideSalesEval"),
        },
      ];
    }
    if (onVoiceRxUpload) {
      return [
        {
          icon: FileAudio,
          label: "Evaluation",
          description: "Single audio file evaluation",
          action: onVoiceRxUpload,
        },
      ];
    }
    return [];
  }, [isKairaBot, isInsideSales, handleNewKairaChat, openModal, onVoiceRxUpload]);

  const newActionTooltip = isNewButtonDisabled && newActionAvailability.blockers.length > 0 ? (
    <div className="space-y-2">
      <div className="font-medium text-[var(--text-primary)]">
        {appMetadata.newItemLabel} is unavailable
      </div>
      <div className="space-y-1.5">
        {newActionAvailability.blockers.map((blocker) => (
          <div key={blocker.key} className="space-y-0.5">
            <div className="font-medium text-[var(--text-primary)]">{blocker.title}</div>
            <div className="text-[var(--text-secondary)]">{blocker.description}</div>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const renderNewActionButton = (button: React.ReactNode, position: 'bottom' | 'right') => {
    if (!newActionTooltip) {
      return button;
    }

    return (
      <Tooltip content={newActionTooltip} position={position} maxWidth={320}>
        <span className="inline-flex">{button}</span>
      </Tooltip>
    );
  };

  // Generic +New rendering — same popover pattern for every app, items
  // come from `newMenuItems` which is the single branching point.
  const renderNewAction = (variant: 'collapsed' | 'expanded') => {
    if (isAdminView || newMenuItems.length === 0) return null;

    const position: 'bottom' | 'right' = variant === 'collapsed' ? 'right' : 'bottom';
    const triggerButton = variant === 'collapsed' ? (
      <Button
        size="sm"
        disabled={isNewButtonDisabled}
        className="h-9 w-9 p-0"
        title={appMetadata.newItemLabel}
      >
        <Plus className="h-4 w-4" />
      </Button>
    ) : (
      <Button
        size="sm"
        disabled={isNewButtonDisabled}
        isLoading={isCreatingSession}
        className="gap-1.5"
      >
        <Plus className="h-4 w-4" />
        Run
      </Button>
    );

    if (isNewButtonDisabled) {
      return renderNewActionButton(triggerButton, position);
    }

    return (
      <Popover open={newMenuOpen} onOpenChange={setNewMenuOpen}>
        <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
        <PopoverContent
          side={position}
          align={variant === 'collapsed' ? 'start' : 'end'}
          className={cn('p-1', variant === 'collapsed' ? 'w-[240px]' : 'w-[280px]')}
        >
          <NewMenu items={newMenuItems} onClose={() => setNewMenuOpen(false)} />
        </PopoverContent>
      </Popover>
    );
  };

  // Resolves to the icon shown in the collapsed-sidebar header. Single source
  // for both apps (image URL from metadata) and admin (the shield glyph),
  // so adding a new app surface only touches the metadata config.
  const collapsedAppIcon: { iconType: AppIconKind; iconValue: string; name: string } = isAdminView
    ? { iconType: 'glyph', iconValue: 'shield-alert', name: 'Admin' }
    : { iconType: 'image', iconValue: appMetadata.icon, name: appMetadata.name };

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
    <>
      <motion.aside
        animate={{ width: sidebarCollapsed ? 56 : 280 }}
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
              {renderNewAction('collapsed')}

              {/* Divider separates the "New …" action from nav items. Hide
                  it in admin view (and any view without a New action), since
                  there is nothing above it to separate from. */}
              {!isAdminView && newMenuItems.length > 0 ? (
                <div className="border-t border-[var(--border-subtle)] w-8 my-1" />
              ) : null}
              {navItems.map((item) => (
                <CollapsedNavLink
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  title={item.label}
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
                      canEditConfiguration={canEditConfiguration}
                      isGuideActive={isGuideActive}
                      onLogout={logout}
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
          <>
            <div className="flex h-14 items-center justify-between px-4 shrink-0">
              <AppSwitcher />
              <div className="flex items-center gap-1">
                {renderNewAction('expanded')}
                <button
                  onClick={toggleSidebar}
                  className="ml-1 rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                  title="Collapse sidebar"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>
            </div>

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
                  <AdminSidebarContent items={adminNavItems} />
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
                      canEditConfiguration={canEditConfiguration}
                      isGuideActive={isGuideActive}
                      onLogout={logout}
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
        )}
      </motion.aside>
      <ChangePasswordDialog
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
      />
    </>
  );
}

export interface NewMenuItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  action: () => void;
}

function NewMenu({
  items,
  onClose,
}: {
  items: NewMenuItem[];
  onClose: () => void;
}) {
  return (
    <div className="py-1">
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            onClose();
            item.action();
          }}
          className="w-full flex items-start gap-3 px-3 py-2 text-left rounded-md hover:bg-[var(--interactive-secondary)] transition-colors"
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
  canEditConfiguration,
  isGuideActive,
  onLogout,
  onChangePassword,
}: {
  /** ``null`` when the current view has no app-scoped settings (e.g. admin)
   *  — Settings entry is hidden in that case. */
  settingsPath: string | null;
  isSettingsActive: boolean;
  canEditConfiguration: boolean;
  isGuideActive: boolean;
  onLogout: () => void;
  onChangePassword: () => void;
}) {
  const menuLinkClass = "flex w-full items-center gap-2.5 rounded-[6px] px-3 py-1.5 text-[13px] font-medium transition-colors text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]";
  const activeLinkClass = "flex w-full items-center gap-2.5 rounded-[6px] px-3 py-1.5 text-[13px] font-medium transition-colors bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]";

  return (
    <div className="py-1">
      {settingsPath && canEditConfiguration && (
        <Link to={settingsPath} className={isSettingsActive ? activeLinkClass : menuLinkClass}>
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      )}
      <Link to={routes.guide} className={isGuideActive ? activeLinkClass : menuLinkClass}>
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
        onClick={onLogout}
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
