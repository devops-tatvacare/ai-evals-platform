import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MainLayout } from '@/components/layout';
import { VoiceRxSettingsPage, VoiceRxDashboard, VoiceRxRunList, VoiceRxRunDetail, VoiceRxLogs } from '@/features/voiceRx';
import { KairaBotSettingsPage, TagManagementPage } from '@/features/kairaBotSettings';
import {
  EvalDashboard,
  EvalRunList,
  EvalRunDetail,
  EvalThreadDetail,
  EvalAdversarialDetail,
  EvalLogs,
} from '@/features/evalRuns';
import { HomePage } from './pages/HomePage';
import { ListingPage } from './pages/ListingPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { KairaBotHomePage } from './pages/kaira';
import { routes } from '@/config/routes';

function RouteDebug() {
  const location = useLocation();
  console.log('[Router] Current path:', location.pathname);
  return null;
}

export function Router() {
  return (
    <BrowserRouter>
      <RouteDebug />
      <MainLayout>
        <Routes>
          {/* Voice Rx routes */}
          <Route path={routes.voiceRx.home} element={<Navigate to={routes.voiceRx.dashboard} replace />} />
          <Route path={routes.voiceRx.upload} element={<HomePage />} />
          <Route path="/listing/:id" element={<ListingPage />} />
          <Route path={routes.voiceRx.dashboard} element={<VoiceRxDashboard />} />
          <Route path="/runs/:runId" element={<VoiceRxRunDetail />} />
          <Route path={routes.voiceRx.runs} element={<VoiceRxRunList />} />
          <Route path={routes.voiceRx.logs} element={<VoiceRxLogs />} />
          <Route path={routes.voiceRx.settings} element={<VoiceRxSettingsPage />} />

          {/* Kaira Bot routes */}
          <Route path={routes.kaira.home} element={<Navigate to={routes.kaira.dashboard} replace />} />
          <Route path={routes.kaira.chat} element={<KairaBotHomePage />} />
          <Route path={routes.kaira.settings} element={<KairaBotSettingsPage />} />
          <Route path={routes.kaira.settingsTags} element={<TagManagementPage />} />

          {/* Kaira Evals routes */}
          <Route path={routes.kaira.dashboard} element={<EvalDashboard />} />
          <Route path={routes.kaira.runs} element={<EvalRunList />} />
          <Route path="/kaira/runs/:runId" element={<EvalRunDetail />} />
          <Route path="/kaira/runs/:runId/adversarial/:evalId" element={<EvalAdversarialDetail />} />
          <Route path="/kaira/threads/:threadId" element={<EvalThreadDetail />} />
          <Route path={routes.kaira.logs} element={<EvalLogs />} />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MainLayout>
    </BrowserRouter>
  );
}
