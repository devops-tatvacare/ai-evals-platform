import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MainLayout } from '@/components/layout';
import { VoiceRxSettingsPage } from '@/features/voiceRx';
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
          <Route path="/" element={<HomePage />} />
          <Route path="/listing/:id" element={<ListingPage />} />
          <Route path="/settings" element={<VoiceRxSettingsPage />} />
          
          {/* Kaira Bot routes */}
          <Route path="/kaira" element={<KairaBotHomePage />} />
          <Route path="/kaira/settings" element={<KairaBotSettingsPage />} />
          <Route path="/kaira/settings/tags" element={<TagManagementPage />} />

          {/* Kaira Evals routes */}
          <Route path="/kaira/dashboard" element={<EvalDashboard />} />
          <Route path="/kaira/runs" element={<EvalRunList />} />
          <Route path="/kaira/runs/:runId" element={<EvalRunDetail />} />
          <Route path="/kaira/runs/:runId/adversarial/:evalId" element={<EvalAdversarialDetail />} />
          <Route path="/kaira/threads/:threadId" element={<EvalThreadDetail />} />
          <Route path="/kaira/logs" element={<EvalLogs />} />
          
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MainLayout>
    </BrowserRouter>
  );
}
