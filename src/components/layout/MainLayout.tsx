import { type ReactNode, useState, useCallback, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { useNavigate, useLocation } from 'react-router-dom';
import { useListingsLoader, useKeyboardShortcuts } from '@/hooks';
import { useAppStore, useMiniPlayerStore } from '@/stores';
import { OfflineBanner, ShortcutsHelpModal } from '@/components/feedback';
import { MiniPlayerConnector } from '@/features/transcript';
import { cn } from '@/utils';
import { routes } from '@/config/routes';
import { JobCompletionWatcher } from '@/components/JobCompletionWatcher';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const setCurrentApp = useAppStore((state) => state.setCurrentApp);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Sync app store from route — route is the single source of truth
  useEffect(() => {
    const isKairaRoute = location.pathname.startsWith('/kaira');
    const newApp = isKairaRoute ? 'kaira-bot' : 'voice-rx';
    setCurrentApp(newApp);
    useMiniPlayerStore.getState().closeIfAppChanged(newApp);
  }, [location.pathname, setCurrentApp]);

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
        {children}
      </main>
      <MiniPlayerConnector />
      <JobCompletionWatcher />
      <OfflineBanner />
      <ShortcutsHelpModal
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
      />
    </div>
  );
}
