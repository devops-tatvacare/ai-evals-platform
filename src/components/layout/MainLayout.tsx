import { type ReactNode, useState, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { useNavigate } from 'react-router-dom';
import { useListingsLoader, useKeyboardShortcuts } from '@/hooks';
import { OfflineBanner, ShortcutsHelpModal } from '@/components/feedback';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const navigate = useNavigate();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  
  // Load listings from IndexedDB on mount
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
      <main className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6">
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
