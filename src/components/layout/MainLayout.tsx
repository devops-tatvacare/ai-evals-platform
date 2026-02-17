import { type ReactNode, useState, useCallback, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { useNavigate, useLocation } from 'react-router-dom';
import { useListingsLoader, useKeyboardShortcuts } from '@/hooks';
import { useAppStore } from '@/stores';
import { OfflineBanner, ShortcutsHelpModal } from '@/components/feedback';

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
    setCurrentApp(isKairaRoute ? 'kaira-bot' : 'voice-rx');
  }, [location.pathname, setCurrentApp]);

  // Load listings on mount
  useListingsLoader();

  const handleNewEval = () => {
    navigate('/');
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

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)]">
      <Sidebar onNewEval={handleNewEval} />
      <main className="flex-1 flex flex-col min-h-0 overflow-y-auto px-6 pt-6">
        {children}
      </main>
      <OfflineBanner />
      <ShortcutsHelpModal 
        isOpen={showShortcutsHelp} 
        onClose={() => setShowShortcutsHelp(false)} 
      />
    </div>
  );
}
