import { type ReactNode, useState, useCallback, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useListingsLoader, useKeyboardShortcuts } from '@/hooks';
import { useAppStore, useMiniPlayerStore, useUIStore } from '@/stores';
import { useAuthStore } from '@/stores/authStore';
import { OfflineBanner, ShortcutsHelpModal } from '@/components/feedback';
import { MiniPlayerConnector } from '@/features/transcript';
import { cn } from '@/utils';
import { firstAccessibleAppId, inferAppIdFromPath, routes } from '@/config/routes';
import { JobCompletionWatcher } from '@/components/JobCompletionWatcher';
import { NewBatchEvalOverlay, NewAdversarialOverlay } from '@/features/evalRuns/components';
import { NewInsideSalesEvalOverlay } from '@/features/insideSales/components/NewInsideSalesEvalOverlay';
import { APP_IDS } from '@/types';
import { ChatWidget } from '@/features/chat-widget/ChatWidget';
import { ReviewUniverse } from '@/features/reviews/ReviewUniverse';

interface MainLayoutProps {
  children?: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const setCurrentApp = useAppStore((state) => state.setCurrentApp);
  const loadAppConfigs = useAppStore((state) => state.loadAppConfigs);
  const currentApp = useAppStore((state) => state.currentApp);
  const user = useAuthStore((state) => state.user);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);

  // Sync app store from route — route is the single source of truth
  useEffect(() => {
    const candidateApps = user?.isOwner ? APP_IDS : user?.appAccess ?? APP_IDS;
    const newApp = inferAppIdFromPath(location.pathname, candidateApps) ?? firstAccessibleAppId(candidateApps);
    if (!newApp || newApp === currentApp) {
      return;
    }
    setCurrentApp(newApp);
    useMiniPlayerStore.getState().closeIfAppChanged(newApp);
  }, [currentApp, location.pathname, setCurrentApp, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const accessibleApps = user.isOwner
      ? APP_IDS
      : APP_IDS.filter((appId) => user.appAccess.includes(appId));

    void loadAppConfigs(accessibleApps);
  }, [loadAppConfigs, user]);

  // Load listings on mount
  useListingsLoader();

  const handleNewEval = () => {
    navigate(routes.voiceRx.upload);
  };

  // Global keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: '?',
      shift: true,
      action: useCallback(() => setShowShortcutsHelp(true), []),
      description: 'Show keyboard shortcuts help',
    },
  ]);

  const miniPlayerOpen = useMiniPlayerStore((s) => s.isOpen);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)]">
      <Sidebar onNewEval={handleNewEval} />
      <main className={cn('flex-1 flex flex-col min-h-0 overflow-y-auto px-6 pt-6', miniPlayerOpen && 'pb-20')}>
        {children ?? <Outlet />}
      </main>
      <MiniPlayerConnector />
      <JobCompletionWatcher />
      {activeModal === 'batchEval' && <NewBatchEvalOverlay onClose={closeModal} />}
      {activeModal === 'adversarialTest' && <NewAdversarialOverlay onClose={closeModal} />}
      {activeModal === 'insideSalesEval' && <NewInsideSalesEvalOverlay onClose={closeModal} />}
      <ChatWidget />
      <ReviewUniverse />
      <OfflineBanner />
      <ShortcutsHelpModal
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
      />
    </div>
  );
}
