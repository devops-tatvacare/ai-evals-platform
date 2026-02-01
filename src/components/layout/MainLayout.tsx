import { type ReactNode, useState, useCallback } from 'react';
import { Bug } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useNavigate } from 'react-router-dom';
import { useListingsLoader, useKeyboardShortcuts } from '@/hooks';
import { OfflineBanner, ShortcutsHelpModal } from '@/components/feedback';
import { DebugPanel } from '@/features/debug';

interface MainLayoutProps {
  children: ReactNode;
}

const isDev = import.meta.env.DEV;

export function MainLayout({ children }: MainLayoutProps) {
  const navigate = useNavigate();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  
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
      
      {/* Debug button - dev mode only, bottom center */}
      {isDev && (
        <>
          <button
            onClick={() => setShowDebugPanel(prev => !prev)}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 rounded-full bg-[var(--color-warning)] px-3 py-1.5 text-[11px] font-medium text-white shadow-lg hover:bg-[var(--color-warning)]/90 transition-colors"
            title="Toggle Debug Panel"
          >
            <Bug className="h-3.5 w-3.5" />
            Debug
          </button>
          <DebugPanel 
            isOpen={showDebugPanel} 
            onClose={() => setShowDebugPanel(false)} 
          />
        </>
      )}
    </div>
  );
}
