import { type ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { useLocation, Outlet } from 'react-router-dom';
import { useListingsLoader, useKeyboardShortcuts } from '@/hooks';
import { useAppStore, useMiniPlayerStore, useUIStore } from '@/stores';
import { useAuthStore } from '@/stores/authStore';
import { OfflineBanner, ShortcutsHelpModal } from '@/components/feedback';
import { Spinner } from '@/components/ui';
import { MiniPlayerConnector } from '@/features/transcript';
import { cn } from '@/utils';
import { firstAccessibleAppId, inferAppIdFromPath } from '@/config/routes';
import { JobCompletionWatcher } from '@/components/JobCompletionWatcher';
import { NewBatchEvalOverlay, NewAdversarialOverlay } from '@/features/evalRuns/components';
import { NewInsideSalesEvalOverlay } from '@/features/insideSales/components/NewInsideSalesEvalOverlay';
import { useFileUpload } from '@/features/upload';
import { ACCEPTED_AUDIO_EXTENSIONS, validateAudioFiles } from '@/features/upload/utils/fileValidation';
import { APP_IDS } from '@/types';
import { ChatWidget } from '@/features/chat-widget/ChatWidget';
import { ReviewBorderGlow } from '@/features/reviews/ReviewBorderGlow';
import { ReviewPersistentBar } from '@/features/reviews/ReviewPersistentBar';
import { ReviewNavigationBlocker } from '@/features/reviews/ReviewNavigationBlocker';

interface MainLayoutProps {
  children?: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
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

  // Voice Rx upload — triggered from the sidebar +New popover. The hidden
  // <input type="file"> lives in this layout so the selector survives page
  // navigation and upload progress can render as a floating card.
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const { uploadFiles, isUploading, progress, error: uploadError } = useFileUpload();

  const triggerVoiceRxUpload = useCallback(() => {
    const el = audioInputRef.current;
    if (!el) return;
    // Reset value so selecting the same file twice still fires change.
    el.value = '';
    el.click();
  }, []);

  const handleAudioInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      if (files.length === 0) return;
      const validated = validateAudioFiles(files).filter((f) => !f.error);
      if (validated.length === 0) return;
      uploadFiles(validated);
    },
    [uploadFiles],
  );

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
      <Sidebar onVoiceRxUpload={triggerVoiceRxUpload} />
      <div className="relative flex-1 flex flex-col min-h-0 min-w-0">
        <ReviewBorderGlow />
        <main className={cn('flex-1 flex flex-col min-h-0 overflow-y-auto px-6 pt-6', miniPlayerOpen ? 'pb-20' : 'pb-6')}>
          {children ?? <Outlet />}
        </main>
        <ReviewPersistentBar />
        <ReviewNavigationBlocker />
      </div>
      <MiniPlayerConnector />
      <JobCompletionWatcher />
      {activeModal === 'batchEval' && <NewBatchEvalOverlay onClose={closeModal} />}
      {activeModal === 'adversarialTest' && <NewAdversarialOverlay onClose={closeModal} />}
      {activeModal === 'insideSalesEval' && <NewInsideSalesEvalOverlay onClose={closeModal} />}
      <input
        ref={audioInputRef}
        type="file"
        multiple
        accept={ACCEPTED_AUDIO_EXTENSIONS.join(',')}
        onChange={handleAudioInputChange}
        className="hidden"
        aria-hidden="true"
      />
      {isUploading && (
        <div className="fixed bottom-6 right-6 z-[var(--z-popover)] w-72 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <Spinner size="sm" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-[var(--text-primary)]">
                Processing files...
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-secondary)]">
                <div
                  className="h-full bg-[var(--color-brand-primary)] transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <div className="text-[11px] text-[var(--text-muted)] tabular-nums">{progress}%</div>
          </div>
          {uploadError && (
            <div className="mt-2 text-[11px] text-[var(--color-error)]">{uploadError}</div>
          )}
        </div>
      )}
      <ChatWidget />
      <OfflineBanner />
      <ShortcutsHelpModal
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
      />
    </div>
  );
}
