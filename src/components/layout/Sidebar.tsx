import { useCallback } from 'react';
import { Plus, PanelLeftClose, PanelLeft, Settings, LayoutDashboard, ListChecks, ScrollText } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import { useUIStore, useAppStore, useChatStore, useKairaBotSettings } from '@/stores';
import { useCurrentAppMetadata } from '@/hooks';
import { cn } from '@/utils';
import { routes } from '@/config/routes';
import { AppSwitcher } from './AppSwitcher';
import { KairaSidebarContent } from './KairaSidebarContent';
import { VoiceRxSidebarContent } from './VoiceRxSidebarContent';

interface SidebarProps {
  onNewEval?: () => void;
}

export function Sidebar({ onNewEval }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const appId = useAppStore((state) => state.currentApp);
  const appMetadata = useCurrentAppMetadata();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  // Kaira chat specific
  const { createSession, selectSession, isCreatingSession, isStreaming } = useChatStore();
  const { settings: kairaBotSettings } = useKairaBotSettings();
  const kairaChatUserId = kairaBotSettings.kairaChatUserId;

  // Compute settings path based on current app
  const settingsPath = appId === 'kaira-bot' ? routes.kaira.settings : routes.voiceRx.settings;
  const isSettingsActive = location.pathname === routes.voiceRx.settings || location.pathname === routes.kaira.settings;

  // Check if this is Kaira Bot app
  const isKairaBot = appId === 'kaira-bot';

  // Disable new button when creating session or streaming
  const isNewButtonDisabled = isKairaBot && (!kairaChatUserId || isCreatingSession || isStreaming);

  // Handle new button click - different behavior for Kaira vs Voice Rx
  const handleNewClick = useCallback(async () => {
    if (isKairaBot && kairaChatUserId) {
      // Guard handled by store, but also check here for early return
      if (isCreatingSession || isStreaming) return;
      
      try {
        // Create new Kaira chat session
        const session = await createSession(appId, kairaChatUserId);
        selectSession(appId, session.id);
        // Navigate to Kaira chat page
        if (location.pathname !== routes.kaira.chat) {
          navigate(routes.kaira.chat);
        }
      } catch (err) {
        // Session creation failed (likely concurrent creation guard)
        console.warn('Session creation skipped:', err);
      }
    } else if (!isKairaBot && onNewEval) {
      // Voice Rx - use existing handler
      onNewEval();
    }
  }, [isKairaBot, kairaChatUserId, isCreatingSession, isStreaming, appId, createSession, selectSession, location.pathname, navigate, onNewEval]);

  // Collapsed sidebar
  if (sidebarCollapsed) {
    return (
      <aside className="flex h-screen w-14 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex h-14 items-center justify-center border-b border-[var(--border-subtle)]">
          <button
            onClick={toggleSidebar}
            className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
            title="Expand sidebar"
          >
            <PanelLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center py-3 gap-2">
          <Button
            size="sm"
            onClick={handleNewClick}
            disabled={isNewButtonDisabled}
            className="h-9 w-9 p-0"
            title={isKairaBot ? "New chat" : "New evaluation"}
          >
            <Plus className="h-4 w-4" />
          </Button>

          <div className="border-t border-[var(--border-subtle)] w-8 my-1" />
          {isKairaBot ? (
            <>
              <CollapsedNavLink to={routes.kaira.dashboard} icon={LayoutDashboard} title="Dashboard" />
              <CollapsedNavLink to={routes.kaira.runs} icon={ListChecks} title="Runs" />
              <CollapsedNavLink to={routes.kaira.logs} icon={ScrollText} title="Logs" />
            </>
          ) : (
            <>
              <CollapsedNavLink to={routes.voiceRx.dashboard} icon={LayoutDashboard} title="Dashboard" />
              <CollapsedNavLink to={routes.voiceRx.runs} icon={ListChecks} title="Runs" />
              <CollapsedNavLink to={routes.voiceRx.logs} icon={ScrollText} title="Logs" />
            </>
          )}
        </div>
        <div className="border-t border-[var(--border-subtle)] p-2">
          <Link
            to={settingsPath}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-[6px] transition-colors',
              isSettingsActive
                ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]'
            )}
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-screen w-[280px] flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
      <div className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] px-4">
        <AppSwitcher />
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            onClick={handleNewClick}
            disabled={isNewButtonDisabled}
            isLoading={isCreatingSession}
          >
            <Plus className="h-4 w-4" />
            New
          </Button>
          <button
            onClick={toggleSidebar}
            className="ml-1 rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Conditional content based on app */}
      {isKairaBot ? (
        <KairaSidebarContent searchPlaceholder={appMetadata.searchPlaceholder} />
      ) : (
        <VoiceRxSidebarContent searchPlaceholder={appMetadata.searchPlaceholder} />
      )}

      <div className="border-t border-[var(--border-subtle)] p-3">
        <Link
          to={settingsPath}
          className={cn(
            'flex items-center gap-2 rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors',
            isSettingsActive
              ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]'
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </aside>
  );
}

function CollapsedNavLink({
  to,
  icon: Icon,
  title,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  const location = useLocation();
  const isActive = location.pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-[6px] transition-colors',
        isActive
          ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]'
      )}
      title={title}
    >
      <Icon className="h-5 w-5" />
    </Link>
  );
}
